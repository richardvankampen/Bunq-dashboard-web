# Worklog

Dit bestand houdt een compacte voortgangshistorie bij, zodat chatcontextverlies geen impact heeft.

## 2026-02-13

### Opgeleverd

- Vaultwarden-first flow verder uitgewerkt en gestabiliseerd.
- Vaultwarden CLI decrypt flow toegevoegd als primaire methode voor Bunq API key retrieval.
- Validatie en onderhoud rond Bunq IP allowlist toegevoegd.
- Admin maintenance endpoints en UI-acties toegevoegd:
  - status check
  - egress IP check
  - Bunq context reinitialize
  - whitelist update
  - bundled maintenance run
- Inputvalidatie aangescherpt (publiek IPv4 voor whitelist-target).
- Restart-/updateflows robuuster gemaakt via scripts.
- Documentatie bijgewerkt voor scripts en maintenance flow.
- Terminal helper-buttons toegevoegd in admin panel.

### Relevante commits (nieuw → oud)

- `2dd7725` Add admin panel terminal-command helper buttons
- `b5b737f` Add conservative Synology install/update helper script
- `d1a368c` Validate whitelist target as public IPv4 in UI and backend
- `37c8b89` Make admin maintenance always whitelist with manual-or-auto target IP
- `030d333` Set admin maintenance refresh-key default to off
- `62bf80b` Add admin panel bundled maintenance with configurable defaults
- `7165844` Auto-tag restart script and prune old bunq-dashboard images
- `d4d4094` Harden restart script for missing/failed image updates
- `d48cff0` Fix Bitwarden CLI checksum lookup for bw zip
- `71d6c20` Add Bunq allowlist API automation and admin whitelist action
- `f34900e` Document and script image-tagged restart validation flow
- `7aac535` Add restart validation script and document admin restart checks
- `43cd79d` Suppress debconf frontend warnings during Docker build
- `a52aebb` Support arm64 by using npm fallback for bw CLI
- `3c377f0` Use native pinned bw binary instead of Node/NPM

## Huidige status (samenvatting)

- Preferred secret-flow: `USE_VAULTWARDEN=true`.
- Directe `bunq_api_key` flow blijft fallback-only.
- Session auth actief; secure cookie instelling en CORS-checks aanwezig.
- P1 admin maintenance tooling staat in code en UI.

## Openstaande focus

- Doorgaan met volgende P1-substap voor dashboard/functionele verbeteringen op basis van jouw feedback.

## 2026-02-14

### Opgeleverd

- Build/install flow sneller en flexibeler gemaakt:
  - `scripts/install_or_update_synology.sh` vraagt nu interactief naar `--no-cache`.
  - Nieuwe override: `NO_CACHE=true|false`.
- Dockerfile robuuster gemaakt voor Bitwarden CLI installatie:
  - eerst native binary (main/oss),
  - automatische npm fallback als release/checksum tijdelijk ontbreekt.
- P1 dashboard-insights uitgebreid met advisor-achtige metrics:
  - `Liquidity Runway`
  - `Needs vs Wants`
  - `Top Merchant Share`
  - `Projected Monthly Net`
- Nieuwe deep-dives via bestaande detailmodal:
  - expense momentum (`30d` vs vorige `30d`)
  - needs-vs-wants breakdown
  - merchant concentration
- Money Flow kaart zelf is nu ook klikbaar voor detailweergave (niet alleen via action button).

### Aanvullend opgeleverd (late update)

- Dashboardvisualisatie en UX verbeterd:
  - `Cashflow Timeline` downloadknop werkt nu (PNG export).
  - KPI mini-charts tonen nu assen (X/Y) voor `Total Income`, `Total Expenses`, `Net Savings`.
  - Betaal-/spaar-KPI kaarten tonen altijd een mini-chart (ook bij weinig datapunten).
  - Balans-detailmodal is breder gemaakt, viewport-safe en beter leesbaar.
  - Rekeninglijst in balans-detail staat nu alfabetisch i.p.v. op saldo.
  - `Day Pattern` vereenvoudigd naar duidelijke dagdelen.
- Datakwaliteit verbeterd voor categorieën/merchants:
  - Merchant fallback gebruikt nu ook `counterparty`/`description` voor betere dekking.
  - Sunburst en Top Merchants tonen hierdoor meer complete data.
  - Category race verhoogd naar meer zichtbare categorieën.
