FROM python:3.11-slim

# Install Node.js 20 from official binary
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://nodejs.org/dist/v20.18.3/node-v20.18.3-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1 && \
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
