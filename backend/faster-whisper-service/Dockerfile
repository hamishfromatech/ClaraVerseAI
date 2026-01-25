FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements
COPY requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY server.py ./

# Create directories for models and uploads
RUN mkdir -p models uploads

# Pre-download the default model (small)
# This is done at container startup instead of build time to avoid layer bloat
# But we can create a startup script to handle it

EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3005/health || exit 1

CMD ["python", "server.py"]