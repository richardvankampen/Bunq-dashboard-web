#!/bin/sh
set -eu

# Production server launcher for Docker/Swarm deployments.
# Runs Gunicorn with --preload so the API key is fetched from Vaultwarden once
# (in the master). The optional Bunq pre-init (BUNQ_PREBOOT_INIT) runs in the
# master via the on_starting hook in scripts/gunicorn_conf.py.

BIND_HOST="${GUNICORN_BIND_HOST:-0.0.0.0}"
BIND_PORT="${GUNICORN_BIND_PORT:-5000}"
WORKERS="${GUNICORN_WORKERS:-2}"
THREADS="${GUNICORN_THREADS:-4}"
WORKER_CLASS="${GUNICORN_WORKER_CLASS:-gthread}"
TIMEOUT="${GUNICORN_TIMEOUT:-120}"
KEEPALIVE="${GUNICORN_KEEPALIVE:-5}"
MAX_REQUESTS="${GUNICORN_MAX_REQUESTS:-1200}"
MAX_REQUESTS_JITTER="${GUNICORN_MAX_REQUESTS_JITTER:-120}"
LOG_LEVEL="${GUNICORN_LOG_LEVEL:-info}"

echo "== Bunq Dashboard Gunicorn startup =="
echo "Bind: ${BIND_HOST}:${BIND_PORT}"
echo "Workers: ${WORKERS} | Threads: ${THREADS} | Worker class: ${WORKER_CLASS}"

exec gunicorn \
  --config "$(dirname "$0")/gunicorn_conf.py" \
  --preload \
  --bind "${BIND_HOST}:${BIND_PORT}" \
  --workers "${WORKERS}" \
  --threads "${THREADS}" \
  --worker-class "${WORKER_CLASS}" \
  --timeout "${TIMEOUT}" \
  --keep-alive "${KEEPALIVE}" \
  --max-requests "${MAX_REQUESTS}" \
  --max-requests-jitter "${MAX_REQUESTS_JITTER}" \
  --access-logfile - \
  --error-logfile - \
  --log-level "${LOG_LEVEL}" \
  "api_proxy:app"
