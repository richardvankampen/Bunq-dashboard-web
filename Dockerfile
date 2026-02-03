# Bunq Financial Dashboard - Dockerfile
# Multi-stage build for optimized image

# Stage 1: Base
FROM python:3.11-slim as base

LABEL maintainer="your-email@example.com"
LABEL description="Bunq Financial Dashboard - Web Application"

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Stage 2: Dependencies
FROM base as dependencies

WORKDIR /app

# Copy requirements first for better caching
COPY requirements_web.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements_web.txt

# Stage 3: Application
FROM base as application

WORKDIR /app

# Copy installed packages from dependencies stage
COPY --from=dependencies /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=dependencies /usr/local/bin /usr/local/bin

# Copy application files
COPY api_proxy.py .
COPY index.html .
COPY styles.css .
COPY app.js .

# Create directory for config files
RUN mkdir -p /app/config

# Set volume for persistent data
VOLUME /app/config

# Expose ports
EXPOSE 5000 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:5000/api/health')" || exit 1

# Create startup script
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
echo "🚀 Starting Bunq Dashboard..."\n\
\n\
# Start Flask API in background\n\
python api_proxy.py &\n\
API_PID=$!\n\
\n\
# Wait for API to be ready\n\
echo "⏳ Waiting for API to start..."\n\
for i in {1..30}; do\n\
    if curl -s http://localhost:5000/api/health > /dev/null; then\n\
        echo "✅ API is ready!"\n\
        break\n\
    fi\n\
    sleep 1\n\
done\n\
\n\
# Start HTTP server for frontend\n\
echo "🌐 Starting frontend server..."\n\
python -m http.server 8000 &\n\
HTTP_PID=$!\n\
\n\
echo "✅ Dashboard is running!"\n\
echo "📊 Frontend: http://localhost:8000"\n\
echo "🔌 API: http://localhost:5000"\n\
\n\
# Wait for any process to exit\n\
wait -n\n\
\n\
# Exit with status of process that exited first\n\
exit $?\n\
' > /app/start.sh && chmod +x /app/start.sh

# Run startup script
CMD ["/app/start.sh"]
