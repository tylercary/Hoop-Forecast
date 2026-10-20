FROM python:3.11-slim

# Install Node.js 20 from official binary
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://nodejs.org/dist/v20.18.3/node-v20.18.3-linux-x64.tar.gz | tar -xz -C /usr/local --strip-components=1 && \
    rm -rf /var/lib/apt/lists/*

# Install Python ML dependencies (XGBoost only — no PyTorch to keep image small)
RUN pip install --no-cache-dir numpy pandas scikit-learn xgboost

WORKDIR /app

# Install Node.js dependencies. better-sqlite3 (prediction store) is a native
# addon: npm downloads its prebuilt binary for this Node/glibc, and falls back
# to compiling it with node-gyp, which needs make/g++ (python is already here).
# The toolchain is removed again in the same layer so the image stays small.
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends make g++ && \
    npm ci --omit=dev && \
    apt-get purge -y make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy application code
COPY . .

EXPOSE ${PORT:-5001}

CMD ["node", "server.js"]
