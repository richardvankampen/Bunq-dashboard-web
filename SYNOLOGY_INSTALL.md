# 🏠 Synology NAS Installation Guide

Complete stap-voor-stap instructies voor het installeren van Bunq Dashboard op je Synology NAS met Vaultwarden secret management.

---

## 🧭 Navigatie

- Startpunt (dit document): [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
- Korte overzichtspagina: [README.md](README.md)
- Security hardening: [SECURITY.md](SECURITY.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

Tip: De lijst met visualisaties staat kort in de [README.md](README.md).

## 📋 Vereisten

### Hardware
- **Synology NAS** met DSM 7.0 of hoger
- **Minimaal 2GB RAM** (4GB aanbevolen)
- **10GB vrije schijfruimte**
- **Intel/AMD CPU** (ARM wordt niet ondersteund door Bunq SDK)

### Software
- **Container Manager** (via Package Center)
- **SSH toegang** (optioneel maar aanbevolen)
- **Bunq Pro/Premium** account

### Netwerk
- **Vaste lokale IP** voor je NAS (bijv. 192.168.1.100)
- **Poorten vrij**: 5000 (Dashboard + API), 9000 (Vaultwarden)

---

## 🔧 Deel 1: Voorbereiding

### Stap 1.1: Enable SSH (Optioneel maar aanbevolen)

```
Control Panel → Terminal & SNMP
├── Enable SSH service ✓
└── Port: 22 (default)
```

Test verbinding:
```bash
ssh admin@192.168.1.100 # Het IP adres van je NAS
# Password: je NAS admin wachtwoord
```

### Stap 1.2: Installeer Container Manager

```
Package Center → Zoek "Container Manager" → Installeer
```

Wacht tot installatie compleet is (kan 5 minuten duren).

### Stap 1.3: Maak Project Directories

Via SSH:
```bash
sudo mkdir -p /volume1/docker/vaultwarden
sudo mkdir -p /volume1/docker/bunq-dashboard

# Set permissions
sudo chmod -R 755 /volume1/docker
```

Of via File Station:
```
File Station → docker (create if not exists)
├── vaultwarden (nieuwe map)
└── bunq-dashboard (nieuwe map)

**Let op:** `config` en `logs` worden later aangemaakt (Deel 3) nadat de repo is gedownload.
```

---

## 🔐 Deel 2: Vaultwarden Installeren

Vaultwarden is een lightweight, self-hosted Bitwarden server voor het veilig opslaan van secrets.

### Stap 2.1: Download Vaultwarden Image

```
Container Manager → Registry
├── Zoek: "vaultwarden/server"
└── Download → Tag: "latest"
```

Wacht tot download compleet (zie Notifications).

### Stap 2.2: Create Vaultwarden Container

**Via Container Manager UI:**

```
Container Manager → Container → Create

General Settings:
├── Container Name: vaultwarden
├── Image: vaultwarden/server:latest
└── Enable auto-restart ✓

Port Settings:
└── Local Port 9000 → Container Port 80

Volume Settings:
└── /volume1/docker/vaultwarden → /data

Environment:
├── DOMAIN = http://192.168.1.100:9000 (vervang met je NAS IP!)
├── SIGNUPS_ALLOWED = true
└── LOG_LEVEL = info

Resource Limits:
├── CPU: 50% (max)
└── Memory: 512 MB

Network:
└── bridge (default — we’ll attach to `bunq-net` in stap 3.3)
```

**Of via docker compose** (`/volume1/docker/vaultwarden/docker-compose.yml`):

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
      DOMAIN: "http://192.168.1.100:9000"  # CHANGE THIS!
      SIGNUPS_ALLOWED: "true"  # Change to false after first account!
      LOG_LEVEL: "info"
      WEBSOCKET_ENABLED: "true"

    # Later in stap 3.3, connect to bunq-net:
    # sudo docker network connect bunq-net vaultwarden
```

### Stap 2.3: Start Vaultwarden

Klik "Run" of via SSH:
```bash
cd /volume1/docker/vaultwarden
sudo docker compose up -d
```

**Tip:** Als `docker compose` niet werkt op jouw DSM, gebruik dan `docker-compose` (met een streepje).

Verify:
```bash
sudo docker ps | grep vaultwarden
# Should show container running
```

### Stap 2.4: Setup Vaultwarden Account

1. **Open browser**: `http://192.168.1.100:9000`

2. **Create Account**:
   - Email: `admin@local` (of jouw email)
   - Master Password: **Kies een STERK wachtwoord!**
   - Confirm password
   - Create Account

3. **⚠️ KRITIEK: Disable Signups**

   Na account aanmaken:
   ```
   Container Manager → vaultwarden → Edit
   └── Environment → SIGNUPS_ALLOWED = false

   Apply → Restart container
   ```

### Stap 2.5: Sla Bunq API Key op

1. **Verkrijg Bunq API Key** (indien nog niet gedaan):
   ```
   Bunq App op je telefoon:
   ├── Profile → Security & Settings
   ├── Developers → API Keys
   ├── + Add API Key
   └── Copy key (begint met "sandbox_" of lang random string)
   ```

2. **Bewaar in Vaultwarden**:
   ```
   Vaultwarden web interface (http://192.168.1.100:9000)
   ├── Login met je account
   ├── My Vault → + Add Item
   ├── Item Type: Login
   ├── Name: Bunq API Key (exact deze naam!)
   ├── Username: bunq-dashboard
   ├── Password: [plak hier je Bunq API key]
   ├── Notes: Created for Bunq Dashboard
   └── Save
   ```

3. **Verify**: Je zou nu 1 item moeten zien in "My Vault"

### Stap 2.6: Genereer API Access Token

Vaultwarden gebruikt OAuth2 voor programmatic access.

**Methode 1: Via Vaultwarden CLI (Aanbevolen)**

```bash
# Install Vaultwarden CLI (eenmalig)
sudo docker exec -it vaultwarden /bin/sh

# Inside container:
# (Dit is complex - gebruik Methode 2!)
exit
```

**Methode 2: Via Web Interface (Makkelijker)**

```
Vaultwarden → Instellingen → Beveiliging
├── Sleutels → API-sleutel bekijken
├── Enter Master Password
├── Copy "client_id" (bv: user.xxxx-xxxx-xxxx)
└── Copy "client_secret" (lange random string)
```

**Bewaar deze credentials!** Je hebt ze nodig voor de dashboard.

---

## 📊 Deel 3: Bunq Dashboard Installeren

### Stap 3.1: Download Project Files

**Optie A: Via Git (HTTPS)**

```bash
cd /volume1/docker/bunq-dashboard
sudo git clone https://github.com/richardvankampen/Bunq-dashboard-web.git .
```

**Let op:** Dit werkt alleen als `/volume1/docker/bunq-dashboard/` leeg is.
Krijg je `fatal: destination path '.' already exists and is not an empty directory`?
Verwijder (of verplaats) eerst bestaande mappen/bestanden zoals `config/` en `logs/`, of clone naar een submap zonder de trailing `.`.

**Optie B: Manual Download**

1. Download ZIP van GitHub
2. Unzip lokaal op je computer
3. Upload via File Station naar `/volume1/docker/bunq-dashboard/`

Verify files:
```bash
ls /volume1/docker/bunq-dashboard/
# Should show: index.html, styles.css, app.js, api_proxy.py, etc.
```

### Stap 3.2: Maak Runtime Mappen

```bash
sudo mkdir -p /volume1/docker/bunq-dashboard/config
sudo mkdir -p /volume1/docker/bunq-dashboard/logs
```

### Stap 3.3: Configureer .env + Docker secrets (verplicht)

**Belangrijk:** Gevoelige waarden **mogen niet in `.env`**. Die gaan via Docker Swarm secrets.

#### A) `.env` (alleen niet‑gevoelig)

Maak `/volume1/docker/bunq-dashboard/.env` met **niet‑gevoelige** settings.

**Verplicht (.env):**

| Variabele | Betekenis | Aanbevolen/default waarde |
|---|---|---|
| `BASIC_AUTH_USERNAME` | Inlog gebruikersnaam voor het dashboard | `admin` (of eigen keuze) |
| `VAULTWARDEN_URL` | Interne URL van Vaultwarden container | `http://vaultwarden:80` (zelfde network) |
| `VAULTWARDEN_ACCESS_METHOD` | Methode om Vaultwarden item te lezen | `cli` (aanbevolen/default) |
| `VAULTWARDEN_ITEM_NAME` | Naam van het Vault item met je Bunq API key | `Bunq API Key` |
| `USE_VAULTWARDEN` | Gebruik Vaultwarden i.p.v. directe API key | `true` |
| `BUNQ_ENVIRONMENT` | Bunq omgeving | `PRODUCTION` (of `SANDBOX` voor test) |
| `AUTO_SET_BUNQ_WHITELIST_IP` | Probeer Bunq allowlist automatisch te updaten op startup/reinit | `true` |
| `AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS` | Zet andere ACTIVE IPs automatisch op INACTIVE | `false` (veiligste default) |
| `ALLOWED_ORIGINS` | Toegestane frontend origins voor CORS | `https://bunq.jouwdomein.nl` (of `http://<NAS-IP>:5000` bij lokale HTTP) |
| `SESSION_COOKIE_SECURE` | Alleen veilige cookies via HTTPS | `true` (aanbevolen/default), alleen `false` bij lokale HTTP |

**Let op (cookie domein):** De session cookie wordt gezet op het domein waarmee je het dashboard opent.  
Voorbeelden:  
- `http://192.168.1.100:5000` → cookie op `192.168.1.100`  
- `https://bunq.jouwdomein.nl` → cookie op `bunq.jouwdomein.nl`  
Gebruik daarom **altijd dezelfde URL** (HTTP of HTTPS), anders werkt je sessie niet goed.

**Optioneel (.env):**

| Variabele | Betekenis | Aanbevolen/default waarde |
|---|---|---|
| `LOG_LEVEL` | Log niveau | `INFO` |
| `FLASK_DEBUG` | Debug mode | `false` |
| `BUNQ_INIT_AUTO_ATTEMPT` | Lazy Bunq init voor API requests (WSGI/Gunicorn) | `true` |
| `BUNQ_INIT_RETRY_SECONDS` | Wachttijd tussen automatische init-retries | `120` |
| `CACHE_ENABLED` | Cache aan/uit | `true` |
| `CACHE_TTL_SECONDS` | Cache TTL in seconden | `60` |
| `DEFAULT_PAGE_SIZE` | Default pagination size | `500` |
| `MAX_PAGE_SIZE` | Max pagination size | `2000` |
| `MAX_DAYS` | Max dagen voor queries | `3650` |
| `DATA_DB_ENABLED` | Lokale SQLite history storage aan/uit | `true` |
| `DATA_DB_PATH` | Pad naar lokale SQLite DB | `config/dashboard_data.db` |
| `FX_ENABLED` | Omgerekende EUR totalen voor niet-EUR rekeningen | `true` |
| `FX_RATE_SOURCE` | Wisselkoersbron | `frankfurter` |
| `FX_REQUEST_TIMEOUT_SECONDS` | Timeout FX API call | `8` |
| `FX_CACHE_HOURS` | Hoe lang FX rates gecached worden | `24` |
| `GUNICORN_WORKERS` | Aantal Gunicorn workers | `2` |
| `GUNICORN_THREADS` | Aantal threads per worker | `4` |
| `GUNICORN_TIMEOUT` | Request timeout (seconden) | `120` |
| `GUNICORN_KEEPALIVE` | Keepalive (seconden) | `5` |
| `GUNICORN_MAX_REQUESTS` | Requests per worker voor recycle | `1200` |
| `GUNICORN_MAX_REQUESTS_JITTER` | Random extra op worker recycle | `120` |
| `GUNICORN_LOG_LEVEL` | Gunicorn log level | `info` |
| `BUNQ_PREBOOT_INIT` | Probeer Bunq init tijdens container startup | `true` |
| `VAULTWARDEN_DEVICE_IDENTIFIER` | Device ID voor Vaultwarden OAuth | Automatisch gegenereerd |
| `VAULTWARDEN_DEVICE_NAME` | Device naam voor Vaultwarden OAuth | `Bunq Dashboard` |
| `VAULTWARDEN_DEVICE_TYPE` | Device type voor Vaultwarden OAuth | `22` |

**Voorbeeld minimale `.env`:**

```bash
BASIC_AUTH_USERNAME=admin
VAULTWARDEN_URL=http://vaultwarden:80
VAULTWARDEN_ACCESS_METHOD=cli
VAULTWARDEN_ITEM_NAME="Bunq API Key"
USE_VAULTWARDEN=true
BUNQ_ENVIRONMENT=PRODUCTION
AUTO_SET_BUNQ_WHITELIST_IP=true
AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS=false
ALLOWED_ORIGINS=https://bunq.jouwdomein.nl
# Alleen bij lokale HTTP:
# ALLOWED_ORIGINS=http://192.168.1.100:5000
SESSION_COOKIE_SECURE=true
# Alleen bij lokale HTTP:
# SESSION_COOKIE_SECURE=false
LOG_LEVEL=INFO
FLASK_DEBUG=false
BUNQ_INIT_AUTO_ATTEMPT=true
BUNQ_INIT_RETRY_SECONDS=120
DATA_DB_ENABLED=true
FX_ENABLED=true
# Gunicorn (optioneel, defaults zijn prima):
# GUNICORN_WORKERS=2
# GUNICORN_THREADS=4
# GUNICORN_TIMEOUT=120
# GUNICORN_KEEPALIVE=5
# GUNICORN_MAX_REQUESTS=1200
# GUNICORN_MAX_REQUESTS_JITTER=120
# GUNICORN_LOG_LEVEL=info
# BUNQ_PREBOOT_INIT=true
```

**Tip:** Gebruik `http://vaultwarden:80` als Vaultwarden op hetzelfde `bunq-net` netwerk draait.
Gebruik `http://<NAS-IP>:9000` als je Vaultwarden via host/IP benadert.

#### B) Docker secrets (verplicht)

Gevoelige waarden gaan in Docker Swarm secrets.

**Eenmalig (Swarm activeren):**
```bash
sudo docker swarm init
# Als je een melding krijgt dat dit al actief is: negeren.
```

**Krijg je een fout over meerdere IP’s?** Gebruik dan je LAN‑IP:
```bash
sudo docker swarm init --advertise-addr 192.168.1.100
```
Vervang dit met het IP van je NAS (bijv. `192.168.1.242`).

**Netwerk (voor Vaultwarden koppeling):**
```bash
# Create an attachable overlay network for Swarm + standalone containers
sudo docker network create --driver overlay --attachable bunq-net
# Bestaat hij al? "already exists" is oké.

# Connect Vaultwarden container (from stap 2) to bunq-net
sudo docker network connect bunq-net vaultwarden
# Als hij al verbonden is, kun je de foutmelding negeren.
```

**Verplicht (Docker secrets):**

| Secret naam | Betekenis | Aanbevolen waarde |
|---|---|---|
| `bunq_basic_auth_password` | Dashboard wachtwoord | Sterk wachtwoord (min 12+ tekens) |
| `bunq_flask_secret_key` | Sessie‑encryptie sleutel | Genereer 64 hex chars: `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `bunq_vaultwarden_client_id` | OAuth client_id uit Vaultwarden | Waarde uit stap 2.6 |
| `bunq_vaultwarden_client_secret` | OAuth client_secret uit Vaultwarden | Waarde uit stap 2.6 |
| `bunq_vaultwarden_master_password` | Master password van dezelfde Vaultwarden account | Verplicht bij `VAULTWARDEN_ACCESS_METHOD=cli` |

**Optioneel (alleen als `USE_VAULTWARDEN=false`):**

| Secret naam | Betekenis | Aanbevolen waarde |
|---|---|---|
| `bunq_api_key` | Bunq API key (direct) | Alleen gebruiken als je geen Vaultwarden gebruikt |

**Aanbevolen werkwijze:** laat `USE_VAULTWARDEN=true` staan en gebruik `bunq_api_key` alleen als tijdelijke nood-fallback.

**Secrets aanmaken:**
```bash
# Let op: vervang de voorbeeldwaarden door je eigen echte waarden.
# Alleen deze regel mag je letterlijk uitvoeren (die genereert een random key):
# python3 -c "import secrets; print(secrets.token_hex(32))" | sudo docker secret create bunq_flask_secret_key -

printf '%s' "JouwSterkeWachtwoord" | sudo docker secret create bunq_basic_auth_password -
python3 -c "import secrets; print(secrets.token_hex(32))" | sudo docker secret create bunq_flask_secret_key -
printf '%s' "user.xxxx-xxxx-xxxx-xxxx" | sudo docker secret create bunq_vaultwarden_client_id -
printf '%s' "jouw_vaultwarden_client_secret" | sudo docker secret create bunq_vaultwarden_client_secret -
printf '%s' "jouw_vaultwarden_master_password" | sudo docker secret create bunq_vaultwarden_master_password -

# Alleen als USE_VAULTWARDEN=false:
# printf '%s' "jouw_bunq_api_key" | sudo docker secret create bunq_api_key -
```

**Veilige methode (voorkomt shell‑expansie bij speciale tekens):**
```bash
# Plak client_id (zichtbaar)
read -r CLIENT_ID
# Plak client_secret (onzichtbaar)
read -s CLIENT_SECRET
# Plak vaultwarden master password (onzichtbaar)
read -s MASTER_PASSWORD

printf '%s' "$CLIENT_ID" | sudo docker secret create bunq_vaultwarden_client_id -
printf '%s' "$CLIENT_SECRET" | sudo docker secret create bunq_vaultwarden_client_secret -
printf '%s' "$MASTER_PASSWORD" | sudo docker secret create bunq_vaultwarden_master_password -

unset CLIENT_ID CLIENT_SECRET MASTER_PASSWORD
```

### Stap 3.4: Update docker-compose.yml

Maak/Edit `/volume1/docker/bunq-dashboard/docker-compose.yml`:

```yaml
version: '3.8'

services:
  bunq-dashboard:
    image: bunq-dashboard:local

    ports:
      - "5000:5000"  # Dashboard + API

    environment:
      BASIC_AUTH_USERNAME: "${BASIC_AUTH_USERNAME:-admin}"
      VAULTWARDEN_URL: "${VAULTWARDEN_URL:-http://vaultwarden:80}"
      VAULTWARDEN_ACCESS_METHOD: "${VAULTWARDEN_ACCESS_METHOD:-cli}"
      VAULTWARDEN_ITEM_NAME: "${VAULTWARDEN_ITEM_NAME:-Bunq API Key}"
      USE_VAULTWARDEN: "${USE_VAULTWARDEN:-true}"
      BUNQ_ENVIRONMENT: "${BUNQ_ENVIRONMENT:-PRODUCTION}"
      AUTO_SET_BUNQ_WHITELIST_IP: "${AUTO_SET_BUNQ_WHITELIST_IP:-true}"
      AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS: "${AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS:-false}"
      ALLOWED_ORIGINS: "${ALLOWED_ORIGINS:-https://bunq.jouwdomein.nl}"
      SESSION_COOKIE_SECURE: "${SESSION_COOKIE_SECURE:-true}"
      FLASK_DEBUG: "${FLASK_DEBUG:-false}"
      LOG_LEVEL: "${LOG_LEVEL:-INFO}"
      BUNQ_INIT_AUTO_ATTEMPT: "${BUNQ_INIT_AUTO_ATTEMPT:-true}"
      BUNQ_INIT_RETRY_SECONDS: "${BUNQ_INIT_RETRY_SECONDS:-120}"
      CACHE_ENABLED: "${CACHE_ENABLED:-true}"
      CACHE_TTL_SECONDS: "${CACHE_TTL_SECONDS:-60}"
      DEFAULT_PAGE_SIZE: "${DEFAULT_PAGE_SIZE:-500}"
      MAX_PAGE_SIZE: "${MAX_PAGE_SIZE:-2000}"
      MAX_DAYS: "${MAX_DAYS:-3650}"
      DATA_DB_ENABLED: "${DATA_DB_ENABLED:-true}"
      DATA_DB_PATH: "${DATA_DB_PATH:-config/dashboard_data.db}"
      FX_ENABLED: "${FX_ENABLED:-true}"
      FX_RATE_SOURCE: "${FX_RATE_SOURCE:-frankfurter}"
      FX_REQUEST_TIMEOUT_SECONDS: "${FX_REQUEST_TIMEOUT_SECONDS:-8}"
      FX_CACHE_HOURS: "${FX_CACHE_HOURS:-24}"
      GUNICORN_WORKERS: "${GUNICORN_WORKERS:-2}"
      GUNICORN_THREADS: "${GUNICORN_THREADS:-4}"
      GUNICORN_TIMEOUT: "${GUNICORN_TIMEOUT:-120}"
      GUNICORN_KEEPALIVE: "${GUNICORN_KEEPALIVE:-5}"
      GUNICORN_MAX_REQUESTS: "${GUNICORN_MAX_REQUESTS:-1200}"
      GUNICORN_MAX_REQUESTS_JITTER: "${GUNICORN_MAX_REQUESTS_JITTER:-120}"
      GUNICORN_LOG_LEVEL: "${GUNICORN_LOG_LEVEL:-info}"
      BUNQ_PREBOOT_INIT: "${BUNQ_PREBOOT_INIT:-true}"

    secrets:
      - source: bunq_basic_auth_password
        target: basic_auth_password
      - source: bunq_flask_secret_key
        target: flask_secret_key
      - source: bunq_vaultwarden_client_id
        target: vaultwarden_client_id
      - source: bunq_vaultwarden_client_secret
        target: vaultwarden_client_secret
      - source: bunq_vaultwarden_master_password
        target: vaultwarden_master_password
      # Optional: only when USE_VAULTWARDEN=false
      # - source: bunq_api_key
      #   target: bunq_api_key

    volumes:
      - /volume1/docker/bunq-dashboard/config:/app/config
      - /volume1/docker/bunq-dashboard/logs:/app/logs

    networks:
      - bunq-net

    deploy:
      restart_policy:
        condition: any
        delay: 5s
        max_attempts: 0
        window: 60s

    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s

networks:
  bunq-net:
    external: true

secrets:
  bunq_basic_auth_password:
    external: true
  bunq_flask_secret_key:
    external: true
  bunq_vaultwarden_client_id:
    external: true
  bunq_vaultwarden_client_secret:
    external: true
  bunq_vaultwarden_master_password:
    external: true
  # Optional: only when USE_VAULTWARDEN=false
  # bunq_api_key:
  #   external: true
```

**Let op:** Zorg dat de Vaultwarden container uit Deel 2 op hetzelfde `bunq-net` netwerk draait (zie stap 3.3).

### Stap 3.5: Vaultwarden Integratie (al ingebouwd)

De `api_proxy.py` bevat standaard Vaultwarden-integratie. Zorg dat je:
- `.env` correct is ingevuld (zoals in stap 3.3),
- `USE_VAULTWARDEN=true` gebruikt,
- `VAULTWARDEN_ACCESS_METHOD=cli` gebruikt (aanbevolen),
- en de secret `bunq_vaultwarden_master_password` hebt aangemaakt.

### Stap 3.6: Build en Start

**Snelle route (aanbevolen):**
```bash
cd /volume1/docker/bunq-dashboard
sh scripts/install_or_update_synology.sh
```

Tijdens de run vraagt het script:
- `Use clean Docker build (--no-cache)? [Y/n]`

Je kunt dit vooraf forceren:
```bash
# Sneller (cached build)
NO_CACHE=false sh scripts/install_or_update_synology.sh

# Volledig schone build
NO_CACHE=true sh scripts/install_or_update_synology.sh
```

Dit script doet:
- Swarm/network checks
- check op vereiste secrets (maakt ze niet automatisch aan)
- build + deploy + startup-validatie
- post-deploy Bunq checks (API key/init + egress-IP vs actieve whitelist)

**Handmatige route (equivalent):**
```bash
cd /volume1/docker/bunq-dashboard

# Build image
TAG=$(sudo git rev-parse --short HEAD)
sudo docker build --no-cache -t bunq-dashboard:$TAG .
sudo docker tag bunq-dashboard:$TAG bunq-dashboard:local

# Architectuur-opmerking (Bitwarden CLI):
# - amd64/Intel NAS: native bw binary (kleiner image), met automatische npm fallback als release-asset/checksum tijdelijk ontbreekt
# - arm64 NAS: @bitwarden/cli via npm fallback (groter image, maar nodig op ARM)
#
# Let op (pip warning):
# Tijdens het builden kun je zien:
# WARNING: Running pip as the 'root' user ...
# of een melding over een nieuwe pip-versie.
# Dit is normaal in Docker builds.

# Deploy stack (Swarm) with values from .env
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'

# Force service restart + startup check (script gebruikt standaard git-tag)
sh scripts/restart_bunq_service.sh

# Check logs
sudo docker service logs -f bunq_bunq-dashboard
```

Je zou moeten zien:
```
== Bunq Dashboard Gunicorn startup ==
🔐 Retrieving API key from Vaultwarden (cli method)...
✅ API key retrieved from vault
✅ Bunq API initialized
Listening at: http://0.0.0.0:5000
```

### Stap 3.7: Open Dashboard

Browser: `http://192.168.1.100:5000`

🎉 **SUCCESS!** Je dashboard draait nu!

### Stap 3.8: Bunq IP Whitelisting & Re-registratie (verplicht bij key/IP wijziging)

Gebruik dit wanneer:
- je een nieuwe Bunq API key hebt aangemaakt
- je publieke IP is gewijzigd (bijv. VPN/ISP wijziging)
- je logs tonen: `Incorrect API key or IP address`

**Script uit de repo:**
```bash
cd /volume1/docker/bunq-dashboard
sh scripts/register_bunq_ip.sh
```

**Snelle non-interactieve variant (expliciet target IP):**
```bash
cd /volume1/docker/bunq-dashboard
TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=true sh scripts/register_bunq_ip.sh
# Voorbeeld:
# TARGET_IP=178.228.65.1 SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=true sh scripts/register_bunq_ip.sh
```

Het script doet automatisch:
- egress publieke IP tonen vanuit de container
- optioneel target IPv4 vragen (leeg = huidige egress IP)
- auth-mode detectie (`USE_VAULTWARDEN=true/false`)
- Bunq API allowlist updaten via API calls (ACTIVE op target IP)
- bij directe key-flow: `bunq_api_key` secret valideren (64 hex chars)
- oude Bunq context verwijderen
- bij directe key-flow: nieuwe `ApiContext` maken (installation + device registration)
- service forceren te herstarten
- relevante Bunq logs tonen
- egress-IP match checken tegen actieve Bunq whitelist (mismatch = duidelijke fout + herstelcommando)

Daarnaast probeert de backend bij startup/reinit automatisch hetzelfde te doen
als `AUTO_SET_BUNQ_WHITELIST_IP=true` in `.env`.

**Als het script nog steeds `Incorrect API key or IP address` toont:**
1. Open bunq app en controleer API key status/IP-restrictie.
2. Whitelist het egress IP dat het script toont.
3. Run het script opnieuw.

---

## 🔒 Deel 4: Security Hardening

### Stap 4.1: Firewall Rules

```
Control Panel → Security → Firewall → Edit Rules

Create Rule:
├── Ports: Custom → 5000,9000
├── Source IP: 192.168.0.0/16 (lokaal netwerk)
└── Action: Allow

All other IPs: Deny
```

### Stap 4.2: Reverse Proxy met HTTPS (Aanbevolen)

```
Control Panel → Login Portal → Advanced → Reverse Proxy

Create:
├── Reverse Proxy Name: bunq-dashboard
├── Protocol: HTTPS
├── Hostname: bunq.jouw-domein.nl
├── Port: 443
├── Enable HSTS ✓
├── Backend Server: localhost
├── Port: 5000
└── Apply
```

Verkrijg SSL cert via Let's Encrypt:
```
Control Panel → Security → Certificate
└── Add → Let's Encrypt (volg wizard)
```

### Stap 4.3: Regular Backups

Via Hyper Backup:
```
Backup:
├── /volume1/docker/vaultwarden (Vaultwarden data)
└── /volume1/docker/bunq-dashboard (Dashboard config)

Schedule: Daily, 2:00 AM
Retention: 30 days
```

### Stap 4.4: Update Notifications

```
Package Center → Container Manager → Settings
└── Enable update notifications ✓
```

---

## 🔧 Deel 5: Maintenance

### Updates

Snelle update (aanbevolen):
```bash
cd /volume1/docker/bunq-dashboard
sh scripts/install_or_update_synology.sh
```

Handmatig:
```bash
cd /volume1/docker/bunq-dashboard

# Rebuild image
TAG=$(sudo git rev-parse --short HEAD)
sudo docker build --no-cache -t bunq-dashboard:$TAG .
sudo docker tag bunq-dashboard:$TAG bunq-dashboard:local

# Redeploy stack
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'

# Force service restart + startup validation
sh scripts/restart_bunq_service.sh

# Verify
sudo docker stack ps bunq
```

### Backup Vaultwarden

```bash
# Create backup
sudo tar -czf vaultwarden-backup-$(date +%Y%m%d).tar.gz /volume1/docker/vaultwarden

# Move to safe location
sudo mv vaultwarden-backup-*.tar.gz /volume1/backups/
```

### Check Logs

```bash
# Dashboard logs
sudo docker service logs -f bunq_bunq-dashboard

# Vaultwarden logs
sudo docker logs vaultwarden
```

### Admin onderhoud via Dashboard (P1)

In **Settings → Admin Maintenance (P1)** kun je als ingelogde admin:
- `Check status`: runtime status van Vaultwarden, context file, cookie/CORS instellingen
- `Check egress IP`: huidig publiek uitgaand IP van de container
- `Set Bunq API whitelist IP`: veilige 2-staps flow
  1) activeer doel-IP
  2) deactiveer overige ACTIVE IPs (na succesvolle stap 1)
