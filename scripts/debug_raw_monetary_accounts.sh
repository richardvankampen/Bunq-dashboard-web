#!/bin/sh
set -eu

# Diagnose Bunq raw monetary-account endpoints from the running dashboard container.
# No heredoc needed from terminal usage.

SERVICE_NAME="${1:-bunq_bunq-dashboard}"
MAX_ROWS="${MAX_ROWS:-20}"
USER_ID="${USER_ID:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker command not found"
  exit 1
fi

DOCKER_CMD="docker"
if [ "$(id -u)" -ne 0 ]; then
  DOCKER_CMD="sudo docker"
fi

CONTAINER_ID="$($DOCKER_CMD ps --filter "name=${SERVICE_NAME}" -q | head -n1 || true)"
if [ -z "${CONTAINER_ID}" ]; then
  echo "ERROR: no running container found for service name '${SERVICE_NAME}'"
  echo "Tip: check with '$DOCKER_CMD ps --format \"table {{.Names}}\\t{{.Status}}\"'"
  exit 1
fi

if [ -z "${USER_ID}" ]; then
  USER_ID_OUTPUT="$($DOCKER_CMD exec "${CONTAINER_ID}" python3 -c "import api_proxy; ok=api_proxy.init_bunq(force_recreate=False, refresh_key=True, run_auto_whitelist=False); ids=api_proxy.discover_bunq_user_ids() if ok else []; print('CODX_USER_ID=' + str((ids or [''])[0]))" 2>&1 || true)"
  USER_ID="$(printf '%s\n' "${USER_ID_OUTPUT}" | awk -F= '/^CODX_USER_ID=/{print $2}' | tail -n1 | tr -d '\r\n')"
fi

if [ -z "${USER_ID}" ]; then
  echo "ERROR: could not resolve a Bunq user id. Set USER_ID explicitly and rerun."
  if [ -n "${USER_ID_OUTPUT:-}" ]; then
    printf '%s\n' "${USER_ID_OUTPUT}"
  fi
  exit 1
fi

echo "Container: ${CONTAINER_ID}"
echo "User ID:   ${USER_ID}"
echo "Max rows:  ${MAX_ROWS}"
set +e
OUTPUT="$($DOCKER_CMD exec \
  -e USER_ID="${USER_ID}" \
  -e MAX_ROWS="${MAX_ROWS}" \
  "${CONTAINER_ID}" \
  python3 -c "import os,api_proxy; uid=os.environ['USER_ID'].strip(); max_rows=int(os.environ.get('MAX_ROWS','20')); ok=api_proxy.init_bunq(force_recreate=False, refresh_key=True, run_auto_whitelist=False); print('init_ok=' + str(ok)); print('last_error=' + str(getattr(api_proxy, '_BUNQ_INIT_LAST_ERROR', None))); client=api_proxy._resolve_bunq_api_client(); plan=api_proxy._raw_monetary_attempt_plan(uid); limit=max_rows if max_rows >= 0 else 0\nfor path, params in plan:\n  print(''); print('== ' + path + ' params=' + str(params) + ' ==')\n  try:\n    result=api_proxy._call_api_client_get(client, path, params=params); payload=api_proxy._extract_json_payload(result); accounts=api_proxy._extract_monetary_accounts_from_raw_payload(payload); print('parsed_accounts=' + str(len(accounts))); print('payload_type=' + (type(payload).__name__ if payload is not None else 'NoneType'))\n    for account in accounts[:limit]:\n      balance = account.get('balance') or {}\n      print(str(account.get('id')) + '\t' + str(account.get('description')) + '\t' + str(balance.get('value')) + '\t' + str(balance.get('currency')) + '\t' + str(account.get('_raw_type')))\n  except Exception as exc:\n    print('error=' + str(exc))" \
  2>&1)"
EXIT_CODE=$?
set -e

printf '%s\n' "${OUTPUT}"
if [ "${EXIT_CODE}" -ne 0 ]; then
  echo "ERROR: debug run failed with exit code ${EXIT_CODE}"
  exit "${EXIT_CODE}"
fi
