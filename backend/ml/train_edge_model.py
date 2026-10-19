"""
Train the pooled "edge" model: how far a player's actual stat lands from the
sportsbook line, given the same features the per-prop models use plus the line.

    # bootstrap / unconditional: train and write the live model
    python3 backend/ml/train_edge_model.py [--in FILE] [--min-rows 5000]

    # gated retrain (what the weekly workflow runs)
    python3 backend/ml/train_edge_model.py --candidate [--in FILE]
    python3 backend/ml/train_edge_model.py --promote [--force] [--tolerance 0.0]
    python3 backend/ml/train_edge_model.py --candidate --promote   # both in one go

Input: evaluated predictions with feature vectors and betting lines, in
predictionTrackingService's raw format (pull them from production with
`node backend/scripts/pullPredictions.mjs --features --out backend/data/predictions_export_fv.json`).

One model covers every prop type (a prop one-hot is a feature) because the
props share structure and together give ~30k rows where each prop alone has
~3-4k. Target: actual - line. The model is evaluated on the last 20% of dates
before the final fit on everything; the out-of-sample predictions also fit the
logistic map from predicted residual to P(over) that the server uses.

--candidate trains exactly as above but writes
    models/edge_xgb_model.candidate.json
    models/edge_xgb_metadata.candidate.json   (gitignored)
and, when a live model exists, scores the live model on the candidate's
held-out slice with the live model's own probability map, storing those
numbers under metadata["incumbent"]. Note the live model was last fitted on
everything it had seen, so held-out rows older than its training end date are
in-sample for it (the comparison favours the incumbent); the metadata also
reports the subset of held-out rows newer than the incumbent's training data.

--promote reads the candidate metadata and replaces the live model only when
    sign accuracy at |predicted residual| >= 1.0 is at least as good
    (candidate >= incumbent - tolerance), and
    log loss of the probability map is no worse (candidate <= incumbent).
The comparison uses the held-out rows newer than the incumbent's training
data when there are at least MIN_FRESH_ROWS of them (the only rows that are
out of sample for both models); with fewer it falls back to the whole held-out
slice, which is in-sample for the incumbent and so almost never promotes.
Both sets of numbers and the decision are printed and written to
backend/data/edge_promotion.json ({"promoted": true|false, ...}) for the
workflow to read. --force promotes regardless of the gates. With no live model
the candidate is promoted outright.

Outputs (backend/ml/models/):
    edge_xgb_model.json      the booster
    edge_xgb_metadata.json   feature names, prop list, probability map, metrics
"""

import argparse
import json
import os
import shutil
import sys
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.linear_model import LogisticRegression

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, 'models')
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'data')
DEFAULT_IN = os.path.join(DATA_DIR, 'predictions_export_fv.json')
DECISION_FILE = os.path.join(DATA_DIR, 'edge_promotion.json')

MODEL_FILE = 'edge_xgb_model.json'
META_FILE = 'edge_xgb_metadata.json'
CAND_MODEL_FILE = 'edge_xgb_model.candidate.json'
CAND_META_FILE = 'edge_xgb_metadata.candidate.json'

PROPS = ['points', 'rebounds', 'assists', 'threes', 'pra', 'pr', 'pa', 'ra']
STAT_PARTS = {
    'points': ['pts'], 'rebounds': ['reb'], 'assists': ['ast'], 'threes': ['threes'],
    'pra': ['pts', 'reb', 'ast'], 'pr': ['pts', 'reb'], 'pa': ['pts', 'ast'], 'ra': ['reb', 'ast'],
}
# Serve-time features that were constant in the stored history (old feature
# builder); the model must not learn from them.
EXCLUDE = {'is_home', 'fg_pct_avg_10', 'fg_pct_trend', 'win_streak', 'loss_streak',
           'recent_win_pct', 'plus_minus_avg_10'}