- `Reinit Bunq context`: context verwijderen + opnieuw opbouwen (installation/device registration)
- `Run maintenance now`: voert in 1 actie de ingestelde onderhoudsopties uit
- `Show install/update commands`: toont copy-ready terminalstappen voor host-level install/update script
- `Show restart/validate commands`: toont copy-ready terminalstappen voor restart/startup-validatie

Standaardopties in het panel:
- `Set whitelist IP`: altijd actief in maintenance flow
- `Auto target IP (egress)`: uit (vink aan om egress IP automatisch te bepalen)
- `Refresh API key`: uit (alleen aanzetten na API key rotatie)
- `Recreate context`: aan
- `Clear runtime cache`: aan
- Veld `IP to set on Bunq API whitelist`: vul handmatig in als auto-target uit staat;
  zodra je een IP invult gaat auto-target automatisch uit.
- Handmatig IP moet een publiek extern IPv4-adres zijn (lokale/private ranges worden geweigerd).

Gebruik `Reinit Bunq context` na:
- API key rotatie
- IP whitelist wijziging
- errors zoals `Incorrect API key or IP address`

### Rotate Bunq API Key

1. Generate new key in Bunq app
2. Update secret:
   - bij Vaultwarden-flow: update key in Vaultwarden item
   - bij directe key-flow (`USE_VAULTWARDEN=false`): update Docker secret `bunq_api_key`
