# 🔒 Beveiligingsgids - Bunq Dashboard

Volledige beveiligingsgids voor veilig gebruik van het Bunq Dashboard.

**Taalversies**
- Nederlands (dit bestand): [SECURITY-NL.md](SECURITY-NL.md)
- English: [SECURITY.md](SECURITY.md)

---

## 🧭 Navigatie

- Overzicht: [README-NL.md](README-NL.md)
- Synology-installatie: [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
- Probleemoplossing: [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)

## 🎯 Beveiligingsoverzicht

Het dashboard is gebouwd voor een privé, alleen-lezen overzicht van je financiën.

| Beveiligingsonderdeel | Invulling |
|-----------------------|-----------|
| **Bunq API-toegang** | Alleen-lezen (het dashboard kan geen betalingen doen) |
| **Authenticatie** | Sessiegebaseerd, sessiecookie server-side |
| **Cookies** | `HttpOnly`, `SameSite=Lax`, standaard `Secure` |
| **Geheimbeheer** | Vaultwarden (Bunq API key) + Docker Swarm secrets |
| **Netwerktoegang** | Alleen via VPN, geen port forwarding |
| **Rate limiting** | 30 verzoeken/min op de API, 5 inlogpogingen/min |
| **Sessieduur** | 24 uur |
| **Wachtwoordcontrole** | Constant-time vergelijking |
| **Runtime-server** | Gunicorn (geen Flask-ontwikkelserver) |

---

## 🛡️ Kritieke eisen

### 1. ⚠️ Alleen toegang via VPN

**Waarom:** je financiële data mag nooit vanaf internet bereikbaar zijn.

Eisen:
- ✅ Open het dashboard alleen via je VPN
- ✅ Zet poort 5000 nooit open op je router
- ✅ Houd het dashboard in een privé LAN/VPN-segment
- ✅ Gebruik Synology VPN Server (OpenVPN of L2TP/IPSec) of een vergelijkbare VPN

**VPN instellen (Synology):**

```text
Configuratiescherm → VPN Server → OpenVPN
├── OpenVPN-server inschakelen
├── Maximum aantal verbindingen: 5
├── Maximum verbindingen vanaf hetzelfde IP: 1
├── Poort: 1194 (standaard)
└── Dynamisch IP: aan

Clientconfiguratie:
VPN Server → OpenVPN → Configuratie exporteren → .ovpn-bestand downloaden

Clients:
Windows: OpenVPN GUI · Mac: Tunnelblick · iOS/Android: OpenVPN Connect · Linux: openvpn
```

**Controleer de VPN van buiten je netwerk (bv. telefoon op mobiele data):**
```bash
# Zonder VPN:
curl http://192.168.1.100:5000
# Moet een time-out geven (niet bereikbaar)

# Met VPN verbonden:
curl http://192.168.1.100:5000
# Geeft het dashboard terug
```

---

### 2. 🔐 Sessiegebaseerde authenticatie

Sessie-authenticatie is de standaard en enige inlogmethode.

- ✅ Inloggegevens worden server-side gecontroleerd (constant-time)
- ✅ `HttpOnly` + `SameSite=Lax` cookies (bescherming tegen cookiediefstal via XSS en tegen CSRF)
- ✅ Automatisch uitloggen na 24 uur

Eisen:
1. Secret `bunq_basic_auth_password` (minimaal 12 tekens)
2. Secret `bunq_flask_secret_key` (64 hex-tekens)
3. `ALLOWED_ORIGINS` precies op je dashboard-origin
4. `SESSION_COOKIE_SECURE=true` (standaard); alleen `false` voor lokaal testen via HTTP

---

### 3. 🔑 Vaultwarden voor geheimbeheer

**Waarom:** sla API keys nooit als platte tekst op.

```text
✅ WEL:
- Bunq API key in Vaultwarden bewaren
- Sterk Vaultwarden-hoofdwachtwoord (20+ tekens)
- 2FA op Vaultwarden aanzetten als dat kan
- Vaultwarden-data regelmatig back-uppen
- SIGNUPS_ALLOWED=false zetten na het aanmaken van je account

❌ NIET:
- API key in .env zetten
- .env in git committen
- Vaultwarden-hoofdwachtwoord delen
- Zwakke wachtwoorden gebruiken
- Registraties open laten staan
```

**Vaultwarden vs Docker Swarm secrets (aanbevolen verdeling):**
- Vaultwarden: de Bunq API key (rotatie, auditlog, UI).
- Swarm secrets: geheimen die alleen de runtime nodig heeft (dashboardwachtwoord, Flask secret key, Vaultwarden client ID/secret/hoofdwachtwoord).
- Zonder Vaultwarden: gebruik `bunq_api_key` als Swarm secret (`USE_VAULTWARDEN=false`); je mist dan rotatie/audit en de UI.
- Let op: Swarm secrets beschermen tegen per ongeluk lekken, maar root op de host kan ze nog steeds lezen.

Aanbevolen instellingen:
- `USE_VAULTWARDEN=true`
- `VAULTWARDEN_ACCESS_METHOD=cli` (ontsleutelt het vault-item via de `bw` CLI)
- `VAULTWARDEN_URL=https://...` (de CLI-flow vereist HTTPS)

**Vaultwarden hardening (in de compose van Vaultwarden zelf):**
```yaml
environment:
  SIGNUPS_ALLOWED: "false"           # kritiek
  ADMIN_TOKEN: "random-token-here"   # zet het adminpaneel aan
  INVITATIONS_ALLOWED: "false"       # geen uitnodigingen
  WEBSOCKET_ENABLED: "false"         # als je het niet nodig hebt
```
Maak een admin-token met `openssl rand -base64 48`.

---

### 4. 🔒 Sterke wachtwoorden en sleutels

**Flask secret key:**
```bash
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
printf "%s" "$SECRET_KEY" | docker secret create bunq_flask_secret_key -
```
- 64 hexadecimale tekens, willekeurig gegenereerd, uniek per installatie
- Nooit delen of in git committen
- ⚠️ Deze sleutel wijzigen logt alle actieve sessies uit

**Dashboardwachtwoord:**
```bash
DASHBOARD_PASSWORD=$(openssl rand -base64 32)
printf "%s" "$DASHBOARD_PASSWORD" | docker secret create bunq_basic_auth_password -
```
- Minimaal 12 tekens (een lange wachtzin mag ook)
- Niet hergebruikt van andere diensten
- Elke 3-6 maanden wijzigen

**Vaultwarden-hoofdwachtwoord:**
- Minimaal 20 tekens, sterke wachtzin of willekeurig wachtwoord
- Alleen bewaard in je wachtwoordmanager
- Jaarlijks wijzigen

---

## 🔧 Beveiligingsconfiguratie

### Aanbevolen `.env` en secrets

```bash
# Inloggen (geen geheim)
BASIC_AUTH_USERNAME=admin

# Sessies
SESSION_COOKIE_SECURE=true        # veilige standaard (HTTPS / reverse proxy)
# Alleen bij lokale HTTP:
# SESSION_COOKIE_SECURE=false
# HttpOnly en SameSite worden in de code afgedwongen (api_proxy.py)

# CORS (kritiek)
ALLOWED_ORIGINS=https://bunq.jouwdomein.nl   # alleen jouw origin, geen wildcards

# Vaultwarden
USE_VAULTWARDEN=true
VAULTWARDEN_ACCESS_METHOD=cli
VAULTWARDEN_URL=https://vault.jouwdomein.nl  # CLI-flow vereist HTTPS

# Bunq
BUNQ_ENVIRONMENT=PRODUCTION
AUTO_SET_BUNQ_WHITELIST_IP=true
AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS=false

# Applicatie
FLASK_DEBUG=false                 # nooit true in productie
LOG_LEVEL=INFO
BUNQ_INIT_AUTO_ATTEMPT=true
BUNQ_INIT_RETRY_SECONDS=120

# Runtime (Gunicorn)
GUNICORN_WORKERS=2
GUNICORN_THREADS=4
GUNICORN_TIMEOUT=120
GUNICORN_KEEPALIVE=5
GUNICORN_MAX_REQUESTS=1200
GUNICORN_MAX_REQUESTS_JITTER=120
GUNICORN_LOG_LEVEL=info
BUNQ_PREBOOT_INIT=true

# Docker Swarm secrets (apart aanmaken):
# - bunq_basic_auth_password
# - bunq_flask_secret_key
# - bunq_vaultwarden_client_id
# - bunq_vaultwarden_client_secret
# - bunq_vaultwarden_master_password
# - bunq_api_key (alleen bij USE_VAULTWARDEN=false)
```

**Bestandsrechten:**
```bash
# .env bevat geen geheimen, maar wel je configuratie
chmod 600 /volume1/docker/bunq-dashboard/.env
```

### Gevoelige data op schijf

`/volume1/docker/bunq-dashboard/config/` (gemount als `/app/config`) bevat:
- `dashboard_data.db`: SQLite-opslag met je volledige transactiegeschiedenis, saldi en snapshots
- `category_rules.json`: je eigen categorieregels (kan IBAN's of namen bevatten)
- de Bunq API-context (installation/device-registratie)

Houd deze map buiten git (dat is al zo), geef alleen beheerders toegang en neem hem alleen op in versleutelde back-ups.

### Bunq IP-whitelist (kritiek)

Bunq API keys kunnen aan IP-adressen gebonden zijn. Het publieke egress-IP van je container moet dan zijn toegestaan, anders krijg je
`Incorrect API key or IP address`.

**Na rotatie van de API key of een netwerk-/VPN-wijziging:**
```bash
cd /volume1/docker/bunq-dashboard
sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard
# Optionele expliciete override:
# sudo env TARGET_IP=<PUBLIEK_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard
```

Het script:
- toont het huidige publieke egress-IP van de container
- gebruikt een veilige Bunq-allowlistupdate in 2 stappen (eerst activeren, daarna andere deactiveren)
- controleert bij de directe key-flow het formaat van het secret `bunq_api_key`
- maakt een nieuwe Bunq `ApiContext` (installation + device-registratie)
- herstart de service en toont de relevante logs
- vergelijkt het egress-IP met de actieve whitelist en stopt met een herstelcommando als ze niet overeenkomen

**Alternatief via de UI:** dashboard → Instellingen → `Admin Maintenance`:
- `Check egress IP` toont welk publiek IP op de whitelist moet
- `Set Bunq API whitelist IP` doet alleen de veilige whitelistupdate in 2 stappen
- `Run full maintenance (recommended)` met de standaardopties:
  - `Try to determine whitelist IP (egress) automatically` staat standaard uit (of vul handmatig een IP in)
  - de optie om de API key te vernieuwen staat standaard uit (alleen nodig na key-rotatie)
- Een handmatig IP wordt gecontroleerd als publiek IPv4-adres (geen privé/lokale ranges)

---

## 🌐 Netwerkbeveiliging

### Firewall

**Synology-firewall:**
```text
Configuratiescherm → Beveiliging → Firewall → Regels bewerken

Toestaan-regel:
├── Poorten: 5000 (dashboard), je Vaultwarden-poort, 1194 (VPN)
├── Bron-IP: 192.168.0.0/16 (alleen lokaal netwerk)
└── Actie: Toestaan

Weigeren-regel (daaronder):
├── Bron-IP: Alle
└── Actie: Weigeren
```

**Linux iptables:**
```bash
# Alleen lokaal netwerk
sudo iptables -A INPUT -p tcp --dport 5000 -s 192.168.0.0/16 -j ACCEPT
# VPN
sudo iptables -A INPUT -p udp --dport 1194 -j ACCEPT
# Al het andere op de dashboardpoort weigeren
sudo iptables -A INPUT -p tcp --dport 5000 -j DROP
sudo iptables-save > /etc/iptables/rules.v4
```

### Reverse proxy met HTTPS (aanbevolen)

**Synology reverse proxy:**
```text
Configuratiescherm → Aanmeldingsportaal → Geavanceerd → Reverse proxy → Maken
├── Bron: HTTPS, hostnaam bunq.jouwdomein.nl, poort 443
├── HSTS en HTTP/2 inschakelen
└── Bestemming: HTTP, localhost, poort 5000

Certificaat:
Configuratiescherm → Beveiliging → Certificaat → Toevoegen → Let's Encrypt
```

**Nginx (gevorderd):**
```nginx
server {
    listen 443 ssl http2;
    server_name bunq.jouwdomein.nl;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 80;
    server_name bunq.jouwdomein.nl;
    return 301 https://$server_name$request_uri;
}
```

**Na het aanzetten van HTTPS** zet je in `.env`:
```bash
SESSION_COOKIE_SECURE=true
ALLOWED_ORIGINS=https://bunq.jouwdomein.nl
```
en deploy je opnieuw (configwijziging):
```bash
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
```

---

## 🔍 Beveiligingsmonitoring

### Logregels om op te letten

De backend logt deze beveiligingsgebeurtenissen:
- `🚫 Failed login attempt: <user> from <ip>`
- `🚫 Rate limit exceeded for <client> on <endpoint>`
- `🚫 Unauthorized access attempt from <ip>`

```bash
# Live
sudo docker service logs -f bunq_bunq-dashboard | grep -E "WARNING|ERROR|🚫"

# Aantallen
sudo docker service logs bunq_bunq-dashboard | grep -c "Failed login attempt"
sudo docker service logs bunq_bunq-dashboard | grep -c "Rate limit exceeded"
sudo docker service logs bunq_bunq-dashboard | grep -c "Unauthorized access attempt"
```

Containermeldingen op Synology: Configuratiescherm → Melding → E-mail.

Houd de health-endpoints in de gaten:
- Liveness: `/api/live`
- Readiness: `/api/health`

### Periodieke controles

**Maandelijks:**
- Bovenstaande logregels nalopen
- Controleren of de firewallregels nog actief zijn
- Updates voor dashboard- en Vaultwarden-images controleren
- Controleren of de back-ups van `config/` gelukt zijn

**Per kwartaal:**
- Dashboardwachtwoord wijzigen (`bunq_basic_auth_password`)
- Optioneel de Bunq API key roteren: nieuwe key in de Bunq-app, bijwerken in Vaultwarden, `register_bunq_ip.sh` draaien, testen
- Bijwerken naar de nieuwste code: `sudo sh scripts/install_or_update_synology.sh`
- Testen dat de VPN werkt en het dashboard zonder VPN niet bereikbaar is

**Jaarlijks:**
- Alle inloggegevens roteren, ook `bunq_flask_secret_key`
- Een herstel uit back-up testen
- Deze gids naast je eigen opzet leggen

---

## 🚨 Incidentafhandeling

### Vermoeden van ongeautoriseerde toegang

```bash
# 1. Blokkeer direct de toegang
sudo docker stack rm bunq

# 2. Bewaar de logs
sudo docker service logs bunq_bunq-dashboard > incident-$(date +%Y%m%d).log   # indien mogelijk vóór stap 1

# 3. Wijzig alle inloggegevens
#    - Vaultwarden-hoofdwachtwoord
#    - bunq_basic_auth_password
#    - bunq_flask_secret_key (maakt alle sessies ongeldig)
#    - Bunq API key (Bunq-app)

# 4. Controleer je transacties in de Bunq-app
#    (het dashboard is alleen-lezen en kan geen transacties aanmaken)

# 5. Deploy opnieuw met de nieuwe gegevens
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh

# 6. Neem contact op met Bunq-support als je ongeautoriseerde transacties vindt
```

### Gecompromitteerde dashboardhost

```bash
# 1. Trek direct de Bunq API key in (Bunq-app → API keys)

# 2. Maak een back-up van alles voor analyse
sudo tar -czf bunq-dashboard-incident-$(date +%Y%m%d).tar.gz /volume1/docker/bunq-dashboard

# 3. Installeer opnieuw vanaf een schone clone volgens SYNOLOGY_INSTALL-NL.md

# 4. Maak nieuwe gegevens aan: Bunq API key, Vaultwarden-hoofdwachtwoord, Flask secret key, dashboardwachtwoord

# 5. Audit: controleer lokale codewijzigingen (git status / git diff) en of de image uit de officiële repository is gebouwd
```

---

## 📋 Beveiligingschecklist

### Eerste installatie
- [ ] VPN geïnstalleerd en getest
- [ ] Firewallregels blokkeren toegang van buiten
- [ ] Poort 5000 NIET doorgestuurd op de router
- [ ] Vaultwarden met sterk hoofdwachtwoord en `SIGNUPS_ALLOWED=false`
- [ ] Bunq API key in Vaultwarden (niet in `.env`)
- [ ] Secret `bunq_flask_secret_key` aangemaakt (64 hex-tekens)
- [ ] Secret `bunq_basic_auth_password` aangemaakt (12+ tekens)
- [ ] `ALLOWED_ORIGINS` precies op je origin
- [ ] `FLASK_DEBUG=false`
- [ ] HTTPS via reverse proxy en `SESSION_COOKIE_SECURE=true`
- [ ] `/api/live` en `/api/health` worden gemonitord
- [ ] Versleutelde back-ups van `config/` ingesteld

### Maandelijks
- [ ] Logs nagelopen op mislukte logins / ongeautoriseerde toegang
- [ ] Firewallregels gecontroleerd
- [ ] Image-updates gecontroleerd
- [ ] Back-ups gecontroleerd

### Per kwartaal
- [ ] Dashboardwachtwoord gewijzigd
- [ ] Code en images bijgewerkt
- [ ] VPN-only toegang opnieuw getest

### Jaarlijks
- [ ] Alle inloggegevens geroteerd (ook secret keys)
- [ ] Herstel uit back-up getest
- [ ] Beveiligingsreview gedaan

---

## 🔐 Kwetsbaarheden melden

Vind je een beveiligingslek:

**Wel:**
1. Meld het privé via GitHub: repository → **Security** → **Report a vulnerability** (private security advisory)
2. Geef een beschrijving, stappen om het te reproduceren, de mogelijke impact en eventueel een voorstel voor een oplossing
3. Geef tijd voor een oplossing voordat je het openbaar maakt

**Niet:**
1. Een openbare GitHub-issue openen voor een beveiligingslek
2. Het openbaar maken voordat er een oplossing is
3. Het misbruiken

---

## 📚 Meer bronnen

- [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md) - installatiegids
- [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md) - veelvoorkomende problemen
- [Bunq API-documentatie](https://doc.bunq.com/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Docker security](https://docs.docker.com/engine/security/)

---

**Onthoud:** beveiliging is een doorlopend proces, geen eenmalige installatie.