- Savings/FX nauwkeurigheid verbeterd:
  - Backend gebruikt waar mogelijk Bunq `balance_converted` (EUR) vóór eigen FX-fallback.
  - Accountclassificatie uitgebreid (o.a. `spaarrekening`, `onvoorzien`) voor betere savings-detectie.
  - Categorisatie uitgebreid met MCC fallback en extra NL-merchantregels.

### Relevante commit

- `fc30a08` Fix balance/merchant analytics and dashboard interaction issues

### Aanvullend opgeleverd (P1 - actionable visualisaties)

- Bunq transactiepaginatie robuuster gemaakt in backend:
  - `api_proxy.py` gebruikt nu expliciet `count` en `older_id` voor payment-lijsten.
  - paging stopt slim op `cutoff_date`, met deduplicatie en veilige fallback over SDK-varianten.
  - nieuwe env-tuning: `BUNQ_PAYMENT_PAGE_SIZE` (max 200) en `BUNQ_PAYMENT_MAX_PAGES`.
- Dashboardvisualisaties meer coachend en actiegericht gemaakt:
  - `3D Time-Space Journey` vervangen door `Budget Discipline (50/30/20)`.
  - nieuwe budgetdetail-modal met maandvergelijkingen (needs/wants/savings + income/net).
  - Sankey herschikt naar `Cash In -> Essentials/Discretionary -> categorieën + Net Saved/Buffer`.
  - Sunburst uitgebreid met `overig`-aggregatie op categorie- en merchantniveau zodat minder data wegvalt.
- Insights uitgebreid met direct bruikbare sturing:
  - nieuwe kaarten `50/30/20 Fit` en `Next Best Action`.
  - nieuwe detailweergave `Action plan` met geprioriteerde acties en geschatte impact.

### Relevante commit

- `8d6fb66` Improve bunq pagination and actionable budgeting views

### Aanvullende P1 verfijning (metrics + edge-cases)

- Insights verder verdiept:
  - `Spend Volatility` toegevoegd (coëfficiënt van variatie op dagelijkse uitgaven).
  - `Recurring Costs` toegevoegd met geschatte maandlast op basis van terugkerende merchants.
  - `Next Best Action` verfijnd met meer business rules en impactdrempels.
- Nieuwe deep-dive:
  - `Recurring costs` detailmodal met prioritering op gemiddelde maandlast en stabiliteit.
- Action-plan tuning:
  - baseline op meerdere maanden i.p.v. één maand.
  - extra regels voor recurring spend, volatiliteit en negatieve savings-maand.
  - deduplicatie en beperking op aantal acties om ruis te reduceren.
- Backend edge-cases verbeterd:
  - accounttype-classificatie gebruikt nu expliciete typevelden (`monetary_account_type`, profile/setting type).
  - categorie-indeling uitgebreid met `Verzekering`, `Belastingen`, `Refund`, `Rente`.
  - MCC-mapping en keywordregels aangescherpt; categorisatie ontvangt nu ook transactie-`amount`.

### Relevante commit

- `cc73d56` Deepen budgeting metrics and harden categorization edge cases

## 2026-02-15

### Opgeleverd

- Whitelist helper script robuuster gemaakt (`scripts/register_bunq_ip.sh`):
  - multi-source egress IP detectie,
  - publieke IPv4 validatie voor `TARGET_IP`,
  - non-interactive run met `NO_PROMPT=true`,
  - duidelijkere foutoutput bij whitelist failures.
- Auto-whitelist startup-noise afgezwakt in backend:
  - SDK-variant zonder credential-password endpoints logt nu warning i.p.v. error-noise.
- Dashboard admin knop `Set Bunq API whitelist IP` aangepast naar veilige vaste 2-staps flow:
  1. IP toevoegen/activeren zonder andere IPs te deactiveren,
  2. expliciete confirm voor deactiveren van overige ACTIVE IPs.
- Voor deze knop is nu ook een expliciete IP prompt toegevoegd (met fallback op ingevulde/suggested egress IP).

### Relevante commits

- `cb04bdd` Run whitelist button in safe two-step flow with IP prompt
- `e1cd3b3` Harden whitelist helper script and downgrade auto-whitelist noise

### Aanvullende P1-uitwerking (stap 1 t/m 4)

- Real-data validatie toegevoegd:
  - nieuwe backend endpoint `GET /api/admin/data-quality` met kwaliteitscore, dekking, warnings en aanbevelingen op basis van lokale history store.
  - nieuwe dashboard insight `Data Quality` met doorklikbare detailmodal en component-score grafiek.
