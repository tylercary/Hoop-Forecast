FROM python:3.11-slim

# Install Node.js 20
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Python ML dependencies (XGBoost only — no PyTorch to keep image small)
RUN pip install --no-cache-dir numpy pandas scikit-learn xgboost

WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

EXPOSE ${PORT:-5001}

CMD ["node", "server.js"]
