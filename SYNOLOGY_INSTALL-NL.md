# 🏠 Synology NAS-installatiegids

Stap-voor-stap instructies voor het installeren van het Bunq Dashboard op je Synology NAS met Vaultwarden voor geheimbeheer.

**Taalversies**
- Nederlands (dit bestand): [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
- English: [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)

---

## 🧭 Navigatie

- Overzicht en snelle start: [README-NL.md](README-NL.md)
- Beveiliging: [SECURITY-NL.md](SECURITY-NL.md)
- Probleemoplossing: [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)

## 📋 Vereisten

### Hardware
- **Synology NAS** met DSM 7.0 of hoger
- **Minimaal 2 GB RAM** (4 GB aanbevolen)
- **10 GB vrije schijfruimte**
- **Intel/AMD-CPU** aanbevolen (op ARM64 gebruikt de image de npm Bitwarden CLI, waardoor hij groter wordt)

### Software
- **Container Manager** (Package Center)
- **SSH-toegang** (optioneel maar aanbevolen)
- **Bunq**-account met API-toegang

### Netwerk
- **Vast LAN-IP** voor je NAS (bv. `192.168.1.100`)
- **Sterk aanbevolen:** een vast publiek IP (beste keuze) of een sticky dynamisch publiek IP bij je provider
- **Vrije lokale poorten:** `5000` (dashboard + API), `9000` (Vaultwarden)
- **Toegang van buitenaf** (optioneel): Tailscale (aanbevolen, geen open poort op de router) of een VPN; zie Deel 4

---

## 🔧 Deel 1: Voorbereiding

### Stap 1.1: SSH inschakelen (optioneel maar aanbevolen)

```text
Configuratiescherm → Terminal & SNMP
├── SSH-service inschakelen ✓
└── Poort: 22 (standaard)
```

Test:
```bash
ssh admin@192.168.1.100   # het IP van je NAS
```

### Stap 1.2: Container Manager installeren

```text
Package Center → zoek "Container Manager" → Installeren
```

### Stap 1.3: Projectmappen aanmaken

Via SSH:
```bash
sudo mkdir -p /volume1/docker/vaultwarden
sudo mkdir -p /volume1/docker/bunq-dashboard
sudo chmod -R 755 /volume1/docker
```

Of via File Station: `docker` → nieuwe mappen `vaultwarden` en `bunq-dashboard`.

**Let op:** `config` en `logs` maak je later aan (Deel 3), nadat de repository is gekloond.

---

## 🔐 Deel 2: Vaultwarden installeren

Vaultwarden is een lichte, zelf gehoste Bitwarden-server om geheimen veilig op te slaan.

### Stap 2.1: Image downloaden

```text
Container Manager → Register → zoek "vaultwarden/server" → Downloaden → tag "latest"
```

### Stap 2.2: Vaultwarden-container aanmaken

**Via de Container Manager-UI:**

```text
Container Manager → Container → Maken
├── Containernaam: vaultwarden
├── Image: vaultwarden/server:latest
├── Automatisch herstarten ✓
├── Poort: lokaal 9000 → container 80
├── Volume: /volume1/docker/vaultwarden → /data
├── Omgeving:
│   ├── DOMAIN = http://192.168.1.100:9000 (IP van je NAS)
│   ├── SIGNUPS_ALLOWED = true
│   └── LOG_LEVEL = info
├── Resourcelimieten: CPU 50%, geheugen 512 MB
└── Netwerk: bridge (in stap 3.3 gekoppeld aan bunq-net)
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
      DOMAIN: "http://192.168.1.100:9000"  # aanpassen
      SIGNUPS_ALLOWED: "true"              # na het aanmaken van je account op false
      LOG_LEVEL: "info"
```

### Stap 2.3: Vaultwarden starten

```bash
cd /volume1/docker/vaultwarden
sudo docker compose up -d      # of: docker-compose up -d op oudere DSM
sudo docker ps | grep vaultwarden
```

### Stap 2.4: Account aanmaken en registraties sluiten

1. Open `http://192.168.1.100:9000`
2. Maak een account aan met een **sterk** hoofdwachtwoord
3. **Kritiek:** zet `SIGNUPS_ALLOWED=false` (Container Manager → vaultwarden → Bewerken → Omgeving) en herstart de container

### Stap 2.5: Bunq API key opslaan

1. Maak een API key in de Bunq-app: Profiel → Beveiliging & instellingen → Ontwikkelaars → API keys → toevoegen
2. In Vaultwarden (`http://192.168.1.100:9000`):
   ```text
   Mijn kluis → + Item toevoegen
   ├── Type: Login
   ├── Naam: Bunq API Key   (moet gelijk zijn aan VAULTWARDEN_ITEM_NAME)
   ├── Gebruikersnaam: bunq-dashboard
   ├── Wachtwoord: <je Bunq API key>
   └── Opslaan
   ```

### Stap 2.6: Vaultwarden API-gegevens ophalen

```text
Vaultwarden → Instellingen → Beveiliging → Sleutels → API-sleutel bekijken
├── Voer je hoofdwachtwoord in
├── Kopieer client_id (bv. user.xxxx-xxxx-xxxx)
└── Kopieer client_secret
```

Bewaar deze; je hebt ze nodig voor de Docker secrets in stap 3.3.

### Stap 2.7: HTTPS voor Vaultwarden

De aanbevolen `VAULTWARDEN_ACCESS_METHOD=cli` vereist een **HTTPS**-`VAULTWARDEN_URL`. Zet Vaultwarden achter de Synology reverse proxy met een geldig certificaat (zie Deel 4), bv. `https://vault.jouwdomein.nl`.

---

## 📊 Deel 3: Bunq Dashboard installeren

### Stap 3.1: Project downloaden

**Optie A: git (aanbevolen)**
```bash
cd /volume1/docker/bunq-dashboard
sudo git clone https://github.com/richardvankampen/Bunq-dashboard-web.git .
```

Dit werkt alleen als `/volume1/docker/bunq-dashboard/` leeg is. Krijg je
`fatal: destination path '.' already exists and is not an empty directory`, verplaats dan eerst bestaande bestanden zoals `config/` en `logs/`.

**Optie B: ZIP** — download de ZIP van GitHub en upload hem via File Station. Bijwerken via `git pull` werkt dan niet; optie A heeft de voorkeur.

Controle:
```bash
ls /volume1/docker/bunq-dashboard/
# index.html, app.js, api_proxy.py, docker-compose.yml, scripts/, ...
```

### Stap 3.2: Runtime-mappen aanmaken

```bash
sudo mkdir -p /volume1/docker/bunq-dashboard/config
sudo mkdir -p /volume1/docker/bunq-dashboard/logs
```

`config/` bevat de Bunq-context, de SQLite-opslag `dashboard_data.db` (je transactiegeschiedenis) en je eigen `category_rules.json`. Deze map staat niet in git.

### Stap 3.3: `.env` en Docker secrets instellen (verplicht)

**Belangrijk:** gevoelige waarden komen **nooit** in `.env`; die gaan in Docker Swarm secrets.

#### A) `.env` (alleen niet-gevoelige instellingen)

Maak `/volume1/docker/bunq-dashboard/.env`.

**Verplicht:**

| Variabele | Betekenis | Aanbevolen / standaard |
|---|---|---|
| `BASIC_AUTH_USERNAME` | Gebruikersnaam voor het dashboard | `admin` (of eigen keuze) |
| `VAULTWARDEN_URL` | Vaultwarden-URL om de key op te halen | `https://vault.jouwdomein.nl` (HTTPS verplicht bij `cli`) |
| `VAULTWARDEN_ACCESS_METHOD` | Hoe het vault-item gelezen wordt | `cli` (aanbevolen/standaard) |
| `VAULTWARDEN_ITEM_NAME` | Naam van het vault-item met je Bunq API key | `Bunq API Key` |
| `USE_VAULTWARDEN` | Vaultwarden gebruiken i.p.v. een directe API key | `true` |
| `BUNQ_ENVIRONMENT` | Bunq-omgeving | `PRODUCTION` (of `SANDBOX` om te testen) |
| `AUTO_SET_BUNQ_WHITELIST_IP` | Bij start/reinit proberen de Bunq-whitelist bij te werken | `true` |
| `AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS` | Andere ACTIVE IP's automatisch op INACTIVE zetten | `false` (veiligst) |
| `ALLOWED_ORIGINS` | Toegestane frontend-origins (CORS) | `https://bunq.jouwdomein.nl` (of `http://<NAS-IP>:5000` bij lokale HTTP) |
| `SESSION_COOKIE_SECURE` | Cookies alleen via HTTPS versturen | `true` (standaard); alleen `false` bij lokale HTTP |

**Cookiedomein:** de sessiecookie wordt gezet op de host waarmee je het dashboard opent (`http://192.168.1.100:5000` → `192.168.1.100`, `https://bunq.jouwdomein.nl` → `bunq.jouwdomein.nl`). Gebruik altijd **dezelfde URL**, anders blijft je sessie niet behouden.

**Optioneel (doorgegeven door `docker-compose.yml`):**

| Variabele | Betekenis | Standaard |
|---|---|---|
| `LOG_LEVEL` | Logniveau | `INFO` |
| `FLASK_DEBUG` | Debugmodus (nooit in productie) | `false` |
| `BUNQ_INIT_AUTO_ATTEMPT` | Bunq pas initialiseren bij een API-verzoek | `true` |
| `BUNQ_INIT_RETRY_SECONDS` | Wachttijd tussen automatische init-pogingen | `120` |
| `CACHE_ENABLED` | Response-cache aan/uit | `true` |
| `CACHE_TTL_SECONDS` | Cache-TTL in seconden | `60` |
| `DEFAULT_PAGE_SIZE` | Standaard paginagrootte | `500` |
| `MAX_PAGE_SIZE` | Maximale paginagrootte | `2000` |
| `MAX_DAYS` | Maximale periode in dagen | `3650` |
| `DATA_DB_ENABLED` | Lokale SQLite-opslag aan/uit | `true` |
| `DATA_DB_PATH` | Pad van de SQLite-opslag | `config/dashboard_data.db` |
| `FX_ENABLED` | EUR-totalen voor niet-EUR-rekeningen | `true` |
| `FX_RATE_SOURCE` | Bron voor wisselkoersen | `frankfurter` |
| `FX_REQUEST_TIMEOUT_SECONDS` | Time-out van de FX-API | `8` |
| `FX_CACHE_HOURS` | Hoe lang wisselkoersen gecachet worden | `24` |
| `GUNICORN_WORKERS` | Gunicorn-workers | `2` |
| `GUNICORN_THREADS` | Threads per worker | `4` |
| `GUNICORN_TIMEOUT` | Request-time-out (seconden) | `120` |
| `GUNICORN_KEEPALIVE` | Keep-alive (seconden) | `5` |
| `GUNICORN_MAX_REQUESTS` | Verzoeken per worker vóór recyclen | `1200` |
| `GUNICORN_MAX_REQUESTS_JITTER` | Willekeurige extra bij recyclen | `120` |
| `GUNICORN_LOG_LEVEL` | Gunicorn-logniveau | `info` |
| `BUNQ_PREBOOT_INIT` | Bunq initialiseren tijdens het starten van de container | `true` |
| `VAULTWARDEN_EXTRA_HOST` | Vaultwarden-hostnaam in de container vastzetten op een LAN-IP (`<hostnaam>:<ip>`) | niet gezet |

**Gevorderd (gelezen door de code, maar NIET doorgegeven door `docker-compose.yml`):** deze werken pas nadat je ze toevoegt aan het `environment:`-blok van `docker-compose.yml` en een volledige stack deploy doet. De standaardwaarden zijn prima voor normaal gebruik.

| Variabele | Betekenis | Standaard |
|---|---|---|
| `BUNQ_PAYMENT_PAGE_SIZE` | Bunq-betalingen per pagina (max 200) | `200` |
| `BUNQ_PAYMENT_MAX_PAGES` | Max betalingspagina's per rekening per sync | `50` |
| `BUNQ_CARD_PAYMENT_PAGE_SIZE` / `BUNQ_CARD_PAYMENT_MAX_PAGES` | Idem voor kaartbetalingen | gelijk aan de betalingswaarden |
| `SYNC_MIN_INTERVAL_SECONDS` | Minimale tijd tussen incrementele syncs | `60` |
| `ACCOUNTS_CACHE_SECONDS` | Cache van de rekeningenlijst per worker | `60` |
| `SOURCE_FAILURE_BACKOFF_SECONDS` | Wachttijd na een falende Bunq-bron | `3600` |
| `RECONCILE_ENABLED` | Maandelijkse volledige reconcile van de opslag | `true` |
| `RECONCILE_DAY` / `RECONCILE_HOUR` / `RECONCILE_TIMEZONE` | Wanneer de reconcile draait | `1` / `3` / `Europe/Amsterdam` |
| `RECONCILE_WINDOW_HOURS` | Venster na het startuur waarin hij mag draaien | `3` |
| `RECONCILE_MAX_PAGES` | Max pagina's per rekening tijdens reconcile | `500` |
| `CATEGORY_RULES_PATH` | Bestand met eigen categorieregels | `config/category_rules.json` |
| `VAULTWARDEN_CLI_TIMEOUT_SECONDS` | Time-out per `bw` CLI-aanroep | `30` |

**Voorbeeld minimale `.env`:**

```bash
BASIC_AUTH_USERNAME=admin
VAULTWARDEN_URL=https://vault.jouwdomein.nl
VAULTWARDEN_ACCESS_METHOD=cli
VAULTWARDEN_ITEM_NAME="Bunq API Key"
USE_VAULTWARDEN=true
# Optioneel: Vaultwarden-hostnaam in de container vastzetten op een LAN-IP
# (bij verouderde/foute Docker DNS). Formaat: <hostnaam>:<ip>
# VAULTWARDEN_EXTRA_HOST=vault.jouwdomein.nl:192.168.1.100
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
DATA_DB_ENABLED=true
FX_ENABLED=true
```

**Tip:** bij `VAULTWARDEN_ACCESS_METHOD=cli` is een HTTPS-URL verplicht. Alleen als je bewust `VAULTWARDEN_ACCESS_METHOD=api` gebruikt, kun je een interne HTTP-URL gebruiken (bv. `http://vaultwarden:80`).

#### B) Docker secrets (verplicht)

**Eenmalig: Swarm aanzetten**
```bash
sudo docker swarm init
# "already part of a swarm" is prima.
# Fout over meerdere IP's? Gebruik je LAN-IP:
# sudo docker swarm init --advertise-addr 192.168.1.100
```

**Netwerk (om Vaultwarden te bereiken):**
```bash
sudo docker network create --driver overlay --attachable bunq-net   # "already exists" is prima
sudo docker network connect bunq-net vaultwarden                    # "already connected" is prima
```

**Verplichte secrets:**

| Secret | Betekenis | Waarde |
|---|---|---|
| `bunq_basic_auth_password` | Dashboardwachtwoord | Sterk wachtwoord (12+ tekens) |
| `bunq_flask_secret_key` | Sleutel voor het ondertekenen van sessies | 64 hex-tekens |
| `bunq_vaultwarden_client_id` | Vaultwarden-`client_id` | Uit stap 2.6 |
| `bunq_vaultwarden_client_secret` | Vaultwarden-`client_secret` | Uit stap 2.6 |
| `bunq_vaultwarden_master_password` | Hoofdwachtwoord van hetzelfde Vaultwarden-account | Verplicht bij `VAULTWARDEN_ACCESS_METHOD=cli` |

**Optioneel (alleen bij `USE_VAULTWARDEN=false`):** `bunq_api_key` (directe Bunq API key). Laat `USE_VAULTWARDEN=true` staan en gebruik dit alleen als noodoplossing.

**Secrets aanmaken (veilige invoer, geen shell-expansie van speciale tekens):**
```bash
read -s DASHBOARD_PASSWORD      # plak het dashboardwachtwoord (onzichtbaar)
read -r CLIENT_ID               # plak client_id (zichtbaar)
read -s CLIENT_SECRET           # plak client_secret (onzichtbaar)
read -s MASTER_PASSWORD         # plak het Vaultwarden-hoofdwachtwoord (onzichtbaar)

printf '%s' "$DASHBOARD_PASSWORD" | sudo docker secret create bunq_basic_auth_password -
python3 -c "import secrets; print(secrets.token_hex(32), end='')" | sudo docker secret create bunq_flask_secret_key -
printf '%s' "$CLIENT_ID" | sudo docker secret create bunq_vaultwarden_client_id -
printf '%s' "$CLIENT_SECRET" | sudo docker secret create bunq_vaultwarden_client_secret -
printf '%s' "$MASTER_PASSWORD" | sudo docker secret create bunq_vaultwarden_master_password -

unset DASHBOARD_PASSWORD CLIENT_ID CLIENT_SECRET MASTER_PASSWORD

# Alleen bij USE_VAULTWARDEN=false:
# read -s BUNQ_KEY; printf '%s' "$BUNQ_KEY" | sudo docker secret create bunq_api_key -; unset BUNQ_KEY
```

### Stap 3.4: `docker-compose.yml`

De repository bevat een kant-en-klare `docker-compose.yml`; normaal hoef je die niet aan te passen. Hij:
- draait de image `bunq-dashboard:local` op poort `5000`
- geeft de `.env`-variabelen uit de tabellen hierboven door (met standaardwaarden)
- koppelt de secrets uit stap 3.3 (`bunq_api_key` staat uitgecommentarieerd; alleen aanzetten bij `USE_VAULTWARDEN=false`)
- mount `/volume1/docker/bunq-dashboard/config` → `/app/config` en `/volume1/docker/bunq-dashboard/logs` → `/app/logs`
- voegt een optionele `extra_hosts`-regel toe vanuit `VAULTWARDEN_EXTRA_HOST`
- gebruikt het externe netwerk `bunq-net`
- heeft een healthcheck op `/api/live` met een `start_period` van 300 s (Vaultwarden + Bunq-init bij het starten)

Zorg dat de Vaultwarden-container uit Deel 2 aan `bunq-net` gekoppeld is (stap 3.3).

### Stap 3.5: Bouwen en starten

**Snelle route (aanbevolen):**
```bash
cd /volume1/docker/bunq-dashboard
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

Belangrijk:
- Voer dit script altijd uit met `sudo sh ...` (root).
- Als normale gebruiker kan `docker stack deploy` de standaardwaarden uit `docker-compose.yml` (`*.jouwdomein.nl`) gebruiken in plaats van je `.env`-waarden.

Het script vraagt `Use clean Docker build (--no-cache)? [Y/n]`. Vooraf kiezen:
```bash
sudo sh -c 'NO_CACHE=false sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'   # sneller, met cache
sudo sh -c 'NO_CACHE=true sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'    # volledig schoon
```

Het script doet:
- Swarm-/netwerkcontroles
- een controle op de verplichte secrets (maakt ze niet aan)
- bouwen + deployen + startvalidatie
- Bunq-controles na de deploy (API key/init + egress-IP vs actieve whitelist)

**Handmatige route (gelijkwaardig):**
```bash
cd /volume1/docker/bunq-dashboard

TAG=$(sudo git rev-parse --short HEAD)
sudo docker build --no-cache -t bunq-dashboard:$TAG .
sudo docker tag bunq-dashboard:$TAG bunq-dashboard:local
# amd64: native bw-binary (valt terug op npm als de release tijdelijk niet beschikbaar is)
# arm64: @bitwarden/cli via npm (grotere image)
# Meldingen "Running pip as the 'root' user" zijn normaal in Docker-builds.

sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo sh scripts/restart_bunq_service.sh

sudo docker service logs -f bunq_bunq-dashboard
curl -s http://127.0.0.1:5000/api/live
curl -s http://127.0.0.1:5000/api/health
```

Verwachte logregels:
```text
== Bunq Dashboard Gunicorn startup ==
🔐 Retrieving API key from Vaultwarden (cli method)...
✅ API key retrieved from vault
✅ Bunq API initialized
Listening at: http://0.0.0.0:5000
```

### Stap 3.6: Dashboard openen

Gebruik precies je `ALLOWED_ORIGINS`-URL:
- aanbevolen: `https://bunq.jouwdomein.nl` (reverse proxy + `SESSION_COOKIE_SECURE=true`)
- alleen als lokale HTTP-noodoplossing: `http://192.168.1.100:5000` met `SESSION_COOKIE_SECURE=false`

De eerste keer dat je een periode laadt, worden de transacties bij Bunq opgehaald en opgeslagen in `config/dashboard_data.db`; daarna komt het laden uit de opslag, met een incrementele sync op de achtergrond.

**Health-endpoints:**
- `/api/live` = liveness (service draait)
- `/api/health` = readiness (status van de Bunq-context; kan `503` geven als key en IP niet kloppen)

### Stap 3.7: Bunq IP-whitelist en herregistratie (na een key- of IP-wijziging)

Gebruik dit als:
- je een nieuwe Bunq API key hebt gemaakt
- je publieke IP is veranderd (nieuwe provider, router, VPN of Tailscale-exit node)
- de logs `Incorrect API key or IP address` tonen

Met een vast of sticky publiek IP heb je dit veel minder vaak nodig; zie [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md), sectie `Publiek IP-beleid (vast vs sticky)`.

```bash
cd /volume1/docker/bunq-dashboard
sudo sh scripts/register_bunq_ip.sh                    # interactief
sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh # niet-interactief, doel = huidig egress-IP
# Expliciet doel:
# sudo env TARGET_IP=<PUBLIEK_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh
```

Het script:
- toont het publieke egress-IP van de container
- vraagt optioneel om een doel-IPv4 (leeg = huidig egress-IP)
- herkent de auth-modus (`USE_VAULTWARDEN=true/false`)
- werkt de Bunq API-whitelist bij (doel-IP ACTIVE)
- controleert bij een directe key het secret `bunq_api_key` (64 hex-tekens)
- verwijdert de oude Bunq-context en maakt een nieuwe `ApiContext`
- herstart de service geforceerd en toont de relevante logs
- vergelijkt het egress-IP met de actieve whitelist (komt het niet overeen: duidelijke fout + herstelcommando)

Met `AUTO_SET_BUNQ_WHITELIST_IP=true` probeert de backend dit ook bij start/reinit.

Nog steeds `Incorrect API key or IP address`? Controleer de key-status/IP-beperking in de Bunq-app, zet het egress-IP dat het script toont op de whitelist en draai het script opnieuw.

### Stap 3.8: Eigen categorieregels (optioneel)

Zet eigen categorieregels in `/volume1/docker/bunq-dashboard/config/category_rules.json`; zie de sectie "Eigen categorieregels" in [README-NL.md](README-NL.md). Doe na het aanpassen een snelle redeploy; opgeslagen transacties worden bij de start eenmalig opnieuw ingedeeld.

---

## 🔒 Deel 4: Beveiliging aanscherpen

### Stap 4.1: Toegang van buitenaf met Tailscale of een VPN

Zet poort 5000 nooit open op je router. Wil je het dashboard buitenshuis gebruiken, kies dan één van deze:

**Tailscale (aanbevolen):**
1. Package Center → zoek "Tailscale" → Installeren → openen en inloggen (maak zo nodig een account op tailscale.com).
2. Installeer de Tailscale-app op je telefoon/laptop en log in met hetzelfde account.
3. Open het dashboard op `http://<Tailscale-IP van de NAS>:5000` (het 100.x.y.z-adres in de Tailscale-app).
4. HTTPS (aanbevolen): zet **MagicDNS** en **HTTPS-certificaten** aan in de Tailscale-beheerconsole, voer `sudo tailscale serve --bg 5000` uit op de NAS en zet in `.env`:
   ```bash
   ALLOWED_ORIGINS=https://nas.<jouw-tailnet>.ts.net
   SESSION_COOKIE_SECURE=true
   ```
   Doe daarna een volledige deploy (configwijziging).
5. Gebruik nooit `tailscale funnel` (dat zet het dashboard op internet) en laat de NAS geen exit node gebruiken (Bunq ziet dan een ander publiek IP).

**VPN:** Synology VPN Server (OpenVPN); zie [SECURITY-NL.md](SECURITY-NL.md), optie B.

### Stap 4.2: Firewall

```text
Configuratiescherm → Beveiliging → Firewall → Regels bewerken
├── Toestaan: poorten 5000, 9000 vanaf 192.168.0.0/16 (lokaal netwerk)
├── Toestaan: poort 5000 vanaf 100.64.0.0/10 (alleen bij Tailscale)
└── Weigeren: alle andere IP's
```

### Stap 4.3: Reverse proxy met HTTPS (aanbevolen)

Met Tailscale geeft `tailscale serve` (stap 4.1) het dashboard al HTTPS; voor Vaultwarden heb je nog steeds een reverse proxy met HTTPS nodig (stap 2.7).

```text
Configuratiescherm → Aanmeldingsportaal → Geavanceerd → Reverse proxy → Maken
├── Naam: bunq-dashboard
├── Bron: HTTPS, bunq.jouwdomein.nl, poort 443, HSTS ✓
└── Bestemming: HTTP, localhost, poort 5000
```
Doe hetzelfde voor Vaultwarden (bv. `vault.jouwdomein.nl` → `localhost:9000`).

Certificaat: Configuratiescherm → Beveiliging → Certificaat → Toevoegen → Let's Encrypt.

Meer in [SECURITY-NL.md](SECURITY-NL.md).

### Stap 4.4: Back-ups

Via Hyper Backup (dagelijks, bv. 02:00, 30 dagen bewaren, versleuteld):
- `/volume1/docker/vaultwarden` (Vaultwarden-data)
- `/volume1/docker/bunq-dashboard/config` (transactieopslag `dashboard_data.db`, `category_rules.json`, Bunq-context)
- `/volume1/docker/bunq-dashboard/.env`

De opslag bewaart ook transacties die Bunq niet meer levert; een back-up van `config/` is dus de enige kopie van die geschiedenis.

### Stap 4.5: Updatemeldingen

```text
Package Center → Container Manager → Instellingen → updatemeldingen inschakelen
```

---

## 🔧 Deel 5: Onderhoud

### Bijwerken

Alleen codewijziging (meest voorkomend; geen wijziging in `.env`/compose/secrets/netwerk):
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

Volledige install/update:
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

Configwijziging (`.env`, `docker-compose.yml`, secrets, netwerk):
```bash
TAG=$(sudo git rev-parse --short HEAD)
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

Herlaad na een update de browser geforceerd (Ctrl+F5 / Cmd+Shift+R), zodat de nieuwe `app.js` geladen wordt.

### Handmatige back-up

```bash
sudo mkdir -p /volume1/backups
sudo tar -czf /volume1/backups/vaultwarden-$(date +%Y%m%d).tar.gz /volume1/docker/vaultwarden
sudo tar -czf /volume1/backups/bunq-dashboard-config-$(date +%Y%m%d).tar.gz \
  /volume1/docker/bunq-dashboard/config /volume1/docker/bunq-dashboard/.env
```

Terugzetten: stop de stack (`sudo docker stack rm bunq`), pak het archief uit naar hetzelfde pad en deploy opnieuw.

### Logs

```bash
sudo docker service logs -f bunq_bunq-dashboard
sudo docker logs vaultwarden
```

### Beheeronderhoud via het dashboard

In **Instellingen → Beheeronderhoud** (ingelogd):

**Welk probleem heb je?** — een gids per situatie, elk met de stappen en knoppen die ze uitvoeren:
- Het dashboard toont geen Bunq-gegevens of meldt `Incorrect API key or IP address`
- Je publieke IP-adres is veranderd
- Je hebt een nieuwe Bunq API key gemaakt
- Vaultwarden geeft een fout (token mislukt, item niet gevonden)
- Transacties ontbreken, zijn gewijzigd of in Bunq verwijderd
- Cijfers lijken verouderd of kloppen niet na een storing
- Er is een nieuwe versie van het dashboard
- Het dashboard is traag, hangt of herstart steeds

**Knoppen** (het paneel legt ze ook uit):
- `Status controleren` (alleen lezen): Bunq-verbinding, laatste Bunq-fout, Vaultwarden, transactieopslag, laatste controle met Bunq, en een **advies** dat naar de passende situatie verwijst
- `Egress-IP controleren` (alleen lezen): het huidige publieke uitgaande IP van de container (dit IP moet op de Bunq-whitelist staan)
- `Bunq API-whitelist-IP instellen`: veilige werkwijze in 2 stappen (1. doel-IP activeren, 2. na bevestiging andere ACTIVE IP's deactiveren)
- `Alleen context opnieuw opbouwen (gevorderd)`: de API key opnieuw ophalen en de Bunq-context opnieuw opbouwen, zonder whitelistwijziging
- `Volledig onderhoud uitvoeren (aanbevolen)`: cache wissen, Bunq-context opnieuw opbouwen en het whitelist-IP bijwerken, volgens de opties
- `Controle met Bunq uitvoeren`: alle transacties opnieuw ophalen en de opslag bijwerken (zoals de maandelijkse controle, loopt op de achtergrond)

**Terminal**-knoppen tonen kant-en-klare commando's voor de NAS, elk met wat het doet: `Nieuwe versie installeren` (snelle redeploy of volledige install/update), `Herstarten en controleren`, `Bunq-whitelist via terminal` (`register_bunq_ip.sh`), `Nieuwe API key via terminal`, `Logs bekijken`.

Standaardopties voor `Volledig onderhoud uitvoeren`:
- whitelistupdate: gebeurt altijd
- `Whitelist-IP (egress) automatisch bepalen`: uit (vul handmatig een IP in, of vink aan; de gidsknop "Volledig onderhoud met automatisch IP" vinkt het aan)
- API key vernieuwen uit Vaultwarden/direct secret: uit (alleen na key-rotatie; alleen het proces dat het verzoek afhandelt krijgt de nieuwe key, herstart daarna dus de service)
- `Bunq-context opnieuw opbouwen`: aan
- `Runtimecache wissen`: aan
- status herladen na uitvoering: aan
- Een handmatig IP moet een publiek IPv4-adres zijn (privé/lokale ranges worden geweigerd)

### Bunq API key roteren

1. Maak een nieuwe key in de Bunq-app
2. Werk hem bij:
   - met Vaultwarden: het Vaultwarden-item bijwerken
   - met een directe key (`USE_VAULTWARDEN=false`): Docker secret `bunq_api_key` opnieuw aanmaken
3. Draai `sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh`
4. Valideer: `sudo sh scripts/restart_bunq_service.sh`

Geen codewijzigingen nodig.

---

## 🐛 Probleemoplossing (kort)

- Logs: `sudo docker service logs -f bunq_bunq-dashboard` en `sudo docker logs vaultwarden`
- Verbinding: `sudo docker exec $(sudo docker ps --filter name=bunq_bunq-dashboard -q | head -n1) ping -c1 vaultwarden`
- Alleen herstarten (geen nieuwe image): `sudo docker service update --force bunq_bunq-dashboard`
- Herstarten + startvalidatie (aanbevolen): `sudo sh scripts/restart_bunq_service.sh`
- Bunq IP/device opnieuw registreren: `sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh`

Zie [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md) voor uitgebreide oplossingen.

### Spaarrekeningen controleren (optioneel)

```bash
EXPECTED_ACCOUNTS_JSON='[
  {"description":"Spaarrekening","currency":"EUR"}
]'