XGB_PARAMS = dict(
    objective='reg:squarederror', max_depth=4, eta=0.03, subsample=0.8,
    colsample_bytree=0.7, min_child_weight=20, reg_lambda=5.0, seed=42,
)
N_ROUNDS = 400
GATE_THRESHOLD = '1.0'   # |residual| bucket the sign-accuracy gate uses
RESIDUAL_THRESHOLDS = (0.0, 0.5, 1.0, 1.5, 2.0, 3.0)
MIN_FRESH_ROWS = 500     # held-out rows newer than the incumbent needed for a fair comparison


def derived_features(row, prop, line):
    """Line-relative features; mirrored in mlPredictionService.buildEdgeRow."""
    out = {}
    for win in ('3', '5', '10', 'season'):
        out[f'stat_avg_{win}'] = sum(float(row.get(f'{part}_avg_{win}', 0) or 0) for part in STAT_PARTS[prop])
    out['line'] = line
    out['line_minus_avg10'] = line - out['stat_avg_10']
    out['line_minus_avg5'] = line - out['stat_avg_5']
    out['line_minus_season'] = line - out['stat_avg_season']
    out['line_over_avg10'] = line / max(out['stat_avg_10'], 0.5)
    for p in PROPS:
        out[f'prop_{p}'] = 1 if p == prop else 0
    return out


def load_rows(path):
    with open(path) as f:
        data = json.load(f)
    preds = data.get('predictions', data)
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
        row = {k: v for k, v in fv.items() if k not in EXCLUDE}
        row.update(derived_features(fv, prop, float(line)))
        row['_prop'] = prop
        row['_date'] = (p.get('created_at') or '')[:10]
        row['_target'] = float(actual) - float(line)
        rows.append(row)
    return pd.DataFrame(rows)


def time_split(df):
    """Last 20% of dates held out; returns (cut_date, train, test)."""
    cut = df['_date'].iloc[int(len(df) * 0.8)]
    return cut, df[df['_date'] < cut], df[df['_date'] >= cut]


def fit_booster(df, feature_names):
    d = xgb.DMatrix(df[feature_names].values, label=df['_target'].values, feature_names=feature_names)
    return xgb.train(XGB_PARAMS, d, N_ROUNDS)


def matrix_for(booster, df):
    """DMatrix in the booster's own feature order (missing columns -> 0, with a warning)."""
    names = booster.feature_names
    missing = [n for n in names if n not in df.columns]
    if missing:
        print(f'  warning: {len(missing)} features missing from this data, filled with 0: {missing[:6]}')
    X = pd.DataFrame({n: (df[n].values if n in df.columns else np.zeros(len(df))) for n in names})
    return xgb.DMatrix(X.values, feature_names=names)


def prob_from_map(prob_map, r, line):
    z = prob_map['intercept'] + prob_map['coef_residual'] * r + prob_map['coef_residual_over_line'] * (r / line)
    return 1.0 / (1.0 + np.exp(-z))


def fit_prob_map(r, line, over):
    X = np.column_stack([r, r / line])
    lr = LogisticRegression(C=1.0).fit(X, over)
    return {'intercept': float(lr.intercept_[0]), 'coef_residual': float(lr.coef_[0][0]),
            'coef_residual_over_line': float(lr.coef_[0][1])}


