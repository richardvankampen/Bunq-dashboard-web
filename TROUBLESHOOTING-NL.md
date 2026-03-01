# Probleemoplossingsgids - Bunq Dashboard (NL)

Actuele gids voor diagnose en herstel op Synology Docker Swarm.

Laatst bijgewerkt: 1 maart 2026
Van toepassing op: session-based installaties (Vaultwarden-first)

---

## Navigatie

- Startpunt: [README-NL.md](README-NL.md)
- Installatie en onderhoud: [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
- Security hardening: [SECURITY-NL.md](SECURITY-NL.md)

---

## Snelle diagnose

Voer deze set eerst uit:

```bash
cd /volume1/docker/bunq-dashboard

sudo docker ps
sudo docker service ls
sudo docker service ps bunq_bunq-dashboard --no-trunc
sudo docker service logs --since 10m bunq_bunq-dashboard

curl -s http://127.0.0.1:5000/api/live
curl -s http://127.0.0.1:5000/api/health
```

Interpretatie:
- `/api/live` moet `200` geven als proces draait.
- `/api/health` kan `503` geven als Bunq init niet geslaagd is (meestal key/IP/whitelist probleem).

---

## Update- en Redeployflows (actueel)

Gebruik altijd deze flows; oudere varianten zonder duidelijke scope zijn verwijderd.

### 1. Code-only redeploy (aanbevolen)

Gebruik dit bij wijzigingen in code/templates/docs, zonder `.env`/compose/secrets/netwerkwijziging:

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

### 2. Full deploy bij configwijziging

Gebruik dit bij wijzigingen in `.env`, `docker-compose.yml`, secrets of netwerk:

```bash
cd /volume1/docker/bunq-dashboard
TAG=$(sudo git rev-parse --short HEAD)
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq; docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard'
```

### 3. Volledige install/update routine

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

---

## Kritieke problemen

### 1. Dashboard service start niet

Symptomen:
- `docker service ps` toont failed/rejected tasks
- UI geeft 502/503

Acties:

```bash
cd /volume1/docker/bunq-dashboard
sudo docker service ps bunq_bunq-dashboard --no-trunc
sudo docker service logs --since 10m bunq_bunq-dashboard
```

Herstel:
1. Bij codewijziging: run code-only redeploy.
2. Bij config/secrets wijziging: run full deploy.
3. Bij aanhoudende build/deploy problemen: run install/update script.

### 2. Login werkt niet (401 / Invalid username or password)

Checks:

```bash
cd /volume1/docker/bunq-dashboard
grep -E '^(BASIC_AUTH_USERNAME|BASE_URL)=' .env
sudo docker secret ls | grep bunq_basic_auth_password
```

Belangrijk:
- Dashboard wachtwoord komt uit Docker secret (`bunq_basic_auth_password`), niet uit `.env`.
- Bij wachtwoordrotatie: secret vernieuwen en daarna full deploy.

### 3. Bunq data faalt (meestal key/IP mismatch)

Checks:

```bash
sudo docker service logs --since 15m bunq_bunq-dashboard | grep -E "Incorrect API key or IP address|No valid API key|Vaultwarden|Bunq API initialized"
```

Herstel:
1. Run in dashboard: `Settings -> Admin Maintenance -> Run full maintenance`.
2. Of via terminal:

```bash
cd /volume1/docker/bunq-dashboard
TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=false sh scripts/register_bunq_ip.sh
sudo sh scripts/restart_bunq_service.sh
```

### 4. Vaultwarden verbinding faalt

Checks:

```bash
sudo docker ps | grep vaultwarden
sudo docker logs --tail 200 vaultwarden
sudo docker service logs --since 10m bunq_bunq-dashboard | grep -E "Vaultwarden|API key retrieved from vault|No valid API key"
```

Controleren:
- `.env`: `USE_VAULTWARDEN=true`, `VAULTWARDEN_ACCESS_METHOD=cli`
- Secrets bestaan:
  - `bunq_vaultwarden_client_id`
  - `bunq_vaultwarden_client_secret`
  - `bunq_vaultwarden_master_password`

### 5. Spaarrekeningen ontbreken in `/api/accounts`

Valideer met de checker:

```bash
EXPECTED_ACCOUNTS_JSON='[
  {"description":"Spaarrekening","currency":"EUR"},
  {"description":"Spaargeld in ZAR","currency":"ZAR"}
]'

DASHBOARD_USERNAME="<dashboard-user>" \
DASHBOARD_PASSWORD="<dashboard-pass>" \
python3 /volume1/docker/bunq-dashboard/scripts/check_accounts_api.py \
  --base-url "$BASE_URL" \
  --insecure \
  --expected-json "$EXPECTED_ACCOUNTS_JSON" \
  --timeout 180
```

Als dit faalt: run eerst full maintenance en herhaal checker.

---

## Veel voorkomende problemen

### 6. CORS errors

Controleer `.env`:

```bash
grep '^ALLOWED_ORIGINS=' /volume1/docker/bunq-dashboard/.env
```

Regel:
- `ALLOWED_ORIGINS` moet exact matchen met de URL die je in de browser gebruikt.

Na wijziging:
- full deploy uitvoeren.

### 7. Sessie verloopt te snel

Controleer:
- Browser accepteert cookies.
- `SESSION_COOKIE_SECURE` matcht je setup:
  - `true` bij HTTPS
  - `false` alleen bij lokale HTTP test

Bij wijziging van `.env`: full deploy uitvoeren.

### 8. Trage performance / time-outs

Controleer of dataset truncatie optreedt:

```bash
curl -s 'http://127.0.0.1:5000/api/transactions?days=365&page=1&page_size=200&exclude_internal=true' | jq '{truncated, amount_eur_missing_count, truncated_accounts}'
```

Als `truncated=true`:
- verhoog pagination limieten in `.env` (bijv. `BUNQ_PAYMENT_MAX_PAGES`, `BUNQ_CARD_PAYMENT_MAX_PAGES`)
- daarna full deploy.

### 9. Frontend wijzigingen niet zichtbaar

Meestal browser cache.

Acties:
1. Hard refresh (`Cmd/Ctrl + Shift + R`).
2. Controleer runtime image:

```bash
sudo docker service inspect bunq_bunq-dashboard --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
```

3. Run code-only redeploy.

---

## Diagnostiekpakket maken

```bash
cd /volume1/docker/bunq-dashboard

sudo sh -c 'echo "=== Service status ===" > diagnostic.txt'
sudo sh -c 'docker service ps bunq_bunq-dashboard --no-trunc >> diagnostic.txt 2>&1'
sudo sh -c 'echo "\n=== Dashboard logs ===" >> diagnostic.txt'
sudo sh -c 'docker service logs bunq_bunq-dashboard >> diagnostic.txt 2>&1'
sudo sh -c 'echo "\n=== Live/Health ===" >> diagnostic.txt'
sudo sh -c 'curl -s http://127.0.0.1:5000/api/live >> diagnostic.txt 2>&1'
sudo sh -c 'curl -s http://127.0.0.1:5000/api/health >> diagnostic.txt 2>&1'

cat diagnostic.txt
```

Controleer `diagnostic.txt` altijd op gevoelige data voordat je deelt.

---

## Hulp

- GitHub issues: <https://github.com/richardvankampen/Bunq-dashboard-web/issues>
- Neem in elk issue op:
  - korte probleemomschrijving
  - reproductiestappen
  - relevante logregels
  - output van `docker --version`
  - Synology model en DSM versie
