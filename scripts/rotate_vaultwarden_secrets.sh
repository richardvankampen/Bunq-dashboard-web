#!/bin/sh
set -eu

# Rotate Vaultwarden-related Docker secrets used by bunq-dashboard.
# Typical use-case: rotated Vaultwarden OAuth client_secret and/or master password.
#
# Usage (interactive):
#   sh scripts/rotate_vaultwarden_secrets.sh
#
# Usage (non-interactive):
#   NEW_VAULTWARDEN_CLIENT_ID='user.xxxx-xxxx-xxxx-xxxx' \
#   NEW_VAULTWARDEN_CLIENT_SECRET='...' \
#   NEW_VAULTWARDEN_MASTER_PASSWORD='...' \
#   sh scripts/rotate_vaultwarden_secrets.sh

STACK_NAME="${STACK_NAME:-bunq}"
SERVICE_NAME="${SERVICE_NAME:-bunq_bunq-dashboard}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
WAIT_SECONDS="${WAIT_SECONDS:-15}"

NEW_CLIENT_ID="${NEW_VAULTWARDEN_CLIENT_ID:-}"
NEW_CLIENT_SECRET="${NEW_VAULTWARDEN_CLIENT_SECRET:-}"
NEW_MASTER_PASSWORD="${NEW_VAULTWARDEN_MASTER_PASSWORD:-}"

say() {
  printf '%s\n' "$*"
}

cleanup_tty() {
  stty echo </dev/tty 2>/dev/null || true
}
trap cleanup_tty EXIT INT TERM

trim_crlf() {
  printf '%s' "$1" | tr -d '\r\n'
}

prompt_visible() {
  prompt="$1"
  printf '%s' "$prompt" >/dev/tty
  IFS= read -r value </dev/tty || true
  printf '%s' "$value"
}

prompt_hidden() {
  prompt="$1"
  printf '%s' "$prompt" >/dev/tty
  stty -echo </dev/tty
  IFS= read -r value </dev/tty || true
  stty echo </dev/tty
  printf '\n' >/dev/tty
  printf '%s' "$value"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker command not found"
  exit 1
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "ERROR: ${COMPOSE_FILE} not found. Run from repo root."
  exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found. Create it first."
  exit 1
fi

DOCKER_CMD="docker"
if [ "$(id -u)" -ne 0 ]; then
  DOCKER_CMD="sudo docker"
fi

if [ -t 0 ]; then
  if [ -z "${NEW_CLIENT_ID}" ]; then
    NEW_CLIENT_ID="$(prompt_visible "New Vaultwarden client_id (enter = keep current): ")"
  fi
  if [ -z "${NEW_CLIENT_SECRET}" ]; then
    NEW_CLIENT_SECRET="$(prompt_hidden "New Vaultwarden client_secret (enter = keep current): ")"
  fi
  if [ -z "${NEW_MASTER_PASSWORD}" ]; then
    NEW_MASTER_PASSWORD="$(prompt_hidden "New Vaultwarden master password (enter = keep current): ")"
  fi
fi

NEW_CLIENT_ID="$(trim_crlf "${NEW_CLIENT_ID}")"
NEW_CLIENT_SECRET="$(trim_crlf "${NEW_CLIENT_SECRET}")"
NEW_MASTER_PASSWORD="$(trim_crlf "${NEW_MASTER_PASSWORD}")"

ROTATE_COUNT=0
[ -n "${NEW_CLIENT_ID}" ] && ROTATE_COUNT=$((ROTATE_COUNT + 1))
[ -n "${NEW_CLIENT_SECRET}" ] && ROTATE_COUNT=$((ROTATE_COUNT + 1))
[ -n "${NEW_MASTER_PASSWORD}" ] && ROTATE_COUNT=$((ROTATE_COUNT + 1))

if [ "${ROTATE_COUNT}" -eq 0 ]; then
  say "No new values provided. Nothing to rotate."
  exit 1
fi

if [ -t 0 ]; then
  say "Will rotate:"
  [ -n "${NEW_CLIENT_ID}" ] && say "- bunq_vaultwarden_client_id"
  [ -n "${NEW_CLIENT_SECRET}" ] && say "- bunq_vaultwarden_client_secret"
  [ -n "${NEW_MASTER_PASSWORD}" ] && say "- bunq_vaultwarden_master_password"
  printf "Continue? [y/N]: "
  IFS= read -r CONFIRM || true
  case "$(printf '%s' "${CONFIRM}" | tr '[:upper:]' '[:lower:]')" in
    y|yes)
      ;;
    *)
      say "Aborted."
      exit 1
      ;;
  esac
