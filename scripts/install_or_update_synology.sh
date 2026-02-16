#!/bin/sh
set -eu

# Guided Synology installer/updater.
# Conservative defaults:
# - does not create/overwrite secrets automatically
# - does not initialize Swarm automatically
# - exits with explicit instructions when prerequisites are missing

STACK_NAME="${STACK_NAME:-bunq}"
SERVICE_NAME="${SERVICE_NAME:-bunq_bunq-dashboard}"
IMAGE_REPO="${IMAGE_REPO:-bunq-dashboard}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
NETWORK_NAME="${NETWORK_NAME:-bunq-net}"
RUN_RESTART_CHECK="${RUN_RESTART_CHECK:-true}"
NO_CACHE="${NO_CACHE:-ask}"
BW_VERSION="${BW_VERSION:-}"
BW_NPM_VERSION="${BW_NPM_VERSION:-}"
BW_SHA256="${BW_SHA256:-}"
CHECK_BUNQ_EGRESS_WHITELIST="${CHECK_BUNQ_EGRESS_WHITELIST:-true}"
POST_DEPLOY_LOG_MINUTES="${POST_DEPLOY_LOG_MINUTES:-6}"
DEPLOY_START_UTC=""

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker command not found"
  exit 1
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "ERROR: ${COMPOSE_FILE} not found. Run this script from the repo root."
  exit 1
fi

DOCKER_CMD="docker"
if [ "$(id -u)" -ne 0 ]; then
  DOCKER_CMD="sudo docker"
fi

REPO_ROOT="$(pwd)"
say() {
  printf '%s\n' "$*"
}

check_swarm() {
  SWARM_STATE="$($DOCKER_CMD info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo inactive)"
  if [ "${SWARM_STATE}" = "active" ]; then
    say "OK: Docker Swarm is active."
    return
  fi

  ADVERTISE_IP="$(ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i==\"src\"){print $(i+1); exit}}' || true)"
  [ -z "${ADVERTISE_IP}" ] && ADVERTISE_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  say "ERROR: Docker Swarm is not active."
  if [ -n "${ADVERTISE_IP}" ]; then
    say "Run first:"
    say "  sudo docker swarm init --advertise-addr ${ADVERTISE_IP}"
  else
    say "Run first:"
    say "  sudo docker swarm init --advertise-addr <LAN-IP>"
  fi
  exit 1
}

ensure_network() {
  if $DOCKER_CMD network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
    say "OK: Network ${NETWORK_NAME} exists."
  else
    say "Creating network ${NETWORK_NAME} (overlay, attachable)..."
    $DOCKER_CMD network create --driver overlay --attachable "${NETWORK_NAME}" >/dev/null
    say "OK: Network ${NETWORK_NAME} created."
  fi

  if $DOCKER_CMD ps --format '{{.Names}}' | grep -qx 'vaultwarden'; then
    $DOCKER_CMD network connect "${NETWORK_NAME}" vaultwarden >/dev/null 2>&1 || true
    say "OK: vaultwarden connected to ${NETWORK_NAME} (or already connected)."
  else
    say "WARN: vaultwarden container not found. Make sure Vaultwarden is running and attached to ${NETWORK_NAME}."
  fi
}

ensure_env_file() {
  if [ -f "${ENV_FILE}" ]; then
    return
  fi
  if [ ! -f ".env.example" ]; then
    say "ERROR: ${ENV_FILE} missing and .env.example not found."
    exit 1
  fi
  cp ".env.example" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}" 2>/dev/null || true
  say "Created ${ENV_FILE} from .env.example."
  say "Edit ${ENV_FILE} first, then re-run this script."
  exit 1
}

load_env() {
  set +e
  set -a
  . "./${ENV_FILE}"
  LOAD_EXIT=$?
  set +a
  set -e
  if [ "${LOAD_EXIT}" -ne 0 ]; then
    say "ERROR: Failed to load ${ENV_FILE}. Quote values with spaces, e.g. VAULTWARDEN_ITEM_NAME=\"Bunq API Key\"."
    exit 1
  fi
}