3. Run (safe non-interactive): `TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=true sh scripts/register_bunq_ip.sh`
4. Validatie: `sh scripts/restart_bunq_service.sh`

No code changes needed! ✨

---

## 🐛 Troubleshooting (kort)

- Logs: `sudo docker service logs -f bunq_bunq-dashboard` en `sudo docker logs vaultwarden`
- Connectivity: `sudo docker exec $(sudo docker ps --filter name=bunq_bunq-dashboard -q | head -n1) ping vaultwarden`
- Redeploy na .env wijziging: `sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'`
- Alleen herstart (zonder config/secrets wijzigingen): `sudo docker service update --force bunq_bunq-dashboard`
- Herstart + startup-validatie (aanbevolen): `sh scripts/restart_bunq_service.sh`
- Bunq IP/device opnieuw registreren (safe): `TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=true sh scripts/register_bunq_ip.sh`

Voor uitgebreide oplossingen, zie [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## ✅ Verification Checklist

- [ ] Vaultwarden running on port 9000
- [ ] Vaultwarden accessible via browser
- [ ] Bunq API Key stored in vault
- [ ] Vaultwarden signups disabled
- [ ] Dashboard container running
- [ ] Dashboard accessible on port 5000
- [ ] API endpoint responding on port 5000
- [ ] Logs show no errors
- [ ] Firewall rules configured
- [ ] Backups scheduled

---

## 📞 Need Help?

- GitHub Issues: [Create Issue](https://github.com/richardvankampen/Bunq-dashboard-web/issues)
- Synology Forums: [DSM 7 Section](https://community.synology.com/enu/forum/1)
- Vaultwarden: [GitHub Discussions](https://github.com/dani-garcia/vaultwarden/discussions)

---

**Installation complete! Enjoy your secure Bunq Dashboard! 🎉**
