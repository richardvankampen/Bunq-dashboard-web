# Context Handover

Laatste update: 2026-03-01 (savings-incident opgelost + SDK-first cleanup + detailtransacties in modal + docs EN/NL split + NL-taalopschoning + second-view feedback verwerkt + interne-transfer/Triodos-fix + cashflow detailview + categorie-race daganimatie + insight titels NL + negatieve-overboeking filterfix + geldstromen detail klikfix + cross-account reconcile)

## Canonieke status

Dit bestand is de actuele bron voor overdracht.
- Informatie staat hier bewust maar 1x.
- Verouderde aannames zijn verwijderd.

## Productiestatus (bevestigd)

- Vaultwarden-first werkt (`USE_VAULTWARDEN=true`).
- Bunq context init werkt op productie.
- Session-auth met secure cookies werkt.
- Dashboard draait via Synology + Docker Swarm + Gunicorn.

## Documentatie-talen (actueel)

- User-facing docs hebben nu een Engelse hoofdversie (`*.md`) en een Nederlandse variant (`*-NL.md`).
- Nederlandstalige docs zijn taalkundig opgeschoond op onnodig Engels in koppen en uitlegzinnen (technische termen behouden waar logisch).
- Huidige mapping:
  - `README.md` (EN) / `README-NL.md` (NL)
  - `SECURITY.md` (EN) / `SECURITY-NL.md` (NL)
  - `SYNOLOGY_INSTALL.md` (EN) / `SYNOLOGY_INSTALL-NL.md` (NL)
  - `TROUBLESHOOTING.md` (EN) / `TROUBLESHOOTING-NL.md` (NL)
- `README.md` bevat expliciete taalkeuze zodat gebruikers EN/NL direct kunnen kiezen.
- Korte release-samenvatting voor docs-updates is nu tweetalig beschikbaar:
  - `RELEASE_NOTES.md` (EN)
  - `RELEASE_NOTES-NL.md` (NL)

## Frontend detailweergave (actueel)

- In de bestaande detailmodal staat nu een tweede sectie met individuele transacties.
- Deze sectie is aangesloten voor:
  - `Inkomsten`
  - `Uitgaven`
  - `Spaarrekening mutaties`
  - `Cashflow (tijdslijn)`
  - `Needs vs Wants`
  - `Merchant concentration`
  - `Expense momentum` (laatste 30 dagen)
  - `Money Flow`
- Kolommen in de transactieview:
  - `Datum`
  - `Tijd`
  - `Eigen Bunq rekening`
  - `Tegenrekening / merchant`
  - `Omschrijving`
  - `Bedrag`
- Performance/UX:
  - dubbele oude individuele opsomming verwijderd bij detailviews met second-view transactietabel (geen dubbeling meer).
  - modal rendert transacties in batches (`Toon meer`) i.p.v. alles in 1 keer om UI-lag bij grote periodes te beperken.
  - client-side zoekveld toegevoegd (eigen rekening, merchant/tegenrekening, omschrijving, datum, bedrag).
  - client-side sortering toegevoegd (datum, bedrag, naam).
  - `Money Flow` detail ondersteunt klikbare categorie-rijen met gefilterde transactietabel en standaard ingeklapte sectie `Alle transacties in de periode`.
  - geldstromen-detail klikhandler is robuust gemaakt voor browservarianten waar `event.target` geen direct `Element` is.
  - tekst `Alle transacties in de periode` staat nu alleen in het bovenste categoriepaneel; de tabelsectie onderin gebruikt neutrale titel `Transacties (...)`.

## Internal transfer filtering (actueel)

- `exclude_internal=true` filtering is aangescherpt:
  - backend markeert internal transfers lijst-gebaseerd op eigen account-id/IBAN/naam (afgeleid uit de volledige opgehaalde Bunq-rekeninglijst).
  - linked external accounts (zoals Triodos `MonetaryAccountExternal`) tellen expliciet niet als intern; Bunq `ExternalSavings` blijft wel intern.
  - backend detectie leest nu ook geneste alias-account-id (`extract_alias_account_id`) en gebruikt een extra description-match fallback op eigen Bunq-rekeningnamen voor edge-cases zonder bruikbare alias/IBAN metadata.
  - backend draait daarnaast een cross-account reconcile-pass (`reconcile_internal_transfers`) over alle opgehaalde transacties:
    - pass 1: match op payment-id + amount/currency met plus/min-tegenboeking op verschillende eigen Bunq-rekeningen;
    - pass 2: fallback op minuut-timestamp + abs(amount) + description/counterparty-signature met plus/min-tegenboeking.
    - doel: negatieve interne afschrijvingen zonder complete counterparty metadata alsnog als intern markeren.
  - deze detectie wordt toegepast in zowel `/api/transactions` als `/api/statistics`.
  - frontend bevat extra fallback-filtering op tegenrekening-account-id, tegenrekening/merchant-naam en omschrijving-match vs eigen Bunq-rekeningen wanneer backend-flagging in een runtimevariant onvolledig is.
  - balanswidgets voor betaal/spaar gebruiken nu alleen eigen Bunq-rekeningen (Triodos valt buiten `Betaalrekeningen (totaal)`).