ensure_runtime_dirs() {
  mkdir -p "${REPO_ROOT}/config" "${REPO_ROOT}/logs"
  chmod 755 "${REPO_ROOT}/config" "${REPO_ROOT}/logs" 2>/dev/null || true
}

secret_exists() {
  SECRET_NAME="$1"
  $DOCKER_CMD secret ls --format '{{.Name}}' | grep -qx "${SECRET_NAME}"
}

MISSING_SECRETS=0

ensure_one_secret() {
  SECRET_NAME="$1"
  if secret_exists "${SECRET_NAME}"; then
    say "OK: Secret ${SECRET_NAME} exists."
    return
  fi
  say "Missing secret: ${SECRET_NAME}"
  MISSING_SECRETS=1
}

ensure_secrets() {
  USE_VAULTWARDEN_NORMALIZED="$(printf '%s' "${USE_VAULTWARDEN:-true}" | tr '[:upper:]' '[:lower:]')"

  ensure_one_secret "bunq_basic_auth_password"
  ensure_one_secret "bunq_flask_secret_key"

  if [ "${USE_VAULTWARDEN_NORMALIZED}" = "true" ]; then
    ensure_one_secret "bunq_vaultwarden_client_id"
    ensure_one_secret "bunq_vaultwarden_client_secret"
    ensure_one_secret "bunq_vaultwarden_master_password"
  else
    ensure_one_secret "bunq_api_key"
  fi

  if [ "${MISSING_SECRETS}" -ne 0 ]; then
    say "ERROR: Required secrets missing. Create missing secrets first, then re-run."
    say "Tip: see SYNOLOGY_INSTALL.md step 3.3 for exact secret commands."
    exit 1
  fi
}

build_and_deploy() {
  NO_CACHE_NORMALIZED="$(printf '%s' "${NO_CACHE}" | tr '[:upper:]' '[:lower:]')"
  case "${NO_CACHE_NORMALIZED}" in
    true|false)
      ;;
    ask|"")
      if [ -t 0 ]; then
        printf "Use clean Docker build (--no-cache)? [Y/n]: "
        read -r NO_CACHE_REPLY || NO_CACHE_REPLY=""
        case "$(printf '%s' "${NO_CACHE_REPLY}" | tr '[:upper:]' '[:lower:]')" in
          n|no)
            NO_CACHE_NORMALIZED=false
            ;;
          *)
            NO_CACHE_NORMALIZED=true
            ;;
        esac
      else
        # Non-interactive mode keeps the safe default.
        NO_CACHE_NORMALIZED=true
      fi
      ;;
    *)
      say "WARN: invalid NO_CACHE='${NO_CACHE}'. Using safe default true."
      NO_CACHE_NORMALIZED=true
      ;;
  esac

  TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
  say "Building image ${IMAGE_REPO}:${TAG} (no-cache=${NO_CACHE_NORMALIZED}) ..."
  BUILD_ARGS=""
  if [ -n "${BW_VERSION}" ]; then
    BUILD_ARGS="${BUILD_ARGS} --build-arg BW_VERSION=${BW_VERSION}"
  fi
  if [ -n "${BW_NPM_VERSION}" ]; then
    BUILD_ARGS="${BUILD_ARGS} --build-arg BW_NPM_VERSION=${BW_NPM_VERSION}"
  fi
  if [ -n "${BW_SHA256}" ]; then
    BUILD_ARGS="${BUILD_ARGS} --build-arg BW_SHA256=${BW_SHA256}"
  fi
  if [ -n "${BUILD_ARGS}" ]; then
    say "Using custom Bitwarden build args from environment."
  fi
  if [ "${NO_CACHE_NORMALIZED}" = "true" ]; then
    # shellcheck disable=SC2086
    $DOCKER_CMD build --no-cache ${BUILD_ARGS} -t "${IMAGE_REPO}:${TAG}" .
  else
    # shellcheck disable=SC2086
    $DOCKER_CMD build ${BUILD_ARGS} -t "${IMAGE_REPO}:${TAG}" .
  fi
  $DOCKER_CMD tag "${IMAGE_REPO}:${TAG}" "${IMAGE_REPO}:local"

  say "Deploying stack ${STACK_NAME} ..."
  DEPLOY_START_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set -a
  . "./${ENV_FILE}"
  set +a
  $DOCKER_CMD stack deploy -c "${COMPOSE_FILE}" "${STACK_NAME}" >/dev/null

  if [ "${RUN_RESTART_CHECK}" = "true" ] && [ -x "scripts/restart_bunq_service.sh" ]; then
    say "Running startup validation script ..."
    IMAGE_TAG="${TAG}" sh "scripts/restart_bunq_service.sh" "${SERVICE_NAME}"
  else
    say "Skipping restart validation (RUN_RESTART_CHECK=${RUN_RESTART_CHECK})."
  fi
}

