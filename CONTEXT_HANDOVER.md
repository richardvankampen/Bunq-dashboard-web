# Context Handover

Laatste update: 2026-03-01 (savings-account incident + raw-route variant probing)

## Canonieke status

Dit bestand is de actuele bron voor overdracht.
- Informatie staat hier bewust maar 1x.
- Oudere of foutieve aannames zijn verwijderd i.p.v. naast nieuwe info te blijven staan.

## Productiestatus (bevestigd)

- Vaultwarden-first werkt: API key wordt via CLI decrypt opgehaald.
- Bunq context init werkt: `/api/health` kan `ready=true` en `bunq_context_initialized=true` geven.
- Session-auth met secure cookies werkt.
- Dashboard draait via Synology + Docker Swarm + Gunicorn.

## Open incident: spaarrekeningen ontbreken

### Symptoom

- Widget `Spaarrekeningen` blijft leeg.
- `/api/accounts` bevat alleen checking/external accounts.
- Bekende echte rekeningen die missen:
  - `Spaarrekening` (EUR)
  - `Spaargeld in ZAR`

### Reproduceerbare observaties

- Logs tonen SDK parse-fouten op savings endpoints:
  - `MonetaryAccountApiObject failed: float() argument must be a string or a real number, not 'NoneType'`
  - `MonetaryAccountSavingsApiObject failed: float() argument must be a string or a real number, not 'NoneType'`
  - `MonetaryAccountExternalSavingsApiObject failed: float() argument must be a string or a real number, not 'NoneType'`
- Accounts output toont alleen:
  - 9x `MonetaryAccountBankApiObject`
  - 1x `MonetaryAccountExternalApiObject`
- Runtime-check in container:
  - `init_ok=True`, `last_error=None`
  - `discover_bunq_user_ids()` retourneert `user_ids=[75231272]`
  - Conclusie: multi-user mismatch is niet de primaire oorzaak.
- Raw fallback client-resolutie werkt nu:
  - logregel gezien: `Resolved Bunq HTTP client via bunq.sdk.http.api_client.ApiClient.__init__`
  - resterende failure zat in SDK-client call-signatuur (`ApiClient.get(...)` verwacht verplichte `params` + `custom_headers`).
- Belangrijke operationele les (bevestigd):
  - `install_or_update_synology.sh` moet als root worden uitgevoerd (`sudo sh ...`).
  - Run als normale user kan bij `docker stack deploy` leiden tot fallback op compose-defaults zoals `vault.jouwdomein.nl` / `bunq.jouwdomein.nl`, ondanks correcte `.env`.
  - Symptoom in logs: `Vaultwarden CLI error ... ENOTFOUND vault.jouwdomein.nl` + demo mode.

## Wat recent is aangepast (code)

Doel: savings-account discovery robuuster maken bij SDK-variantfouten.

