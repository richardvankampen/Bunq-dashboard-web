#!/bin/sh
set -eu

# Production server launcher for Docker/Swarm deployments.
# Runs Gunicorn by default and performs an optional Bunq pre-init.

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
PREBOOT_INIT="${BUNQ_PREBOOT_INIT:-true}"

echo "== Bunq Dashboard Gunicorn startup =="
echo "Bind: ${BIND_HOST}:${BIND_PORT}"
echo "Workers: ${WORKERS} | Threads: ${THREADS} | Worker class: ${WORKER_CLASS}"

if [ "${PREBOOT_INIT}" = "true" ]; then
  echo "Preboot Bunq init attempt (non-fatal)..."
  python3 - <<'PY' || true
import api_proxy

ok = api_proxy.init_bunq(force_recreate=False, refresh_key=True, run_auto_whitelist=True)
if ok:
    print("Preboot init: Bunq API initialized.")
else:
    print("Preboot init: Bunq API not initialized (service continues; lazy init stays active).")
PY
fi

exec gunicorn \
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