def score(booster, test, cut, prob_map=None):
    """Held-out metrics for a booster on `test`. Fits the probability map on
    the held-out predictions unless one is given (incumbent). Returns
    (metrics, prob_map)."""
    r = booster.predict(matrix_for(booster, test))
    y = test['_target'].values
    line = test['line'].values
    over = (y > 0).astype(int)
    if prob_map is None:
        prob_map = fit_prob_map(r, line, over)
    prob = np.clip(prob_from_map(prob_map, r, line), 1e-6, 1 - 1e-6)

    metrics = {
        'test_rows': int(len(test)), 'test_from': cut,
        'mae_line': float(np.mean(np.abs(y))), 'mae_model': float(np.mean(np.abs(y - r))),
        'sign_accuracy': float(np.mean((r > 0) == (y > 0))),
        'log_loss': float(-np.mean(over * np.log(prob) + (1 - over) * np.log(1 - prob))),
        'brier': float(np.mean((prob - over) ** 2)),
        'by_min_abs_residual': {},
        'by_prop': {},
        'prob_bins': {},
    }
    for lo in RESIDUAL_THRESHOLDS:
        m = np.abs(r) >= lo
        metrics['by_min_abs_residual'][str(lo)] = {
            'n': int(m.sum()),
            'sign_accuracy': float(np.mean((r[m] > 0) == (y[m] > 0))) if m.sum() else None,
        }
    for prop in PROPS:
        m = (test['_prop'] == prop).values
        if m.sum():
            metrics['by_prop'][prop] = {'n': int(m.sum()), 'sign_accuracy': float(np.mean((r[m] > 0) == (y[m] > 0))),
                                        'under_rate': float(1 - over[m].mean())}
    for lo in range(30, 71, 5):
        m = (prob * 100 >= lo) & (prob * 100 < lo + 5)
        if m.sum() >= 30:
            metrics['prob_bins'][f'{lo}-{lo + 5}'] = {'n': int(m.sum()), 'actual_over': float(over[m].mean())}
    return metrics, prob_map


def print_metrics(label, m):
    print(f"\n{label} ({m['test_rows']} held-out rows from {m['test_from']}):")
    print(f"  MAE vs line {m['mae_line']:.3f} -> model {m['mae_model']:.3f}; sign accuracy {m['sign_accuracy']:.3f}; "
          f"log loss {m['log_loss']:.4f}; brier {m['brier']:.4f}")
    for k, v in m['by_min_abs_residual'].items():
        sa = '-' if v['sign_accuracy'] is None else f"{v['sign_accuracy']:.3f}"
        print(f"  |residual| >= {k}: n={v['n']} sign accuracy {sa}")
    for k, v in m['by_prop'].items():
        print(f"  {k:9s} n={v['n']} sign accuracy {v['sign_accuracy']:.3f} (always-under {v['under_rate']:.3f})")
    if m['prob_bins']:
        print('  stated P(over) vs actual:', ', '.join(f"{k}: {v['actual_over']:.2f} ({v['n']})" for k, v in m['prob_bins'].items()))


def build_metadata(final, df, feature_names, prob_map, metrics):
    importance = final.get_score(importance_type='gain')
    top = sorted(importance.items(), key=lambda kv: -kv[1])[:15]
    return {
        'model': 'edge', 'target': 'actual - line', 'trained_at': date.today().isoformat(),
        'rows': int(len(df)), 'date_range': [df['_date'].min(), df['_date'].max()],
        'feature_names': feature_names, 'props': PROPS, 'excluded_features': sorted(EXCLUDE),
        'xgb_params': XGB_PARAMS, 'n_rounds': N_ROUNDS,
        'probability_map': prob_map, 'metrics': metrics,
        'top_features': [{'name': k, 'gain': round(v, 2)} for k, v in top],
    }


def load_live(models_dir):
    model_path = os.path.join(models_dir, MODEL_FILE)
    meta_path = os.path.join(models_dir, META_FILE)
    if not (os.path.exists(model_path) and os.path.exists(meta_path)):
        return None, None
    booster = xgb.Booster()
    booster.load_model(model_path)
    with open(meta_path) as f:
        meta = json.load(f)
    return booster, meta


