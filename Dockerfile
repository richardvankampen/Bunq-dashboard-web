# Bunq Financial Dashboard - Production Dockerfile
# Multi-version support: basic, secure, session

FROM python:3.11-slim

LABEL maintainer="Bunq Dashboard"
LABEL description="Bunq Financial Dashboard with Vaultwarden integration"
LABEL version="2.1.0"

# Build argument for authentication version
# Options: basic, secure, session (default)
ARG AUTH_VERSION=session

WORKDIR /app

# Environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    AUTH_VERSION=${AUTH_VERSION}

# Install system dependencies
RUN apt-get update && apt-get install -y \
    --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements_web.txt .
RUN pip install --no-cache-dir -r requirements_web.txt

# Copy ALL versions of backend and frontend
COPY api_proxy.py api_proxy_basic.py
COPY api_proxy_secure.py .
COPY api_proxy_session.py .
COPY app.js app_basic.js
COPY app_secure.js .
COPY app_session.js .

# Copy static files
COPY index.html .
COPY styles.css .
COPY login_modal.html .

# Create symlinks based on AUTH_VERSION
# This allows runtime selection of auth version
RUN if [ "$AUTH_VERSION" = "session" ]; then \
        ln -sf api_proxy_session.py api_proxy.py && \
        ln -sf app_session.js app.js && \
        echo "Using SESSION auth version" && \
        echo "⭐⭐⭐⭐⭐ Security level: MAXIMUM" ; \
    elif [ "$AUTH_VERSION" = "secure" ]; then \
        ln -sf api_proxy_secure.py api_proxy.py && \
        ln -sf app_secure.js app.js && \
        echo "Using SECURE auth version" && \
        echo "⭐⭐⭐⭐ Security level: HIGH" ; \
    else \
        ln -sf api_proxy_basic.py api_proxy.py && \
        ln -sf app_basic.js app.js && \
        echo "Using BASIC version (NO AUTH)" && \
        echo "⚠️  WARNING: Not for production use!" ; \
    fi

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
    echo "Bunq Dashboard - Version 2.1.0" && \
    echo "Auth Version: ${AUTH_VERSION}" && \
    echo "Python: $(python --version)" && \
    echo "================================================"

# Run application
CMD ["python", "api_proxy.py"]
