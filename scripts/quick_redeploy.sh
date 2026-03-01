#!/bin/sh
set -eu

# Fast code redeploy for Synology Swarm:
# - build image (cached by default)
# - force service update to new image
# - no stack deploy (faster loop)
#
# Use full stack deploy when .env, docker-compose.yml, secrets, or network settings changed.

SERVICE_NAME="${1:-${SERVICE_NAME:-bunq_bunq-dashboard}}"
NO_CACHE="${2:-${NO_CACHE:-false}}"
IMAGE_REPO="${IMAGE_REPO:-bunq-dashboard}"
IMAGE_TAG="${IMAGE_TAG:-}"
SKIP_BUILD="${SKIP_BUILD:-false}"
MAX_UPDATE_RETRIES="${MAX_UPDATE_RETRIES:-6}"
UPDATE_RETRY_DELAY="${UPDATE_RETRY_DELAY:-3}"

normalize_bool() {
  case "$(printf '%s' "${1}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) echo "true" ;;
    *) echo "false" ;;
  esac
}

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker command not found"
  exit 1
fi

DOCKER_CMD="docker"
if [ "$(id -u)" -ne 0 ]; then
  DOCKER_CMD="sudo docker"
fi

NO_CACHE="$(normalize_bool "${NO_CACHE}")"
SKIP_BUILD="$(normalize_bool "${SKIP_BUILD}")"

if [ -z "${IMAGE_TAG}" ]; then
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    IMAGE_TAG="$(git rev-parse --short HEAD 2>/dev/null || true)"
  fi
fi
if [ -z "${IMAGE_TAG}" ]; then
  IMAGE_TAG="$(date +%Y%m%d%H%M%S)"
fi

TARGET_IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"

echo "Service: ${SERVICE_NAME}"
echo "Image:   ${TARGET_IMAGE}"
echo "No cache:${NO_CACHE}"
echo "Skip build: ${SKIP_BUILD}"
echo "Note: quick mode (no docker stack deploy)."
echo "      Use full deploy after .env/compose/secrets/network changes."

if [ "${SKIP_BUILD}" != "true" ]; then
  if [ "${NO_CACHE}" = "true" ]; then
    echo "[1/3] Building image (no-cache)"
    $DOCKER_CMD build --no-cache -t "${TARGET_IMAGE}" -t "${IMAGE_REPO}:local" .
  else
    echo "[1/3] Building image (cached)"
    $DOCKER_CMD build -t "${TARGET_IMAGE}" -t "${IMAGE_REPO}:local" .
  fi
else
  echo "[1/3] Skipping build"
  if ! $DOCKER_CMD image inspect "${TARGET_IMAGE}" >/dev/null 2>&1; then
    if $DOCKER_CMD image inspect "${IMAGE_REPO}:local" >/dev/null 2>&1; then
      echo "Tagging existing ${IMAGE_REPO}:local -> ${TARGET_IMAGE}"
      $DOCKER_CMD tag "${IMAGE_REPO}:local" "${TARGET_IMAGE}"
    else
      echo "ERROR: no local image found (${TARGET_IMAGE} or ${IMAGE_REPO}:local)"
      exit 1
    fi
  fi
fi

if ! $DOCKER_CMD image inspect "${TARGET_IMAGE}" >/dev/null 2>&1; then
  echo "ERROR: image ${TARGET_IMAGE} not found after build"
  exit 1
fi

echo "[2/3] Updating service image"
ATTEMPT=1
UPDATE_EXIT=1
UPDATE_ERR=""
while [ "${ATTEMPT}" -le "${MAX_UPDATE_RETRIES}" ]; do
  set +e
  UPDATE_ERR="$($DOCKER_CMD service update --force --image "${TARGET_IMAGE}" "${SERVICE_NAME}" 2>&1 >/dev/null)"
  UPDATE_EXIT=$?
  set -e
  [ "${UPDATE_EXIT}" -eq 0 ] && break

  if printf '%s\n' "${UPDATE_ERR}" | grep -qi "update out of sequence"; then
    if [ "${ATTEMPT}" -lt "${MAX_UPDATE_RETRIES}" ]; then
      echo "WARN: Swarm update lock busy (attempt ${ATTEMPT}/${MAX_UPDATE_RETRIES}), retry in ${UPDATE_RETRY_DELAY}s"
      sleep "${UPDATE_RETRY_DELAY}"
      ATTEMPT=$((ATTEMPT + 1))
      continue
    fi
  fi
  break
done

if [ "${UPDATE_EXIT}" -ne 0 ]; then
  [ -n "${UPDATE_ERR}" ] && printf '%s\n' "${UPDATE_ERR}"
  echo "ERROR: service update failed"
  echo "Recent task state:"
  $DOCKER_CMD service ps --no-trunc --format "table {{.Name}}\t{{.CurrentState}}\t{{.Error}}" "${SERVICE_NAME}" || true
  exit "${UPDATE_EXIT}"
fi

echo "[3/3] Done"
echo "Next:"
echo "  sudo sh scripts/debug_raw_monetary_accounts.sh ${SERVICE_NAME} 0 | tee /tmp/monetary_debug.log"
