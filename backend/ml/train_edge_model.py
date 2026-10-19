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
from datetime import date

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.linear_model import LogisticRegression

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, 'models')
DEFAULT_IN = os.path.join(SCRIPT_DIR, '..', 'data', 'predictions_export_fv.json')

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', default=DEFAULT_IN)
    ap.add_argument('--min-rows', type=int, default=5000)
    args = ap.parse_args()

    df = load_rows(args.inp)
    if len(df) < args.min_rows:
        print(f'Only {len(df)} usable rows (< {args.min_rows}); not training')
        sys.exit(1)
    feature_names = sorted(c for c in df.columns if not c.startswith('_'))
    df = df.sort_values('_date').reset_index(drop=True)
    print(f'{len(df)} rows, {len(feature_names)} features, {df["_date"].min()} .. {df["_date"].max()}')

    # Time split for honest metrics and the probability map
    cut = df['_date'].iloc[int(len(df) * 0.8)]
    train = df[df['_date'] < cut]
    test = df[df['_date'] >= cut]
    dtrain = xgb.DMatrix(train[feature_names].values, label=train['_target'].values, feature_names=feature_names)
    dtest = xgb.DMatrix(test[feature_names].values, feature_names=feature_names)
    booster = xgb.train(XGB_PARAMS, dtrain, N_ROUNDS)
    r = booster.predict(dtest)
    y = test['_target'].values
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
        'xgb_params': XGB_PARAMS, 'n_rounds': N_ROUNDS,
        'probability_map': prob_map, 'metrics': metrics,
        'top_features': [{'name': k, 'gain': round(v, 2)} for k, v in top],
    }
    with open(os.path.join(MODELS_DIR, 'edge_xgb_metadata.json'), 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"\nSaved edge model ({len(df)} rows). Top features: {', '.join(k for k, _ in top[:8])}")


if __name__ == '__main__':
    main()
