import os
import sys
import json
import torch
import pickle
import numpy as np

# -----------------------------
# PATHS
# -----------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
model_path = os.path.join(BASE_DIR, "hoopforecast_model.pth")
scaler_path = os.path.join(BASE_DIR, "scaler.pkl")
feature_list_path = os.path.join(BASE_DIR, "feature_list.json")

# -----------------------------
# LOAD SCALER
# -----------------------------
with open(scaler_path, "rb") as f:
    scaler = pickle.load(f)

input_dim = scaler.mean_.shape[0]  # Should be 91

# -----------------------------
# LOAD FEATURE LIST
# -----------------------------
with open(feature_list_path, "r") as f:
    feature_list = json.load(f)

# Trim/pad to match input_dim
if len(feature_list) > input_dim:
    feature_list = feature_list[:input_dim]
elif len(feature_list) < input_dim:
    feature_list += ["missing_" + str(i) for i in range(input_dim - len(feature_list))]

# -----------------------------
# ACTUAL MODEL ARCHITECTURE (MATCHES TRAINING EXACTLY)
# -----------------------------
model = torch.nn.Sequential(
    torch.nn.Linear(input_dim, 256),
    torch.nn.ReLU(),
    torch.nn.Linear(256, 128),
    torch.nn.ReLU(),
    torch.nn.Linear(128, 1)
)

# -----------------------------
# LOAD CHECKPOINT (NOW MATCHES KEYS)
# -----------------------------
state = torch.load(model_path, map_location="cpu")
model.load_state_dict(state)   # <-- No more missing/unexpected key errors
model.eval()

print("🎉 Model loaded correctly with", input_dim, "features.")

# -----------------------------
# PREDICT FUNCTION
# -----------------------------
def predict_player(input_data):
    # Create full feature row
    row = []
    for col in feature_list:
        try:
            row.append(float(input_data.get(col, 0)))
        except:
            row.append(0.0)

    row = np.array(row).reshape(1, -1)

    # Scale
    row_scaled = scaler.transform(row)

    # Convert to tensor
    tensor_input = torch.tensor(row_scaled, dtype=torch.float32)

    # Predict
    with torch.no_grad():
        pred = model(tensor_input).item()

    return float(pred)


if __name__ == "__main__":
    sample = {f: 0 for f in feature_list}
    print("Prediction test:", predict_player(sample))

