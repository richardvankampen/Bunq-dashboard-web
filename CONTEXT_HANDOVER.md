# Context Handover

Laatste update: 2026-03-01 (savings-incident opgelost + SDK-first cleanup + detailtransacties in modal + docs EN/NL split + NL-taalopschoning + second-view feedback verwerkt + interne-transfer/Triodos-fix + cashflow detailview + categorie-race daganimatie + insight titels NL + negatieve-overboeking filterfix + geldstromen detail klikfix + cross-account reconcile + race fps 2 + overfilter guard inkomsten/uitgaven + deterministische internal detectie op account-id/IBAN)

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
- Operationele markdown-instructies zijn gesynchroniseerd op de huidige updateflow:
  - `git pull` voorbeelden gebruiken nu `sudo git pull --rebase origin main`;
  - README EN/NL bevatten nu ook expliciet quick code-only redeploy (`scripts/quick_redeploy.sh`);
  - troubleshooting/synology NL voorbeelden voor full deploy gebruiken `.env`-load + `docker service update --force --image bunq-dashboard:$TAG ...` in dezelfde shell.

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
  - `Tegenrekening / merchant + rekeningnummer` (IBAN of account-id indien beschikbaar)
  - `Omschrijving`
  - `Bedrag`
- KPI-afstemming:
  - `Sparen` gebruikt nu dezelfde datasetlogica als de secondary view `Spaarrekening mutaties` (stortingen minus opnames), inclusief negatieve bedragen.
  - `Savings Rate` wordt nu ook afgeleid van diezelfde gecorrigeerde `Sparen`-netto (i.p.v. oude netto-spaarbenadering).
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
  - backend markeert internal transfers primair op deterministische signalen: eigen account-id en eigen IBAN (afgeleid uit de volledige opgehaalde Bunq-rekeninglijst).
  - linked external accounts (zoals Triodos `MonetaryAccountExternal`) tellen expliciet niet als intern; Bunq `ExternalSavings` blijft wel intern.
  - backend detectie leest geneste alias-account-id (`extract_alias_account_id`) plus IBANs uit `counterparty_alias`, `monetary_account_counterparty` en `merchant_reference`.
  - backend draait daarnaast een cross-account reconcile-pass (`reconcile_internal_transfers`) over alle opgehaalde transacties:
    - pass 1: match op `payment-id + minute + amount + currency` met plus/min-tegenboeking op verschillende eigen Bunq-rekeningen.
  - overfilter-correctie (inkomsten/uitgaven op 0 voorkomen):
    - deterministische account-id-match markeert alleen intern als `counterparty_account_id` een eigen Bunq-account is én verschilt van de bronrekening (`account_id`);
    - reconcile pass 1 gebruikt nu ook minuut-timestamp in de key (`payment-id + minute + amount + currency`) om false matches tussen ongerelateerde transacties te voorkomen.
  - `/api/accounts` levert `ibans` per rekening zodat ook frontend-fallback op rekeningnummer kan matchen.
  - deze detectie wordt toegepast in zowel `/api/transactions` als `/api/statistics`.
  - frontend bevat alleen nog deterministische fallback-filtering op tegenrekening-account-id en tegenrekening-IBAN.
  - frontend account-id fallback respecteert nu ook bronrekening-id (zelfde account-id wordt niet automatisch intern weggefilterd).
  - balanswidgets voor betaal/spaar gebruiken nu alleen eigen Bunq-rekeningen (Triodos valt buiten `Betaalrekeningen (totaal)`).
  - widgetspecifiek:
    - `Top tegenrekeningen` en `Verdeling in categorieën` filteren nu ook expliciet interne/eigen tegenrekeningen weg op account-id, IBAN en eigen Bunq-rekeningnaam (zodat o.a. `Richard` niet meer verschijnt).

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
  - tooltip op insight-kaarten staat nu op de hele tegel (`.insight-card`), niet alleen op de `h4`-titel.
  - tooltips zijn nu ook statisch in de HTML op elke inzichttegel gezet (`title` op elk `.insight-card`) en daarnaast als custom CSS-tooltip (`data-tooltip`) gerenderd voor consistente hover-weergave in browsers die `title` op `div` beperkt tonen.
- `Geldstromen` samenvattingstekst (`In · Uit · Netto`) staat nu als HTML-balk boven de Sankey i.p.v. als Plotly-annotatie; dit voorkomt render-artifacts in fullscreen (tekst werd een dunne onleesbare lijn).
- Op `Cashflow (tijdslijn)` is de downloadknop verwijderd; detailview opent via de detailactieknop.
- `Top tegenrekeningen` en `Categorie-race` gebruiken nu transparante Plotly-plotachtergrond (`plot_bgcolor`) zodat geen witte chart-achtergrond meer zichtbaar is binnen de tegel.
- `Budget discipline` en `Categorie-race` gebruiken nu dezelfde standaard tegelrand als andere widgets (featured-card rand verwijderd).
- Safari hover-fix inzichttegels:
  - JS-gestuurde floating tooltip toegevoegd (`.insight-hover-tooltip`) die op `mouseenter/focus` op inzichttegels toont.
  - oude native `title` mouse-overs op inzichttegels worden nu runtime verwijderd, zodat alleen de nieuwe custom tooltip zichtbaar is.
  - CSS pseudo-tooltips worden automatisch uitgeschakeld wanneer JS-tooltip actief is (`body.js-insight-tooltips`) om dubbele tooltips te voorkomen.
  - tooltip volgt nu de cursor en wordt net onder de muis getoond (met viewport fallback boven de cursor indien nodig).
  - floating tooltip heeft nu een lichtere glass-tint met subtiele magenta-accenten voor betere zichtbaarheid.
  - doel: ook in Safari (maximized/fullscreen) consistente tooltipweergave.

## Detailmodal styling (actueel)

- `Action plan` detail gebruikt nu een gestapelde rijweergave voor tekstregels (`balance-detail-list-stacked`) zodat kopteksten/inhoud horizontaal leesbaar blijven (geen verticaal “ingedrukte” tekstblokken).

## Header UX (actueel)

- Op het bewegende Bunq-icoon naast `Bunq Financial Dashboard` staat nu een hover/focus popover met klikbare support-link:
  - tekst: `buy me a coffee if you enjoy using this dashboard`
  - URL: `https://bunq.me/BunqFinancialDashboard`
  - opent in nieuw tabblad (`target="_blank"` + `rel="noopener noreferrer"`).

## Settings UX (actueel)

- Instelling `Enable background particles` is visueel opgewaardeerd naar een prominente feature-togglekaart met:
  - heldere glass gradient (cyan/magenta accenten),
  - badge + titel + korte uitleg,
  - custom switch met glow/pulse-animatie wanneer actief.
- Technisch blijft dezelfde instelling behouden (`id="enableParticles"`), dus bestaande save/load logica in `app.js` is ongewijzigd.

## Categorie-race (actueel)

- Widgetnaam is `Categorie-race`.
- Raceframes zijn nu dag-gebaseerd (i.p.v. maand-gebaseerd), met cumulatieve uitgaven per categorie per dag.
- Playback draait op `2 fps` (`RACING_ANIMATION_FPS=2`), zodat ~90 dagen ongeveer 45 seconden animatie geven.
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
