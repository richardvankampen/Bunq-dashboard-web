# Context Handover

Laatste update: 2026-03-01 (savings-account incident + Synology deploy les)

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
- Raw fallback faalt in runtime met:
  - `Raw Bunq monetary-account fallback failed: bunq-sdk api_client unavailable`
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
  - `_resolve_bunq_api_client(...)` probeert nu ook endpoint-module + endpoint-klassen (`MonetaryAccount*`, `PaymentApiObject`) voor client-resolutie.
  - raw-fallback foutmelding bevat uitgebreide kandidaatdiagnostiek (`candidates: ...`) i.p.v. alleen `api_client unavailable`.
  - Runtime-incidentfix: endpoint-klasse werd foutief als HTTP client gezien (`Resolved ... endpoint.MonetaryAccountApiObject.self`).
    - `_is_http_client_like(...)` sluit nu endpoint classes/objecten expliciet uit.
    - `_call_api_client_get(...)` bouwt nu dynamisch alleen calls voor beschikbare methodes (`get/request/execute`) en geeft duidelijke fout als geen van drie beschikbaar is.
  - Raw-client discovery verder verdiept:
    - accessor-probing uitgebreid met session-gerelateerde paden;
    - object-graph traversal volgt nu ook private contextvelden (`_ApiContext__*`, `_SessionContext__*`, etc.);
    - traversal-diepte verhoogd van 2 naar 3 om interne SDK context-objecten te bereiken.
  - Nieuwe fallback-laag toegevoegd:
    - SDK HTTP client wordt nu ook direct geconstrueerd vanuit `ApiContext` via bekende SDK-klassen/factories (`bunq.sdk.http.api_client*`) met signature-gebaseerde argumentmapping.

Status: incident nog open; volgende validatie richt zich op:
- of `count`-param direct extra accounts (incl. savings) teruggeeft;
- of raw-fallback nu een bruikbare client resolveert i.p.v. endpoint-class false positive / `api_client unavailable`.

## Deployment + validatie (volgende stap)

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
TAG=$(sudo git rev-parse --short HEAD)
sudo docker build --no-cache -t bunq-dashboard:$TAG -t bunq-dashboard:local .
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

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
grep -E "Using bunq endpoint class|Resolved Bunq HTTP client via|raw Bunq monetary-account fallback|Merged [0-9]+ account|Retrieved [0-9]+ accounts|MonetaryAccountSavings|api_client unavailable|candidates:|Error fetching accounts"
```

## Als savings nog steeds ontbreken
- Neem de exacte nieuwe `api_client unavailable (candidates: ...)` logregel over; die bepaalt het volgende concrete resolverpad.
- Als nog steeds geen raw client: gerichte inspectie van `BunqContext.api_context()` objectgraph in runtime-container uitvoeren en op die accessor patchen.
- Als raw client wel resolved maar nog geen savings: endpoint/pagination output per `/user/{id}/monetary-account*` pad inspecteren en fallback daarop fixeren.

## Documentatie-afspraak

Vanaf nu bij elke codewijziging:
- `WORKLOG.md` bijwerken met wat/waarom/resultaat.
- `CONTEXT_HANDOVER.md` bijwerken naar 1 actuele, niet-duplicerende waarheid.
- Verouderde informatie in `CONTEXT_HANDOVER.md` verwijderen i.p.v. extra lagen toevoegen.
- Startup-volgorde voor nieuwe sessies staat vast in `AGENTS.md` (eerst `CONTEXT_HANDOVER.md`, daarna `WORKLOG.md`).
