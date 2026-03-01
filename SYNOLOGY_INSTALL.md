# 🏠 Synology NAS Installation Guide

Step-by-step guide for installing Bunq Dashboard on Synology NAS.

**Language versions**
- English (this file): [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
- Dutch (full original): [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)

---

## 🧭 Navigation

- Overview and quick start: [README.md](README.md)
- Security best practices: [SECURITY.md](SECURITY.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## 📋 Requirements

### Hardware
- Synology NAS with DSM 7+
- Minimum 2GB RAM (4GB recommended)
- Minimum 10GB free disk space
- Intel/AMD CPU (Bunq SDK on ARM is not supported)

### Software
- Container Manager
- SSH access (recommended)
- Bunq Pro/Premium account

### Network
- Static NAS LAN IP (for example `192.168.1.100`)
- Recommended: fixed public IP (best) or sticky dynamic public IP (acceptable) from your ISP
- Open local ports:
  - `5000` (dashboard + API)
  - `9000` (Vaultwarden)

## 🔧 Part 1: Preparation

### Step 1.1 Enable SSH

DSM:
- `Control Panel -> Terminal & SNMP -> Enable SSH`

Test:
```bash
ssh admin@192.168.1.100
```

### Step 1.2 Create folders

```bash
sudo mkdir -p /volume1/docker/vaultwarden
sudo mkdir -p /volume1/docker/bunq-dashboard
sudo chmod -R 755 /volume1/docker
```

## 🔐 Part 2: Vaultwarden

### Step 2.1 Run Vaultwarden

Use Container Manager UI or Docker compose.

Minimal compose example (`/volume1/docker/vaultwarden/docker-compose.yml`):

```yaml
version: '3.8'

services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: vaultwarden
    restart: unless-stopped
    ports:
      - "9000:80"
    volumes:
      - /volume1/docker/vaultwarden:/data
    environment:
      DOMAIN: "http://192.168.1.100:9000"
      SIGNUPS_ALLOWED: "true"
      LOG_LEVEL: "info"
```

Start:
```bash
cd /volume1/docker/vaultwarden
sudo docker compose up -d
```

### Step 2.2 Create account and harden

1. Open `http://192.168.1.100:9000`
2. Create first account
3. Set `SIGNUPS_ALLOWED=false` and restart Vaultwarden

### Step 2.3 Store Bunq API key

In Vaultwarden:
- Create item (type Login)
- Name: `Bunq API Key` (exact)
- Password: your Bunq API key

## 📊 Part 3: Dashboard Setup

### Step 3.1 Clone repository

```bash
cd /volume1/docker/bunq-dashboard
sudo git clone https://github.com/richardvankampen/Bunq-dashboard-web.git .
```

### Step 3.2 Create runtime folders

```bash
cd /volume1/docker/bunq-dashboard
sudo mkdir -p config logs
sudo chmod -R 755 config logs
```

### Step 3.3 Configure `.env`

Create `/volume1/docker/bunq-dashboard/.env` with non-secret settings.

Minimal production example:

```bash
BASIC_AUTH_USERNAME=admin
ALLOWED_ORIGINS=https://bunq.yourdomain.com
SESSION_COOKIE_SECURE=true

USE_VAULTWARDEN=true
VAULTWARDEN_ACCESS_METHOD=cli
VAULTWARDEN_URL=https://vault.yourdomain.com
VAULTWARDEN_ITEM_NAME=Bunq API Key

BUNQ_ENVIRONMENT=PRODUCTION
FLASK_DEBUG=false
LOG_LEVEL=INFO
```

### Step 3.4 Create Docker secrets

Examples:

```bash
# Dashboard password
printf "%s" "<STRONG_PASSWORD>" | sudo docker secret create bunq_basic_auth_password -

# Flask secret key (64 hex)
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
printf "%s" "$SECRET_KEY" | sudo docker secret create bunq_flask_secret_key -

# Vaultwarden credentials
printf "%s" "<VAULTWARDEN_CLIENT_ID>" | sudo docker secret create bunq_vaultwarden_client_id -
printf "%s" "<VAULTWARDEN_CLIENT_SECRET>" | sudo docker secret create bunq_vaultwarden_client_secret -
printf "%s" "<VAULTWARDEN_MASTER_PASSWORD>" | sudo docker secret create bunq_vaultwarden_master_password -
```

## 🚀 Part 4: Deploy

### Recommended install/update command (root)

```bash
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

Important:
- Always run with `sudo sh ...`
- Running as a regular user can cause `.env` values to be missed

### Manual stack deploy (if needed)

Always load `.env` explicitly:

```bash
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

### Quick redeploy for code-only changes

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

Use full stack deploy only for `.env`, `docker-compose.yml`, secrets, or network changes.

## ✅ Part 5: Validation

### Health checks

```bash
curl -s http://127.0.0.1:5000/api/live
curl -s http://127.0.0.1:5000/api/health
```

### Logs

```bash
sudo docker service logs --since 5m bunq_bunq-dashboard
```

### Savings account validation

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

## 🔧 Operations Notes

- Keep `USE_VAULTWARDEN=true` as primary flow
- Use `register_bunq_ip.sh` when Bunq key or egress IP changes
- Use `restart_bunq_service.sh` for startup validation after deploy
- Prefer fixed or sticky public IP connectivity to reduce Bunq whitelist churn (details in `TROUBLESHOOTING.md`)

## 📎 More Details

For the full Dutch deep-dive version (all original details):
- [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
