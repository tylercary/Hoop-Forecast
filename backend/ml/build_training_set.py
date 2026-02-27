"""
Build per-prop training sets from evaluated predictions.

Reads predictions.json, filters to evaluated predictions with feature vectors,
and produces per-prop CSVs for XGBoost retraining.

Usage: python3 backend/ml/build_training_set.py
"""

import json
import os
import sys
import hashlib
import csv

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PREDICTIONS_FILE = os.path.join(SCRIPT_DIR, '..', 'data', 'predictions.json')
SCHEMA_FILE = os.path.join(SCRIPT_DIR, 'feature_schema.json')
OUTPUT_DIR = os.path.join(SCRIPT_DIR, 'data')

# Target column names for each prop type
TARGET_MAP = {
    'PTS': 'target_pts',
    'REB': 'target_reb',
    'AST': 'target_ast',
    '3PM': 'target_3pm',
    'PRA': 'target_pra',
    'PR': 'target_pr',
    'PA': 'target_pa',
    'RA': 'target_ra'
}


def load_feature_schema():
    """Load canonical feature lists from feature_schema.json"""
    with open(SCHEMA_FILE, 'r') as f:
        schema = json.load(f)
    # Remove TARGET_COLUMNS entry, keep only feature lists
    feature_cols = {k: v for k, v in schema.items() if k != 'TARGET_COLUMNS'}
    return feature_cols


def load_predictions():
    """Load predictions from JSON file"""
    if not os.path.exists(PREDICTIONS_FILE):
        print(f"Error: {PREDICTIONS_FILE} not found")
        sys.exit(1)

    with open(PREDICTIONS_FILE, 'r') as f:
        data = json.load(f)

    return data.get('predictions', [])


def leakage_check(feature_names):
    """Assert no feature name contains post-game data indicators"""
    forbidden = ['target_', 'actual_', 'predicted_', 'accuracy', 'error']
    for feat in feature_names:
        for term in forbidden:
            if term in feat.lower():
                raise ValueError(
                    f"Leakage detected: feature '{feat}' contains '{term}'"
                )


def build_prop_dataset(predictions, prop_type, feature_cols):
    """Build training dataset for a single prop type"""
    target_col = TARGET_MAP[prop_type]
    features = feature_cols[prop_type]

    # Leakage check
    leakage_check(features)

    rows = []
    skipped = {'no_feature_vector': 0, 'missing_features': 0, 'no_actual': 0, 'duplicate': 0}
    seen_keys = set()

    for pred in predictions:
        # Must be evaluated with actual value
        if not pred.get('evaluated'):
            continue

        actual = pred.get('actual_value') or pred.get('actual_points')
        if actual is None:
            skipped['no_actual'] += 1
            continue

        # Must have feature vector
        fv = pred.get('feature_vector')
        if not fv:
            skipped['no_feature_vector'] += 1
            continue

        # Check prop type matches
        prop_formatted = pred.get('prop_type_formatted', '').upper()
        prop_raw = pred.get('prop_type', '')

        # Match by formatted key or by raw type mapping
        prop_matches = (
            prop_formatted == prop_type or
            (prop_type == 'PTS' and prop_raw == 'points') or
            (prop_type == 'REB' and prop_raw == 'rebounds') or
            (prop_type == 'AST' and prop_raw == 'assists') or
            (prop_type == '3PM' and prop_raw in ('threes', 'threes_made')) or
            (prop_type == 'PRA' and prop_raw in ('pra', 'points_rebounds_assists')) or
            (prop_type == 'PR' and prop_raw in ('pr', 'points_rebounds')) or
            (prop_type == 'PA' and prop_raw in ('pa', 'points_assists')) or
            (prop_type == 'RA' and prop_raw in ('ra', 'rebounds_assists'))
        )
        if not prop_matches:
            continue

        # Deduplicate by (player_name, game_date, prop_type)
        player = pred.get('player_name', '')
        game_date = pred.get('next_game', {}).get('date', '')
        dedup_key = f"{player.lower()}|{game_date}|{prop_type}"
        if dedup_key in seen_keys:
            skipped['duplicate'] += 1
            continue
        seen_keys.add(dedup_key)

        # Extract feature values in correct order
        row_features = []
        missing = False
        for feat_name in features:
            val = fv.get(feat_name)
            if val is None:
                skipped['missing_features'] += 1
                missing = True
                break
            row_features.append(val)

        if missing:
            continue

        # Compute target value based on prop type for combined props
        if prop_type == 'PRA':
            # For combined props, actual_value should already be the combined stat
            target_val = actual
        elif prop_type == 'PR':
            target_val = actual
        elif prop_type == 'PA':
            target_val = actual
        elif prop_type == 'RA':
            target_val = actual
        else:
            target_val = actual

        rows.append({
            'game_date': game_date,
            'player_name': player,
            'features': row_features,
            'target': target_val
        })

    return rows, skipped