fi

rotate_secret_if_set() {
  secret_name="$1"
  secret_value="$2"
  if [ -z "${secret_value}" ]; then
    return 0
  fi
  say "Updating secret ${secret_name}"
  $DOCKER_CMD secret rm "${secret_name}" >/dev/null 2>&1 || true
  printf '%s' "${secret_value}" | $DOCKER_CMD secret create "${secret_name}" - >/dev/null
}

say "[1/5] Stopping stack ${STACK_NAME}"
$DOCKER_CMD stack rm "${STACK_NAME}" >/dev/null 2>&1 || true
sleep "${WAIT_SECONDS}"

say "[2/5] Rotating selected Vaultwarden secrets"
rotate_secret_if_set "bunq_vaultwarden_client_id" "${NEW_CLIENT_ID}"
rotate_secret_if_set "bunq_vaultwarden_client_secret" "${NEW_CLIENT_SECRET}"
rotate_secret_if_set "bunq_vaultwarden_master_password" "${NEW_MASTER_PASSWORD}"
unset NEW_CLIENT_ID NEW_CLIENT_SECRET NEW_MASTER_PASSWORD

say "[3/5] Deploying stack ${STACK_NAME}"
set -a
. "./${ENV_FILE}"
set +a
$DOCKER_CMD stack deploy -c "${COMPOSE_FILE}" "${STACK_NAME}" >/dev/null

say "[4/5] Restarting ${SERVICE_NAME}"
$DOCKER_CMD service update --force "${SERVICE_NAME}" >/dev/null 2>&1 || true
sleep 6

say "[5/5] Validation"
$DOCKER_CMD service logs --since 2m "${SERVICE_NAME}" 2>&1 | \
  grep -E "Vaultwarden|API key|initialized|Incorrect client_secret|No valid API key|error" || true

CONTAINER_ID="$($DOCKER_CMD ps --filter "name=${SERVICE_NAME}" -q | head -n1 || true)"
if [ -n "${CONTAINER_ID}" ]; then
  TOKEN_CODE="$($DOCKER_CMD exec "${CONTAINER_ID}" sh -lc '
    URL="${VAULTWARDEN_URL:-http://vaultwarden:80}"
    CID="$(tr -d "\r\n" </run/secrets/vaultwarden_client_id 2>/dev/null || true)"
    CSECRET="$(tr -d "\r\n" </run/secrets/vaultwarden_client_secret 2>/dev/null || true)"
    if [ -z "$CID" ] || [ -z "$CSECRET" ]; then
      echo "missing-secrets"
      exit 0
    fi
    curl -s -o /dev/null -w "%{http_code}" -X POST "$URL/identity/connect/token" \
      --data-urlencode grant_type=client_credentials \
      --data-urlencode scope=api \
      --data-urlencode "client_id=$CID" \
      --data-urlencode "client_secret=$CSECRET" \
      --data-urlencode deviceType=22 \
      --data-urlencode deviceIdentifier=bunq-dashboard \
      --data-urlencode "deviceName=Bunq Dashboard"
  ' 2>/dev/null || true)"
  if [ "${TOKEN_CODE}" = "200" ]; then
    say "Vaultwarden token check: OK (200)"
  elif [ "${TOKEN_CODE}" = "missing-secrets" ]; then
    say "Vaultwarden token check: skipped (missing secrets in container)"
  else
    say "Vaultwarden token check: FAILED (${TOKEN_CODE:-no-response})"
  fi
fi

say "Done."
