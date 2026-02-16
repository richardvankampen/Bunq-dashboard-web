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
    PIP_NO_CACHE_DIR=1 \
    GUNICORN_WORKERS=2 \
    GUNICORN_THREADS=4 \
    GUNICORN_TIMEOUT=120 \
    GUNICORN_KEEPALIVE=5 \
    GUNICORN_LOG_LEVEL=info \
    BUNQ_PREBOOT_INIT=true

# Pin Bitwarden CLI release (native binary)
ARG BW_VERSION=2026.1.0
# Pinned checksum for bw-linux-${BW_VERSION}.zip.
# If you override BW_VERSION, also override BW_SHA256.
ARG BW_SHA256=1d7b44c94b17a0a6c1264ba529f94b8b50fe059ab08d20aa5a5cbfdd25084aab
ARG BW_NPM_VERSION=2026.1.0
ARG DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && DEBIAN_FRONTEND=${DEBIAN_FRONTEND} apt-get install -y \
    --no-install-recommends \
    curl \
       unzip \
       ca-certificates \
    && ARCH="$(dpkg --print-architecture)" \
    && install_bw_native() { \
         BASE_URL="https://github.com/bitwarden/clients/releases/download/cli-v${BW_VERSION}"; \
         ZIP_NAME="bw-linux-${BW_VERSION}.zip"; \
         test -n "${BW_SHA256}" || return 1; \
         curl -fsSL -o /tmp/bw.zip "${BASE_URL}/${ZIP_NAME}" || return 1; \
         echo "${BW_SHA256}  /tmp/bw.zip" | sha256sum -c - >/dev/null; \
         unzip -q /tmp/bw.zip -d /tmp; \
         install -m 0755 /tmp/bw /usr/local/bin/bw; \
         rm -f /tmp/bw.zip /tmp/bw; \
         return 0; \
       } \
    && install_bw_npm() { \
         DEBIAN_FRONTEND=${DEBIAN_FRONTEND} apt-get install -y --no-install-recommends nodejs npm; \
         npm install -g "@bitwarden/cli@${BW_NPM_VERSION}"; \
         npm cache clean --force; \
       } \
    && if [ "${ARCH}" = "amd64" ]; then \
         if install_bw_native; then \
           echo "Installed native Bitwarden CLI binary (${BW_VERSION})."; \
         else \
           echo "WARN: native Bitwarden CLI download/checksum validation failed for ${BW_VERSION}; falling back to npm." >&2; \
           install_bw_npm; \
         fi; \
       elif [ "${ARCH}" = "arm64" ]; then \
         install_bw_npm; \
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
COPY scripts/run_server.sh ./scripts/run_server.sh

# Copy static files
COPY index.html .
COPY styles.css .

# Create directories
RUN mkdir -p /app/config /app/logs
RUN chmod 755 /app/scripts/run_server.sh

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

# Run application (production WSGI server)
CMD ["/bin/sh", "/app/scripts/run_server.sh"]
