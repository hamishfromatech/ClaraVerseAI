FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    make \
    g++ \
    wget \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create directories
RUN mkdir -p uploads models

# Pre-download the model (small.en)
# We use a script in package.json to trigger whisper-node's download logic
RUN npm run download-model small.en

EXPOSE 3005

CMD ["npm", "start"]
