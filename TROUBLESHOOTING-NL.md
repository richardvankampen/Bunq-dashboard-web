# 🐛 Probleemoplossingsgids - Bunq Dashboard

Diagnose en herstel op Synology Docker Swarm (sessiegebaseerde installaties met Vaultwarden).

**Taalversies**
- Nederlands (dit bestand): [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)
- English: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 🧭 Navigatie

- Overzicht: [README-NL.md](README-NL.md)
- Installatie en onderhoud: [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
- Beveiliging: [SECURITY-NL.md](SECURITY-NL.md)

---

## 📋 Snelle diagnose

Voer deze eerst uit:

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
- `/api/live` moet `200` geven als het proces draait.
- `/api/health` kan `503` geven als de Bunq-initialisatie mislukt is (meestal een key-/IP-/whitelistprobleem).

---

## 🌍 Publiek IP-beleid (vast vs sticky)

Voor dit dashboard is Bunq API-toegang in de praktijk gekoppeld aan je **huidige publieke egress-IP**.
Als dat IP verandert, kan Bunq verzoeken weigeren met `Incorrect API key or IP address` totdat je de whitelist bijwerkt.

Begrippen:
- **Vast/statisch publiek IP**: je publieke IP verandert niet, tenzij je provider het wijzigt.
- **Sticky dynamisch publiek IP**: formeel dynamisch, maar vaak lang hetzelfde (tot een modem-reconnect, storing, onderhoud of lease-reset).
- **Regulier dynamisch publiek IP**: kan vaker en minder voorspelbaar veranderen.

Waarom dit hier belangrijk is:
- minder Bunq-whitelistherregistraties
- minder `503`-readinessincidenten na provider-/routergebeurtenissen
- voorspelbaardere werking en makkelijker diagnosticeren

Providerpraktijk (Nederland, gebruikelijk beeld per maart 2026):
- Een vast publiek IPv4-adres zit meestal op **zakelijke** abonnementen (vaak als add-on), onder andere bij veel pakketten van KPN Zakelijk, Ziggo Zakelijk en Odido Zakelijk.
- Particuliere abonnementen zijn meestal dynamisch; soms sticky, maar zelden contractueel gegarandeerd.
- Mobiele/5G- en CGNAT-verbindingen zijn het minst voorspelbaar voor IP-gebaseerde allowlists.

Als je publieke IP is veranderd:
```bash
cd /volume1/docker/bunq-dashboard
sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh
# Optioneel expliciet doel:
# sudo env TARGET_IP=<PUBLIEK_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh
sudo sh scripts/restart_bunq_service.sh
```

---

## 🔄 Update- en redeployflows

### 1. Redeploy bij alleen codewijzigingen (aanbevolen)

Voor wijzigingen in code/templates/docs, zonder wijziging in `.env`/compose/secrets/netwerk:

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

### 2. Volledige deploy na een configwijziging

Voor wijzigingen in `.env`, `docker-compose.yml`, secrets of netwerk:

```bash
cd /volume1/docker/bunq-dashboard
TAG=$(sudo git rev-parse --short HEAD)
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

### 3. Volledige install/update-routine

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

---

## 🔴 Kritieke problemen

### 1. Dashboardservice start niet

Symptomen:
- `docker service ps` toont failed/rejected tasks
- de UI geeft 502/503

Controle:
```bash
sudo docker service ps bunq_bunq-dashboard --no-trunc
sudo docker service logs --since 10m bunq_bunq-dashboard
```

Gebruikelijke oorzaken: ontbrekend/fout Docker secret, ongeldige `.env`-waarden, image die niet overeenkomt met de build.

Herstel:
1. Na een codewijziging: redeploy bij alleen codewijzigingen.
2. Na een config-/secretswijziging: volledige deploy.
3. Aanhoudende build-/deployproblemen: install/update-script.

### 2. Inloggen mislukt (401 / Invalid username or password)

```bash
cd /volume1/docker/bunq-dashboard
grep -E '^BASIC_AUTH_USERNAME=' .env
sudo docker secret ls | grep bunq_basic_auth_password
```

- Het dashboardwachtwoord komt uit het Docker secret `bunq_basic_auth_password`, niet uit `.env`.
- Wijzigen: maak het secret opnieuw aan en doe daarna een volledige deploy.
- Na 5 mislukte pogingen per minuut wordt inloggen tijdelijk geblokkeerd; wacht een minuut.

### 3. Inloggen werkt, maar Bunq-data faalt

Symptomen:
- `503` op `/api/accounts` of `/api/transactions`
- de UI toont dat de API niet geïnitialiseerd is

```bash
sudo docker service logs --since 15m bunq_bunq-dashboard | grep -E "Bunq API initialized|Incorrect API key or IP address|No valid API key|Vaultwarden"
```

Waarschijnlijke oorzaken: verkeerde Bunq API key, whitelist-IP komt niet overeen, ophalen uit Vaultwarden mislukt.

Herstel:
1. In het dashboard: `Instellingen → Admin Maintenance → Run full maintenance (recommended)`.
2. Of in de terminal:
   ```bash
   cd /volume1/docker/bunq-dashboard
   sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh
   sudo sh scripts/restart_bunq_service.sh
   ```

### 4. Vaultwarden-verbinding faalt

```bash
sudo docker ps | grep vaultwarden
sudo docker logs --tail 200 vaultwarden
sudo docker service logs --since 10m bunq_bunq-dashboard | grep -E "Vaultwarden|API key retrieved from vault|No valid API key"
curl -I https://vault.jouwdomein.nl
```

Controleer:
- `.env`: `USE_VAULTWARDEN=true`, `VAULTWARDEN_ACCESS_METHOD=cli`, `VAULTWARDEN_URL=https://...`
- de secrets `bunq_vaultwarden_client_id`, `bunq_vaultwarden_client_secret` en `bunq_vaultwarden_master_password` bestaan

Wijst de Vaultwarden-hostnaam in de container naar een verkeerd/oud IP (bv. na een subnetwijziging)?
- zet `VAULTWARDEN_EXTRA_HOST=<vault-hostnaam>:<nas-lan-ip>` in `.env`
- doe daarna een volledige stack deploy (geen snelle redeploy), zodat de host-mapping wordt toegepast

### 5. Container herstart met `non-zero exit (137): unhealthy container`

Bij het starten wordt de API key eenmalig uit Vaultwarden gehaald (in de Gunicorn-master, ~35 s) en wordt Bunq geïnitialiseerd voordat Gunicorn `/api/live` beantwoordt. De healthcheck-`start_period` (300 s) dekt dit. Gebruikt een oudere deployment nog een korte start-periode, pas die dan toe op de draaiende service zonder redeploy:

```bash
sudo docker service update --health-start-period 300s bunq_bunq-dashboard
```

Controleer ook de logs op `Vault item '...' not found`: `VAULTWARDEN_ITEM_NAME` in `.env` moet precies overeenkomen met de naam van het vault-item (hoofdlettergevoelig).

Na het roteren van de Bunq API key in Vaultwarden: herstart de service (`sudo docker service update --force bunq_bunq-dashboard`); workers hergebruiken de key die bij het starten is opgehaald.

### 6. Spaarrekeningen ontbreken in de widget of `/api/accounts`

Controleer de API-uitvoer:

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

Faalt dit: draai eerst full maintenance en herhaal de controle. Faalt het nog steeds? Verzamel ruwe endpointgegevens (alleen officiële routes):

```bash
sudo sh scripts/debug_raw_monetary_accounts.sh bunq_bunq-dashboard 0 | tee /tmp/monetary_debug.log
grep -E "^(attempt_count=|== /user/|parsed_accounts=|first_account=|result_type=|probe_|error=)" /tmp/monetary_debug.log
```

---

## 🟡 Veelvoorkomende problemen

### 7. Transactieopslag en maandelijkse controle

Transacties worden opgeslagen in SQLite (`config/dashboard_data.db`, tabel `bunq_transactions`). Als de opgeslagen data de gekozen periode dekt, antwoordt het dashboard direct uit de database en controleert het op de achtergrond bij Bunq op nieuwere transacties (hooguit eens per `SYNC_MIN_INTERVAL_SECONDS`); nieuwe transacties verschijnen bij de volgende keer laden. Alleen bij de eerste keer laden of een langere periode dan opgeslagen wacht het op Bunq. De rekeningenlijst wordt `ACCOUNTS_CACHE_SECONDS` hergebruikt en daarna op de achtergrond ververst.

Eens per maand (standaard: de 1e, 03:00–06:00 Europe/Amsterdam) haalt de app alles opnieuw op tot aan de oudste opgeslagen transactie en verwerkt de verschillen:
- nieuwe transacties worden toegevoegd, gewijzigde bijgewerkt;
- transacties die Bunq niet meer teruggeeft worden als verwijderd gemarkeerd en verborgen (de rij blijft in de database);
- transacties die ouder zijn dan wat Bunq nog levert blijven bewaard en zichtbaar.

Laatste runs bekijken:
```bash
sudo docker service logs --since 48h bunq_bunq-dashboard 2>&1 | grep "Reconcile"
```

Nu een controle draaien (zelfde logica als de maandelijkse run):
```bash
BUNQ_CONTAINER=$(sudo docker ps -q -f name=bunq_bunq-dashboard | head -n1)
sudo docker exec "$BUNQ_CONTAINER" python3 -c "import api_proxy; print(api_proxy.run_reconcile_exclusive('manual'))"
```
Via de API (ingelogd): `POST /api/admin/reconcile` (starten) en `GET /api/admin/reconcile` (status en recente runs).

### 8. Cijfers lijken onvolledig of laden is traag

De widget **Datakwaliteit** in het dashboard toont de waarschuwingen hieronder. Je kunt ook deze URL openen in de browser terwijl je ingelogd bent (de API heeft je sessie nodig):

```text
https://<jouw-domein>/api/transactions?days=365&page=1&page_size=1
```

Let op:
- `truncated: true` / `truncated_accounts`: Bunq-paging heeft voor die rekeningen de paginagrens bereikt
- `amount_eur_missing_count > 0`: niet-EUR-transacties zonder omrekening naar EUR
- `sync_errors`: een Bunq-bron die tijdens de sync faalde

Acties:
- `truncated`: de volgende achtergrondsync of de maandelijkse controle vult het gat meestal aan. Voor zeer grote geschiedenissen verhoog je `BUNQ_PAYMENT_MAX_PAGES` / `BUNQ_CARD_PAYMENT_MAX_PAGES`; die staan **niet** in `docker-compose.yml`, dus voeg ze toe aan het `environment:`-blok en doe een volledige deploy.
- `amount_eur_missing_count`: controleer `FX_ENABLED=true` en of de container de FX-bron kan bereiken.
- Trage eerste keer laden van een lange periode: eenmalig normaal (de opslag wordt gevuld); daarna komt het uit de opslag.

### 9. Categorieën kloppen niet

- Eigen regels in `config/category_rules.json` gaan voor de ingebouwde regels; zie "Eigen categorieregels" in [README-NL.md](README-NL.md).
- Alle velden in een regel moeten kloppen; tekst is een hoofdletterongevoelige deeltekst, IBAN's exact.
- Doe na het aanpassen van het bestand een redeploy bij alleen codewijzigingen: opgeslagen transacties worden bij de start eenmalig opnieuw ingedeeld. Controleer de logs op `Could not read category rules` (ongeldige JSON).

### 10. CORS-fouten

```bash
grep '^ALLOWED_ORIGINS=' /volume1/docker/bunq-dashboard/.env
```

`ALLOWED_ORIGINS` moet precies overeenkomen met de URL in je browser (schema, host en poort). Na een wijziging: volledige deploy.

### 11. Sessie verloopt te snel of inloggen blijft niet hangen

Controleer:
- de browser accepteert cookies
- je gebruikt altijd dezelfde URL (de cookie hoort bij de host)
- `SESSION_COOKIE_SECURE` past bij je opzet: `true` bij HTTPS, `false` alleen voor lokaal testen via HTTP

Sessies duren 24 uur. Na een `.env`-wijziging: volledige deploy.

### 12. Frontendwijzigingen niet zichtbaar

Meestal de browsercache.

1. Geforceerd herladen (`Ctrl/Cmd + Shift + R`).
2. Controleer welke image draait:
   ```bash
   sudo docker service inspect bunq_bunq-dashboard --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
   ```
3. Doe een redeploy bij alleen codewijzigingen.

---

## 🧰 Handige commando's

```bash
# Image die de service nu draait
sudo docker service inspect bunq_bunq-dashboard --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'

# Rolling restart (geen nieuwe image)
sudo docker service update --force bunq_bunq-dashboard

# Herstart + startvalidatie
sudo sh scripts/restart_bunq_service.sh

# Shell in de draaiende container
sudo docker exec -it $(sudo docker ps -q -f name=bunq_bunq-dashboard | head -n1) sh
```

---

## 📦 Diagnostiekpakket maken

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

Controleer `diagnostic.txt` altijd op gevoelige gegevens (IBAN's, namen, bedragen, IP's) voordat je het deelt.

---

## 📞 Hulp

- GitHub-issues: <https://github.com/richardvankampen/Bunq-dashboard-web/issues>
- Vermeld in elk issue:
  - een korte omschrijving van het probleem
  - stappen om het te reproduceren
  - relevante (geanonimiseerde) logregels
  - uitvoer van `docker --version`
  - Synology-model en DSM-versie
- Beveiligingsproblemen: meld ze privé, zie [SECURITY-NL.md](SECURITY-NL.md#-kwetsbaarheden-melden).
