"""
XGBoost Training Pipeline for NBA Props
Trains gradient boosting models for all 8 prop types

Modes:
  Full training:        python3 train_xgboost.py
  Incremental update:   python3 train_xgboost.py --incremental
  With retrain data:    python3 train_xgboost.py --retrain-data
  Combined:             python3 train_xgboost.py --incremental --retrain-data

Features:
  - Time-based train/val/test split (70/15/15)
  - Promotion gate: new model must beat current model on test set
  - Schema hash for feature consistency validation
  - Per-prop metrics reporting with JSON output
"""

import pandas as pd
import numpy as np
import xgboost as xgb
import json
import os
import sys
import hashlib
from sklearn.metrics import mean_absolute_error, mean_squared_error
import warnings
warnings.filterwarnings('ignore')

# Directories
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, 'data')
DATA_FILE = os.path.join(DATA_DIR, 'training_features.csv')
MODELS_DIR = os.path.join(SCRIPT_DIR, 'models')
SCHEMA_FILE = os.path.join(SCRIPT_DIR, 'feature_schema.json')

# Ensure directories exist
os.makedirs(MODELS_DIR, exist_ok=True)

# Promotion gate tolerance: new model MAE can be at most this much worse
PROMOTION_TOLERANCE = 0.05


def load_feature_schema():
    """Load canonical feature lists from feature_schema.json"""
    with open(SCHEMA_FILE, 'r') as f:
        schema = json.load(f)
    feature_cols = {k: v for k, v in schema.items() if k != 'TARGET_COLUMNS'}
    target_cols = schema.get('TARGET_COLUMNS', {})
    return feature_cols, target_cols


def compute_schema_hash(feature_names):
    """Compute deterministic hash of feature names for schema validation"""
    canonical = ','.join(sorted(feature_names))
    return hashlib.md5(canonical.encode()).hexdigest()[:12]


def load_retrain_data(prop_type, feature_names, target_col):
    """Load retrain CSV for a prop type (from build_training_set.py output)"""
    retrain_file = os.path.join(DATA_DIR, f'retrain_{prop_type.lower()}.csv')
    if not os.path.exists(retrain_file):
        return None

    df = pd.read_csv(retrain_file)
    required = feature_names + [target_col]

    # Check all required columns exist
    missing = [c for c in required if c not in df.columns]
    if missing:
        print(f"  Warning: retrain CSV missing columns: {missing}")
        return None

    # Also need game_date for time-based split
    if 'game_date' not in df.columns:
        print(f"  Warning: retrain CSV missing game_date column")
        return None

    print(f"  Loaded {len(df)} retrain rows from {retrain_file}")
    return df