def save_prop_csv(rows, prop_type, feature_cols):
    """Save per-prop training CSV"""
    features = feature_cols[prop_type]
    target_col = TARGET_MAP[prop_type]

    output_path = os.path.join(OUTPUT_DIR, f'retrain_{prop_type.lower()}.csv')
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    header = ['game_date', 'player_name'] + features + [target_col]

    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for row in rows:
            csv_row = [row['game_date'], row['player_name']] + row['features'] + [row['target']]
            writer.writerow(csv_row)

    return output_path


def main():
    print('=' * 60)
    print('Building Per-Prop Training Sets from Predictions')
    print('=' * 60)

    # Load schema and predictions
    feature_cols = load_feature_schema()
    predictions = load_predictions()

    total_preds = len(predictions)
    evaluated = [p for p in predictions if p.get('evaluated')]
    with_features = [p for p in evaluated if p.get('feature_vector')]

    print(f"\nTotal predictions: {total_preds}")
    print(f"Evaluated:         {len(evaluated)}")
    print(f"With features:     {len(with_features)}")

    if len(with_features) == 0:
        print("\nNo predictions with feature vectors found.")
        print("Feature logging starts with new predictions. Run predictions first.")
        # Output empty result JSON for orchestrator
        result = {'props': {}, 'total_rows': 0, 'message': 'no_data'}
        print(f"\n__RESULT_JSON__:{json.dumps(result)}")
        return

    # Build dataset for each prop type
    print(f"\n{'Prop':<6} | {'Rows':>6} | {'Date Range':<25} | {'Skipped'}")
    print('-' * 70)

    results = {}
    total_rows = 0

    for prop_type in ['PTS', 'REB', 'AST', '3PM', 'PRA', 'PR', 'PA', 'RA']:
        rows, skipped = build_prop_dataset(predictions, prop_type, feature_cols)

        if rows:
            output_path = save_prop_csv(rows, prop_type, feature_cols)
            dates = [r['game_date'] for r in rows if r['game_date']]
            date_range = f"{min(dates)} to {max(dates)}" if dates else "N/A"
            skip_summary = ', '.join(f"{k}={v}" for k, v in skipped.items() if v > 0) or 'none'
            print(f"{prop_type:<6} | {len(rows):>6} | {date_range:<25} | {skip_summary}")
            results[prop_type] = {
                'rows': len(rows),
                'path': output_path,
                'date_range': date_range
            }
            total_rows += len(rows)
        else:
            skip_summary = ', '.join(f"{k}={v}" for k, v in skipped.items() if v > 0) or 'no matching predictions'
            print(f"{prop_type:<6} | {'0':>6} | {'N/A':<25} | {skip_summary}")

    print(f"\nTotal rows across all props: {total_rows}")

    # Output result JSON for orchestrator to parse
    result = {'props': results, 'total_rows': total_rows, 'message': 'success'}
    print(f"\n__RESULT_JSON__:{json.dumps(result)}")


if __name__ == '__main__':
    main()
