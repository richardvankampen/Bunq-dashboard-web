# Bunq Financial Dashboard - Production Dockerfile
# Single version: session-based authentication

FROM python:3.11-slim

LABEL maintainer="Bunq Dashboard"
LABEL description="Bunq Financial Dashboard with Vaultwarden integration"
LABEL version="3.0.0"

WORKDIR /app

# Environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Pin Bitwarden CLI release (native binary)
ARG BW_VERSION=2026.1.0
ARG BW_SHA256=f99817d95a7a6f70506bc3e17f20f65ec09d15d0f840f168f172f4db0fd5f22f
ARG BW_NPM_VERSION=2026.1.0

# Install system dependencies
RUN apt-get update && apt-get install -y \
    --no-install-recommends \
    curl \
    unzip \
    ca-certificates \
    && ARCH="$(dpkg --print-architecture)" \
    && if [ "${ARCH}" = "amd64" ]; then \
         curl -fsSL -o /tmp/bw.zip "https://github.com/bitwarden/clients/releases/download/cli-v${BW_VERSION}/bw-linux-${BW_VERSION}.zip" \
         && echo "${BW_SHA256}  /tmp/bw.zip" | sha256sum -c - \
         && unzip -q /tmp/bw.zip -d /tmp \
         && install -m 0755 /tmp/bw /usr/local/bin/bw \
         && rm -f /tmp/bw.zip /tmp/bw; \
       elif [ "${ARCH}" = "arm64" ]; then \
         apt-get install -y --no-install-recommends nodejs npm \
         && npm install -g "@bitwarden/cli@${BW_NPM_VERSION}" \
         && npm cache clean --force; \
       else \
         echo "Unsupported architecture for Bitwarden CLI: ${ARCH}" >&2; exit 1; \
       fi \
    && bw --version \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements_web.txt .
RUN pip install --no-cache-dir -r requirements_web.txt

# Copy backend and frontend
COPY api_proxy.py .
COPY app.js .

# Copy static files
COPY index.html .
COPY styles.css .

# Create directories
RUN mkdir -p /app/config /app/logs

# Volumes for persistent data
VOLUME ["/app/config", "/app/logs"]

# Expose single port for API + Frontend
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:5000/api/health || exit 1

# Display version info on startup
RUN echo "================================================" && \
    echo "Bunq Dashboard - Version 3.0.0" && \
    echo "Auth Version: session-based" && \
    echo "Python: $(python --version)" && \
    echo "================================================"

# Run application
CMD ["python", "api_proxy.py"]
