#!/usr/bin/env python3
"""
NBA Prop Prediction Model Training Script
Trains separate PyTorch models for each prop type
Usage: python3 backend/ml/train.py
"""

import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import pickle
import json
import os
from datetime import datetime

# Configuration
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
INPUT_FILE = os.path.join(DATA_DIR, 'training_features.csv')
MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')

BATCH_SIZE = 256
EPOCHS = 50
LEARNING_RATE = 0.001
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Prop types and their target columns
PROP_TYPES = {
    'PTS': 'target_pts',
    'REB': 'target_reb',
    'AST': 'target_ast',
    '3PM': 'target_3pm',
    'PRA': 'target_pra',
    'PR': 'target_pr',
    'PA': 'target_pa',
    'RA': 'target_ra'
}

# Feature columns for each prop type
FEATURE_COLUMNS = {
    'PTS': [
        # Basic stats
        'pts_avg_3', 'pts_avg_5', 'pts_avg_10', 'pts_avg_season',
        'pts_std_10', 'pts_volatility',
        'min_avg_3', 'min_avg_5', 'min_avg_10',
        'usage', 'fga_avg_10', 'is_home',
        # Advanced features
        'pts_hot_streak', 'pts_momentum', 'pts_over_streak',
        'days_rest', 'is_back_to_back', 'games_in_last_week',
        'win_streak', 'loss_streak', 'recent_win_pct'
    ],
    'REB': [
        # Basic stats
        'reb_avg_3', 'reb_avg_5', 'reb_avg_10', 'reb_avg_season',
        'reb_std_10', 'reb_volatility',
        'min_avg_3', 'min_avg_5', 'min_avg_10',
        'is_home',
        # Advanced features
        'reb_hot_streak', 'reb_momentum',
        'days_rest', 'is_back_to_back', 'games_in_last_week',
        'win_streak', 'loss_streak', 'recent_win_pct'
    ],
    'AST': [
        # Basic stats
        'ast_avg_3', 'ast_avg_5', 'ast_avg_10', 'ast_avg_season',
        'ast_std_10', 'ast_volatility',
        'min_avg_3', 'min_avg_5', 'min_avg_10',
        'usage', 'is_home',
        # Advanced features
        'ast_hot_streak', 'ast_momentum',
        'days_rest', 'is_back_to_back', 'games_in_last_week',
        'win_streak', 'loss_streak', 'recent_win_pct'
    ],
    '3PM': [
        # Basic stats
        'threes_avg_3', 'threes_avg_5', 'threes_avg_10', 'threes_avg_season',
        'threes_std_10', 'threes_volatility',
        'fg3a_avg_10', 'min_avg_5', 'min_avg_10',
        'is_home',
        # Advanced features
        'threes_hot_streak',
        'days_rest', 'is_back_to_back', 'games_in_last_week',
        'win_streak', 'loss_streak', 'recent_win_pct'
    ],
    'PRA': [
        # Basic stats
        'pra_avg_3', 'pra_avg_5', 'pra_avg_10',
        'pts_avg_10', 'reb_avg_10', 'ast_avg_10',
        'min_avg_5', 'min_avg_10', 'usage', 'is_home',
        # Advanced features
        'pts_hot_streak', 'reb_hot_streak', 'ast_hot_streak',
        'pts_momentum', 'reb_momentum', 'ast_momentum',
        'days_rest', 'is_back_to_back', 'games_in_last_week',
        'win_streak', 'loss_streak', 'recent_win_pct'
    ],
    'PR': [
        # Basic stats
        'pr_avg_3', 'pr_avg_5', 'pr_avg_10',
        'pts_avg_10', 'reb_avg_10',
        'min_avg_5', 'min_avg_10', 'usage', 'is_home',
        # Advanced features
        'pts_hot_streak', 'reb_hot_streak',
        'pts_momentum', 'reb_momentum',
        'days_rest', 'is_back_to_back', 'games_in_last_week',
        'win_streak', 'loss_streak', 'recent_win_pct'
    ],
    'PA': [
        # Basic stats
        'pa_avg_3', 'pa_avg_5', 'pa_avg_10',
        'pts_avg_10', 'ast_avg_10',
        'min_avg_5', 'min_avg_10', 'usage', 'is_home',
        # Advanced features
        'pts_hot_streak', 'ast_hot_streak',
        'pts_momentum', 'ast_momentum',
        'days_rest', 'is_back_to_back', 'games_in_last_week',
        'win_streak', 'loss_streak', 'recent_win_pct'
    ],
    'RA': [
        # Basic stats
        'ra_avg_3', 'ra_avg_5', 'ra_avg_10',
        'reb_avg_10', 'ast_avg_10',
        'min_avg_5', 'min_avg_10', 'is_home',
        # Advanced features
        'reb_hot_streak', 'ast_hot_streak',
        'reb_momentum', 'ast_momentum',
        'days_rest', 'is_back_to_back', 'games_in_last_week',
        'win_streak', 'loss_streak', 'recent_win_pct'
    ]
}


