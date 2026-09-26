# 🐛 Troubleshooting Guide - Bunq Dashboard

Diagnosis and recovery on Synology Docker Swarm (session-based, Vaultwarden-first installations).

**Language versions**
- English (this file): [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- Dutch: [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)

---

## 🧭 Navigation

- Overview: [README.md](README.md)
- Installation and maintenance: [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
- Security: [SECURITY.md](SECURITY.md)

---

## 📋 Quick Diagnostic

Run these first:

```bash
cd /volume1/docker/bunq-dashboard

sudo docker ps
sudo docker service ls
sudo docker service ps bunq_bunq-dashboard --no-trunc
sudo docker service logs --since 10m bunq_bunq-dashboard

curl -s http://127.0.0.1:5000/api/live
curl -s http://127.0.0.1:5000/api/health
```

Interpretation:
- `/api/live` must return `200` when the process is running.
- `/api/health` may return `503` when Bunq initialisation failed (usually a key/IP/whitelist problem).

---

## 🌍 Public IP strategy (fixed vs sticky)

For this dashboard, Bunq API access is effectively tied to your **current public egress IP**.
If that IP changes, Bunq can reject requests with `Incorrect API key or IP address` until you update the whitelist.
With Tailscale: if the NAS uses an **exit node**, Bunq sees the exit node's public IP instead; turn the exit node off on the NAS (or whitelist that IP).

Definitions:
- **Fixed/static public IP**: your public IP does not change unless your provider reassigns it.
- **Sticky dynamic public IP**: officially dynamic, but often the same for a long time (until a modem reconnect, outage, maintenance or lease reset).
- **Regular dynamic public IP**: may change more often and less predictably.

Why this matters here:
- fewer Bunq whitelist re-registrations
- fewer `503` readiness incidents after ISP/router events
- more predictable operation and easier diagnostics

Provider reality (Netherlands, typical situation as of March 2026):
- A static public IPv4 address is usually offered on **business** subscriptions (often as an add-on), including many plans from KPN Zakelijk, Ziggo Zakelijk and Odido Zakelijk.
- Residential subscriptions are usually dynamic; some behave sticky, but this is rarely guaranteed contractually.
- Mobile/5G and CGNAT connections are the least predictable for IP-based allowlists.

When your public IP changed:
```bash
cd /volume1/docker/bunq-dashboard
sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh
# Optional explicit target:
# sudo env TARGET_IP=<PUBLIC_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh
sudo sh scripts/restart_bunq_service.sh
```

---

## 🔄 Update and redeploy flows

### 1. Code-only redeploy (recommended)

For changes in code/templates/docs, without `.env`/compose/secrets/network changes:

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

### 2. Full deploy after a config change

For changes in `.env`, `docker-compose.yml`, secrets or network:

```bash
cd /volume1/docker/bunq-dashboard
TAG=$(sudo git rev-parse --short HEAD)
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

### 3. Full install/update routine

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

---

## 🔴 Critical Issues

### 1. Dashboard service does not start

Symptoms:
- `docker service ps` shows failed/rejected tasks
- the UI returns 502/503

Checks:
```bash
sudo docker service ps bunq_bunq-dashboard --no-trunc
sudo docker service logs --since 10m bunq_bunq-dashboard
```

Typical causes: a missing/wrong Docker secret, invalid `.env` values, an image build mismatch.

Recovery:
1. After a code change: code-only redeploy.
2. After a config/secrets change: full deploy.
3. Persistent build/deploy problems: install/update script.

### 2. Login fails (401 / Invalid username or password)

```bash
cd /volume1/docker/bunq-dashboard
grep -E '^BASIC_AUTH_USERNAME=' .env
sudo docker secret ls | grep bunq_basic_auth_password
```

- The dashboard password comes from the Docker secret `bunq_basic_auth_password`, not from `.env`.
- To change it: recreate the secret, then do a full deploy.
- After 5 failed attempts per minute the login is rate-limited; wait a minute.

### 3. Login works, but Bunq data fails

Symptoms:
- `503` on `/api/accounts` or `/api/transactions`
- the UI shows that the API is not initialised

```bash
sudo docker service logs --since 15m bunq_bunq-dashboard | grep -E "Bunq API initialized|Incorrect API key or IP address|No valid API key|Vaultwarden"
```

Likely causes: wrong Bunq API key, whitelist IP mismatch, Vaultwarden retrieval failure.

Recovery:
1. In the dashboard: `Settings → Admin maintenance → Run full maintenance (recommended)`. The panel's **What problem do you have?** guide and the **Advice** line in `Check status` point to the right action.
2. Or in the terminal:
   ```bash
   cd /volume1/docker/bunq-dashboard
   sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh
   sudo sh scripts/restart_bunq_service.sh
   ```

### 4. Vaultwarden connection fails

```bash
sudo docker ps | grep vaultwarden
sudo docker logs --tail 200 vaultwarden
sudo docker service logs --since 10m bunq_bunq-dashboard | grep -E "Vaultwarden|API key retrieved from vault|No valid API key"
curl -I https://vault.yourdomain.com
```

Check:
- `.env`: `USE_VAULTWARDEN=true`, `VAULTWARDEN_ACCESS_METHOD=cli`, `VAULTWARDEN_URL=https://...`
- the secrets `bunq_vaultwarden_client_id`, `bunq_vaultwarden_client_secret` and `bunq_vaultwarden_master_password` exist

Vaultwarden hostname resolves to a wrong/old IP inside the container (e.g. after a LAN subnet change)?
- set `VAULTWARDEN_EXTRA_HOST=<vault-hostname>:<nas-lan-ip>` in `.env`
- then do a full stack deploy (not a quick redeploy) so the host mapping is applied

### 5. Container restarts with `non-zero exit (137): unhealthy container`

At startup the API key is fetched from Vaultwarden once (in the Gunicorn master, ~35 s) and Bunq is initialised before Gunicorn answers `/api/live`. The healthcheck `start_period` (300 s) covers this. If an older deployment still uses a short start period, apply it to the running service without redeploying:

```bash
sudo docker service update --health-start-period 300s bunq_bunq-dashboard
```

Also check the logs for `Vault item '...' not found`: `VAULTWARDEN_ITEM_NAME` in `.env` must match the vault item name exactly (case-sensitive).

After rotating the Bunq API key in Vaultwarden, restart the service (`sudo docker service update --force bunq_bunq-dashboard`): workers reuse the key fetched at startup.

### 6. Savings accounts missing in the widget or `/api/accounts`

Validate the API output:

```bash
EXPECTED_ACCOUNTS_JSON='[
  {"description":"Savings account","currency":"EUR"}
]'

DASHBOARD_USERNAME="<dashboard-user>" \
DASHBOARD_PASSWORD="<dashboard-pass>" \
python3 /volume1/docker/bunq-dashboard/scripts/check_accounts_api.py \
  --base-url "https://<your-domain>" \
  --insecure \
  --expected-json "$EXPECTED_ACCOUNTS_JSON" \
  --timeout 180
```

If it fails: run full maintenance first and repeat the check. Still failing? Collect raw endpoint evidence (official routes only):

```bash
sudo sh scripts/debug_raw_monetary_accounts.sh bunq_bunq-dashboard 0 | tee /tmp/monetary_debug.log
grep -E "^(attempt_count=|== /user/|parsed_accounts=|first_account=|result_type=|probe_|error=)" /tmp/monetary_debug.log
```

---

## 🟡 Common Issues

### 7. Transaction store and monthly reconcile

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

### 8. Numbers look incomplete or loading is slow

The **Data quality** widget in the dashboard shows the warnings below. You can also open this URL in the browser while logged in (the API needs your session):

```text
https://<your-domain>/api/transactions?days=365&page=1&page_size=1
```

Look for:
- `truncated: true` / `truncated_accounts`: Bunq paging hit its page cap for those accounts
- `amount_eur_missing_count > 0`: non-EUR transactions without an EUR conversion
- `sync_errors`: a Bunq source that failed during the sync

Actions:
- `truncated`: the next background sync or the monthly reconcile usually fills the gap. For very large histories raise `BUNQ_PAYMENT_MAX_PAGES` / `BUNQ_CARD_PAYMENT_MAX_PAGES`; these are **not** in `docker-compose.yml`, so add them to its `environment:` block and do a full deploy.
- `amount_eur_missing_count`: check `FX_ENABLED=true` and that the container can reach the FX source.
- Slow first load of a long period: expected once (the store is filled); later loads come from the store.

### 9. Categories look wrong

- Personal rules in `config/category_rules.json` win over the built-in rules; see "Personal category rules" in [README.md](README.md).
- Rules are all-fields-must-match; text matches are case-insensitive substrings, IBANs exact.
- After changing the file, run a code-only redeploy: stored transactions are recategorised once on startup. Check the logs for errors about reading the rules file (invalid JSON).

### 10. CORS errors

```bash
grep '^ALLOWED_ORIGINS=' /volume1/docker/bunq-dashboard/.env
```

`ALLOWED_ORIGINS` must match the URL in your browser exactly (scheme, host and port), e.g. `https://nas.<your-tailnet>.ts.net` when you use `tailscale serve`. Several origins: separate them with commas. After a change: full deploy.

### 11. Session expires too quickly or login does not stick

Check:
- the browser accepts cookies
- you always use the same URL (the cookie is bound to the host)
- `SESSION_COOKIE_SECURE` matches your setup: `true` with HTTPS, `false` only for local HTTP testing

Sessions last 24 hours. After a `.env` change: full deploy.

### 12. Frontend changes not visible

Usually the browser cache.

1. Hard refresh (`Ctrl/Cmd + Shift + R`).
2. Check the image in use:
   ```bash
   sudo docker service inspect bunq_bunq-dashboard --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
   ```
3. Run a code-only redeploy.

### 13. Dashboard not reachable via Tailscale

Check:
- the device and the NAS are both **connected** in the Tailscale app (same tailnet) and the NAS key has not expired (admin console → Machines)
- `http://<Tailscale IP of the NAS>:5000` works; if it doesn't, allow `100.64.0.0/10` for port 5000 in the Synology firewall
- with `tailscale serve`: MagicDNS and HTTPS certificates are enabled in the admin console, and `sudo tailscale serve status` shows port 5000
- `Serve is not enabled on your tailnet` (with a link): one-time approval; open the link as the tailnet admin, confirm, and run `sudo tailscale serve --bg 5000` again
- login works but the session doesn't stick: `ALLOWED_ORIGINS` must contain the exact `https://…ts.net` URL and `SESSION_COOKIE_SECURE=true` (full deploy after changing `.env`)
- never use `tailscale funnel`: it makes the dashboard reachable from the internet

---

## 🧰 Useful Commands

```bash
# Image the service currently runs
sudo docker service inspect bunq_bunq-dashboard --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'

# Rolling restart (no image change)
sudo docker service update --force bunq_bunq-dashboard

# Restart + startup validation
sudo sh scripts/restart_bunq_service.sh

# Shell in the running container
sudo docker exec -it $(sudo docker ps -q -f name=bunq_bunq-dashboard | head -n1) sh
```

---

## 📦 Create a diagnostic package

```bash
cd /volume1/docker/bunq-dashboard

sudo sh -c 'echo "=== Service status ===" > diagnostic.txt'
sudo sh -c 'docker service ps bunq_bunq-dashboard --no-trunc >> diagnostic.txt 2>&1'
sudo sh -c 'printf "\n=== Dashboard logs ===\n" >> diagnostic.txt'
sudo sh -c 'docker service logs --since 1h bunq_bunq-dashboard >> diagnostic.txt 2>&1'
sudo sh -c 'printf "\n=== Live/Health ===\n" >> diagnostic.txt'
sudo sh -c 'curl -s http://127.0.0.1:5000/api/live >> diagnostic.txt 2>&1'
sudo sh -c 'curl -s http://127.0.0.1:5000/api/health >> diagnostic.txt 2>&1'

cat diagnostic.txt
```

Always check `diagnostic.txt` for sensitive data (IBANs, names, amounts, IPs) before sharing it.

---

## 📞 Help

- GitHub issues: <https://github.com/richardvankampen/Bunq-dashboard-web/issues>
- Include in every issue:
  - a short description of the problem
  - steps to reproduce
  - relevant (anonymised) log lines
  - output of `docker --version`
  - Synology model and DSM version
- Security issues: report privately, see [SECURITY.md](SECURITY.md#-vulnerability-reporting).