def train_xgboost_model(prop_type, feature_names, target_col, incremental=False, use_retrain_data=False):
    """Train XGBoost model for a specific prop type with promotion gating"""
    mode_label = "Incremental" if incremental else "Full"
    print(f"\n{'#'*60}")
    print(f"# {mode_label} Training: {prop_type} Model (XGBoost)")
    print('#'*60)

    # Load main training data
    print(f"\nLoading data...")
    df = pd.read_csv(DATA_FILE)

    # Merge retrain data if requested
    retrain_rows = 0
    if use_retrain_data:
        retrain_df = load_retrain_data(prop_type, feature_names, target_col)
        if retrain_df is not None:
            # Select only columns present in both datasets
            common_cols = list(set(df.columns) & set(retrain_df.columns))
            # Ensure required columns are present
            required = ['game_date'] + feature_names + [target_col]
            if all(c in common_cols for c in required):
                retrain_df = retrain_df[required]
                df_subset = df[required].copy()
                df = pd.concat([df_subset, retrain_df], ignore_index=True)
                retrain_rows = len(retrain_df)
                print(f"  Merged {retrain_rows} retrain rows with {len(df_subset)} original rows")
            else:
                print(f"  Skipping retrain merge: missing required columns")

    # Filter to rows with all required columns
    required_cols = feature_names + [target_col]
    available_cols = [c for c in required_cols if c in df.columns]
    missing_cols = [c for c in required_cols if c not in df.columns]
    if missing_cols:
        print(f"  Warning: Missing columns in data: {missing_cols}")
        return None

    df_filtered = df[['game_date'] + required_cols].dropna()

    print(f"  Features: {len(feature_names)}")
    print(f"  Total examples: {len(df_filtered)}")
    if retrain_rows > 0:
        print(f"  (includes {retrain_rows} from prediction feedback)")
    print(f"  Target range: [{df_filtered[target_col].min():.2f}, {df_filtered[target_col].max():.2f}]")

    if len(df_filtered) < 100:
        print(f"  Error: Not enough data ({len(df_filtered)} rows). Need at least 100.")
        return None

    # Time-based split: sort by game_date, split 70/15/15
    df_sorted = df_filtered.sort_values('game_date').reset_index(drop=True)
    n = len(df_sorted)
    train_end = int(n * 0.70)
    val_end = int(n * 0.85)

    df_train = df_sorted.iloc[:train_end]
    df_val = df_sorted.iloc[train_end:val_end]
    df_test = df_sorted.iloc[val_end:]

    X_train = df_train[feature_names].values
    y_train = df_train[target_col].values
    X_val = df_val[feature_names].values
    y_val = df_val[target_col].values
    X_test = df_test[feature_names].values
    y_test = df_test[target_col].values

    print(f"\n  Time-based split:")
    print(f"    Train: {len(X_train)} rows ({df_train['game_date'].min()} to {df_train['game_date'].max()})")
    print(f"    Val:   {len(X_val)} rows ({df_val['game_date'].min()} to {df_val['game_date'].max()})")
    print(f"    Test:  {len(X_test)} rows ({df_test['game_date'].min()} to {df_test['game_date'].max()})")

    # Check for existing model (for incremental training and promotion gate)
    model_path = os.path.join(MODELS_DIR, f'{prop_type.lower()}_xgb_model.json')
    existing_model = None
    current_test_mae = None

    if os.path.exists(model_path):
        print(f"\n  Loading current model for comparison...")
        existing_model = xgb.Booster()
        existing_model.load_model(model_path)

        # Evaluate current model on test set (for promotion gate)
        dtest_check = xgb.DMatrix(X_test, feature_names=feature_names)
        current_preds = existing_model.predict(dtest_check)
        current_test_mae = mean_absolute_error(y_test, current_preds)
        current_test_rmse = np.sqrt(mean_squared_error(y_test, current_preds))
        print(f"  Current model Test MAE: {current_test_mae:.4f} | RMSE: {current_test_rmse:.4f}")

    if incremental and existing_model is None:
        print(f"\n  No existing model found, falling back to full training")
        incremental = False

    # XGBoost parameters
    params = {
        'objective': 'reg:squarederror',
        'max_depth': 6,
        'learning_rate': 0.05 if incremental else 0.1,
        'min_child_weight': 3,
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'reg_alpha': 0.1,
        'reg_lambda': 1.0,
        'gamma': 0.02,                         # Light pruning of weak splits
        'random_state': 42,
        'n_jobs': -1
    }

    num_rounds = 50 if incremental else 200
    early_stop = 10 if incremental else 20

    # Create DMatrix objects
    dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=feature_names)
    dval = xgb.DMatrix(X_val, label=y_val, feature_names=feature_names)
    dtest = xgb.DMatrix(X_test, label=y_test, feature_names=feature_names)

    # Train model
    print(f"\n{'='*60}")
    print(f"{'Incremental' if incremental else 'Full'} XGBoost Training")
    print('='*60)
    print(f"  Boost rounds: {num_rounds}")
    print(f"  Learning rate: {params['learning_rate']}")
    print(f"  Max depth: {params['max_depth']}")
    if incremental:
        print(f"  Starting from: existing model weights")

    evals = [(dtrain, 'train'), (dval, 'val')]
    model = xgb.train(
        params,
        dtrain,
        num_boost_round=num_rounds,
        evals=evals,
        early_stopping_rounds=early_stop,
        verbose_eval=10 if incremental else 20,
        xgb_model=existing_model if incremental else None
    )

    # Evaluate new model on all sets
    y_train_pred = model.predict(dtrain)
    y_val_pred = model.predict(dval)
    y_test_pred = model.predict(dtest)

    train_mae = mean_absolute_error(y_train, y_train_pred)
    train_rmse = np.sqrt(mean_squared_error(y_train, y_train_pred))
    val_mae = mean_absolute_error(y_val, y_val_pred)
    val_rmse = np.sqrt(mean_squared_error(y_val, y_val_pred))
    test_mae = mean_absolute_error(y_test, y_test_pred)
    test_rmse = np.sqrt(mean_squared_error(y_test, y_test_pred))

    print(f"\n{'='*60}")
    print(f"New {prop_type} Model Performance")
    print('='*60)
    print(f"  Train MAE: {train_mae:.4f} | RMSE: {train_rmse:.4f}")
    print(f"  Val MAE:   {val_mae:.4f} | RMSE: {val_rmse:.4f}")
    print(f"  Test MAE:  {test_mae:.4f} | RMSE: {test_rmse:.4f}")

    # Promotion gate: compare new model vs current on same test set
    promoted = True
    promotion_reason = 'no_existing_model'

    if current_test_mae is not None:
        improvement = current_test_mae - test_mae
        print(f"\n  Promotion Gate:")
        print(f"    Current Test MAE: {current_test_mae:.4f}")
        print(f"    New Test MAE:     {test_mae:.4f}")
        print(f"    Improvement:      {improvement:+.4f}")
        print(f"    Tolerance:        {PROMOTION_TOLERANCE}")

        if test_mae > current_test_mae + PROMOTION_TOLERANCE:
            promoted = False
            promotion_reason = f"new_mae_{test_mae:.4f}_worse_than_current_{current_test_mae:.4f}"
            print(f"    REJECTED: New model is worse by {-improvement:.4f} (exceeds tolerance)")
        else:
            promotion_reason = f"improved_by_{improvement:.4f}" if improvement > 0 else f"within_tolerance_{-improvement:.4f}"
            print(f"    PROMOTED: {'Improved' if improvement > 0 else 'Within tolerance'}")

    # Save model only if promoted
    schema_hash = compute_schema_hash(feature_names)

    if promoted:
        model.save_model(model_path)
        print(f"\n  Saved model: {model_path}")
    else:
        print(f"\n  Model NOT saved (failed promotion gate)")

    # Save metadata (always, with promotion status)
    metadata = {
        'prop_type': prop_type,
        'n_features': len(feature_names),
        'feature_names': feature_names,
        'features_schema_hash': schema_hash,
        'train_samples': len(X_train),
        'val_samples': len(X_val),
        'test_samples': len(X_test),
        'retrain_rows': retrain_rows,
        'train_mae': float(train_mae),
        'train_rmse': float(train_rmse),
        'val_mae': float(val_mae),
        'val_rmse': float(val_rmse),
        'test_mae': float(test_mae),
        'test_rmse': float(test_rmse),
        'best_iteration': model.best_iteration,
        'model_type': 'xgboost',
        'training_mode': 'incremental' if incremental else 'full',
        'promoted': promoted,
        'promotion_reason': promotion_reason,
        'current_test_mae': float(current_test_mae) if current_test_mae else None
    }

    metadata_path = os.path.join(MODELS_DIR, f'{prop_type.lower()}_xgb_metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"  Saved metadata: {metadata_path}")

    # Feature importance (only if promoted)
    if promoted:
        importance = model.get_score(importance_type='gain')
        top_features = sorted(importance.items(), key=lambda x: x[1], reverse=True)[:5]
        print(f"\n  Top 5 Features:")
        for feat, score in top_features:
            print(f"    {feat}: {score:.1f}")

    return {
        'prop_type': prop_type,
        'train_mae': float(train_mae),
        'val_mae': float(val_mae),
        'test_mae': float(test_mae),
        'test_rmse': float(test_rmse),
        'promoted': promoted,
        'promotion_reason': promotion_reason,
        'current_test_mae': float(current_test_mae) if current_test_mae else None,
        'retrain_rows': retrain_rows,
        'training_mode': 'incremental' if incremental else 'full'
    }


def main():
    incremental = '--incremental' in sys.argv
    use_retrain_data = '--retrain-data' in sys.argv
    mode = 'Incremental' if incremental else 'Full'

    print('='*60)
    print(f'NBA Prop Prediction - XGBoost {mode} Training')
    if use_retrain_data:
        print('  (with prediction feedback data)')
    print('='*60)

    # Check if main data exists
    if not os.path.exists(DATA_FILE):
        print(f"\n  Error: Training data not found at {DATA_FILE}")
        print("  Please run feature engineering first:")
        print("    node backend/ml/featureEngineering.js")
        return

    # Load feature schema
    if not os.path.exists(SCHEMA_FILE):
        print(f"\n  Error: Feature schema not found at {SCHEMA_FILE}")
        return

    feature_cols, target_cols = load_feature_schema()
    print(f"\n  Training data: {DATA_FILE}")
    print(f"  Feature schema: {SCHEMA_FILE}")
    if incremental:
        print("  Mode: Incremental (continuing from existing model weights)")
    if use_retrain_data:
        print("  Retrain data: merging prediction feedback CSVs")

    # Train all prop types
    results = []
    for prop_type in ['PTS', 'REB', 'AST', '3PM', 'PRA', 'PR', 'PA', 'RA']:
        feature_names = feature_cols[prop_type]
        target_col = target_cols[prop_type]
        result = train_xgboost_model(
            prop_type, feature_names, target_col,
            incremental=incremental,
            use_retrain_data=use_retrain_data
        )
        if result:
            results.append(result)

    # Summary
    print('\n' + '='*60)
    print(f'{mode} Training Complete! Summary:')
    print('='*60 + '\n')

    promoted_count = 0
    rejected_count = 0

    print(f"{'Prop':<6} | {'Test MAE':>10} | {'Prev MAE':>10} | {'Status':<12} | {'Mode'}")
    print('-' * 70)

    for result in results:
        prop = result['prop_type'].ljust(6)
        test_mae = f"{result['test_mae']:.3f}"
        prev_mae = f"{result['current_test_mae']:.3f}" if result['current_test_mae'] else "N/A"
        status = "PROMOTED" if result['promoted'] else "REJECTED"
        mode_str = result['training_mode']
        print(f"{prop} | {test_mae:>10} | {prev_mae:>10} | {status:<12} | {mode_str}")

        if result['promoted']:
            promoted_count += 1
        else:
            rejected_count += 1

    print(f"\n  Promoted: {promoted_count}/{len(results)}")
    print(f"  Rejected: {rejected_count}/{len(results)}")
    print(f"\n  Models dir: {MODELS_DIR}")

    # Output JSON result for orchestrator
    summary = {
        'results': results,
        'promoted': promoted_count,
        'rejected': rejected_count,
        'total': len(results)
    }
    print(f"\n__RESULT_JSON__:{json.dumps(summary)}")


if __name__ == '__main__':
    main()
