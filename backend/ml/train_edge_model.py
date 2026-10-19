"""
Train the pooled "edge" model: how far a player's actual stat lands from the
sportsbook line, given the same features the per-prop models use plus the line.

    python3 backend/ml/train_edge_model.py [--in backend/data/predictions_export_fv.json] [--min-rows 5000]

Input: evaluated predictions with feature vectors and betting lines, in
predictionTrackingService's raw format (pull them from production with
`node backend/scripts/pullPredictions.mjs --features --out backend/data/predictions_export_fv.json`).

One model covers every prop type (a prop one-hot is a feature) because the
props share structure and together give ~30k rows where each prop alone has
~3-4k. Target: actual - line. The model is evaluated on the last 20% of dates
before the final fit on everything; the out-of-sample predictions also fit the
logistic map from predicted residual to P(over) that the server uses.

Outputs (backend/ml/models/):
    edge_xgb_model.json      the booster
    edge_xgb_metadata.json   feature names, prop list, probability map, metrics
"""

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.linear_model import LogisticRegression

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
from edge_features import (PROPS, STAT_PARTS, FAMILIES, derived_features as _derived_features,  # noqa: E402
                           opponent_context, minutes_under_share)

MODELS_DIR = os.path.join(SCRIPT_DIR, 'models')
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'data')
DEFAULT_IN = os.path.join(DATA_DIR, 'predictions_export_fv.json')
DEFAULT_GAMELOGS = os.path.join(DATA_DIR, 'backfill_gamelogs.json')      # backend/scripts/backfillGameLogs.mjs
DEFAULT_TEAM_STATS = os.path.join(DATA_DIR, 'team_game_stats.json')      # backend/scripts/refreshTeamGameStats.mjs
# Serve-time features that were constant in the stored history (old feature
# builder); the model must not learn from them.
EXCLUDE = {'is_home', 'fg_pct_avg_10', 'fg_pct_trend', 'win_streak', 'loss_streak',
           'recent_win_pct', 'plus_minus_avg_10'}

XGB_PARAMS = dict(
    objective='reg:squarederror', max_depth=4, eta=0.03, subsample=0.8,
    colsample_bytree=0.7, min_child_weight=20, reg_lambda=5.0, seed=42,
)
N_ROUNDS = 400


def derived_features(row, prop, line, ctx=None):
    """Line-relative + context features; mirrored in mlPredictionService.buildEdgeRow
    (the shared implementation lives in edge_features.py)."""
    return _derived_features(row, prop, line, ctx)


def _load_json(path):
    if not path or not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


class Backfill:
    """Opponent, home flag and minutes for stored rows, from the players' ESPN
    game logs and the team box-score file (both fetched by scripts in
    backend/scripts). Rows carry only their feature vector, so the game is
    found by its date; the stat in that game must match the stored actual."""

    def __init__(self, gamelogs_path, team_stats_path):
        logs = _load_json(gamelogs_path) or {}
        self.players = logs.get('players', {})
        self.team_stats = _load_json(team_stats_path)
        self.hits = self.misses = self.mismatches = 0

    @staticmethod
    def _stat(game, prop):
        parts = {'pts': game['pts'], 'reb': game['reb'], 'ast': game['ast'], 'threes': game['fg3m']}
        return sum(parts[p] for p in STAT_PARTS[prop])

    @staticmethod
    def iso_date(value):
        """Stored game dates are ISO from the cron and "Oct 20, 2026" from the player page."""
        value = str(value or '')
        if value[:4].isdigit() and value[4:5] == '-':
            return value[:10]
        for fmt in ('%b %d, %Y', '%B %d, %Y'):
            try:
                return datetime.strptime(value, fmt).strftime('%Y-%m-%d')
            except ValueError:
                pass
        return ''

    def game_for(self, record):
        """The backfilled game this record predicted, or None."""
        games = self.players.get(record.get('player_name'), {}).get('games') or []
        target = self.iso_date((record.get('next_game') or {}).get('date'))
        if not games or not target:
            self.misses += 1
            return None
        hist = record.get('game_history_hash') or ''
        last_hist = hist.split('|')[0][:10] if hist else ''
        try:
            limit = (datetime.strptime(target, '%Y-%m-%d') + timedelta(days=2)).strftime('%Y-%m-%d')
        except ValueError:
            limit = target
        # The stored game date can be a day off (UTC vs local), so take the
        # first game after the history that is not past the target
        candidates = [g for g in games if g['d'] > last_hist and g['d'] <= limit]
        exact = [g for g in candidates if g['d'] == target]
        game = (exact or candidates or [None])[0]
        if game is None:
            self.misses += 1
            return None
        actual = record.get('actual_value')
        if actual is not None and abs(self._stat(game, record.get('prop_type', 'points')) - float(actual)) > 0.5:
            self.mismatches += 1
            return None
        self.hits += 1
        return game

    def minutes_before(self, record, game):
        """Minutes of the games the feature vector was built from, oldest first."""
        games = self.players.get(record.get('player_name'), {}).get('games') or []
        by_date = {g['d']: g['min'] for g in games}
        dates = [part[:10] for part in (record.get('game_history_hash') or '').split('|') if part]
        mins = [by_date[d] for d in reversed(dates) if d in by_date]
        return mins

    def context(self, record):
        """({'opponent':..., 'risk':...}, is_home, min_under25_share_10) for one record."""
        stored = record.get('edge_context') or {}
        game = self.game_for(record)
        opponent = (game['o'] if game else None) or stored.get('opponent') or (record.get('next_game') or {}).get('opponent')
        game_date = (game['d'] if game else None) or self.iso_date(stored.get('game_date') or (record.get('next_game') or {}).get('date'))
        opp_ctx = opponent_context(opponent, game_date, self.team_stats) if opponent and game_date else None
        is_home = game['h'] if game else stored.get('is_home')
        mins = self.minutes_before(record, game) if game else []
        share = minutes_under_share(mins) if len(mins) >= 10 else None
        risk = {'game_spread_abs': stored.get('game_spread_abs'), 'teammates_out_key': stored.get('teammates_out_key')}
        return {'opponent': opp_ctx, 'risk': risk}, is_home, share


