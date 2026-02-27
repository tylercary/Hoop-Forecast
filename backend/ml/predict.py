#!/usr/bin/env python3
"""
NBA Prop Prediction Inference Script
Loads trained models and makes predictions
Usage: python3 backend/ml/predict.py --features <json_string> --prop-type <PTS|REB|AST|3PM|PRA|PR|PA|RA>
"""

import torch
import torch.nn as nn
import pickle
import json
import argparse
import sys
import os
import numpy as np


class PropPredictionModel(nn.Module):
    """Neural network for prop prediction (same architecture as training)"""

    def __init__(self, input_size):
        super(PropPredictionModel, self).__init__()

        self.network = nn.Sequential(
            nn.Linear(input_size, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Dropout(0.2),

            nn.Linear(128, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(0.2),

            nn.Linear(64, 32),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.Dropout(0.1),

            nn.Linear(32, 1)
        )

    def forward(self, x):
        return self.network(x)


class PropPredictor:
    """Predictor class for loading models and making predictions"""

    def __init__(self, models_dir):
        self.models_dir = models_dir
        self.models = {}
        self.scalers = {}
        self.metadata = {}
        self.device = torch.device('cpu')  # Use CPU for inference

    def load_model(self, prop_type):
        """Load model, scaler, and metadata for a specific prop type"""
        prop_lower = prop_type.lower()

        # Paths
        model_path = os.path.join(self.models_dir, f'{prop_lower}_model.pth')
        scaler_path = os.path.join(self.models_dir, f'{prop_lower}_scaler.pkl')
        metadata_path = os.path.join(self.models_dir, f'{prop_lower}_metadata.json')

        # Check if files exist
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model not found: {model_path}")
        if not os.path.exists(scaler_path):
            raise FileNotFoundError(f"Scaler not found: {scaler_path}")
        if not os.path.exists(metadata_path):
            raise FileNotFoundError(f"Metadata not found: {metadata_path}")

        # Load metadata
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)

        # Load scaler
        with open(scaler_path, 'rb') as f:
            scaler = pickle.load(f)

        # Load model
        input_size = metadata['num_features']
        model = PropPredictionModel(input_size).to(self.device)
        model.load_state_dict(torch.load(model_path, map_location=self.device))
        model.eval()

        # Cache
        self.models[prop_type] = model
        self.scalers[prop_type] = scaler
        self.metadata[prop_type] = metadata

        return model, scaler, metadata

    def predict(self, features, prop_type):
        """
        Make a prediction for a given prop type

        Args:
            features: dict of feature name -> value
            prop_type: one of PTS, REB, AST, 3PM, PRA, PR, PA, RA

        Returns:
            float: predicted value
        """
        # Load model if not already loaded
        if prop_type not in self.models:
            self.load_model(prop_type)

        model = self.models[prop_type]
        scaler = self.scalers[prop_type]
        metadata = self.metadata[prop_type]

        # Extract features in correct order
        feature_cols = metadata['feature_columns']
        feature_values = []

        for col in feature_cols:
            if col not in features:
                raise ValueError(f"Missing feature: {col}")
            feature_values.append(float(features[col]))

        # Convert to numpy array and scale
        X = np.array([feature_values])
        X_scaled = scaler.transform(X)

        # Predict
        with torch.no_grad():
            X_tensor = torch.FloatTensor(X_scaled).to(self.device)
            prediction = model(X_tensor).cpu().numpy()[0][0]

        return float(prediction)


def main():
    """Main inference function"""
    parser = argparse.ArgumentParser(description='NBA Prop Prediction Inference')
    parser.add_argument('--features', type=str, required=True, help='JSON string of features')
    parser.add_argument('--prop-type', type=str, required=True,
                        choices=['PTS', 'REB', 'AST', '3PM', 'PRA', 'PR', 'PA', 'RA'],
                        help='Prop type to predict')
    parser.add_argument('--models-dir', type=str, default=None, help='Directory containing models')

    args = parser.parse_args()

    # Default models directory
    if args.models_dir is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        args.models_dir = os.path.join(script_dir, 'models')

    try:
        # Parse features JSON
        features = json.loads(args.features)

        # Create predictor
        predictor = PropPredictor(args.models_dir)

        # Make prediction
        prediction = predictor.predict(features, args.prop_type)

        # Output result as JSON
        result = {
            'success': True,
            'prop_type': args.prop_type,
            'prediction': prediction
        }
        print(json.dumps(result))

    except Exception as e:
        # Output error as JSON
        result = {
            'success': False,
            'error': str(e)
        }
        print(json.dumps(result), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