def train(args, candidate):
    df = load_rows(args.inp)
    if len(df) < args.min_rows:
        print(f'Only {len(df)} usable rows (< {args.min_rows}); not training')
        sys.exit(1)
    feature_names = sorted(c for c in df.columns if not c.startswith('_'))
    df = df.sort_values('_date').reset_index(drop=True)
    print(f'{len(df)} rows, {len(feature_names)} features, {df["_date"].min()} .. {df["_date"].max()}')

    cut, train_df, test = time_split(df)
    booster = fit_booster(train_df, feature_names)
    metrics, prob_map = score(booster, test, cut)
    print_metrics('Candidate' if candidate else 'Out of sample', metrics)

    final = fit_booster(df, feature_names)
    metadata = build_metadata(final, df, feature_names, prob_map, metrics)

    if candidate:
        live, live_meta = load_live(args.models_dir)
        if live is not None:
            inc_metrics, _ = score(live, test, cut, prob_map=live_meta['probability_map'])
            trained_to = (live_meta.get('date_range') or ['', ''])[1]
            fresh = test[test['_date'] > trained_to]
            incumbent = {
                'trained_at': live_meta.get('trained_at'), 'rows': live_meta.get('rows'),
                'date_range': live_meta.get('date_range'), 'metrics': inc_metrics,
                'heldout_rows_after_incumbent_training': int(len(fresh)),
            }
            if len(fresh) >= MIN_FRESH_ROWS:
                incumbent['fresh_metrics'], _ = score(live, fresh, fresh['_date'].min(), prob_map=live_meta['probability_map'])
                metadata['candidate_fresh_metrics'], _ = score(booster, fresh, fresh['_date'].min(), prob_map=prob_map)
            metadata['incumbent'] = incumbent
            print_metrics(f"Incumbent (trained {incumbent['trained_at']} on {incumbent['rows']} rows)", inc_metrics)
            print(f"  ({len(fresh)} of the held-out rows are newer than the incumbent's training data; "
                  f"the rest are in-sample for it)")
        else:
            print('\nNo live edge model found; the candidate will be promoted outright.')
        model_out, meta_out = CAND_MODEL_FILE, CAND_META_FILE
    else:
        model_out, meta_out = MODEL_FILE, META_FILE

    os.makedirs(args.models_dir, exist_ok=True)
    final.save_model(os.path.join(args.models_dir, model_out))
    with open(os.path.join(args.models_dir, meta_out), 'w') as f:
        json.dump(metadata, f, indent=2)
    top = metadata['top_features']
    print(f"\nSaved {'candidate' if candidate else 'edge'} model ({len(df)} rows) to {os.path.relpath(os.path.join(args.models_dir, model_out))}. "
          f"Top features: {', '.join(t['name'] for t in top[:8])}")


def gate_numbers(m):
    bucket = m['by_min_abs_residual'].get(GATE_THRESHOLD) or {}
    return {'sign_accuracy_at_1': bucket.get('sign_accuracy'), 'n_at_1': bucket.get('n', 0),
            'log_loss': m['log_loss'], 'sign_accuracy': m['sign_accuracy']}


