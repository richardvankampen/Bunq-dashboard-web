#!/bin/sh
set -eu

# Diagnose Bunq raw monetary-account endpoints from the running dashboard container.

SERVICE_NAME="${1:-bunq_bunq-dashboard}"
MAX_ROWS="${2:-${MAX_ROWS:-20}}"
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
$DOCKER_CMD exec \
  -i \
  -e USER_ID="${USER_ID}" \
  -e MAX_ROWS="${MAX_ROWS}" \
  "${CONTAINER_ID}" \
  python3 -u - <<'PY'
import os
import api_proxy

uid = os.environ["USER_ID"].strip()
max_rows = int(os.environ.get("MAX_ROWS", "20"))
ok = api_proxy.init_bunq(force_recreate=False, refresh_key=True, run_auto_whitelist=False)
print("init_ok=" + str(ok))
print("last_error=" + str(getattr(api_proxy, "_BUNQ_INIT_LAST_ERROR", None)))

client = api_proxy._resolve_bunq_api_client()
plan = api_proxy._raw_monetary_attempt_plan(uid)
print("attempt_count=" + str(len(plan)))
limit = max_rows if max_rows >= 0 else 0
inspected_empty_once = False

for path, params in plan:
    print("")
    print("== " + path + " params=" + str(params) + " ==")
    try:
        result = api_proxy._call_api_client_get(client, path, params=params)
        accounts, payload = api_proxy._extract_monetary_accounts_from_raw_result(result)
        print("parsed_accounts=" + str(len(accounts)))
        print("payload_type=" + (type(payload).__name__ if payload is not None else "NoneType"))
        if len(accounts) == 0 and not inspected_empty_once:
            inspected_empty_once = True
            print("result_type=" + type(result).__name__)
            probe_attrs = (
                "value",
                "raw_body",
                "raw_response",
                "body",
                "response_body",
                "response",
                "json",
                "content",
                "text",
                "headers",
                "status_code",
            )
            for attr in probe_attrs:
                if not hasattr(result, attr):
                    continue
                attr_value = getattr(result, attr)
                if callable(attr_value):
                    try:
                        attr_value = attr_value()
                    except Exception as exc:
                        print("probe_" + attr + "=call_error:" + str(exc))
                        continue
                value_type = type(attr_value).__name__
                if isinstance(attr_value, (str, bytes, bytearray)):
                    size = len(attr_value)
                elif isinstance(attr_value, (list, tuple, dict, set)):
                    size = len(attr_value)
                elif attr_value is None:
                    size = 0
                else:
                    size = -1
                print("probe_" + attr + "_type=" + value_type + " size=" + str(size))
                if isinstance(attr_value, dict):
                    keys = list(attr_value.keys())[:8]
                    print("probe_" + attr + "_keys=" + ",".join(str(k) for k in keys))
                elif isinstance(attr_value, (list, tuple)) and attr_value:
                    print("probe_" + attr + "_item0_type=" + type(attr_value[0]).__name__)
                elif isinstance(attr_value, str) and attr_value:
                    print("probe_" + attr + "_preview=" + attr_value[:180].replace("\n", "\\n"))
        if accounts:
            first = accounts[0]
            if isinstance(first, dict):
                first_balance = first.get("balance") or {}
                first_id = first.get("id", first.get("id_"))
                first_desc = first.get("description", first.get("display_name"))
                first_currency = first_balance.get("currency")
                first_raw_type = first.get("_raw_type", "dict")
            else:
                first_balance = api_proxy.get_obj_field(first, "balance") or {}
                first_id = api_proxy.get_obj_field(first, "id_", "id")
                first_desc = api_proxy.get_obj_field(first, "description", "display_name")
                first_currency = api_proxy.get_obj_field(first_balance, "currency", default=None)
                first_raw_type = first.__class__.__name__
            print(
                "first_account="
                + str(first_id)
                + "|"
                + str(first_desc)
                + "|"
                + str(first_currency)
                + "|"
                + str(first_raw_type)
            )
        for account in accounts[:limit]:
            if isinstance(account, dict):
                balance = account.get("balance") or {}
                account_id = account.get("id", account.get("id_"))
                account_desc = account.get("description", account.get("display_name"))
                account_value = balance.get("value")
                account_currency = balance.get("currency")
                raw_type = account.get("_raw_type")
            else:
                balance = api_proxy.get_obj_field(account, "balance") or {}
                account_id = api_proxy.get_obj_field(account, "id_", "id")
                account_desc = api_proxy.get_obj_field(account, "description", "display_name")
                account_value = api_proxy.get_obj_field(balance, "value", default=None)
                account_currency = api_proxy.get_obj_field(balance, "currency", default=None)
                raw_type = account.__class__.__name__
            print(
                str(account_id)
                + "\t"
                + str(account_desc)
                + "\t"
                + str(account_value)
                + "\t"
                + str(account_currency)
                + "\t"
                + str(raw_type)
            )
    except Exception as exc:  # noqa: BLE001
        print("error=" + str(exc))
PY
EXIT_CODE=$?
set -e
if [ "${EXIT_CODE}" -ne 0 ]; then
  echo "ERROR: debug run failed with exit code ${EXIT_CODE}"
  exit "${EXIT_CODE}"
fi