- `e9da54c` - savings-classificatie verbeterd (backend + frontend).
- `adb96f0` - monetary-account endpoint discovery + list modes verbreed.
- `dcc7bb7` - retry met `status=ACTIVE` modes toegevoegd.
- `6909e51` - raw monetary-account fallback toegevoegd bij SDK parse failures.
- `223396f` - api-client resolutie verbreed voor raw fallback (`BunqContext`/`ApiContext` varianten).
- `948a564` - meerdere Bunq user IDs detecteren en per user account-enumeratie proberen (bevestigd: momenteel 1 user-id gevonden).
- Extra hardening (nieuw, nog te valideren op NAS na deploy):
  - `_call_monetary_account_list(...)` stuurt nu standaard `count` mee (`BUNQ_ACCOUNT_PAGE_SIZE`, default/max 200), ook in `status=ACTIVE` varianten.
  - `_resolve_bunq_api_client(...)` retourneert nu alleen gevalideerde HTTP-clients en gebruikt standaard een strikte resolve-volgorde:
    - `BUNQ_STRICT_RAW_CLIENT_RESOLUTION=true` (default).
  - `_call_api_client_get(...)` maakt onderscheid tussen signatuurfouten en echte runtime/API-fouten, met duidelijkere foutmelding.
  - Live observatie op NAS: alle drie `/v1/user/{id}/monetary-account*` raw routes geven `404 Route not found`.
  - Raw monetary fallback probeert nu een deterministische route-matrix i.p.v. alleen `/v1/...`:
    - prefixes: `/v1/user`, `/user`, `user`
    - suffixes: `monetary-account`, `monetary-account-bank`, `monetary-account-savings`, `monetary-account-external-savings`, `monetary-account-external`, `monetary-account-joint`, `monetary-account-card`
    - params-varianten per route: `{'status':'ACTIVE','count':N}`, `{'count':N}`, `{}`
  - Extra routevariant toegevoegd voor sdk-contextinjectie:
    - ook context-scoped paden zonder expliciete user-id worden geprobed:
      - `/v1/monetary-account*`
      - `/monetary-account*`
      - `monetary-account*`
  - Raw fallback heeft cooldown op herhaalde failures:
    - `BUNQ_RAW_FALLBACK_COOLDOWN_SECONDS` (default `120`).
  - SDK endpoint-discovery staat standaard in strikte modus:
    - `BUNQ_STRICT_ENDPOINT_DISCOVERY=true` (default), dus eerst alleen canonieke endpoint-klassen/modes.
  - Raw fallback diagnostiek is uitgebreid:
    - per raw endpoint expliciete logregels voor:
      - `Raw Bunq endpoint returned no parsable monetary accounts ...`
      - `Raw Bunq endpoint parsed only duplicate accounts ...`
      - `Raw Bunq endpoint unavailable (skip) ...` bij 404/route-not-found
    - merge-pad (`list_monetary_accounts` met bestaande SDK-accounts) gebruikt nu `soft_fail=True` om partiële raw endpoint failures niet als globale fallback-failure te loggen.
  - Raw payload extractie/parsing is extra gehard:
    - `_extract_json_payload(...)` leest eerst `raw_body/raw_response/...` en pas later `.value`, zodat lege sdk-wrapperwaarden de echte JSON-body niet overschrijven.
    - `_extract_json_payload(...)` probeert nu ook `get_*` methoden (`get_value/get_body/get_raw_body/get_response_body/get_json/get_data`) en scant `__dict__` private velden op payload-achtige data.
    - `_extract_monetary_accounts_from_raw_payload(...)` accepteert ook directe account-dicts zonder `MonetaryAccount*` wrapper key.
    - `_extract_monetary_accounts_from_raw_payload(...)` accepteert ook single-object payloads zonder `Response[]` wrapper plus nested `value/data/result` payloads.
    - `_extract_monetary_accounts_from_raw_result(...)` verwerkt ook sdk model-object responses uit raw client calls (dus niet alleen JSON payloads).
    - account-extractie is aangescherpt om false positives te reduceren:
      - alleen account-like mappings/objecten (o.a. `id` + `balance` of monetary-account class-hint) worden meegenomen.

Status: incident nog open; focus ligt nu op:
- valideren welke route-variant in de matrix echt data teruggeeft op deze Bunq/SDK runtime;
- daarna savings-widget/logica bevestigen op live data.
- nieuwe deterministische check gebruiken om per deploy te valideren dat bekende savings-accounts (naam + currency + saldo) terugkomen:
  - `scripts/check_accounts_api.py`

## Deployment + validatie (volgende stap)

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
TAG=$(sudo git rev-parse --short HEAD)
sudo docker build --no-cache -t bunq-dashboard:$TAG -t bunq-dashboard:local .
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

Snelle debug-loop (zonder stack deploy) bij pure codewijzigingen:

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

Gebruik full stack deploy (met `.env` laden) alleen bij wijziging van:
- `.env`
- `docker-compose.yml`
- secrets/netwerk/deploy-config

Synology deploy-regel:
- Gebruik voor install/update altijd: `sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh`
- Voor handmatige redeploy: `sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'`

Controle 1 (nieuwe runtime-code aanwezig):

```bash
BUNQ_CONTAINER=$(sudo docker ps --filter name=bunq_bunq-dashboard -q | head -n1)
sudo docker exec "$BUNQ_CONTAINER" sh -c "grep -n '_resolve_bunq_api_client' /app/api_proxy.py"
```

Controle 2 (accounts + logs):

```bash
curl -sS -k -b "$COOKIE_JAR" "$BASE_URL/api/accounts?_ts=$(date +%s)" | jq -r '
(.data // [])[]
| [.id, .description, .account_class, .account_type, (.monetary_account_type // ""), (.balance.value|tostring), .balance.currency] | @tsv'
```

```bash
sudo docker service logs --since 5m bunq_bunq-dashboard | \
grep -E "Using bunq endpoint class|Resolved Bunq HTTP client via|raw Bunq monetary-account fallback|Raw Bunq endpoint returned no parsable|Raw Bunq endpoint parsed only duplicate|Raw Bunq endpoint unavailable|Merged [0-9]+ account|Retrieved [0-9]+ accounts|MonetaryAccountSavings|api_client unavailable|candidates:|Error fetching accounts"
```

Controle 3 (deterministische API-asserts op bekende savings-accounts):

```bash
EXPECTED_ACCOUNTS_JSON='[
  {"description":"Spaarrekening","currency":"EUR"},
  {"description":"Spaargeld in ZAR","currency":"ZAR"}
]'

DASHBOARD_USERNAME="$BASIC_AUTH_USERNAME" \
DASHBOARD_PASSWORD="$BASIC_AUTH_PASSWORD" \
python3 /volume1/docker/bunq-dashboard/scripts/check_accounts_api.py \
  --base-url "$BASE_URL" \
  --insecure \
  --expected-json "$EXPECTED_ACCOUNTS_JSON" \
  --balance-tolerance 0.01
```

