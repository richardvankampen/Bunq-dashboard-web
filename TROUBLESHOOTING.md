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

## 🟡 UI/Data Issues

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