def promote(args):
    cand_meta_path = os.path.join(args.models_dir, CAND_META_FILE)
    cand_model_path = os.path.join(args.models_dir, CAND_MODEL_FILE)
    if not (os.path.exists(cand_meta_path) and os.path.exists(cand_model_path)):
        print('No candidate model found; run with --candidate first')
        sys.exit(1)
    with open(cand_meta_path) as f:
        cand = json.load(f)
    c = gate_numbers(cand['metrics'])
    inc = cand.get('incumbent')
    decision = {
        'decided_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'candidate': {'trained_at': cand['trained_at'], 'rows': cand['rows'], 'date_range': cand['date_range'], **c},
        'incumbent': None, 'tolerance': args.tolerance, 'forced': bool(args.force),
        'gates': {},
    }
    print('\nPromotion check (held-out slice from %s, %d rows)' % (cand['metrics']['test_from'], cand['metrics']['test_rows']))
    print(f"  candidate : sign acc @|r|>=1 {fmt(c['sign_accuracy_at_1'])} (n={c['n_at_1']}), log loss {c['log_loss']:.4f}, overall sign acc {c['sign_accuracy']:.3f}")
    if inc is None:
        promoted, reason = True, 'no live model'
        print('  incumbent : none')
    else:
        i = gate_numbers(inc['metrics'])
        decision['incumbent'] = {'trained_at': inc['trained_at'], 'rows': inc['rows'], 'date_range': inc['date_range'], **i}
        print(f"  incumbent : sign acc @|r|>=1 {fmt(i['sign_accuracy_at_1'])} (n={i['n_at_1']}), log loss {i['log_loss']:.4f}, overall sign acc {i['sign_accuracy']:.3f}")
        n_fresh = inc.get('heldout_rows_after_incumbent_training', 0)
        if 'fresh_metrics' in inc:
            c, i = gate_numbers(cand['candidate_fresh_metrics']), gate_numbers(inc['fresh_metrics'])
            decision['basis'] = {'rows': 'newer than incumbent training data', 'n': n_fresh}
            decision['candidate_fresh'], decision['incumbent_fresh'] = c, i
            print(f"  judged on the {n_fresh} held-out rows newer than the incumbent's training data (out of sample for both):")
            print(f"    candidate : sign acc @|r|>=1 {fmt(c['sign_accuracy_at_1'])} (n={c['n_at_1']}), log loss {c['log_loss']:.4f}")
            print(f"    incumbent : sign acc @|r|>=1 {fmt(i['sign_accuracy_at_1'])} (n={i['n_at_1']}), log loss {i['log_loss']:.4f}")
        else:
            decision['basis'] = {'rows': 'whole held-out slice', 'n': cand['metrics']['test_rows']}
            print(f"  warning: only {n_fresh} held-out rows are newer than the incumbent's training data (< {MIN_FRESH_ROWS}); "
                  f"judging on the whole slice, which is in-sample for the incumbent")
        cand_sa = c['sign_accuracy_at_1'] if c['n_at_1'] else 0.0
        inc_sa = i['sign_accuracy_at_1'] if i['n_at_1'] else 0.0
        sign_ok = cand_sa >= inc_sa - args.tolerance
        ll_ok = c['log_loss'] <= i['log_loss']
        decision['gates'] = {'sign_accuracy_at_1_ok': sign_ok, 'log_loss_ok': ll_ok}
        print(f"  gate sign accuracy @|r|>=1 (candidate >= incumbent - {args.tolerance}): {'pass' if sign_ok else 'FAIL'}")
        print(f"  gate log loss (candidate <= incumbent): {'pass' if ll_ok else 'FAIL'}")
        promoted = sign_ok and ll_ok
        reason = 'both gates passed' if promoted else 'gate failed: ' + ', '.join(
            k for k, ok in (('sign accuracy', sign_ok), ('log loss', ll_ok)) if not ok)
        if args.force and not promoted:
            promoted, reason = True, f'forced ({reason})'
    decision['promoted'] = promoted
    decision['reason'] = reason

    if promoted:
        cand['promoted_at'] = decision['decided_at']
        if inc is not None:
            cand['replaced'] = {'trained_at': inc['trained_at'], 'rows': inc['rows'], 'date_range': inc['date_range']}
        shutil.copyfile(cand_model_path, os.path.join(args.models_dir, MODEL_FILE))
        with open(os.path.join(args.models_dir, META_FILE), 'w') as f:
            json.dump(cand, f, indent=2)
        print(f'\nPROMOTED: candidate is now the live edge model ({reason})')
    else:
        print(f'\nKEPT: live edge model unchanged ({reason})')

    os.makedirs(os.path.dirname(args.decision_file), exist_ok=True)
    with open(args.decision_file, 'w') as f:
        json.dump(decision, f, indent=2)
    print(f'Decision written to {os.path.relpath(args.decision_file)}')


def fmt(x):
    return '-' if x is None else f'{x:.3f}'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--in', dest='inp', default=DEFAULT_IN)
    ap.add_argument('--min-rows', type=int, default=5000)
    ap.add_argument('--candidate', action='store_true', help='train to *.candidate.json and score the live model on the same held-out slice')
    ap.add_argument('--promote', action='store_true', help='replace the live model with the candidate if it passes the gates')
    ap.add_argument('--force', action='store_true', help='with --promote: promote even if a gate fails')
    ap.add_argument('--tolerance', type=float, default=0.0, help='allowed drop in held-out sign accuracy at |residual| >= 1 (default 0)')
    ap.add_argument('--models-dir', default=MODELS_DIR)
    ap.add_argument('--decision-file', default=DECISION_FILE)
    args = ap.parse_args()

    if args.candidate or not args.promote:
        train(args, candidate=args.candidate)
    if args.promote:
        promote(args)


if __name__ == '__main__':
    main()
