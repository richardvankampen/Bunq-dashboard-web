#!/bin/sh
set -eu

# Re-register current egress IP for Bunq API by creating a fresh ApiContext.
# Useful after API key rotation, VPN/public IP change, or "Incorrect API key or IP address".

SERVICE_NAME="${1:-bunq_bunq-dashboard}"
LOG_MINUTES="${LOG_MINUTES:-5}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker command not found"
  exit 1
fi

DOCKER_CMD="docker"
if [ "$(id -u)" -ne 0 ]; then
  DOCKER_CMD="sudo docker"
fi

echo "Service: ${SERVICE_NAME}"

CONTAINER_ID="$($DOCKER_CMD ps --filter "name=${SERVICE_NAME}" -q | head -n1 || true)"
if [ -z "${CONTAINER_ID}" ]; then
  echo "ERROR: no running container found for service ${SERVICE_NAME}"
  echo "Hint: deploy the stack first."
  exit 1
fi

echo "[1/6] Container egress public IP"
$DOCKER_CMD exec "${CONTAINER_ID}" python3 - <<'PY'
import requests
print(requests.get("https://api64.ipify.org", timeout=10).text.strip())
PY

USE_VAULTWARDEN="$($DOCKER_CMD exec "${CONTAINER_ID}" sh -c 'echo "${USE_VAULTWARDEN:-true}"' | tr '[:upper:]' '[:lower:]')"
VAULTWARDEN_ACCESS_METHOD="$($DOCKER_CMD exec "${CONTAINER_ID}" sh -c 'echo "${VAULTWARDEN_ACCESS_METHOD:-cli}"' | tr '[:upper:]' '[:lower:]')"
echo "[2/6] Auth mode: USE_VAULTWARDEN=${USE_VAULTWARDEN}"

if [ "${USE_VAULTWARDEN}" = "false" ]; then
  echo "[3/6] Validate bunq_api_key secret (must be 64 hex chars)"
  if ! $DOCKER_CMD exec "${CONTAINER_ID}" test -f /run/secrets/bunq_api_key; then
    echo "ERROR: missing /run/secrets/bunq_api_key (create Docker secret first)"
    exit 1
  fi

  KEY_LENGTH="$($DOCKER_CMD exec "${CONTAINER_ID}" sh -c "tr -d '\r\n' </run/secrets/bunq_api_key | wc -c" | tr -d '[:space:]')"
  echo "bunq_api_key length: ${KEY_LENGTH}"
  if [ "${KEY_LENGTH}" -ne 64 ]; then
    echo "ERROR: bunq_api_key must be exactly 64 chars"
    exit 1
  fi

  if ! $DOCKER_CMD exec "${CONTAINER_ID}" sh -c "tr -d '\r\n' </run/secrets/bunq_api_key | grep -Eq '^[0-9A-Fa-f]{64}$'"; then
    echo "ERROR: bunq_api_key contains non-hex characters"
    exit 1
  fi
fi

echo "[4/6] Remove existing Bunq API context"
$DOCKER_CMD exec "${CONTAINER_ID}" sh -c "rm -f /app/config/bunq_production.conf /app/config/bunq_sandbox.conf"

if [ "${USE_VAULTWARDEN}" = "false" ]; then
  echo "[5/6] Create fresh Bunq API context (installation + device registration)"
  $DOCKER_CMD exec "${CONTAINER_ID}" python3 - <<'PY'
import os
import sys
import traceback

from bunq.sdk.context.api_context import ApiContext
from bunq.sdk.context.api_environment_type import ApiEnvironmentType


def read_secret(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except FileNotFoundError:
        return ""


api_key = read_secret("/run/secrets/bunq_api_key") or os.getenv("BUNQ_API_KEY", "").strip()
if not api_key:
    raise SystemExit("ERROR: bunq_api_key secret/BUNQ_API_KEY is empty")

environment = os.getenv("BUNQ_ENVIRONMENT", "PRODUCTION").strip().upper()
env_type = ApiEnvironmentType.SANDBOX if environment == "SANDBOX" else ApiEnvironmentType.PRODUCTION
config_file = "/app/config/bunq_sandbox.conf" if environment == "SANDBOX" else "/app/config/bunq_production.conf"

try:
    context = ApiContext.create(env_type, api_key, "Bunq Dashboard (READ-ONLY)")
    context.save(config_file)
    print(f"OK: context saved to {config_file}")
except Exception as exc:
    print(f"ERROR: {exc}")
    traceback.print_exc()
    sys.exit(1)
PY
else
  if [ "${VAULTWARDEN_ACCESS_METHOD}" = "cli" ]; then
    if ! $DOCKER_CMD exec "${CONTAINER_ID}" test -f /run/secrets/vaultwarden_master_password; then
      echo "ERROR: missing /run/secrets/vaultwarden_master_password (required for VAULTWARDEN_ACCESS_METHOD=cli)"
      exit 1
    fi
  fi
  echo "[5/6] Vaultwarden mode: context will be recreated on service restart"
fi

echo "[6/6] Restart service to load refreshed context and print recent logs"
$DOCKER_CMD service update --force "${SERVICE_NAME}" >/dev/null
LOG_OUTPUT="$($DOCKER_CMD service logs --since "${LOG_MINUTES}m" "${SERVICE_NAME}" 2>&1 || true)"
printf '%s\n' "$LOG_OUTPUT" | \
  grep -E "Retrieving API key from Vaultwarden|API key retrieved from vault|API key loaded from env/secret|Bunq API|context|Incorrect API key or IP address|initialized|Failed|response id" || true

if ! printf '%s\n' "$LOG_OUTPUT" | grep -Eq "API key retrieved from vault|API key loaded from env/secret|No valid API key"; then
  echo "WARN: expected API key startup lines were not detected."
  echo "Tip: run 'sh scripts/restart_bunq_service.sh' for a focused restart check."
  echo "Tip: if you rebuilt with a git-tagged image, run 'IMAGE_TAG=\$(git rev-parse --short HEAD) sh scripts/restart_bunq_service.sh'."
fi

echo "Done."