class PropDataset(Dataset):
    """PyTorch Dataset for prop predictions"""

    def __init__(self, X, y):
        self.X = torch.FloatTensor(X)
        self.y = torch.FloatTensor(y)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]


class PropPredictionModel(nn.Module):
    """
    Neural network for prop prediction
    Architecture: Input -> 128 -> 64 -> 32 -> 1
    """

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


def load_data():
    """Load and validate training data"""
    print(f"\n{'='*60}")
    print("Loading Training Data")
    print(f"{'='*60}\n")

    if not os.path.exists(INPUT_FILE):
        raise FileNotFoundError(f"Training data not found: {INPUT_FILE}")

    df = pd.read_csv(INPUT_FILE)
    print(f"✓ Loaded {len(df)} training examples")
    print(f"✓ Columns: {len(df.columns)}")

    # Remove rows with NaN in critical columns
    df = df.dropna()
    print(f"✓ After removing NaN: {len(df)} examples")

    return df


def prepare_data(df, prop_type):
    """Prepare data for a specific prop type"""
    print(f"\nPreparing data for {prop_type}...")

    feature_cols = FEATURE_COLUMNS[prop_type]
    target_col = PROP_TYPES[prop_type]

    # Verify all columns exist
    missing_cols = [col for col in feature_cols if col not in df.columns]
    if missing_cols:
        raise ValueError(f"Missing feature columns for {prop_type}: {missing_cols}")

    if target_col not in df.columns:
        raise ValueError(f"Missing target column: {target_col}")

    X = df[feature_cols].values
    y = df[target_col].values.reshape(-1, 1)

    # Remove any rows with inf or extreme values
    valid_mask = np.isfinite(X).all(axis=1) & np.isfinite(y).ravel()
    X = X[valid_mask]
    y = y[valid_mask]

    print(f"  Features: {len(feature_cols)}")
    print(f"  Examples: {len(X)}")
    print(f"  Target range: [{y.min():.2f}, {y.max():.2f}]")

    return X, y, feature_cols


def train_model(X_train, y_train, X_val, y_val, input_size, prop_type):
    """Train a model for a specific prop type"""
    print(f"\n{'='*60}")
    print(f"Training {prop_type} Model")
    print(f"{'='*60}\n")

    # Create datasets and dataloaders
    train_dataset = PropDataset(X_train, y_train)
    val_dataset = PropDataset(X_val, y_val)

    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE)

    # Initialize model
    model = PropPredictionModel(input_size).to(DEVICE)
    criterion = nn.HuberLoss()  # Robust to outliers
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE, weight_decay=1e-5)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode='min', factor=0.5, patience=5)

    # Training loop
    best_val_loss = float('inf')
    best_model_state = None
    patience_counter = 0

    print(f"Device: {DEVICE}")
    print(f"Epochs: {EPOCHS}")
    print(f"Batch size: {BATCH_SIZE}")
    print(f"Learning rate: {LEARNING_RATE}\n")

    for epoch in range(EPOCHS):
        # Training phase
        model.train()
        train_loss = 0.0

        for batch_X, batch_y in train_loader:
            batch_X, batch_y = batch_X.to(DEVICE), batch_y.to(DEVICE)

            optimizer.zero_grad()
            outputs = model(batch_X)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()

            train_loss += loss.item()

        train_loss /= len(train_loader)

        # Validation phase
        model.eval()
        val_loss = 0.0
        val_mae = 0.0

        with torch.no_grad():
            for batch_X, batch_y in val_loader:
                batch_X, batch_y = batch_X.to(DEVICE), batch_y.to(DEVICE)
                outputs = model(batch_X)
                loss = criterion(outputs, batch_y)
                val_loss += loss.item()
                val_mae += torch.abs(outputs - batch_y).mean().item()

        val_loss /= len(val_loader)
        val_mae /= len(val_loader)

        scheduler.step(val_loss)

        # Print progress
        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"Epoch {epoch+1:3d}/{EPOCHS} | "
                  f"Train Loss: {train_loss:.4f} | "
                  f"Val Loss: {val_loss:.4f} | "
                  f"Val MAE: {val_mae:.4f}")

        # Save best model
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_model_state = model.state_dict().copy()
            patience_counter = 0
        else:
            patience_counter += 1

        # Early stopping
        if patience_counter >= 10:
            print(f"\n✓ Early stopping at epoch {epoch+1}")
            break

    # Load best model
    model.load_state_dict(best_model_state)

    # Final evaluation
    model.eval()
    with torch.no_grad():
        train_pred = model(torch.FloatTensor(X_train).to(DEVICE)).cpu().numpy()
        val_pred = model(torch.FloatTensor(X_val).to(DEVICE)).cpu().numpy()

    train_mae = np.abs(train_pred - y_train).mean()
    val_mae = np.abs(val_pred - y_val).mean()
    train_rmse = np.sqrt(((train_pred - y_train) ** 2).mean())
    val_rmse = np.sqrt(((val_pred - y_val) ** 2).mean())

    print(f"\n{'='*60}")
    print(f"Final {prop_type} Model Performance")
    print(f"{'='*60}")
    print(f"Train MAE: {train_mae:.4f} | Train RMSE: {train_rmse:.4f}")
    print(f"Val MAE:   {val_mae:.4f} | Val RMSE:   {val_rmse:.4f}")

    return model, {
        'train_mae': float(train_mae),
        'val_mae': float(val_mae),
        'train_rmse': float(train_rmse),
        'val_rmse': float(val_rmse),
        'best_val_loss': float(best_val_loss)
    }


