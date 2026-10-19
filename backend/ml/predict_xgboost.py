"""
XGBoost Prediction Script
Called by Node.js to make predictions using trained XGBoost models.

Usage:
  python3 predict_xgboost.py <features_json> <PROP|PROP,PROP,...> <models_dir> [edge_rows_json]

edge_rows_json is an optional JSON list of feature rows for the pooled edge
model (see train_edge_model.py); the result then carries "edge": [residual,...]
in the same order (null where a row could not be scored).

One process can score several prop types from the same feature dict, so a
player page costs one spawn instead of eight. Output:
  {"success": true, "predictions": {"PTS": 24.1, ...}, "errors": {"RA": "..."},
   "prediction": 24.1}            # "prediction" kept for single-prop callers
"""

import sys
import json
import os
import hashlib
import xgboost as xgb
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, 'models')


def load_model(prop_type):
    """Load an XGBoost model and its feature list; None if the model is missing."""
    key = prop_type.lower()
    model_path = os.path.join(MODELS_DIR, f'{key}_xgb_model.json')
    metadata_path = os.path.join(MODELS_DIR, f'{key}_xgb_metadata.json')
    if not os.path.exists(model_path) or not os.path.exists(metadata_path):
        return None

    model = xgb.Booster()
    model.load_model(model_path)
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)

    expected_hash = metadata.get('features_schema_hash')
    if expected_hash:
        actual_hash = hashlib.md5(','.join(sorted(metadata['feature_names'])).encode()).hexdigest()[:12]
        if actual_hash != expected_hash:
            print(f"Warning: schema hash mismatch for {prop_type}", file=sys.stderr)

    return model, metadata['feature_names']


def predict_one(features, prop_type):
    """Score one prop type. Returns (value, error)."""
    loaded = load_model(prop_type)
    if loaded is None:
        return None, f'XGBoost model not found for {prop_type}'
    model, feature_names = loaded

    missing = [name for name in feature_names if name not in features]
    if missing:
        return None, f'Missing features: {", ".join(missing)}'

    row = np.array([[float(features[name]) for name in feature_names]])
    value = float(model.predict(xgb.DMatrix(row, feature_names=feature_names))[0])
    return max(0.0, value), None


_edge_cache = None


def load_edge_model():
    """The pooled edge model and its metadata; None when not trained."""
    global _edge_cache
    if _edge_cache is not None:
        return _edge_cache or None
    model_path = os.path.join(MODELS_DIR, 'edge_xgb_model.json')
    meta_path = os.path.join(MODELS_DIR, 'edge_xgb_metadata.json')
    if not os.path.exists(model_path) or not os.path.exists(meta_path):
        _edge_cache = False
        return None
    model = xgb.Booster()
    model.load_model(model_path)
    with open(meta_path, 'r') as f:
        meta = json.load(f)
    _edge_cache = (model, meta)
    return _edge_cache


def predict_edge(rows):
    """Residual (actual - line) for each row; None where features are missing."""
    loaded = load_edge_model()
    if loaded is None:
        return [None] * len(rows), 'Edge model not found'
    model, meta = loaded
    names = meta['feature_names']
    out = [None] * len(rows)
    valid, matrix = [], []
    for i, row in enumerate(rows):
        # Every feature must be present; null means "unknown" and becomes a
        # missing value, which the booster handles natively
        if all(name in row for name in names):
            valid.append(i)
            matrix.append([float('nan') if row[name] is None else float(row[name]) for name in names])
    if matrix:
        preds = model.predict(xgb.DMatrix(np.array(matrix), feature_names=names))
        for i, value in zip(valid, preds):
            out[i] = float(value)
    return out, None if len(valid) == len(rows) else f'{len(rows) - len(valid)} edge rows missing features'


def main():
    if len(sys.argv) not in (4, 5):
        print(json.dumps({'success': False, 'error': 'Usage: predict_xgboost.py <features_json> <prop_types> <models_dir> [edge_rows_json]'}))
        sys.exit(1)

    try:
        features = json.loads(sys.argv[1])
        prop_types = [p.strip().upper() for p in sys.argv[2].split(',') if p.strip()]
        edge_rows = json.loads(sys.argv[4]) if len(sys.argv) == 5 and sys.argv[4] else None
    except Exception as e:
        print(json.dumps({'success': False, 'error': f'Bad arguments: {e}'}))
        sys.exit(1)

    predictions, errors = {}, {}
    for prop_type in prop_types:
        try:
            value, error = predict_one(features, prop_type)
        except Exception as e:
            value, error = None, str(e)
        if error:
            errors[prop_type] = error
        else:
            predictions[prop_type] = value

    result = {'success': len(predictions) > 0, 'predictions': predictions, 'errors': errors}
    if edge_rows:
        try:
            edge_values, edge_error = predict_edge(edge_rows)
        except Exception as e:
            edge_values, edge_error = [None] * len(edge_rows), str(e)
        result['edge'] = edge_values
        if edge_error:
            errors['EDGE'] = edge_error
    if len(prop_types) == 1:
        # Single-prop callers read these fields
        if predictions:
            result['prediction'] = predictions[prop_types[0]]
        else:
            result['error'] = errors.get(prop_types[0], 'Prediction failed')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