- Actionable metrics verder verfijnd:
  - `Next Best Action` gebruikt nu ook inkomensdaling (30d vs prior 30d), categorie-concentratie en urgente runway-signalen (<60 dagen).
  - top-actie toont nu prioriteit expliciet (`P1/P2/P3`).
- Edge-cases verder gehard:
  - accounttype-herkenning uitgebreid (o.a. `potje`, `stash`, `etf/equity` signalen).
  - categorisatie uitgebreid met extra NL merchants/keywords (boodschappen, vervoer, utilities, shopping, entertainment, zorg).
- Visualisaties informatiever gemaakt:
  - Sankey bevat nu link-aandelen (% van bron) in hover + totaalannotatie (in/uit/netto).
  - Sunburst toont meer categorieën/merchants met share-aware selectie en duidelijke parent-percentage hover.

## 2026-02-16

### Aanvullende P1-finetuning (actionability + datakwaliteit)

- Action plan verfijnd met dynamische impactdrempels en confidence-score per actie.
- `Next Best Action` toont nu confidence naast prioriteit/impact.
- Nieuwe action rules toegevoegd:
  - structurele vaste-lasten-risico (hoog aandeel recurring costs),
  - income-side focus wanneer essentials structureel dominant zijn.
- Data quality uitgebreid met bedrag-gedreven dekking:
  - category coverage op aantallen én op uitgavenvolume,
  - merchant coverage op aantallen én op uitgavenvolume.
- Data quality gebruikt nu ook dagdekking/datasetspan signalen in warnings/recommendations.
- Data quality detailmodal uitgebreid met actieve transactiedagen, dataspan en bedrag-gebaseerde dekkingsregels.

### Relevante commit

- `94e5b9d` Refine P1 action plan scoring and data-quality diagnostics

### Aanvullende P1/P2 batch (4-stappenreeks)

- P1 real-data/actionability uitgebreid:
  - nieuwe categorie `Abonnementen` (MCC + merchant keyword mapping),
  - verbeterde merchant/category signalen voor NL data.
- P1 actionable recommendations verdiept:
  - concrete cost-levers per categorie/merchant,
  - action-plan regels tonen nu ook praktisch `Actie`/playbook in de detailmodal.
- P1/P2 operations hardening:
  - `scripts/register_bunq_ip.sh` ondersteunt nu standaard veilige 2-staps whitelist-flow (`SAFE_TWO_STEP=true`),
  - extra egress-vs-whitelist verificatie met duidelijke mismatch-remediatie,
  - install/restart scripts gebruiken dezelfde veilige flow-parameters.
- P2 runtime hardening:
  - container draait nu op Gunicorn i.p.v. Flask dev server,
  - `scripts/run_server.sh` toegevoegd als production launcher,
  - backend kreeg lazy/throttled Bunq init guard voor WSGI workers.
- Documentatie bijgewerkt:
  - `README.md`, `SYNOLOGY_INSTALL.md`, `SECURITY.md`, `TROUBLESHOOTING.md`.

### Opslagstatus

- Alle bovenstaande wijzigingen zijn vastgelegd op `main`.
- Laatste commit: `6b67696` (`Finalize P1/P2 hardening and sync installation docs`).

### Vervolgacties (volgende run op NAS)

1. Update en deploy op NAS:
   - `cd /volume1/docker/bunq-dashboard`
   - `sudo git pull --rebase`
   - `sh scripts/install_or_update_synology.sh`
2. Runtime valideren:
   - `curl -s http://127.0.0.1:5000/api/health`
   - `sudo docker service logs --since 3m bunq_bunq-dashboard | grep -E "API key retrieved from vault|Bunq API initialized|Incorrect API key or IP address|No valid API key|ERROR"`
3. Alleen bij Bunq IP mismatch:
   - `TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard`
4. Daarna P1 functionele validatie in UI:
   - Data Quality kaart + detailmodal
   - Action Plan concrete levers
   - Accounts/Transactions flow op live data

## 2026-02-17

### Incidentfixes (startup en Vaultwarden-CLI stabiliteit)

- Root cause crashloop gefixt:
  - app faalde op `ValueError: Unknown level: 'info'` tijdens import in `api_proxy.py`.
  - fix: `LOG_LEVEL` normaliseren via `os.getenv('LOG_LEVEL', 'INFO').upper()`.
- Vaultwarden CLI race-condition onder Gunicorn workers gefixt:
  - Bitwarden CLI appdata nu per worker-proces (`.../bwcli-dashboard-<pid>`), zodat sessiestate niet gedeeld wordt tussen workers.
