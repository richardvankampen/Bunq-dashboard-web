#!/bin/sh
set -eu

# Re-register current egress IP for Bunq API by creating a fresh ApiContext.
# Useful after API key rotation, VPN/public IP change, or "Incorrect API key or IP address".

SERVICE_NAME="${1:-bunq_bunq-dashboard}"
LOG_MINUTES="${LOG_MINUTES:-5}"
NO_PROMPT="${NO_PROMPT:-false}"
VERIFY_EGRESS_MATCH="${VERIFY_EGRESS_MATCH:-true}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker command not found"
  exit 1
fi

DOCKER_CMD="docker"
if [ "$(id -u)" -ne 0 ]; then
  DOCKER_CMD="sudo docker"
fi

echo "Service: ${SERVICE_NAME}"

resolve_public_ipv4_host() {
  if ! command -v curl >/dev/null 2>&1; then
    return 1
  fi

  for URL in \
    "https://api.ipify.org" \
    "https://ifconfig.me/ip" \
    "https://ipinfo.io/ip"
  do
    VALUE="$(curl -4 -fsS --max-time 12 "${URL}" 2>/dev/null | tr -d '\r\n[:space:]' || true)"
    if printf '%s' "${VALUE}" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
      printf '%s\n' "${VALUE}"
      return 0
    fi
  done

  return 1
}

CONTAINER_ID="$($DOCKER_CMD ps --filter "name=${SERVICE_NAME}" -q | head -n1 || true)"
if [ -z "${CONTAINER_ID}" ]; then
  echo "ERROR: no running container found for service ${SERVICE_NAME}"
  echo "Hint: deploy the stack first."
  exit 1
fi

PROVIDED_TARGET_IP="${TARGET_IP:-}"
if [ -n "${PROVIDED_TARGET_IP}" ]; then
  TARGET_IP="${PROVIDED_TARGET_IP}"
  echo "[1/8] Using provided target IP (skip egress lookup): ${TARGET_IP}"
else
  echo "[1/8] Auto-detect public IPv4 (host first, container fallback)"

  TARGET_IP="$(resolve_public_ipv4_host || true)"
  if [ -n "${TARGET_IP}" ]; then
    echo "Detected host public IPv4: ${TARGET_IP}"
  else
    echo "Host public IPv4 detection failed; trying container egress IPv4 ..."
  fi

  if [ -z "${TARGET_IP}" ]; then
    EGRESS_IP="$($DOCKER_CMD exec "${CONTAINER_ID}" python3 - <<'PY'
import ipaddress
import requests

urls = (
    "https://api64.ipify.org",
    "https://ifconfig.me/ip",
    "https://ipinfo.io/ip",
)

resolved = ""
for url in urls:
    try:
        value = requests.get(url, timeout=10).text.strip()
        ip_obj = ipaddress.ip_address(value)
        if ip_obj.version != 4:
            continue
        if any((ip_obj.is_private, ip_obj.is_loopback, ip_obj.is_link_local, ip_obj.is_reserved, ip_obj.is_multicast)):
            continue
        resolved = value
        break
    except Exception:
        continue

if not resolved:
    raise SystemExit("ERROR: unable to resolve public IPv4 egress from container")
print(resolved)
PY
  2>/dev/null || true)"
    EGRESS_IP="$(printf '%s' "${EGRESS_IP}" | tr -d '\r\n[:space:]')"
    if [ -n "${EGRESS_IP}" ]; then
      TARGET_IP="${EGRESS_IP}"
      echo "Detected container egress public IPv4: ${TARGET_IP}"
    fi
  fi

  if [ -z "${TARGET_IP}" ]; then
    echo "ERROR: unable to determine a public IPv4 automatically."
    echo "Tip: set TARGET_IP explicitly:"
    echo "  TARGET_IP=\$(curl -4 -s https://api.ipify.org) NO_PROMPT=true sh scripts/register_bunq_ip.sh ${SERVICE_NAME}"
    exit 1
  fi
fi

