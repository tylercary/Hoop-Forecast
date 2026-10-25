"""
Refit the edge model's residual -> P(over) map on THIS season's graded picks.

    python3 backend/ml/recalibrate_probability_map.py [--in FILE] [--min-rows 400] [--write]

Input: a prediction export (node backend/scripts/pullPredictions.mjs --all --out FILE)
with graded edge-model rows: edge_residual (the capped residual the server
stores), betting_line, actual_value.

Why: the map shipped inside edge_xgb_metadata.json was fitted on last season's
history, where the model rarely strayed far from the line, so its tails were
never trained. In live use it stated 65-75% on overs that hit about 50%, while
unders stated at 40-44% hit 77%. This script fits a piecewise-logistic map on
live rows only, with separate slopes for positive and negative residuals so
the two sides can calibrate independently, and validates it on the latest
nights before fitting on everything.

Output (--write): backend/ml/models/edge_probability_map.json
    { "map": { intercept, coef_pos, coef_neg, coef_rel_pos, coef_rel_neg },
      "fitted_on": n, "fitted_at": date, "metrics": {...} }
The server prefers this file over the map in the model metadata when present.
"""

import argparse
import json
import os
import sys
from datetime import date

import numpy as np
from sklearn.linear_model import LogisticRegression

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_FILE = os.path.join(SCRIPT_DIR, 'models', 'edge_probability_map.json')
DEFAULT_IN = os.path.join(SCRIPT_DIR, '..', 'data', 'predictions_export_live.json')


def design(r, line):
    r = np.asarray(r, dtype=float)
    rel = r / np.asarray(line, dtype=float)
    return np.column_stack([np.maximum(r, 0), np.minimum(r, 0), np.maximum(rel, 0), np.minimum(rel, 0)])


def prob(m, r, line):
    rel = r / line
    z = (m['intercept'] + m['coef_pos'] * max(r, 0) + m['coef_neg'] * min(r, 0)
         + m['coef_rel_pos'] * max(rel, 0) + m['coef_rel_neg'] * min(rel, 0))
    return 1 / (1 + np.exp(-z))


def fit(rows):
    X = design([x['r'] for x in rows], [x['line'] for x in rows])
    y = np.array([x['over'] for x in rows])
    # C < 1 regularises the slopes toward 0: with few rows in the tails the
    # fitted map stays close to 50% where it has little evidence
    lr = LogisticRegression(C=0.5, max_iter=1000).fit(X, y)
    return {'intercept': float(lr.intercept_[0]), 'coef_pos': float(lr.coef_[0][0]), 'coef_neg': float(lr.coef_[0][1]),
            'coef_rel_pos': float(lr.coef_[0][2]), 'coef_rel_neg': float(lr.coef_[0][3])}


