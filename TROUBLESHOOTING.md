# 🐛 Troubleshooting Guide - Bunq Dashboard

Common issues, diagnostics, and recovery steps.

**Language versions**
- English (this file): [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- Dutch (full original): [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)

---

## 🧭 Navigation

- Overview: [README.md](README.md)
- Synology installation: [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
- Security guide: [SECURITY.md](SECURITY.md)

## 📋 Quick Diagnostic

Run these first:

```bash
# Running containers/services
docker ps
sudo docker service ls

# Current dashboard container id
BUNQ_CONTAINER=$(docker ps --filter name=bunq_bunq-dashboard -q | head -n1)

# Service logs
sudo docker service logs --since 10m bunq_bunq-dashboard

# Health endpoints
curl -s http://127.0.0.1:5000/api/live
curl -s http://127.0.0.1:5000/api/health
```

Notes:
- `/api/live` checks process/container liveness
- `/api/health` checks readiness and can return `503` when Bunq key/IP mismatches

## 🌍 Public IP strategy (fixed vs sticky)

For this dashboard, your Bunq API access is effectively tied to your **current public egress IP**.
If that IP changes, Bunq can reject requests with `Incorrect API key or IP address` until you update the whitelist.

Definitions:
- **Fixed/static public IP**: your public IP does not change unless your provider reassigns it manually.
- **Sticky dynamic public IP**: officially dynamic, but often remains the same for long periods (until modem reconnect, outage, maintenance, or lease reset).
- **Regular dynamic public IP**: may change more frequently and unpredictably.

Why this matters here:
- fewer Bunq whitelist re-registrations
- fewer `503` readiness incidents after ISP/router events
- more predictable operations and easier diagnostics

Provider reality (Netherlands, typical situation as of March 1, 2026):
- Static public IPv4 is usually offered on **business** subscriptions (commonly as an add-on), including many plans from providers such as KPN Zakelijk, Ziggo Zakelijk, and Odido Zakelijk.
- Residential subscriptions are usually dynamic; some behave sticky, but this is generally not guaranteed contractually.
- Mobile/5G and CGNAT connections are usually the least stable for IP-based allowlists.

What to do when IP changed:
```bash
cd /volume1/docker/bunq-dashboard
NO_PROMPT=true sh scripts/register_bunq_ip.sh
# Optional explicit target override:
# TARGET_IP=<PUBLIC_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh
sudo sh scripts/restart_bunq_service.sh
```

## 🔴 Critical Issues

### 1. Dashboard service not starting

Checks:

```bash
sudo docker service ps bunq_bunq-dashboard --no-trunc
sudo docker service logs bunq_bunq-dashboard
```

Typical causes:
- wrong/missing Docker secret
- invalid `.env` values
- image build mismatch

Recovery:

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

If config changed (`.env` / compose / secrets), do full deploy:

```bash
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq; docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard'
```

### 2. Login works, but Bunq data fails

Symptoms:
- `503` on `/api/accounts` or `/api/transactions`
- UI shows API initialized = false

Checks:

```bash
sudo docker service logs --since 10m bunq_bunq-dashboard | grep -E "Bunq API initialized|Incorrect API key or IP address|No valid API key|Vaultwarden"
```

Likely causes:
- wrong Bunq API key
- Bunq whitelist IP mismatch
- Vaultwarden retrieval failure

Recovery:
- verify Vaultwarden item name and credentials
- run whitelist update
- restart/reinitialize Bunq context

### 3. Savings accounts missing in widget/API

Validate API output:

```bash
EXPECTED_ACCOUNTS_JSON='[
  {"description":"Spaarrekening","currency":"EUR"},
  {"description":"Spaargeld in ZAR","currency":"ZAR"}
]'

DASHBOARD_USERNAME="<dashboard-user>" \
DASHBOARD_PASSWORD="<dashboard-pass>" \
python3 /volume1/docker/bunq-dashboard/scripts/check_accounts_api.py \
  --base-url "https://<your-domain>" \
  --insecure \
  --expected-json "$EXPECTED_ACCOUNTS_JSON" \
  --timeout 180
```

If needed, collect raw endpoint debug evidence:

```bash
sudo sh scripts/debug_raw_monetary_accounts.sh bunq_bunq-dashboard 0 | tee /tmp/monetary_debug.log
grep -E "^(attempt_count=|== /user/|parsed_accounts=|first_account=|result_type=|probe_|error=)" /tmp/monetary_debug.log
```

### 4. Vaultwarden-related failures

Checks:

```bash
sudo docker ps | grep vaultwarden
curl -k -I https://vault.yourdomain.com
```

Validate app settings:
- `USE_VAULTWARDEN=true`
- `VAULTWARDEN_ACCESS_METHOD=cli`
- `VAULTWARDEN_URL=https://...`
- required Vaultwarden secrets exist in Docker Swarm

Vaultwarden hostname resolves to the wrong/old IP inside the container (e.g. after a LAN subnet change)?
- set `VAULTWARDEN_EXTRA_HOST=<vault-hostname>:<nas-lan-ip>` in `.env`
- then run a full stack deploy (not quick redeploy) so the host mapping is applied

## 🟡 UI/Data Issues

### 4b. Container restarts with `non-zero exit (137): unhealthy container`

Startup fetches the API key from Vaultwarden (~35s, once, in the Gunicorn master) and initialises Bunq before Gunicorn answers `/api/live`. The healthcheck `start_period` (300s) covers this. If an older deployment still uses a short start period, apply it to the running service without redeploying:

```bash
sudo docker service update --health-start-period 300s bunq_bunq-dashboard
```

Also check the logs for `Vault item '...' not found`: `VAULTWARDEN_ITEM_NAME` in `.env` must match the vault item name exactly (case-sensitive).

After rotating the Bunq API key in Vaultwarden, restart the service (`sudo docker service update --force bunq_bunq-dashboard`): workers reuse the key fetched at startup.

### 5. Charts load but numbers look incomplete

Check transaction diagnostics:

```bash
curl -s "http://127.0.0.1:5000/api/transactions?days=90&page=1&page_size=200" | jq '.meta'
```

Look for:
- `truncated: true`
- `amount_eur_missing_count > 0`

Actions:
- increase page tuning env vars if needed
- verify FX conversion settings

### 5b. Transaction store and monthly reconcile

Transactions are stored in SQLite (`config/dashboard_data.db`, table `bunq_transactions`). When the stored data covers the selected period, the dashboard answers from the database right away and checks Bunq for newer transactions in the background (at most once per `SYNC_MIN_INTERVAL_SECONDS`); new transactions appear on the next load. It only waits for Bunq on the first load or when you pick a longer period than is stored. The account list is reused for `ACCOUNTS_CACHE_SECONDS` and then refreshed in the background.

Once a month (default: the 1st, 03:00–06:00 Europe/Amsterdam) the app refetches everything back to the oldest stored transaction and applies the differences:
- new transactions are added, changed ones updated;
- transactions Bunq no longer returns are marked deleted and hidden (the row stays in the database);
- transactions older than what Bunq still serves are kept and stay visible.

Check the last runs:
```bash
sudo docker service logs --since 48h bunq_bunq-dashboard 2>&1 | grep "Reconcile"
```

Run a reconcile now (same logic as the monthly run):
```bash
BUNQ_CONTAINER=$(sudo docker ps -q -f name=bunq_bunq-dashboard | head -n1)
sudo docker exec "$BUNQ_CONTAINER" python3 -c "import api_proxy; print(api_proxy.run_reconcile_exclusive('manual'))"
```
Logged-in API alternative: `POST /api/admin/reconcile` (start) and `GET /api/admin/reconcile` (status and recent runs).

### 6. New frontend changes not visible

Likely browser cache issue.

Actions:
- hard refresh (Ctrl/Cmd + Shift + R)
- clear site cache
- verify deployed image tag in service logs

## 🧰 Useful Commands

```bash
# Show service image currently in use
sudo docker service inspect bunq_bunq-dashboard --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'

# Force rolling restart (no image change)
sudo docker service update --force bunq_bunq-dashboard

# Quick code-only redeploy
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false

# Full update flow
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

## 📎 More Details

For the full Dutch troubleshooting knowledge base:
- [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)