if [ "${NO_PROMPT}" != "true" ] && [ -t 0 ]; then
  printf "Whitelist IPv4 [%s]: " "${TARGET_IP}"
  IFS= read -r INPUT_IP || true
  if [ -n "${INPUT_IP:-}" ]; then
    TARGET_IP="${INPUT_IP}"
  fi
fi

echo "[2/8] Target whitelist IP: ${TARGET_IP}"
$DOCKER_CMD exec -e TARGET_IP="${TARGET_IP}" "${CONTAINER_ID}" python3 - <<'PY'
import ipaddress
import os

target = (os.getenv("TARGET_IP") or "").strip()
if not target:
    raise SystemExit("ERROR: TARGET_IP is empty")
try:
    ip_obj = ipaddress.ip_address(target)
except ValueError:
    raise SystemExit(f"ERROR: invalid TARGET_IP '{target}'")

if ip_obj.version != 4:
    raise SystemExit(f"ERROR: TARGET_IP must be IPv4, got '{target}'")

if any((ip_obj.is_private, ip_obj.is_loopback, ip_obj.is_link_local, ip_obj.is_reserved, ip_obj.is_multicast)):
    raise SystemExit(f"ERROR: TARGET_IP must be public IPv4, got '{target}'")
PY

USE_VAULTWARDEN="$($DOCKER_CMD exec "${CONTAINER_ID}" sh -c 'echo "${USE_VAULTWARDEN:-true}"' | tr '[:upper:]' '[:lower:]')"
VAULTWARDEN_ACCESS_METHOD="$($DOCKER_CMD exec "${CONTAINER_ID}" sh -c 'echo "${VAULTWARDEN_ACCESS_METHOD:-cli}"' | tr '[:upper:]' '[:lower:]')"
echo "[3/8] Auth mode: USE_VAULTWARDEN=${USE_VAULTWARDEN}"
echo "      Whitelist update mode: activate target IP only (deactivation of other IPs disabled by default)"

echo "[4/8] Set Bunq API allowlist IP via API calls"
WHITELIST_RESULT="$($DOCKER_CMD exec \
  -e TARGET_IP="${TARGET_IP}" \
  -e AUTO_SET_BUNQ_WHITELIST_IP=false \
  "${CONTAINER_ID}" python3 - <<'PY'
import json
import os
import sys
from api_proxy import init_bunq, set_bunq_api_whitelist_ip

target_ip = (os.getenv("TARGET_IP", "") or "").strip() or None

if not init_bunq(force_recreate=False, refresh_key=True, run_auto_whitelist=False):
    print("ERROR: Bunq init failed before whitelist update")
    sys.exit(1)

result = set_bunq_api_whitelist_ip(target_ip=target_ip, deactivate_others=False)
print(json.dumps(result, ensure_ascii=False, sort_keys=True))
if not result.get("success"):
    sys.exit(1)
PY
  2>&1)" || {
  echo "ERROR: whitelist update failed"
  printf '%s\n' "${WHITELIST_RESULT}"
  echo "Tip: check if the running context can still authenticate; if not, first restore API key/context and rerun."
  exit 1
}
printf '%s\n' "${WHITELIST_RESULT}"

if [ "${USE_VAULTWARDEN}" = "false" ]; then
  echo "[5/8] Validate bunq_api_key secret (must be 64 hex chars)"
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

echo "[6/8] Remove existing Bunq API context"
$DOCKER_CMD exec "${CONTAINER_ID}" sh -c "rm -f /app/config/bunq_production.conf /app/config/bunq_sandbox.conf"

if [ "${USE_VAULTWARDEN}" = "false" ]; then
  echo "[7/8] Create fresh Bunq API context (installation + device registration)"
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
  echo "[7/8] Vaultwarden mode: context will be recreated on service restart"
fi

echo "[8/8] Restart service to load refreshed context and print recent logs"
$DOCKER_CMD service update --force "${SERVICE_NAME}" >/dev/null
LOG_OUTPUT="$($DOCKER_CMD service logs --since "${LOG_MINUTES}m" "${SERVICE_NAME}" 2>&1 || true)"
printf '%s\n' "$LOG_OUTPUT" | \
  grep -E "Retrieving API key from Vaultwarden|API key retrieved from vault|API key loaded from env/secret|Bunq API|context|Incorrect API key or IP address|initialized|Failed|response id" || true

