# Context Handover

Laatste update: 2026-02-28 (savings-account incident)

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

## Wat recent is aangepast (code)

Doel: savings-account discovery robuuster maken bij SDK-variantfouten.

- `e9da54c` - savings-classificatie verbeterd (backend + frontend).
- `adb96f0` - monetary-account endpoint discovery + list modes verbreed.
- `dcc7bb7` - retry met `status=ACTIVE` modes toegevoegd.
- `6909e51` - raw monetary-account fallback toegevoegd bij SDK parse failures.
- `223396f` - api-client resolutie verbreed voor raw fallback (`BunqContext`/`ApiContext` varianten).
- `948a564` - meerdere Bunq user IDs detecteren en per user account-enumeratie proberen.

Status: laatste fix (`948a564`) moet nog op NAS bevestigd worden in runtime-logs/resultaten.

## Deployment + validatie (volgende stap)

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
TAG=$(sudo git rev-parse --short HEAD)
sudo docker build --no-cache -t bunq-dashboard:$TAG -t bunq-dashboard:local .
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

Controle 1 (nieuwe runtime-code aanwezig):

```bash
BUNQ_CONTAINER=$(sudo docker ps --filter name=bunq_bunq-dashboard -q | head -n1)
sudo docker exec "$BUNQ_CONTAINER" sh -c "grep -n 'discover_bunq_user_ids' /app/api_proxy.py"
```

Controle 2 (accounts + logs):

```bash
curl -sS -k -b "$COOKIE_JAR" "$BASE_URL/api/accounts?_ts=$(date +%s)" | jq -r '
(.data // [])[]
| [.id, .description, .account_class, .account_type, (.monetary_account_type // ""), (.balance.value|tostring), .balance.currency] | @tsv'
```

```bash
sudo docker service logs --since 5m bunq_bunq-dashboard | \
grep -E "Using bunq endpoint class|raw Bunq monetary-account fallback|Merged [0-9]+ account|Retrieved [0-9]+ accounts|MonetaryAccountSavings|Error fetching accounts"
```

## Als savings nog steeds ontbreken

Doe een gerichte raw inspectie per Bunq user-id en endpoint in de container (volgende debug-stap). Doel: exact vaststellen op welk `/user/{id}/monetary-account*` pad de twee spaarrekeningen terugkomen, zodat fallback daarop gefixeerd kan worden.

## Documentatie-afspraak

Vanaf nu bij elke codewijziging:
- `WORKLOG.md` bijwerken met wat/waarom/resultaat.
- `CONTEXT_HANDOVER.md` bijwerken naar 1 actuele, niet-duplicerende waarheid.
- Verouderde informatie in `CONTEXT_HANDOVER.md` verwijderen i.p.v. extra lagen toevoegen.