def buckets(rows, probs):
    out = {}
    for x, p in zip(rows, probs):
        lo = int(min(95, max(0, p * 100 // 5 * 5)))
        b = out.setdefault(f'{lo}-{lo + 5}', {'n': 0, 'stated': 0.0, 'over': 0})
        b['n'] += 1; b['stated'] += p; b['over'] += x['over']
    return {k: {'n': v['n'], 'stated_over': round(v['stated'] / v['n'], 3), 'actual_over': round(v['over'] / v['n'], 3)}
            for k, v in sorted(out.items(), key=lambda kv: int(kv[0].split('-')[0])) if v['n'] >= 15}


def pick_record(rows, probs, over_th=56, under_th=44):
    rec = {'over': [0, 0], 'under': [0, 0]}
    for x, p in zip(rows, probs):
        if p * 100 >= over_th: rec['over'][0] += x['over']; rec['over'][1] += 1
        elif p * 100 <= under_th: rec['under'][0] += 1 - x['over']; rec['under'][1] += 1
    return {k: {'hits': v[0], 'n': v[1], 'hit_rate': round(v[0] / v[1], 3) if v[1] else None} for k, v in rec.items()}


def log_loss(rows, probs):
    eps = 1e-6
    p = np.clip(np.asarray(probs), eps, 1 - eps); y = np.array([x['over'] for x in rows])
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', default=DEFAULT_IN)
    ap.add_argument('--min-rows', type=int, default=400)
    ap.add_argument('--write', action='store_true', help='save the map if it validates at least as well as the shipped one')
    ap.add_argument('--force', action='store_true', help='with --write: save even if validation is worse')
    ap.add_argument('--status', default=os.path.join(SCRIPT_DIR, '..', 'data', 'edge_recalibration.json'))
    args = ap.parse_args()

    with open(args.inp) as f:
        data = json.load(f)
    preds = data.get('predictions', data)
    rows = []
    for p in preds:
        if p.get('model_variant') != 'edge' or not p.get('evaluated') or p.get('expired') or p.get('dnp'):
            continue
        r, line, a = p.get('edge_residual'), p.get('betting_line'), p.get('actual_value')
        if r is None or not line or a is None or a == line:
            continue
        rows.append({'r': float(r), 'line': float(line), 'over': 1 if a > line else 0,
                     'date': (p.get('next_game') or {}).get('date') or p.get('created_at', '')[:10],
                     'stated': p.get('over_probability')})
    rows.sort(key=lambda x: x['date'])
    print(f'{len(rows)} graded edge rows, {rows[0]["date"]} .. {rows[-1]["date"]}' if rows else 'no rows')
    if len(rows) < args.min_rows:
        print(f'fewer than {args.min_rows} rows; not fitting'); sys.exit(1)

    # Validate: fit on the earlier nights, score the last ~30% of rows
    cut = rows[int(len(rows) * 0.7)]['date']
    train = [x for x in rows if x['date'] < cut]; test = [x for x in rows if x['date'] >= cut]
    m_val = fit(train)
    old_probs = [x['stated'] / 100 for x in test if x['stated'] is not None]
    old_rows = [x for x in test if x['stated'] is not None]
    new_probs = [prob(m_val, x['r'], x['line']) for x in test]
    print(f'\nValidation on {len(test)} rows from {cut} (map fitted on {len(train)} earlier rows):')
    print(f"  log loss  shipped map {log_loss(old_rows, old_probs):.4f}  ->  live map {log_loss(test, new_probs):.4f}")
    print('  shipped map, stated vs actual:', buckets(old_rows, old_probs))
    print('  live map,    stated vs actual:', buckets(test, new_probs))
    print('  picks at 56/44, shipped map:', pick_record(old_rows, old_probs))
    print('  picks at 56/44, live map:   ', pick_record(test, new_probs))

    # Final fit on everything
    m = fit(rows)
    all_probs = [prob(m, x['r'], x['line']) for x in rows]
    metrics = {'validation_rows': len(test), 'validation_from': cut,
               'validation_log_loss_shipped': round(log_loss(old_rows, old_probs), 4),
               'validation_log_loss_live': round(log_loss(test, new_probs), 4),
               'validation_picks_live': pick_record(test, new_probs),
               'in_sample_buckets': buckets(rows, all_probs),
               'in_sample_picks': pick_record(rows, all_probs)}
    print('\nFinal map (all live rows):', {k: round(v, 4) for k, v in m.items()})
    print('  in-sample buckets:', metrics['in_sample_buckets'])
    print('  in-sample picks at 56/44:', metrics['in_sample_picks'])
    print('  examples: r=+1 on 20.5 ->', round(100 * prob(m, 1, 20.5), 1), '% | r=-1 on 20.5 ->', round(100 * prob(m, -1, 20.5), 1),
          '% | r=+2 on 10.5 ->', round(100 * prob(m, 2, 10.5), 1), '% | r=-2 on 10.5 ->', round(100 * prob(m, -2, 10.5), 1), '%')

    # Gate: the live map must predict the latest nights at least as well as
    # what is shipped (log loss), otherwise it is not written
    better = metrics['validation_log_loss_live'] <= metrics['validation_log_loss_shipped']
    status = {'rows': len(rows), 'validated_better': better, 'written': False,
              'validation_log_loss_shipped': metrics['validation_log_loss_shipped'],
              'validation_log_loss_live': metrics['validation_log_loss_live']}
    if args.write and (better or args.force):
        out = {'map': m, 'fitted_on': len(rows), 'fitted_at': date.today().isoformat(),
               'date_range': [rows[0]['date'], rows[-1]['date']], 'source': 'live graded edge rows', 'metrics': metrics}
        with open(OUT_FILE, 'w') as f:
            json.dump(out, f, indent=2)
        status['written'] = True
        print(f"\nWROTE {os.path.relpath(OUT_FILE)}{' (forced)' if not better else ''}")
    elif args.write:
        print('\nKEPT the shipped map: the live map did not validate better on the latest nights')
    else:
        print('\n(dry run; pass --write to save the map when it validates better)')
    os.makedirs(os.path.dirname(args.status), exist_ok=True)
    with open(args.status, 'w') as f:
        json.dump(status, f, indent=2)


if __name__ == '__main__':
    main()
