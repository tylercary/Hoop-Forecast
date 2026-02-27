"""
XGBoost Prediction Script
Called by Node.js to make predictions using trained XGBoost models
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
    """Load XGBoost model for a prop type"""
    model_path = os.path.join(MODELS_DIR, f'{prop_type.lower()}_xgb_model.json')
    
    if not os.path.exists(model_path):
        return None
    
    model = xgb.Booster()
    model.load_model(model_path)
    
    # Load metadata to get feature names
    metadata_path = os.path.join(MODELS_DIR, f'{prop_type.lower()}_xgb_metadata.json')
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
    
    return model, metadata['feature_names']

def predict(features_dict, prop_type):
    """Make prediction using XGBoost model"""
    try:
        # Load model
        result = load_model(prop_type)

        if result is None:
            return {
                'success': False,
                'error': f'XGBoost model not found for {prop_type}'
            }

        model, feature_names = result

        # Schema hash validation
        metadata_path = os.path.join(MODELS_DIR, f'{prop_type.lower()}_xgb_metadata.json')
        if os.path.exists(metadata_path):
            with open(metadata_path, 'r') as f:
                metadata = json.load(f)
            expected_hash = metadata.get('features_schema_hash')
            if expected_hash:
                # Only hash the features the model expects (not all incoming features)
                incoming_hash = hashlib.md5(','.join(sorted(feature_names)).encode()).hexdigest()[:12]
                if incoming_hash != expected_hash:
                    print(f"Warning: Schema hash mismatch for {prop_type}. Expected {expected_hash}, got {incoming_hash}", file=sys.stderr)

        # Build feature array in correct order
        feature_values = []
        for feat_name in feature_names:
            if feat_name not in features_dict:
                return {
                    'success': False,
                    'error': f'Missing feature: {feat_name}'
                }
            feature_values.append(features_dict[feat_name])
        
        # Convert to numpy array and create DMatrix
        X = np.array([feature_values])
        dmatrix = xgb.DMatrix(X, feature_names=feature_names)
        
        # Predict
        prediction = float(model.predict(dmatrix)[0])
        
        # Ensure non-negative
        prediction = max(0, prediction)
        
        return {
            'success': True,
            'prediction': prediction
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

def main():
    """Main entry point called from Node.js"""
    if len(sys.argv) != 4:
        print(json.dumps({
            'success': False,
            'error': 'Usage: python3 predict_xgboost.py <features_json> <prop_type> <models_dir>'
        }))
        sys.exit(1)
    
    try:
        # Parse arguments
        features_json = sys.argv[1]
        prop_type = sys.argv[2].upper()
        
        # Parse features
        features = json.loads(features_json)
        
        # Make prediction
        result = predict(features, prop_type)
        
        # Output result as JSON
        print(json.dumps(result))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e)
        }))
        sys.exit(1)

if __name__ == '__main__':
    main()