Wil je ook saldo hard afdwingen? Voeg dan per account een `balance` veld toe met de echte live waarde.

Controle 4 (raw endpoint inspectie zonder heredoc):

```bash
cd /volume1/docker/bunq-dashboard
sudo sh scripts/debug_raw_monetary_accounts.sh
```

Optioneel:
- `USER_ID=<bunq_user_id> sudo sh scripts/debug_raw_monetary_accounts.sh`
- `MAX_ROWS=50 sudo sh scripts/debug_raw_monetary_accounts.sh`
- `MAX_ROWS=0 sudo sh scripts/debug_raw_monetary_accounts.sh` (snelle route-scan zonder accountregels)
- `sudo sh scripts/debug_raw_monetary_accounts.sh bunq_bunq-dashboard 0` (idem, zonder env-variabelen)

Let op:
- Gebruik niet de shellvariabele `UID` voor Bunq user-id (die is readonly in POSIX shells).
- Losse `docker exec python3 -c ...` debugcalls moeten eerst `init_bunq(...)` doen; anders krijg je `ApiContext has not been loaded`.
- Het script streamt output live; bij redirect naar bestand (`> file 2>&1`) blijft voortgang zichtbaar via `tail -f file`.
- Het script toont nu ook `attempt_count=<n>` en gebruikt ongebufferde Python-output (`python3 -u`) voor directe voortgang.
- Het script toont nu ook `first_account=...` per route, ook bij `MAX_ROWS=0`.
- Bij eerste lege route (`parsed_accounts=0`) toont script nu ook `result_type` en `probe_*` attribuutdiagnostiek om SDK-wrappervelden te identificeren.
- De `probe_*` diagnostiek bevat nu ook `get_*` accessors en `__dict__`, specifiek om BunqResponseRaw payloadvelden in SDK-varianten te vinden.
- Voor snelle code-iteraties is er nu `scripts/quick_redeploy.sh` (build + service update, zonder stack deploy).
- Als `MAX_ROWS` via `sudo` niet doorkomt, gebruik de 2e script-parameter (`...sh <service> <max_rows>`) of `sudo env MAX_ROWS=...`.

## Als savings nog steeds ontbreken
- Neem de exacte nieuwe `api_client unavailable (candidates: ...)` logregel over; die bepaalt het volgende concrete resolverpad.
- Als nog steeds geen raw client: gerichte inspectie van `BunqContext.api_context()` objectgraph in runtime-container uitvoeren en op die accessor patchen.
- Als raw client wel resolved maar nog geen savings: endpoint/pagination output per `/user/{id}/monetary-account*` pad inspecteren en fallback daarop fixeren.

## Volgende sessie (nog uit te voeren)

1) Handmatige redeploy met `.env` geladen:

```bash
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

2) Raw debug opnieuw draaien en kernregels verzamelen:

```bash
sudo sh scripts/debug_raw_monetary_accounts.sh bunq_bunq-dashboard 0 | tee /tmp/monetary_debug.log
grep -E "^(attempt_count=|== /user/|== user/|parsed_accounts=|first_account=|error=)" /tmp/monetary_debug.log
```

3) API checker draaien:

```bash
sudo chmod 755 /volume1/docker/bunq-dashboard/scripts/check_accounts_api.py

EXPECTED_ACCOUNTS_JSON='[
  {"description":"Spaarrekening","currency":"EUR"},
  {"description":"Spaargeld in ZAR","currency":"ZAR"}
]'
DASHBOARD_USERNAME="$BASIC_AUTH_USERNAME" \
DASHBOARD_PASSWORD="$BASIC_AUTH_PASSWORD" \
python3 /volume1/docker/bunq-dashboard/scripts/check_accounts_api.py \
  --base-url "$BASE_URL" \
  --insecure \
  --expected-json "$EXPECTED_ACCOUNTS_JSON" \
  --timeout 180
```

Belangrijk:
- gebruik variabele `EXPECTED_ACCOUNTS_JSON` (niet `EXPECTED_ACTS_JSON`).
- voor analyse zijn de `first_account=...` regels essentieel.

## Documentatie-afspraak

Vanaf nu bij elke codewijziging:
- `WORKLOG.md` bijwerken met wat/waarom/resultaat.
- `CONTEXT_HANDOVER.md` bijwerken naar 1 actuele, niet-duplicerende waarheid.
- Verouderde informatie in `CONTEXT_HANDOVER.md` verwijderen i.p.v. extra lagen toevoegen.
- Startup-volgorde voor nieuwe sessies staat vast in `AGENTS.md` (eerst `CONTEXT_HANDOVER.md`, daarna `WORKLOG.md`).