DASHBOARD_USERNAME="<dashboard-gebruiker>" \
DASHBOARD_PASSWORD="<dashboard-wachtwoord>" \
python3 /volume1/docker/bunq-dashboard/scripts/check_accounts_api.py \
  --base-url "https://<jouw-domein>" \
  --insecure \
  --expected-json "$EXPECTED_ACCOUNTS_JSON" \
  --timeout 180
```

---

## ✅ Controlelijst

- [ ] Vaultwarden draait op poort 9000 en is bereikbaar via HTTPS
- [ ] Bunq API key staat in de kluis
- [ ] Vaultwarden-registraties uitgeschakeld
- [ ] Secrets aangemaakt, `bunq-net` bestaat en Vaultwarden is eraan gekoppeld
- [ ] Dashboardservice draait; `/api/live` en `/api/health` reageren
- [ ] Dashboard bereikbaar op je `ALLOWED_ORIGINS`-URL (via je thuisnetwerk, VPN of Tailscale) en niet vanaf internet
- [ ] Logs tonen geen fouten
- [ ] Firewallregels ingesteld
- [ ] Back-ups ingepland (inclusief `config/`)

---

## 📞 Hulp nodig?

- GitHub Issues: [issue aanmaken](https://github.com/richardvankampen/Bunq-dashboard-web/issues) (plak nooit geheimen, API keys of persoonlijke gegevens)
- Synology-forum: [DSM 7](https://community.synology.com/enu/forum/1)
- Vaultwarden: [GitHub Discussions](https://github.com/dani-garcia/vaultwarden/discussions)

---

**Installatie voltooid. Veel plezier met je veilige Bunq Dashboard! 🎉**