def save_model(model, scaler, feature_cols, prop_type, metrics):
    """Save model, scaler, and metadata"""
    os.makedirs(MODELS_DIR, exist_ok=True)

    # Save PyTorch model
    model_path = os.path.join(MODELS_DIR, f'{prop_type.lower()}_model.pth')
    torch.save(model.state_dict(), model_path)
    print(f"✓ Saved model: {model_path}")

    # Save scaler
    scaler_path = os.path.join(MODELS_DIR, f'{prop_type.lower()}_scaler.pkl')
    with open(scaler_path, 'wb') as f:
        pickle.dump(scaler, f)
    print(f"✓ Saved scaler: {scaler_path}")

    # Save metadata
    metadata = {
        'prop_type': prop_type,
        'feature_columns': feature_cols,
        'num_features': len(feature_cols),
        'trained_date': datetime.now().isoformat(),
        'metrics': metrics
    }

    metadata_path = os.path.join(MODELS_DIR, f'{prop_type.lower()}_metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"✓ Saved metadata: {metadata_path}")


def main():
    """Main training pipeline"""
    print("\n" + "="*60)
    print("NBA Prop Prediction Model Training")
    print("="*60)

    try:
        # Load data
        df = load_data()

        # Train a model for each prop type
        all_metrics = {}

        for prop_type in PROP_TYPES.keys():
            print(f"\n{'#'*60}")
            print(f"# Training {prop_type} Model")
            print(f"{'#'*60}")

            # Prepare data
            X, y, feature_cols = prepare_data(df, prop_type)

            # Split into train/validation
            X_train, X_val, y_train, y_val = train_test_split(
                X, y, test_size=0.2, random_state=42
            )

            print(f"\nTrain set: {len(X_train)} examples")
            print(f"Val set:   {len(X_val)} examples")

            # Scale features
            scaler = StandardScaler()
            X_train_scaled = scaler.fit_transform(X_train)
            X_val_scaled = scaler.transform(X_val)

            # Train model
            model, metrics = train_model(
                X_train_scaled, y_train,
                X_val_scaled, y_val,
                len(feature_cols), prop_type
            )

            # Save model
            save_model(model, scaler, feature_cols, prop_type, metrics)

            all_metrics[prop_type] = metrics

        # Print summary
        print(f"\n{'='*60}")
        print("Training Complete! Summary:")
        print(f"{'='*60}\n")

        for prop_type, metrics in all_metrics.items():
            print(f"{prop_type:6s} | Val MAE: {metrics['val_mae']:6.3f} | Val RMSE: {metrics['val_rmse']:6.3f}")

        print(f"\n✓ All models saved to: {MODELS_DIR}")
        print(f"\nNext step: Integrate models into your app")
        print(f"  → node backend/ml/predict.js <player_name> <prop_type>\n")

    except Exception as e:
        print(f"\n✗ Error during training: {e}")
        import traceback
        traceback.print_exc()
        exit(1)


if __name__ == '__main__':
    main()
