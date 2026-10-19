"""
XGBoost Prediction Script
Called by Node.js to make predictions using trained XGBoost models.

Usage:
  python3 predict_xgboost.py <features_json> <PROP|PROP,PROP,...> <models_dir>

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


def main():
    if len(sys.argv) != 4:
        print(json.dumps({'success': False, 'error': 'Usage: predict_xgboost.py <features_json> <prop_types> <models_dir>'}))
        sys.exit(1)

    try:
        features = json.loads(sys.argv[1])
        prop_types = [p.strip().upper() for p in sys.argv[2].split(',') if p.strip()]
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
    if len(prop_types) == 1:
        # Single-prop callers read these fields
        if predictions:
            result['prediction'] = predictions[prop_types[0]]
        else:
            result['error'] = errors.get(prop_types[0], 'Prediction failed')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