if ! printf '%s\n' "$LOG_OUTPUT" | grep -Eq "API key retrieved from vault|API key loaded from env/secret|No valid API key"; then
  echo "WARN: expected API key startup lines were not detected."
  echo "Tip: run 'sh scripts/restart_bunq_service.sh' for a focused restart check."
  echo "Tip: if you rebuilt with a git-tagged image, run 'IMAGE_TAG=\$(git rev-parse --short HEAD) sh scripts/restart_bunq_service.sh'."
fi

if [ "${VERIFY_EGRESS_MATCH}" = "true" ]; then
  # Service restart creates a new task/container; refresh container id before exec checks.
  CONTAINER_ID="$($DOCKER_CMD ps --filter "name=${SERVICE_NAME}" -q | head -n1 || true)"
  if [ -z "${CONTAINER_ID}" ]; then
    echo "WARN: no running container found for egress-vs-whitelist validation after restart."
    echo "Done."
    exit 0
  fi

  CHECK_RAW="$($DOCKER_CMD exec "${CONTAINER_ID}" python3 - <<'PY'
from api_proxy import (
    get_public_egress_ip,
    init_bunq,
    get_bunq_user_id,
    list_credential_password_profiles,
    pick_credential_password_profile,
    extract_credential_profile_id,
    list_credential_password_ip_entries,
    extract_whitelist_ip_entry,
)

status = "UNAVAILABLE"
egress = get_public_egress_ip() or ""
active_ips = []

try:
    if init_bunq(force_recreate=False, refresh_key=False, run_auto_whitelist=False):
        user_id = get_bunq_user_id()
        if user_id:
            profiles = list_credential_password_profiles(user_id)
            selected = pick_credential_password_profile(profiles) if profiles else None
            profile_id = extract_credential_profile_id(selected) if selected else None
            if profile_id:
                entries = list_credential_password_ip_entries(user_id, profile_id)
                active_ips = sorted({
                    item.get("ip")
                    for item in (extract_whitelist_ip_entry(entry) for entry in entries)
                    if item.get("status") == "ACTIVE" and item.get("ip")
                })
                if egress and egress in active_ips:
                    status = "MATCH"
                elif egress and active_ips:
                    status = "MISMATCH"
except Exception:
    status = "UNAVAILABLE"

print(f"{status}|{egress}|{','.join(active_ips)}")
PY
  2>/dev/null || true)"
  CHECK_LINE="$(printf '%s\n' "${CHECK_RAW}" | tail -n1)"
  CHECK_STATUS="$(printf '%s' "${CHECK_LINE}" | cut -d'|' -f1)"
  CHECK_EGRESS="$(printf '%s' "${CHECK_LINE}" | cut -d'|' -f2)"
  CHECK_ACTIVE="$(printf '%s' "${CHECK_LINE}" | cut -d'|' -f3)"

  case "${CHECK_STATUS}" in
    MATCH)
      echo "OK: egress IP matches active Bunq whitelist (${CHECK_EGRESS})."
      ;;
    MISMATCH)
      echo "ERROR: egress IP (${CHECK_EGRESS}) is NOT in active Bunq whitelist (${CHECK_ACTIVE})."
      echo "Tip: rerun with explicit target:"
      echo "  TARGET_IP=${CHECK_EGRESS} NO_PROMPT=true sh scripts/register_bunq_ip.sh ${SERVICE_NAME}"
      exit 1
      ;;
    *)
      echo "WARN: could not verify egress-vs-whitelist match automatically."
      [ -n "${CHECK_EGRESS}" ] && echo "Current egress IP: ${CHECK_EGRESS}"
      [ -n "${CHECK_ACTIVE}" ] && echo "Active whitelist IPs: ${CHECK_ACTIVE}"
      ;;
  esac
fi

echo "Done."
