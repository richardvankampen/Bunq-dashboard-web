#!/bin/sh
set -eu

SERVICE_NAME="${1:-bunq_bunq-dashboard}"
LOG_MINUTES="${LOG_MINUTES:-3}"
IMAGE_REPO="${IMAGE_REPO:-bunq-dashboard}"
IMAGE_TAG="${IMAGE_TAG:-}"
AUTO_TAG_FROM_GIT="${AUTO_TAG_FROM_GIT:-true}"
CLEANUP_OLD_IMAGES="${CLEANUP_OLD_IMAGES:-true}"
KEEP_IMAGE_COUNT="${KEEP_IMAGE_COUNT:-2}"
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

if [ -z "${IMAGE_TAG}" ] && [ "${AUTO_TAG_FROM_GIT}" = "true" ] && command -v git >/dev/null 2>&1; then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    IMAGE_TAG="$(git rev-parse --short HEAD 2>/dev/null || true)"
  fi
fi

if [ -n "${IMAGE_TAG}" ]; then
  TARGET_IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"
  if ! $DOCKER_CMD image inspect "${TARGET_IMAGE}" >/dev/null 2>&1; then
    FALLBACK_IMAGE="${IMAGE_REPO}:local"
    if $DOCKER_CMD image inspect "${FALLBACK_IMAGE}" >/dev/null 2>&1; then
      echo "Image ${TARGET_IMAGE} not found; tagging ${FALLBACK_IMAGE} -> ${TARGET_IMAGE}"
      $DOCKER_CMD tag "${FALLBACK_IMAGE}" "${TARGET_IMAGE}"
    fi
  fi
fi

case "${KEEP_IMAGE_COUNT}" in
  ''|*[!0-9]*)
    KEEP_IMAGE_COUNT=2
    ;;
esac

echo "Service: ${SERVICE_NAME}"
echo "[1/5] Force restart service"
if [ -n "${IMAGE_TAG}" ]; then
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

echo "[2/5] Verify runtime code marker"
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

echo "[3/5] Optional Bunq whitelist update via API calls"
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

echo "[4/5] Print relevant startup logs (${LOG_MINUTES}m)"
LOG_OUTPUT="$($DOCKER_CMD service logs --since "${LOG_MINUTES}m" "${SERVICE_NAME}" 2>&1 || true)"
printf '%s\n' "$LOG_OUTPUT" | grep -E "Retrieving API key from Vaultwarden|API key retrieved from vault|API key loaded from env/secret|No valid API key|Bunq API initialized|Vaultwarden|whitelist|allowlist" || true

if ! printf '%s\n' "$LOG_OUTPUT" | grep -Eq "API key retrieved from vault|API key loaded from env/secret|No valid API key"; then
  echo "WARN: expected API key startup lines not found yet."
  echo "Run manually:"
  echo "  sudo docker service logs --since 5m ${SERVICE_NAME} | grep -E \"Retrieving API key from Vaultwarden|API key retrieved from vault|No valid API key\""
fi

echo "[5/5] Optional cleanup of old ${IMAGE_REPO} images"
if [ "${CLEANUP_OLD_IMAGES}" = "true" ]; then
  if [ -z "${CONTAINER_ID}" ]; then
    CONTAINER_ID="$($DOCKER_CMD ps --filter "name=${SERVICE_NAME}" -q | head -n1 || true)"
  fi

  if [ -z "${CONTAINER_ID}" ]; then
    echo "WARN: no running container found; skipping cleanup"
  else
    RUNNING_IMAGE_ID="$($DOCKER_CMD inspect --format '{{.Image}}' "${CONTAINER_ID}" 2>/dev/null || true)"
    if [ -z "${RUNNING_IMAGE_ID}" ]; then
      echo "WARN: could not determine running image id; skipping cleanup"
    else
      IMAGE_ROWS="$($DOCKER_CMD image ls "${IMAGE_REPO}" --format '{{.Repository}}:{{.Tag}} {{.ID}}' | awk '$1 !~ /<none>/' || true)"
      if [ -z "${IMAGE_ROWS}" ]; then
        echo "No local ${IMAGE_REPO} images found."
      else
        TMP_IMAGE_ROWS="$(mktemp)"
        printf '%s\n' "${IMAGE_ROWS}" > "${TMP_IMAGE_ROWS}"
        KEPT_RECENT=0
        while IFS=' ' read -r IMAGE_REF IMAGE_ID; do
          [ -z "${IMAGE_REF}" ] && continue
          if [ "${IMAGE_ID}" = "${RUNNING_IMAGE_ID}" ] || { [ -n "${IMAGE_TAG}" ] && [ "${IMAGE_REF}" = "${TARGET_IMAGE}" ]; }; then
            echo "Keep active image: ${IMAGE_REF}"
            continue
          fi
          if [ "${KEPT_RECENT}" -lt "${KEEP_IMAGE_COUNT}" ]; then
            KEPT_RECENT=$((KEPT_RECENT + 1))
            echo "Keep recent image: ${IMAGE_REF}"
            continue
          fi
          echo "Remove old image: ${IMAGE_REF}"
          $DOCKER_CMD image rm "${IMAGE_REF}" >/dev/null 2>&1 || echo "WARN: could not remove ${IMAGE_REF}"
        done < "${TMP_IMAGE_ROWS}"
        rm -f "${TMP_IMAGE_ROWS}"
      fi
    fi
  fi
else
  echo "Skipped (CLEANUP_OLD_IMAGES=${CLEANUP_OLD_IMAGES})"
fi

echo "Done."