def load_rows(path, families=(), backfill=None):
    """families: subset of edge_features.FAMILIES to include ('market', 'opponent', 'risk').
    Features of other families are dropped so an ablation sees nothing of them."""
    with open(path) as f:
        data = json.load(f)
    preds = data.get('predictions', data)
    drop = {k for fam, keys in FAMILIES.items() if fam not in families for k in keys}
    exclude = EXCLUDE | drop
    rows = []
    for p in preds:
        fv = p.get('feature_vector')
        line = p.get('betting_line')
        actual = p.get('actual_value')
        prop = p.get('prop_type', 'points')
        if not fv or not line or actual is None or prop not in PROPS:
            continue
        if p.get('expired') or p.get('dnp'):
            continue
        if actual == line:
            continue  # push: no direction to learn
        ctx = {'market': p.get('market')}
        fv = dict(fv)
        if backfill is not None:
            more, is_home, share = backfill.context(p)
            ctx.update(more)
            if is_home is not None:
                fv['is_home'] = int(bool(is_home))
            if share is not None or 'min_under25_share_10' not in fv:
                fv['min_under25_share_10'] = share
        row = {k: v for k, v in fv.items() if k not in exclude}
        row.update({k: v for k, v in derived_features(fv, prop, float(line), ctx).items() if k not in exclude})
        row['_prop'] = prop
        row['_date'] = (p.get('created_at') or '')[:10]
        row['_target'] = float(actual) - float(line)
        rows.append(row)
    df = pd.DataFrame(rows)
    return df.astype({c: float for c in df.columns if not c.startswith('_')})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', default=DEFAULT_IN)
    ap.add_argument('--min-rows', type=int, default=5000)
    ap.add_argument('--families', default='market,opponent,risk',
                    help='comma list of context feature families to include (market, opponent, risk); "" for none')
    ap.add_argument('--gamelogs', default=DEFAULT_GAMELOGS, help='backfilled player game logs (opponent/home/minutes for stored rows)')
    ap.add_argument('--team-stats', default=DEFAULT_TEAM_STATS, help='team box-score file (opponent allowances)')
    ap.add_argument('--no-save', action='store_true', help='report held-out metrics only; leave the saved model alone')
    ap.add_argument('--seeds', type=int, default=1,
                    help='also report held-out metrics averaged over this many seeds (column sampling makes one run noisy)')
    args = ap.parse_args()

    families = [f for f in args.families.split(',') if f]
    backfill = Backfill(args.gamelogs, args.team_stats) if any(f in families for f in ('opponent', 'risk')) else None
    df = load_rows(args.inp, families, backfill)
    if backfill is not None:
        print(f'backfill: {backfill.hits} rows matched to a game, {backfill.misses} unmatched, {backfill.mismatches} stat mismatches')
    if len(df) < args.min_rows:
        print(f'Only {len(df)} usable rows (< {args.min_rows}); not training')
        sys.exit(1)
    feature_names = sorted(c for c in df.columns if not c.startswith('_'))
    df = df.sort_values('_date').reset_index(drop=True)
    print(f'{len(df)} rows, {len(feature_names)} features, {df["_date"].min()} .. {df["_date"].max()}; families: {families or "none"}')
    untrained = [c for c in feature_names if df[c].isna().all()]
    coverage = {c: float(df[c].notna().mean()) for c in feature_names if df[c].isna().any()}
    if coverage:
        print('  partly missing: ' + ', '.join(f'{k} {v:.0%}' for k, v in sorted(coverage.items())))

    # Time split for honest metrics and the probability map
    cut = df['_date'].iloc[int(len(df) * 0.8)]
    train = df[df['_date'] < cut]
    test = df[df['_date'] >= cut]
    dtrain = xgb.DMatrix(train[feature_names].values, label=train['_target'].values, feature_names=feature_names)
    dtest = xgb.DMatrix(test[feature_names].values, feature_names=feature_names)
    booster = xgb.train(XGB_PARAMS, dtrain, N_ROUNDS)
    r = booster.predict(dtest)
    y = test['_target'].values
    if args.seeds > 1:
        # Seed-averaged held-out numbers: one fit moves by a point or two just
        # from column subsampling, so family comparisons use this block
        acc = {lo: [] for lo in (0.5, 1.0, 2.0)}
        maes = []
        for seed in range(args.seeds):
            b = xgb.train(dict(XGB_PARAMS, seed=seed), dtrain, N_ROUNDS)
            rs = b.predict(dtest)
            maes.append(float(np.mean(np.abs(y - rs))))
            for lo in acc:
                m = np.abs(rs) >= lo
                acc[lo].append(float(np.mean((rs[m] > 0) == (y[m] > 0))) if m.sum() else float('nan'))
        print(f'Seed-averaged ({args.seeds} seeds): MAE {np.mean(maes):.4f}; ' +
              '; '.join(f'>= {lo}: {np.nanmean(v):.4f} (sd {np.nanstd(v):.4f})' for lo, v in acc.items()))
    line = test['line'].values
    over = (y > 0).astype(int)

    metrics = {
        'test_rows': int(len(test)), 'test_from': cut,
        'mae_line': float(np.mean(np.abs(y))), 'mae_model': float(np.mean(np.abs(y - r))),
        'sign_accuracy': float(np.mean((r > 0) == (y > 0))),
        'by_min_abs_residual': {},
        'by_prop': {},
    }
    for lo in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0):
        m = np.abs(r) >= lo
        if m.sum() >= 50:
            metrics['by_min_abs_residual'][str(lo)] = {'n': int(m.sum()), 'sign_accuracy': float(np.mean((r[m] > 0) == (y[m] > 0)))}
    for prop in PROPS:
        m = (test['_prop'] == prop).values
        if m.sum():
            metrics['by_prop'][prop] = {'n': int(m.sum()), 'sign_accuracy': float(np.mean((r[m] > 0) == (y[m] > 0))),
                                        'under_rate': float(1 - over[m].mean())}

    # P(over) from the predicted residual, absolute and relative to the line
    X = np.column_stack([r, r / line])
    lr = LogisticRegression(C=1.0).fit(X, over)
    prob = lr.predict_proba(X)[:, 1]
    bins = {}
    for lo in range(30, 71, 5):
        m = (prob * 100 >= lo) & (prob * 100 < lo + 5)
        if m.sum() >= 30:
            bins[f'{lo}-{lo + 5}'] = {'n': int(m.sum()), 'actual_over': float(over[m].mean())}
    metrics['prob_bins'] = bins
    prob_map = {'intercept': float(lr.intercept_[0]), 'coef_residual': float(lr.coef_[0][0]),
                'coef_residual_over_line': float(lr.coef_[0][1])}

    print(f"\nOut of sample ({len(test)} rows from {cut}):")
    print(f"  MAE vs line {metrics['mae_line']:.3f} -> model {metrics['mae_model']:.3f}; sign accuracy {metrics['sign_accuracy']:.3f}")
    for k, v in metrics['by_min_abs_residual'].items():
        print(f"  |residual| >= {k}: n={v['n']} sign accuracy {v['sign_accuracy']:.3f}")
    for k, v in metrics['by_prop'].items():
        print(f"  {k:9s} n={v['n']} sign accuracy {v['sign_accuracy']:.3f} (always-under {v['under_rate']:.3f})")
    print('  stated P(over) vs actual:', ', '.join(f"{k}: {v['actual_over']:.2f} ({v['n']})" for k, v in bins.items()))

    if args.no_save:
        print('\n--no-save: model not written')
        return

    # Final fit on everything
    dall = xgb.DMatrix(df[feature_names].values, label=df['_target'].values, feature_names=feature_names)
    final = xgb.train(XGB_PARAMS, dall, N_ROUNDS)
    os.makedirs(MODELS_DIR, exist_ok=True)
    final.save_model(os.path.join(MODELS_DIR, 'edge_xgb_model.json'))
    importance = final.get_score(importance_type='gain')
    top = sorted(importance.items(), key=lambda kv: -kv[1])[:15]
    metadata = {
        'model': 'edge', 'target': 'actual - line', 'trained_at': date.today().isoformat(),
        'rows': int(len(df)), 'date_range': [df['_date'].min(), df['_date'].max()],
        'feature_names': feature_names, 'props': PROPS, 'excluded_features': sorted(EXCLUDE),
        'context_families': families, 'untrained_features': untrained, 'feature_coverage': coverage,
        'xgb_params': XGB_PARAMS, 'n_rounds': N_ROUNDS,
        'probability_map': prob_map, 'metrics': metrics,
        'top_features': [{'name': k, 'gain': round(v, 2)} for k, v in top],
    }
    with open(os.path.join(MODELS_DIR, 'edge_xgb_metadata.json'), 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"\nSaved edge model ({len(df)} rows). Top features: {', '.join(k for k, _ in top[:8])}")


if __name__ == '__main__':
    main()