## Widgetteksten (actueel)

- KPI labels:
  - `Inkomsten`
  - `Uitgaven`
  - `Sparen`
- Visualisatie labels:
  - `Cashflow (tijdslijn)`
  - `Geldstromen`
  - `Verdeling in categorieën`
- Kleine widgets onder de race-sectie zijn vertaald:
  - `Dagpatroon`
  - `Top tegenrekeningen`
  - `Maandverdeling`
- Bovenstaande widgettitels hebben korte hover-uitleg (native tooltip via `title`).
- Insights-kaarten (o.a. `Terugkerende kosten`, `Volgende beste actie`, `Datakwaliteit`) zijn ook vertaald naar Nederlands en voorzien van korte hover-uitleg.
- Op `Cashflow (tijdslijn)` is de downloadknop verwijderd; detailview opent via de detailactieknop.

## Categorie-race (actueel)

- Widgetnaam is `Categorie-race`.
- Raceframes zijn nu dag-gebaseerd (i.p.v. maand-gebaseerd), met cumulatieve uitgaven per categorie per dag.
- Playback draait op `10 fps` (`RACING_ANIMATION_FPS=10`), zodat ~90 dagen ongeveer 9 seconden animatie geven.
- Slider/label tonen dagframes (datum) in plaats van maandlabels.

## Savings-incident status

Status: opgelost op 2026-03-01.

Live validatie:
- `scripts/check_accounts_api.py` geeft nu `Validation OK`.
- `/api/accounts` bevat beide savings-accounts:
  - `Spaarrekening` (`EUR`)
  - `Spaargeld in ZAR` (`ZAR`)

## Root cause (bevestigd)

- In deze runtime faalde SDK-deserialisatie op savings objecten (`float(None)`).
- Raw responses bevatten wel savings-data, maar payload zat in `BunqResponseRaw` velden die niet volledig werden uitgelezen.

## Huidige implementatie (bewust SDK-first)

Bronleidraad: officiële Bunq SDK/API documentatie.

1. SDK-first accountophaalpad:
- `MonetaryAccountApiObject` / `MonetaryAccount`
- `MonetaryAccountSavingsApiObject` / `MonetaryAccountSavings`
- `MonetaryAccountExternalSavingsApiObject` / `MonetaryAccountExternalSavings`
- efficiëntie-optimalisatie: als het canonieke unified endpoint al savings bevat, stopt verdere subtype-probing vroegtijdig.

2. Minimalistische raw fallback (alleen bij SDK parse issues):
- uitsluitend gedocumenteerde user-routes:
  - `/user/{user_id}/monetary-account`
  - `/user/{user_id}/monetary-account-savings`
  - `/user/{user_id}/monetary-account-external-savings`
- beperkte params:
  - `{'status': 'ACTIVE', 'count': <page_size>}`
  - `{'count': <page_size>}`
- brede route-matrix/probe-combinaties zijn verwijderd.
- raw fallback merge draait nu alleen wanneer SDK-resultaat geen savings bevat.

3. Raw payload extractor:
- ondersteunt nu `BunqResponseRaw` accessors (`get_*`) en private `__dict__` payloadvelden.
- ondersteunt `Response[]` én single-object payloads plus nested `value/data/result`.

4. API robustness:
- `parse_pagination()` is gehard tegen ongeldige/negatieve querywaarden en voorkomt 500s door `int(...)` parsefouten.

## Deploystrategie op Synology

Snelle loop voor codewijzigingen (zonder stack deploy):

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

Gebruik volledige stack deploy alleen bij wijzigingen aan:
- `.env`
- `docker-compose.yml`
- secrets/netwerk/deploy-config

Volledige deploy:

```bash
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

Belangrijk:
- install/update op Synology altijd als root uitvoeren:
  - `sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh`

## Validatiecommando's (actueel)

Savings-check:

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

Raw debug (alleen indien nodig):

```bash
sudo sh scripts/debug_raw_monetary_accounts.sh bunq_bunq-dashboard 0 | tee /tmp/monetary_debug.log
grep -E "^(attempt_count=|== /user/|parsed_accounts=|first_account=|result_type=|probe_|error=)" /tmp/monetary_debug.log
```

## Als regressie terugkomt

1. Eerst `check_accounts_api.py` draaien (zelfde expected JSON).
2. Daarna `debug_raw_monetary_accounts.sh` voor endpoint/result-type bewijs.
3. Alleen patchen op basis van officiële SDK/API routes en response-structuur.

## Documentatie-afspraak

Bij elke codewijziging:
- `WORKLOG.md` bijwerken met wat/waarom/resultaat.
- `CONTEXT_HANDOVER.md` actueel houden.
