# ============================================
# ClaraVerse All-in-One Docker Image
# ============================================
# Usage: docker run -d -p 80:80 -v claraverse-data:/data claraverseoss/claraverse
# ============================================

# ============================================
# Stage 1: Build Backend (Go)
# ============================================
FROM golang:1.25.5-alpine AS backend-builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /build
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags "-s -w" -o claraverse ./cmd/server

# ============================================
# Stage 2: Build Frontend (React)
# ============================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY frontend/ .
ENV VITE_API_BASE_URL=""
ENV VITE_WS_URL=""
# Skip type checking - use vite directly like main Dockerfile
RUN npx vite build

# ============================================
# Stage 3: Final All-in-One Image
# ============================================
FROM ubuntu:22.04

LABEL maintainer="ClaraVerse Team"
LABEL description="ClaraVerse All-in-One - Your Private AI Workspace"

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Install dependencies + musl for Alpine-built Go binary
# Includes Chromium and fonts for PDF generation (emoji, CJK, symbols)
RUN apt-get update && apt-get install -y \
    supervisor \
    nginx \
    gnupg curl wget \
    mysql-server \
    redis-server \
    python3 python3-pip \
    ca-certificates tzdata xxd \
    chromium-browser \
    fonts-liberation \
    fonts-noto \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fontconfig \
    musl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/lib/x86_64-linux-musl/libc.so /lib/libc.musl-x86_64.so.1 \
    && fc-cache -f -v

# Install MongoDB 7
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update \
    && apt-get install -y mongodb-org \
    && rm -rf /var/lib/apt/lists/*

# Create directories
RUN mkdir -p \
    /data/mongodb /data/mysql /data/redis /data/uploads /data/logs /data/backend \
    /app/backend /app/frontend /app/e2b \
    /var/log/supervisor /run/mysqld \
    && chown -R mysql:mysql /data/mysql /run/mysqld

# Copy backend binary
COPY --from=backend-builder /build/claraverse /app/backend/claraverse
COPY backend/providers.example.json /app/backend/

# Copy migrations for MySQL init
COPY backend/migrations/ /app/migrations/

# Copy frontend build
COPY --from=frontend-builder /app/dist /app/frontend

# Copy E2B service (uses simple executor - no E2B API key required)
COPY backend/e2b-service/requirements.txt /app/e2b/
RUN pip3 install --no-cache-dir -r /app/e2b/requirements.txt
COPY backend/e2b-service/main.py /app/e2b/
COPY backend/e2b-service/main_simple.py /app/e2b/

# Copy configs
COPY docker/all-in-one/nginx.conf /etc/nginx/sites-available/default
COPY docker/all-in-one/supervisord.conf /etc/supervisor/conf.d/claraverse.conf
COPY docker/all-in-one/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Chromium environment for PDF generation
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV CHROME_PATH=/usr/lib/chromium-browser/

# Environment defaults
# Note: Search functionality requires external SearXNG. Set SEARXNG_URL to enable.
ENV ENVIRONMENT=production
ENV DATABASE_URL=mysql://claraverse_user:claraverse_pass@127.0.0.1:3306/claraverse?parseTime=true
ENV MONGODB_URI=mongodb://127.0.0.1:27017/claraverse
ENV REDIS_URL=redis://127.0.0.1:6379
ENV FRONTEND_URL=http://localhost
ENV BACKEND_URL=http://localhost
ENV ALLOWED_ORIGINS=http://localhost,http://localhost:80
ENV E2B_SERVICE_URL=http://localhost:8001
ENV SEARXNG_URL=""
ENV SEARXNG_URLS=""

VOLUME ["/data"]
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl -sf http://localhost/health || exit 1

CMD ["/app/start.sh"]
