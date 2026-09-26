# 🏠 Synology NAS Installation Guide

Step-by-step instructions for installing the Bunq Dashboard on your Synology NAS with Vaultwarden secret management.

**Language versions**
- English (this file): [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
- Dutch: [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)

---

## 🧭 Navigation

- Overview and quick start: [README.md](README.md)
- Security hardening: [SECURITY.md](SECURITY.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## 📋 Requirements

### Hardware
- **Synology NAS** with DSM 7.0 or later
- **At least 2 GB RAM** (4 GB recommended)
- **10 GB free disk space**
- **Intel/AMD CPU** recommended (on ARM64 the image uses the npm Bitwarden CLI, which makes it larger)

### Software
- **Container Manager** (Package Center)
- **SSH access** (optional but recommended)
- **Bunq** account with API access

### Network
- **Fixed LAN IP** for your NAS (e.g. `192.168.1.100`)
- **Strongly recommended:** a fixed public IP (best) or a sticky dynamic public IP from your ISP
- **Free local ports:** `5000` (dashboard + API), `9000` (Vaultwarden)
- **Remote access** (optional): Tailscale (recommended, no open router port) or a VPN; see Part 4

---

## 🔧 Part 1: Preparation

### Step 1.1: Enable SSH (optional but recommended)

```text
Control Panel → Terminal & SNMP
├── Enable SSH service ✓
└── Port: 22 (default)
```

Test:
```bash
ssh admin@192.168.1.100   # your NAS IP
```

### Step 1.2: Install Container Manager

```text
Package Center → search "Container Manager" → Install
```

### Step 1.3: Create project folders

Via SSH:
```bash
sudo mkdir -p /volume1/docker/vaultwarden
sudo mkdir -p /volume1/docker/bunq-dashboard
sudo chmod -R 755 /volume1/docker
```

Or via File Station: `docker` → new folders `vaultwarden` and `bunq-dashboard`.

**Note:** `config` and `logs` are created later (Part 3), after the repository has been cloned.

---

## 🔐 Part 2: Install Vaultwarden

Vaultwarden is a lightweight, self-hosted Bitwarden server for storing secrets safely.

### Step 2.1: Download the image

```text
Container Manager → Registry → search "vaultwarden/server" → Download → tag "latest"
```

### Step 2.2: Create the Vaultwarden container

**Via the Container Manager UI:**

```text
Container Manager → Container → Create
├── Container name: vaultwarden
├── Image: vaultwarden/server:latest
├── Enable auto-restart ✓
├── Port: local 9000 → container 80
├── Volume: /volume1/docker/vaultwarden → /data
├── Environment:
│   ├── DOMAIN = http://192.168.1.100:9000 (your NAS IP)
│   ├── SIGNUPS_ALLOWED = true
│   └── LOG_LEVEL = info
├── Resource limits: CPU 50%, memory 512 MB
└── Network: bridge (connected to bunq-net in step 3.3)
```

**Or via docker compose** (`/volume1/docker/vaultwarden/docker-compose.yml`):

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
      DOMAIN: "http://192.168.1.100:9000"  # change this
      SIGNUPS_ALLOWED: "true"              # set to false after creating your account
      LOG_LEVEL: "info"
```

### Step 2.3: Start Vaultwarden

```bash
cd /volume1/docker/vaultwarden
sudo docker compose up -d      # or: docker-compose up -d on older DSM
sudo docker ps | grep vaultwarden
```

### Step 2.4: Create your account and close signups

1. Open `http://192.168.1.100:9000`
2. Create an account with a **strong** master password
3. **Critical:** set `SIGNUPS_ALLOWED=false` (Container Manager → vaultwarden → Edit → Environment) and restart the container

### Step 2.5: Store the Bunq API key

1. Create an API key in the Bunq app: Profile → Security & Settings → Developers → API keys → add
2. In Vaultwarden (`http://192.168.1.100:9000`):
   ```text
   My Vault → + Add item
   ├── Type: Login
   ├── Name: Bunq API Key   (must match VAULTWARDEN_ITEM_NAME)
   ├── Username: bunq-dashboard
   ├── Password: <your Bunq API key>
   └── Save
   ```

### Step 2.6: Get the Vaultwarden API credentials

```text
Vaultwarden → Settings → Security → Keys → View API key
├── Enter your master password
├── Copy client_id (e.g. user.xxxx-xxxx-xxxx)
└── Copy client_secret
```

Keep these; you need them for the Docker secrets in step 3.3.

### Step 2.7: HTTPS for Vaultwarden

The recommended `VAULTWARDEN_ACCESS_METHOD=cli` requires an **HTTPS** `VAULTWARDEN_URL`. Put Vaultwarden behind the Synology reverse proxy with a valid certificate (see Part 4), e.g. `https://vault.yourdomain.com`.

---

## 📊 Part 3: Install the Bunq Dashboard

### Step 3.1: Download the project

**Option A: git (recommended)**
```bash
cd /volume1/docker/bunq-dashboard
sudo git clone https://github.com/richardvankampen/Bunq-dashboard-web.git .
```

This only works when `/volume1/docker/bunq-dashboard/` is empty. On
`fatal: destination path '.' already exists and is not an empty directory`, move existing files such as `config/` and `logs/` aside first.

**Option B: ZIP** — download the ZIP from GitHub and upload it via File Station. Updates via `git pull` then won't work; option A is preferred.

Check:
```bash
ls /volume1/docker/bunq-dashboard/
# index.html, app.js, api_proxy.py, docker-compose.yml, scripts/, ...
```

### Step 3.2: Create runtime folders

```bash
sudo mkdir -p /volume1/docker/bunq-dashboard/config
sudo mkdir -p /volume1/docker/bunq-dashboard/logs
```

`config/` holds the Bunq context, the SQLite store `dashboard_data.db` (your transaction history) and your personal `category_rules.json`. It is not in git.

### Step 3.3: Configure `.env` and Docker secrets (required)

**Important:** sensitive values **never** go in `.env`; they go in Docker Swarm secrets.

#### A) `.env` (non-sensitive settings only)

Create `/volume1/docker/bunq-dashboard/.env`.

**Required:**

| Variable | Meaning | Recommended / default |
|---|---|---|
| `BASIC_AUTH_USERNAME` | Dashboard login username | `admin` (or your choice) |
| `VAULTWARDEN_URL` | Vaultwarden URL for key retrieval | `https://vault.yourdomain.com` (HTTPS required with `cli`) |
| `VAULTWARDEN_ACCESS_METHOD` | How the vault item is read | `cli` (recommended/default) |
| `VAULTWARDEN_ITEM_NAME` | Name of the vault item with your Bunq API key | `Bunq API Key` |
| `USE_VAULTWARDEN` | Use Vaultwarden instead of a direct API key | `true` |
| `BUNQ_ENVIRONMENT` | Bunq environment | `PRODUCTION` (or `SANDBOX` for testing) |
| `AUTO_SET_BUNQ_WHITELIST_IP` | Try to update the Bunq allowlist on startup/reinit | `true` |
| `AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS` | Set other ACTIVE IPs to INACTIVE automatically | `false` (safest) |
| `ALLOWED_ORIGINS` | Allowed frontend origins (CORS) | `https://bunq.yourdomain.com` (or `http://<NAS-IP>:5000` for local HTTP) |
| `SESSION_COOKIE_SECURE` | Send cookies over HTTPS only | `true` (default); `false` only for local HTTP |

**Cookie domain:** the session cookie is set on the host you open the dashboard with (`http://192.168.1.100:5000` → `192.168.1.100`, `https://bunq.yourdomain.com` → `bunq.yourdomain.com`). Always use the **same URL**, otherwise your session won't stick.

**Optional (passed through by `docker-compose.yml`):**

| Variable | Meaning | Default |
|---|---|---|
| `LOG_LEVEL` | Log level | `INFO` |
| `FLASK_DEBUG` | Debug mode (never in production) | `false` |
| `BUNQ_INIT_AUTO_ATTEMPT` | Lazy Bunq init on API requests | `true` |
| `BUNQ_INIT_RETRY_SECONDS` | Wait between automatic init retries | `120` |
| `CACHE_ENABLED` | Response cache on/off | `true` |
| `CACHE_TTL_SECONDS` | Cache TTL in seconds | `60` |
| `DEFAULT_PAGE_SIZE` | Default pagination size | `500` |
| `MAX_PAGE_SIZE` | Maximum pagination size | `2000` |
| `MAX_DAYS` | Maximum period in days | `3650` |
| `DATA_DB_ENABLED` | Local SQLite store on/off | `true` |
| `DATA_DB_PATH` | Path of the SQLite store | `config/dashboard_data.db` |
| `FX_ENABLED` | EUR totals for non-EUR accounts | `true` |
| `FX_RATE_SOURCE` | Exchange rate source | `frankfurter` |
| `FX_REQUEST_TIMEOUT_SECONDS` | FX API timeout | `8` |
| `FX_CACHE_HOURS` | How long FX rates are cached | `24` |
| `GUNICORN_WORKERS` | Gunicorn workers | `2` |
| `GUNICORN_THREADS` | Threads per worker | `4` |
| `GUNICORN_TIMEOUT` | Request timeout (seconds) | `120` |
| `GUNICORN_KEEPALIVE` | Keep-alive (seconds) | `5` |
| `GUNICORN_MAX_REQUESTS` | Requests per worker before recycling | `1200` |
| `GUNICORN_MAX_REQUESTS_JITTER` | Random extra on worker recycling | `120` |
| `GUNICORN_LOG_LEVEL` | Gunicorn log level | `info` |
| `BUNQ_PREBOOT_INIT` | Initialise Bunq during container startup | `true` |
| `VAULTWARDEN_EXTRA_HOST` | Pin the Vaultwarden hostname to a LAN IP inside the container (`<hostname>:<ip>`) | not set |

**Advanced (read by the code, but NOT passed by `docker-compose.yml`):** these only take effect after you add them to the `environment:` block of `docker-compose.yml` and do a full stack deploy. The defaults are fine for normal use.

| Variable | Meaning | Default |
|---|---|---|
| `BUNQ_PAYMENT_PAGE_SIZE` | Bunq payments per page (max 200) | `200` |
| `BUNQ_PAYMENT_MAX_PAGES` | Max payment pages per account per sync | `50` |
| `BUNQ_CARD_PAYMENT_PAGE_SIZE` / `BUNQ_CARD_PAYMENT_MAX_PAGES` | Same for card payments | same as payment values |
| `SYNC_MIN_INTERVAL_SECONDS` | Minimum time between incremental syncs | `60` |
| `ACCOUNTS_CACHE_SECONDS` | Account list cache per worker | `60` |
| `SOURCE_FAILURE_BACKOFF_SECONDS` | Back-off after a failing Bunq source | `3600` |
| `RECONCILE_ENABLED` | Monthly full reconcile of the store | `true` |
| `RECONCILE_DAY` / `RECONCILE_HOUR` / `RECONCILE_TIMEZONE` | When the reconcile runs | `1` / `3` / `Europe/Amsterdam` |
| `RECONCILE_WINDOW_HOURS` | Window after the start hour in which it may run | `3` |
| `RECONCILE_MAX_PAGES` | Max pages per account during reconcile | `500` |
| `CATEGORY_RULES_PATH` | Personal category rules file | `config/category_rules.json` |
| `VAULTWARDEN_CLI_TIMEOUT_SECONDS` | Timeout per `bw` CLI call | `30` |

**Minimal `.env` example:**

```bash
BASIC_AUTH_USERNAME=admin
VAULTWARDEN_URL=https://vault.yourdomain.com
VAULTWARDEN_ACCESS_METHOD=cli
VAULTWARDEN_ITEM_NAME="Bunq API Key"
USE_VAULTWARDEN=true
# Optional: pin the Vaultwarden hostname to a LAN IP inside the container
# (when Docker DNS is stale/wrong). Format: <hostname>:<ip>
# VAULTWARDEN_EXTRA_HOST=vault.yourdomain.com:192.168.1.100
BUNQ_ENVIRONMENT=PRODUCTION
AUTO_SET_BUNQ_WHITELIST_IP=true
AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS=false
ALLOWED_ORIGINS=https://bunq.yourdomain.com
# Local HTTP only:
# ALLOWED_ORIGINS=http://192.168.1.100:5000
SESSION_COOKIE_SECURE=true
# Local HTTP only:
# SESSION_COOKIE_SECURE=false
LOG_LEVEL=INFO
FLASK_DEBUG=false
DATA_DB_ENABLED=true
FX_ENABLED=true
```

**Tip:** with `VAULTWARDEN_ACCESS_METHOD=cli` an HTTPS URL is required. Only if you deliberately use `VAULTWARDEN_ACCESS_METHOD=api` can you use an internal HTTP URL (e.g. `http://vaultwarden:80`).

#### B) Docker secrets (required)

**Once: enable Swarm**
```bash
sudo docker swarm init
# "already part of a swarm" is fine.
# Error about multiple IPs? Use your LAN IP:
# sudo docker swarm init --advertise-addr 192.168.1.100
```

**Network (to reach Vaultwarden):**
```bash
sudo docker network create --driver overlay --attachable bunq-net   # "already exists" is fine
sudo docker network connect bunq-net vaultwarden                    # "already connected" is fine
```

**Required secrets:**

| Secret | Meaning | Value |
|---|---|---|
| `bunq_basic_auth_password` | Dashboard password | Strong password (12+ characters) |
| `bunq_flask_secret_key` | Session signing key | 64 hex characters |
| `bunq_vaultwarden_client_id` | Vaultwarden `client_id` | From step 2.6 |
| `bunq_vaultwarden_client_secret` | Vaultwarden `client_secret` | From step 2.6 |
| `bunq_vaultwarden_master_password` | Master password of the same Vaultwarden account | Required with `VAULTWARDEN_ACCESS_METHOD=cli` |

**Optional (only with `USE_VAULTWARDEN=false`):** `bunq_api_key` (direct Bunq API key). Keep `USE_VAULTWARDEN=true` and use this only as an emergency fallback.

**Create the secrets (safe input, no shell expansion of special characters):**
```bash
read -s DASHBOARD_PASSWORD      # paste the dashboard password (hidden)
read -r CLIENT_ID               # paste client_id (visible)
read -s CLIENT_SECRET           # paste client_secret (hidden)
read -s MASTER_PASSWORD         # paste the Vaultwarden master password (hidden)

printf '%s' "$DASHBOARD_PASSWORD" | sudo docker secret create bunq_basic_auth_password -
python3 -c "import secrets; print(secrets.token_hex(32), end='')" | sudo docker secret create bunq_flask_secret_key -
printf '%s' "$CLIENT_ID" | sudo docker secret create bunq_vaultwarden_client_id -
printf '%s' "$CLIENT_SECRET" | sudo docker secret create bunq_vaultwarden_client_secret -
printf '%s' "$MASTER_PASSWORD" | sudo docker secret create bunq_vaultwarden_master_password -

unset DASHBOARD_PASSWORD CLIENT_ID CLIENT_SECRET MASTER_PASSWORD

# Only with USE_VAULTWARDEN=false:
# read -s BUNQ_KEY; printf '%s' "$BUNQ_KEY" | sudo docker secret create bunq_api_key -; unset BUNQ_KEY
```

### Step 3.4: `docker-compose.yml`

The repository ships a ready-to-use `docker-compose.yml`; you normally don't need to edit it. It:
- runs the image `bunq-dashboard:local` on port `5000`
- passes the `.env` variables from the tables above (with defaults)
- mounts the secrets from step 3.3 (`bunq_api_key` is commented out; enable it only with `USE_VAULTWARDEN=false`)
- mounts `/volume1/docker/bunq-dashboard/config` → `/app/config` and `/volume1/docker/bunq-dashboard/logs` → `/app/logs`
- adds an optional `extra_hosts` entry from `VAULTWARDEN_EXTRA_HOST`
- uses the external network `bunq-net`
- has a healthcheck on `/api/live` with a `start_period` of 300 s (Vaultwarden + Bunq init at startup)

Make sure the Vaultwarden container from Part 2 is connected to `bunq-net` (step 3.3).

### Step 3.5: Build and start

**Quick route (recommended):**
```bash
cd /volume1/docker/bunq-dashboard
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

Important:
- Always run this script with `sudo sh ...` (root).
- Run as a regular user, `docker stack deploy` may use the defaults from `docker-compose.yml` (`*.jouwdomein.nl`) instead of your `.env` values.

The script asks `Use clean Docker build (--no-cache)? [Y/n]`. To choose in advance:
```bash
sudo sh -c 'NO_CACHE=false sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'   # faster, cached
sudo sh -c 'NO_CACHE=true sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'    # fully clean
```

The script does:
- Swarm/network checks
- a check for the required secrets (it does not create them)
- build + deploy + startup validation
- post-deploy Bunq checks (API key/init + egress IP vs active whitelist)

**Manual route (equivalent):**
```bash
cd /volume1/docker/bunq-dashboard

TAG=$(sudo git rev-parse --short HEAD)
sudo docker build --no-cache -t bunq-dashboard:$TAG .
sudo docker tag bunq-dashboard:$TAG bunq-dashboard:local
# amd64: native bw binary (npm fallback if the release asset is temporarily unavailable)
# arm64: @bitwarden/cli via npm (larger image)
# "Running pip as the 'root' user" warnings are normal in Docker builds.

sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo sh scripts/restart_bunq_service.sh

sudo docker service logs -f bunq_bunq-dashboard
curl -s http://127.0.0.1:5000/api/live
curl -s http://127.0.0.1:5000/api/health
```

Expected log lines:
```text
== Bunq Dashboard Gunicorn startup ==
🔐 Retrieving API key from Vaultwarden (cli method)...
✅ API key retrieved from vault
✅ Bunq API initialized
Listening at: http://0.0.0.0:5000
```

### Step 3.6: Open the dashboard

Use exactly your `ALLOWED_ORIGINS` URL:
- recommended: `https://bunq.yourdomain.com` (reverse proxy + `SESSION_COOKIE_SECURE=true`)
- local HTTP fallback only: `http://192.168.1.100:5000` with `SESSION_COOKIE_SECURE=false`

The first load of a period fetches the transactions from Bunq and stores them in `config/dashboard_data.db`; after that, loads come from the store with a background incremental sync.

**Health endpoints:**
- `/api/live` = liveness (service is running)
- `/api/health` = readiness (Bunq context state; may return `503` on key/IP mismatch)

### Step 3.7: Bunq IP whitelist and re-registration (after a key or IP change)

Use this when:
- you created a new Bunq API key
- your public IP changed (new provider, router, VPN or Tailscale exit node)
- the logs show `Incorrect API key or IP address`

With a fixed or sticky public IP you need this much less often; see [TROUBLESHOOTING.md](TROUBLESHOOTING.md), section `Public IP strategy (fixed vs sticky)`.

```bash
cd /volume1/docker/bunq-dashboard
sudo sh scripts/register_bunq_ip.sh                    # interactive
sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh # non-interactive, target = current egress IP
# Explicit target:
# sudo env TARGET_IP=<PUBLIC_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh
```

The script:
- shows the container's public egress IP
- optionally asks for a target IPv4 (empty = current egress IP)
- detects the auth mode (`USE_VAULTWARDEN=true/false`)
- updates the Bunq API allowlist (target IP ACTIVE)
- in the direct-key flow: validates the `bunq_api_key` secret (64 hex characters)
- removes the old Bunq context and creates a new `ApiContext`
- force-restarts the service and shows the relevant logs
- checks the egress IP against the active whitelist (mismatch = clear error + recovery command)

With `AUTO_SET_BUNQ_WHITELIST_IP=true` the backend also tries this on startup/reinit.

Still `Incorrect API key or IP address`? Check the key status/IP restriction in the Bunq app, whitelist the egress IP the script shows, and run the script again.

### Step 3.8: Personal category rules (optional)

Add your own category rules in `/volume1/docker/bunq-dashboard/config/category_rules.json`; see the section "Personal category rules" in [README.md](README.md). After editing, run a quick redeploy; stored transactions are recategorised once on startup.

---

## 🔒 Part 4: Security Hardening

### Step 4.1: Remote access with Tailscale or a VPN

Never forward port 5000 on your router. To use the dashboard away from home, pick one:

**Tailscale (recommended):**
1. Package Center → search "Tailscale" → Install → open it and sign in (create an account at tailscale.com if needed).
2. Install the Tailscale app on your phone/laptop and sign in to the same account.
3. Open the dashboard at `http://<Tailscale IP of the NAS>:5000` (the 100.x.y.z address in the Tailscale app).
4. HTTPS (recommended), choose one of two ways (details: [SECURITY.md](SECURITY.md), option A):
   - **Way 1: your own domain through the DSM reverse proxy** (handy if you already use a reverse proxy, e.g. `https://bunq.yourdomain.com` at home). Advertise your LAN as a subnet route (`sudo tailscale set --advertise-routes=192.168.1.0/24`, approve it in the admin console under Machines → NAS → Edit route settings), let a local DNS server (e.g. the Synology DNS Server package) resolve `bunq.yourdomain.com` to the NAS LAN IP, and add that DNS server in the admin console under DNS → Nameservers → Custom with "Restrict to domain" (split DNS). The DSM reverse proxy (step 4.3) then serves the dashboard on port 443 at home and via Tailscale. Allow `100.64.0.0/10` in its access control profile. `tailscale serve` is not needed.
   - **Way 2: `tailscale serve`**: enable **MagicDNS** and **HTTPS certificates** in the admin console and run `sudo tailscale serve --bg 5000` on the NAS. This sends all traffic to port 443 of `nas.<your-tailnet>.ts.net` to the dashboard. To keep 443 free, use `sudo tailscale serve --bg --https=8443 5000` (then include `:8443` in `ALLOWED_ORIGINS`).
     - First time only: if Tailscale answers `Serve is not enabled on your tailnet` with a link, open that link as the tailnet admin, confirm, and run the command again.
     - Check with `sudo tailscale serve status`: it must say "(tailnet only)", never "Funnel on". Remove it with `sudo tailscale serve --https=443 off` (status then shows `No serve config`).

   Then set in `.env` the URL you open (several: comma-separated) and do a full deploy (config change):
   ```bash
   ALLOWED_ORIGINS=https://bunq.yourdomain.com   # way 1, or https://nas.<your-tailnet>.ts.net for way 2
   SESSION_COOKIE_SECURE=true
   ```
5. Never use `tailscale funnel` (that publishes the dashboard on the internet), and don't let the NAS use an exit node (Bunq would see another public IP).

**VPN:** Synology VPN Server (OpenVPN); see [SECURITY.md](SECURITY.md), option B.

### Step 4.2: Firewall

```text
Control Panel → Security → Firewall → Edit Rules
├── Allow: ports 5000, 9000 from 192.168.0.0/16 (local network)
├── Allow: port 5000 from 100.64.0.0/10 (only with Tailscale)
├── Allow: port 443 from 100.64.0.0/10 (only with Tailscale way 1: reverse proxy)
└── Deny: all other IPs
```

### Step 4.3: Reverse proxy with HTTPS (recommended)

The reverse proxy serves the dashboard at home and, with Tailscale way 1 (step 4.1), also remotely. If you use `tailscale serve` (way 2) instead, the dashboard already has HTTPS through Tailscale; you still need a reverse proxy with HTTPS for Vaultwarden (step 2.7).

```text
Control Panel → Login Portal → Advanced → Reverse Proxy → Create
├── Name: bunq-dashboard
├── Source: HTTPS, bunq.yourdomain.com, port 443, HSTS ✓
└── Destination: HTTP, localhost, port 5000
```
Do the same for Vaultwarden (e.g. `vault.yourdomain.com` → `localhost:9000`).

Certificate: Control Panel → Security → Certificate → Add → Let's Encrypt.

More in [SECURITY.md](SECURITY.md).

### Step 4.4: Backups

Via Hyper Backup (daily, e.g. 02:00, 30 days retention, encrypted):
- `/volume1/docker/vaultwarden` (Vaultwarden data)
- `/volume1/docker/bunq-dashboard/config` (transaction store `dashboard_data.db`, `category_rules.json`, Bunq context)
- `/volume1/docker/bunq-dashboard/.env`

The store also keeps transactions that Bunq no longer serves, so a backup of `config/` is the only copy of that history.

### Step 4.5: Update notifications

```text
Package Center → Container Manager → Settings → enable update notifications
```

---

## 🔧 Part 5: Maintenance

### Updates

Code-only change (most common; no `.env`/compose/secrets/network change):
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

Full install/update:
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

Config change (`.env`, `docker-compose.yml`, secrets, network):
```bash
TAG=$(sudo git rev-parse --short HEAD)
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

After an update, force-reload the browser (Ctrl+F5 / Cmd+Shift+R) so the new `app.js` is loaded.

### Manual backup

```bash
sudo mkdir -p /volume1/backups
sudo tar -czf /volume1/backups/vaultwarden-$(date +%Y%m%d).tar.gz /volume1/docker/vaultwarden
sudo tar -czf /volume1/backups/bunq-dashboard-config-$(date +%Y%m%d).tar.gz \
  /volume1/docker/bunq-dashboard/config /volume1/docker/bunq-dashboard/.env
```

Restore: stop the stack (`sudo docker stack rm bunq`), extract the archive back to the same path, deploy again.

### Logs

```bash
sudo docker service logs -f bunq_bunq-dashboard
sudo docker logs vaultwarden
```

### Admin maintenance via the dashboard

In **Settings → Admin maintenance** (logged in):

**What problem do you have?** — a guide per situation, each with the steps and buttons that do them:
- The dashboard shows no Bunq data or reports `Incorrect API key or IP address`
- Your public IP address has changed
- You created a new Bunq API key
- Vaultwarden reports an error (token failed, item not found)
- Transactions are missing, changed or deleted in Bunq
- Figures look outdated or wrong after an outage
- There is a new version of the dashboard
- The dashboard is slow, hangs or keeps restarting

**Buttons** (the panel also explains each one):
- `Check status` (read-only): Bunq connection, last Bunq error, Vaultwarden, transaction store, last reconcile with Bunq, and an **advice** line pointing to the matching situation
- `Check egress IP` (read-only): the container's current public outbound IP (this IP must be on the Bunq whitelist)
- `Set Bunq API whitelist IP`: safe 2-step flow (1. activate the target IP, 2. after confirmation deactivate other ACTIVE IPs)
- `Reinit context only (advanced)`: fetch the API key again and recreate the Bunq context, without whitelist changes
- `Run full maintenance (recommended)`: clear the cache, recreate the Bunq context and update the whitelist IP, following the options
- `Reconcile with Bunq`: refetch all transactions and update the store (same as the monthly reconcile, runs in the background)

**Terminal** buttons show copy-ready commands for the NAS, each with what it does: `Install new version` (quick redeploy or full install/update), `Restart and validate`, `Bunq whitelist via terminal` (`register_bunq_ip.sh`), `New API key via terminal`, `View logs`.

Defaults for `Run full maintenance`:
- whitelist update: always part of the flow
- `Try to determine whitelist IP (egress) automatically`: off (enter an IP manually, or tick it; the guide button "Full maintenance with automatic IP" ticks it)
- API key refresh from Vaultwarden/direct secret: off (only after key rotation; only the process handling the request gets the new key, so restart the service afterwards)
- `Recreate Bunq context`: on
- `Clear runtime cache`: on
- reload status afterwards: on
- A manual IP must be a public IPv4 address (private/local ranges are rejected)

### Rotate the Bunq API key

1. Create a new key in the Bunq app
2. Update it:
   - Vaultwarden flow: update the Vaultwarden item
   - direct-key flow (`USE_VAULTWARDEN=false`): recreate Docker secret `bunq_api_key`
3. Run `sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh`
4. Validate: `sudo sh scripts/restart_bunq_service.sh`

No code changes needed.

---

## 🐛 Troubleshooting (short)

- Logs: `sudo docker service logs -f bunq_bunq-dashboard` and `sudo docker logs vaultwarden`
- Connectivity: `sudo docker exec $(sudo docker ps --filter name=bunq_bunq-dashboard -q | head -n1) ping -c1 vaultwarden`
- Restart only (no image update): `sudo docker service update --force bunq_bunq-dashboard`
- Restart + startup validation (recommended): `sudo sh scripts/restart_bunq_service.sh`
- Re-register Bunq IP/device: `sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh`

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for full solutions.

### Savings account validation (optional)

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

---

## ✅ Verification Checklist

- [ ] Vaultwarden running on port 9000 and reachable via HTTPS
- [ ] Bunq API key stored in the vault
- [ ] Vaultwarden signups disabled
- [ ] Secrets created, `bunq-net` exists and Vaultwarden is connected to it
- [ ] Dashboard service running; `/api/live` and `/api/health` respond
- [ ] Dashboard reachable on your `ALLOWED_ORIGINS` URL (via your home network, VPN or Tailscale) and not from the internet
- [ ] Logs show no errors
- [ ] Firewall rules configured
- [ ] Backups scheduled (including `config/`)

---

## 📞 Need help?

- GitHub Issues: [create an issue](https://github.com/richardvankampen/Bunq-dashboard-web/issues) (never paste secrets, API keys or personal data)
- Synology forums: [DSM 7](https://community.synology.com/enu/forum/1)
- Vaultwarden: [GitHub Discussions](https://github.com/dani-garcia/vaultwarden/discussions)

---

**Installation complete. Enjoy your secure Bunq Dashboard! 🎉**