post_deploy_checks() {
  say "Running post-deploy Bunq validation ..."

  if [ -n "${DEPLOY_START_UTC}" ]; then
    LOG_OUTPUT="$($DOCKER_CMD service logs --since "${DEPLOY_START_UTC}" "${SERVICE_NAME}" 2>&1 || true)"
  else
    LOG_OUTPUT="$($DOCKER_CMD service logs --since "${POST_DEPLOY_LOG_MINUTES}m" "${SERVICE_NAME}" 2>&1 || true)"
  fi

  if printf '%s\n' "${LOG_OUTPUT}" | grep -q "Incorrect API key or IP address"; then
    say "ERROR: Bunq init failed with 'Incorrect API key or IP address'."
    say "Response-id lines:"
    printf '%s\n' "${LOG_OUTPUT}" | grep -E "response id|Incorrect API key or IP address" || true
    say "Fix flow:"
    say "  1) Check current egress IP from container"
    say "  2) Ensure Bunq API key is valid for that IP"
    say "  3) Re-register allowlist IP:"
    say "     TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=true sh scripts/register_bunq_ip.sh ${SERVICE_NAME}"
    exit 1
  fi

  if printf '%s\n' "${LOG_OUTPUT}" | grep -q "No valid API key found"; then
    say "ERROR: No valid API key found during startup."
    say "Check Vaultwarden/Docker secrets and retry."
    exit 1
  fi

  if printf '%s\n' "${LOG_OUTPUT}" | grep -q "Bunq API initialized successfully"; then
    say "OK: Bunq API initialized successfully."
  else
    say "WARN: No explicit 'Bunq API initialized successfully' line seen in recent logs."
  fi

  if [ "${CHECK_BUNQ_EGRESS_WHITELIST}" != "true" ]; then
    say "Skipping egress-vs-whitelist validation (CHECK_BUNQ_EGRESS_WHITELIST=${CHECK_BUNQ_EGRESS_WHITELIST})."
    return
  fi

  CONTAINER_ID="$($DOCKER_CMD ps --filter "name=${SERVICE_NAME}" -q | head -n1 || true)"
  if [ -z "${CONTAINER_ID}" ]; then
    say "WARN: no running container found for egress-vs-whitelist validation."
    return
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
    if init_bunq(force_recreate=False, refresh_key=True, run_auto_whitelist=False):
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
                else:
                    status = "UNAVAILABLE"
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
      say "OK: egress IP matches active Bunq whitelist (${CHECK_EGRESS})."
      ;;
    MISMATCH)
      say "ERROR: egress IP (${CHECK_EGRESS}) is NOT in active Bunq whitelist (${CHECK_ACTIVE})."
      say "Run:"
      say "  TARGET_IP=${CHECK_EGRESS} SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=true sh scripts/register_bunq_ip.sh ${SERVICE_NAME}"
      exit 1
      ;;
    *)
      say "WARN: could not verify egress-vs-whitelist match automatically."
      [ -n "${CHECK_EGRESS}" ] && say "Current egress IP: ${CHECK_EGRESS}"
      [ -n "${CHECK_ACTIVE}" ] && say "Active whitelist IPs: ${CHECK_ACTIVE}"
      ;;
  esac
}

say "== Bunq Dashboard Synology Install/Update =="
ensure_env_file
load_env
check_swarm
ensure_network
ensure_runtime_dirs
ensure_secrets
build_and_deploy
post_deploy_checks
say "Done."
