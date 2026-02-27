#!/bin/bash

# NBA Prop Prediction - Complete Training Pipeline
# This script runs the full ML training pipeline from data collection to model deployment

set -e  # Exit on any error

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         NBA Prop Prediction - ML Training Pipeline            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Step 1: Data Collection
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1/3: Collecting Training Data"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏱  This step takes ~30-45 minutes (fetching from NBA.com API)"
echo ""

read -p "Do you want to collect fresh data? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]
then
    # Skip loading existing data to save memory (use only fresh data)
    export SKIP_EXISTING_DATA=true
    node --max-old-space-size=8192 dataCollector.js
    if [ $? -ne 0 ]; then
        echo "❌ Data collection failed!"
        exit 1
    fi
else
    echo "⏭  Skipping data collection (using existing data)"

    # Check if combined data exists
    if [ ! -f "data/combined_training_data.csv" ]; then
        echo "❌ No training data found! Please run data collection first."
        exit 1
    fi
fi

# Step 2: Feature Engineering
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2/3: Feature Engineering"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏱  This step takes ~5-10 minutes"
echo ""

node --max-old-space-size=8192 featureEngineering.js
if [ $? -ne 0 ]; then
    echo "❌ Feature engineering failed!"
    exit 1
fi

# Step 3: Model Training
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3/3: Training ML Models"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏱  This step takes ~30-60 minutes"
echo ""

# Check if Python dependencies are installed
if ! python3 -c "import torch" &> /dev/null; then
    echo "⚠️  PyTorch not found. Installing dependencies..."
    pip3 install -r requirements.txt
fi

python3 train.py
if [ $? -ne 0 ]; then
    echo "❌ Model training failed!"
    exit 1
fi

# Success message
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    Training Complete! ✅                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📁 Models saved to: $(pwd)/models/"
echo ""
echo "Next steps:"
echo "1. Restart your backend server"
echo "2. Make a prediction request"
echo "3. Check logs for: '🧠 Using custom ML model...'"
echo ""
echo "To test manually:"
echo "  python3 predict.py --features '{...}' --prop-type PTS"
echo ""
