#!/bin/sh
set -eu

SERVICE_NAME="${1:-bunq_bunq-dashboard}"
LOG_MINUTES="${LOG_MINUTES:-3}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker command not found"
  exit 1
fi

DOCKER_CMD="docker"
if [ "$(id -u)" -ne 0 ]; then
  DOCKER_CMD="sudo docker"
fi

echo "Service: ${SERVICE_NAME}"
echo "[1/3] Force restart service"
$DOCKER_CMD service update --force "${SERVICE_NAME}" >/dev/null
sleep 6

echo "[2/3] Verify runtime code marker"
CONTAINER_ID="$($DOCKER_CMD ps --filter "name=${SERVICE_NAME}" -q | head -n1 || true)"
if [ -n "${CONTAINER_ID}" ]; then
  if $DOCKER_CMD exec "${CONTAINER_ID}" sh -c "grep -q 'get_api_key_from_vaultwarden_cli' /app/api_proxy.py"; then
    echo "OK: runtime contains Vaultwarden CLI flow"
  else
    echo "WARN: runtime may still be old (no get_api_key_from_vaultwarden_cli marker)"
  fi
else
  echo "WARN: no running container found after restart"
fi

echo "[3/3] Print relevant startup logs (${LOG_MINUTES}m)"
LOG_OUTPUT="$($DOCKER_CMD service logs --since "${LOG_MINUTES}m" "${SERVICE_NAME}" 2>&1 || true)"
printf '%s\n' "$LOG_OUTPUT" | grep -E "Retrieving API key from Vaultwarden|API key retrieved from vault|API key loaded from env/secret|No valid API key|Bunq API initialized|Vaultwarden" || true

if ! printf '%s\n' "$LOG_OUTPUT" | grep -Eq "API key retrieved from vault|API key loaded from env/secret|No valid API key"; then
  echo "WARN: expected API key startup lines not found yet."
  echo "Run manually:"
  echo "  sudo docker service logs --since 5m ${SERVICE_NAME} | grep -E \"Retrieving API key from Vaultwarden|API key retrieved from vault|No valid API key\""
fi

echo "Done."