- Commit en push:
  - `0d9f5ae` — `Harden startup log level and isolate bw CLI state per worker`.

### NAS runtime status (na deploy)

- Service convergeert en blijft draaien op Gunicorn.
- `/api/health` geeft stabiel `200`.
- `BUNQ_PREBOOT_INIT=false` en `GUNICORN_WORKERS=1` gebruikt op NAS om startup stabiel te houden.

### Openstaand operationeel issue

- Bunq-context init faalt nog op live environment met:
  - `HTTP Response Code: 400`
  - `Error message: User credentials are incorrect. Incorrect API key or IP address.`
- Gevolg: app is gezond, maar Bunq-data endpoints kunnen `503` geven zolang key/IP-whitelist niet matcht.

### Volgende concrete stappen op NAS

1. Bepaal actuele container-egress IP.
2. Run veilige 2-staps whitelist-flow met die IP:
   - eerst `DEACTIVATE_OTHERS=false`,
   - daarna `DEACTIVATE_OTHERS=true`.
3. Verwijder Bunq context files en force service restart.
4. Valideer logs op `Bunq API initialized successfully` (zonder `Incorrect API key or IP address`).

### SDK-validatie en datakwaliteit fixes (savings + merchant/category)

- `api_proxy.py` gevalideerd tegen officiële Bunq Python SDK broncode (`bunq/sdk_python`):
  - `MonetaryAccountApiObject` kan concrete varianten wrappen (`MonetaryAccountSavings`, `MonetaryAccountInvestment`, etc.).
  - `PaymentApiObject` gebruikt `counterparty_alias` via `MonetaryAccountReference`, vaak met nested label/pointer structuur.
  - `LabelMonetaryAccountObject` en `MasterCardActionApiObject` bevatten MCC-signalen (`merchant_category_code`) die voor categorisatie gebruikt moeten worden.
- Backend verbeteringen doorgevoerd:
  - account-unwrapping voor wrapped `MonetaryAccount` varianten;
  - robuustere savings/investment classificatie via embedded type hints + modelvelden;
  - diepere alias traversal voor counterparty/IBAN/merchant-data;
  - MCC extractie uit nested alias-structuur.
- Resultaat:
  - savings-accounts worden consistenter als `savings` herkend;
  - merchant labels en categorieën krijgen betere dekking door correctere alias/MCC parsing.
- Commit en push:
  - `acadc97` — `Fix savings classification and merchant/MCC extraction`.

### Verificatie op NAS (na deploy)

1. Bouw/deploy:
   - `cd /volume1/docker/bunq-dashboard`
   - `sudo git pull --rebase origin main`
   - `TAG=$(date +%Y%m%d%H%M%S)`
   - `sudo docker build --build-arg BW_VERSION=2026.1.0 --build-arg BW_NPM_VERSION=2026.1.0 -t bunq-dashboard:$TAG -t bunq-dashboard:local .`
   - `sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'`
   - `sudo docker service update --image bunq-dashboard:$TAG --force bunq_bunq-dashboard`
2. Savings-account classificatie checken:
   - `curl -sS -m 10 http://127.0.0.1:5000/api/accounts | jq -r '.data[] | [.id, .description, .account_type, .account_class] | @tsv'`
3. Merchant/category output checken:
   - `curl -sS -m 20 'http://127.0.0.1:5000/api/transactions?days=90&page=1&page_size=200&exclude_internal=true' | jq -r '.data[] | [.date, .merchant, .category, .description] | @tsv' | head -n 40`
4. Datadekking direct uit lokale history DB:
   - `BUNQ_CONTAINER=$(sudo docker ps --filter name=bunq_bunq-dashboard -q | head -n1)`
   - `sudo docker exec "$BUNQ_CONTAINER" python3 -c "import sqlite3; c=sqlite3.connect('/app/config/dashboard_data.db'); c.row_factory=sqlite3.Row; r=c.execute(\"SELECT COUNT(*) total, SUM(CASE WHEN merchant IS NOT NULL AND TRIM(merchant)!='' AND LOWER(TRIM(merchant)) NOT IN ('unknown','onbekend') THEN 1 ELSE 0 END) merchant_named, SUM(CASE WHEN category IS NOT NULL AND TRIM(category)!='' AND LOWER(TRIM(category)) NOT IN ('overig','unknown','onbekend') THEN 1 ELSE 0 END) categorized FROM transaction_cache\").fetchone(); print(dict(r)); c.close()"`
