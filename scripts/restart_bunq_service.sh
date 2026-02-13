#!/bin/sh
set -eu

SERVICE_NAME="${1:-bunq_bunq-dashboard}"
LOG_MINUTES="${LOG_MINUTES:-3}"
IMAGE_REPO="${IMAGE_REPO:-bunq-dashboard}"
IMAGE_TAG="${IMAGE_TAG:-}"
RUN_WHITELIST_UPDATE="${RUN_WHITELIST_UPDATE:-true}"
TARGET_IP="${TARGET_IP:-}"
DEACTIVATE_OTHERS="${DEACTIVATE_OTHERS:-false}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker command not found"
  exit 1
fi

DOCKER_CMD="docker"
if [ "$(id -u)" -ne 0 ]; then
  DOCKER_CMD="sudo docker"
fi

echo "Service: ${SERVICE_NAME}"
echo "[1/4] Force restart service"
if [ -n "${IMAGE_TAG}" ]; then
  TARGET_IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"
  echo "Using image override: ${TARGET_IMAGE}"
  if ! $DOCKER_CMD image inspect "${TARGET_IMAGE}" >/dev/null 2>&1; then
    echo "ERROR: image ${TARGET_IMAGE} not found locally."
    echo "Build it first:"
    echo "  sudo docker build -t ${TARGET_IMAGE} ."
    exit 1
  fi
  set +e
  $DOCKER_CMD service update --image "${TARGET_IMAGE}" --force "${SERVICE_NAME}" >/dev/null
  UPDATE_EXIT=$?
  set -e
else
  set +e
  $DOCKER_CMD service update --force "${SERVICE_NAME}" >/dev/null
  UPDATE_EXIT=$?
  set -e
fi
if [ "${UPDATE_EXIT}" -ne 0 ]; then
  echo "ERROR: service update failed (exit ${UPDATE_EXIT}). Recent task state:"
  $DOCKER_CMD service ps --no-trunc --format "table {{.Name}}\t{{.CurrentState}}\t{{.Error}}" "${SERVICE_NAME}" || true
  echo "You can rollback with:"
  echo "  sudo docker service update --rollback ${SERVICE_NAME}"
  exit "${UPDATE_EXIT}"
fi
sleep 6

echo "[2/4] Verify runtime code marker"
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

echo "[3/4] Optional Bunq whitelist update via API calls"
if [ "${RUN_WHITELIST_UPDATE}" = "true" ] && [ -n "${CONTAINER_ID}" ]; then
  if ! $DOCKER_CMD exec \
    -e TARGET_IP="${TARGET_IP}" \
    -e DEACTIVATE_OTHERS="${DEACTIVATE_OTHERS}" \
    -e AUTO_SET_BUNQ_WHITELIST_IP=false \
    "${CONTAINER_ID}" python3 - <<'PY'
import json
import os
import sys
from api_proxy import init_bunq, set_bunq_api_whitelist_ip

target_ip = (os.getenv("TARGET_IP", "") or "").strip() or None
deactivate_others = (os.getenv("DEACTIVATE_OTHERS", "false") or "").strip().lower() in ("1", "true", "yes", "on")

if not init_bunq(force_recreate=False, refresh_key=True):
    print("WARN: Bunq init failed before whitelist update")
    sys.exit(1)

result = set_bunq_api_whitelist_ip(target_ip=target_ip, deactivate_others=deactivate_others)
print(json.dumps(result, ensure_ascii=False))
if not result.get("success"):
    sys.exit(1)
PY
  then
    echo "WARN: whitelist update failed (continuing)."
  fi
else
  echo "Skipped (RUN_WHITELIST_UPDATE=${RUN_WHITELIST_UPDATE})"
fi

echo "[4/4] Print relevant startup logs (${LOG_MINUTES}m)"
LOG_OUTPUT="$($DOCKER_CMD service logs --since "${LOG_MINUTES}m" "${SERVICE_NAME}" 2>&1 || true)"
printf '%s\n' "$LOG_OUTPUT" | grep -E "Retrieving API key from Vaultwarden|API key retrieved from vault|API key loaded from env/secret|No valid API key|Bunq API initialized|Vaultwarden|whitelist|allowlist" || true

if ! printf '%s\n' "$LOG_OUTPUT" | grep -Eq "API key retrieved from vault|API key loaded from env/secret|No valid API key"; then
  echo "WARN: expected API key startup lines not found yet."
  echo "Run manually:"
  echo "  sudo docker service logs --since 5m ${SERVICE_NAME} | grep -E \"Retrieving API key from Vaultwarden|API key retrieved from vault|No valid API key\""
fi

echo "Done."
