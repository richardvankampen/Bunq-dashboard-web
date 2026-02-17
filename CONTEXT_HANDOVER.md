# Context Handover

Laatste update: 2026-02-17 (SDK-validatie + savings/merchant parsing fixes)

## Waar we staan

- Vaultwarden-first setup blijft de voorkeursroute (`USE_VAULTWARDEN=true`).
- Dashboard draait via Synology + Docker Swarm.
- Recente fixes zijn gepusht op `main`:
  - `8d6fb66`: bunq pagination + actionable budgeting visualisaties
  - `fc30a08`: balance/merchant analytics + UI/visualisatie fixes
  - `8c8a69e`: worklog update
  - `c690891`: persistent context handover bestand

## Wat net is aangepast (samenvatting)

- Backend:
  - payment-list paginatie aangescherpt met `count` + `older_id` (SDK-compatibel).
  - cutoff-aware paging + deduplicatie toegevoegd voor stabielere transactielijsten.
  - paging tuning via `BUNQ_PAYMENT_PAGE_SIZE` en `BUNQ_PAYMENT_MAX_PAGES`.
- Frontend visualisaties:
  - `3D Time-Space Journey` vervangen door `Budget Discipline (50/30/20)`.
  - nieuwe budget-coach detailmodal (maandelijkse needs/wants/savings + targets).
  - Sankey informatiever gemaakt: income split naar essentials/discretionary + net saved/buffer.
  - Sunburst bevat nu `overig`-aggregatie (minder missende categorieën/winkels).
- Insights:
  - nieuwe KPI-kaart `50/30/20 Fit`.
  - nieuwe KPI-kaart `Next Best Action`.
  - nieuwe detailmodal `Action plan` met prioriteit + impactinschatting.
- Verdieping/finetuning daarna:
  - nieuwe KPI `Spend Volatility`.
  - nieuwe KPI `Recurring Costs` + detailmodal.
  - action-plan regels uitgebreid (multi-maand baseline, recurring costs, volatiliteit, negatieve savings).
  - accounttype/categorisatie edge-cases verbeterd (`monetary_account_type` signalen, extra MCC/keyword categorieën).

## Belangrijk voor volgende sessie

- Eerst valideren op echte NAS-data:
  - transaction paging performance en volledigheid (`/api/transactions` over langere periodes),
  - 50/30/20 grafiek en Action Plan op echte categoriepatronen,
  - Sunburst/Sankey leesbaarheid en informatiedichtheid.
- Daarna volgende P1-substap:
  - finetunen op echte gebruikersdata (drempels per categorie/merchant),
  - checken of nieuwe categorieën (`Verzekering`, `Belastingen`, `Refund`, `Rente`) goed landen in visualisaties,
  - eventuele extra deep-dives voor budgetcoach use-cases.

## Concreet vervolgstappenplan

1. NAS updaten/deployen:
   - `cd /volume1/docker/bunq-dashboard`
   - `sudo git pull`
   - `sh scripts/install_or_update_synology.sh`
2. Health + logs checken:
   - `curl -s http://127.0.0.1:5000/api/health`
   - `sudo docker service logs --since 5m bunq_bunq-dashboard | grep -E "ERROR|Warning|API key|initialized"`
3. UI-functioneel testen:
   - cards: `Spend Volatility`, `Recurring Costs`, `Next Best Action`
   - detailmodals: `Budget Discipline`, `Action plan`, `Recurring costs`
4. Datakwaliteit valideren:
   - categorisatie op nieuwe labels (`Verzekering`, `Belastingen`, `Refund`, `Rente`)
   - accounttype-classificatie (checking/savings/investment)
5. Op basis van feedback:
   - action-rules en thresholds verder bijstellen voor minder ruis en hogere relevantie.

## Handige update/deploy flow op NAS

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull
sudo docker build --no-cache -t bunq-dashboard:local .
sudo docker service update --force --image bunq-dashboard:local bunq_bunq-dashboard
```

## Log-checks

```bash
sudo docker service logs --since 5m bunq_bunq-dashboard | grep -E "Vaultwarden|API key|Bunq API|Error|initialized"
curl -s http://127.0.0.1:5000/api/health
```

## Update 2026-02-15 (whitelist flows)

- Script `scripts/register_bunq_ip.sh` is hardener gemaakt:
  - publieke IPv4 validatie,
  - non-interactive support (`NO_PROMPT=true`),
  - robuustere egress IP detectie en foutoutput.
- Dashboard knop `Set Bunq API whitelist IP` draait nu in verplichte veilige 2-staps flow:
  1. create/activate target IP zonder deactiveren van andere ACTIVE IPs,
  2. aparte confirm voor deactiveren van overige ACTIVE IPs.
- De knop toont nu expliciet een IP-prompt, met fallback op ingevuld veld of bekend egress IP.
- Relevante commits: `e1cd3b3`, `cb04bdd`.

## Update 2026-02-15 (P1 stap 1 t/m 4)

- Nieuwe real-data kwaliteitsdiagnostiek:
  - backend endpoint `GET /api/admin/data-quality`,
  - score + coverage + warnings/recommendations op basis van `transaction_cache` en `account_snapshots`.
- Dashboard heeft nieuwe doorklikbare insight `Data Quality` met detailmodal (component scores + concrete waarschuwingen).
- Action-plan regels zijn aangescherpt op:
  - inkomensdaling (rolling 30d),
  - categorie-concentratie,
  - urgente liquiditeitsrunway (<60 dagen).
- Edge-cases uitgebreid:
  - accounttype-detectie (`potje`, `stash`, `etf/equity`),
  - categorisatiekeywords voor extra NL-merchants.
- Sankey/Sunburst verfijnd voor meer informatiedichtheid:
  - Sankey link-shares en in/uit/netto annotatie,
  - Sunburst share-aware selectie (minder missende categorieën/merchants) + parent-percentage hover.

## Update 2026-02-16 (P1 finetuning vervolg)

- Action plan aangescherpt:
  - dynamische impactdrempels o.b.v. recente spend-scale (minder ruis op kleine datasets),
  - confidence-score per actie en sortering op prioriteit + confidence + impact,
  - extra rule voor structurele vaste-lasten-risico (hoog recurring share),
  - extra rule voor income-side focus als essentials structureel dominant zijn.
- `Next Best Action` kaart toont nu confidence-percentage.
- Data quality is uitgebreid met bedrag-gebaseerde dekkingen:
  - `category_amount_coverage` en `merchant_amount_coverage`,
  - nieuwe signalen: `active_transaction_days` en `dataset_span_days`.
- Data quality detailmodal toont nu extra diagnostiek:
  - actieve transactiedagen, dataspan,
  - dekkingsratio’s op zowel aantallen als uitgavenvolume.
- Relevante commit: `94e5b9d`.

## Update 2026-02-16 (P1/P2 4-stappenreeks)

- P1 real-data categorisatie verbeterd:
  - nieuwe `Abonnementen` signalen via MCC + merchant keywords.
- P1 actionable insights verfijnd:
  - nieuwe concrete cost-levers (categorie/merchant),
  - action-plan detailweergave bevat nu ook concrete `Actie`/playbook.
- P1/P2 ops-hardening scripts:
  - `scripts/register_bunq_ip.sh` gebruikt veilige 2-staps flow als `DEACTIVATE_OTHERS=true`,
  - post-run verificatie van container-egress IP tegen actieve Bunq whitelist,
  - duidelijke auto-remediatiehint bij mismatch.
  - `scripts/install_or_update_synology.sh` en `scripts/restart_bunq_service.sh` verwijzen naar dezelfde veilige flow.
- P2 production runtime:
  - Docker runtime switched naar Gunicorn (`scripts/run_server.sh` + `gunicorn` dependency),
  - backend lazy/throttled Bunq context init voor WSGI workers (`BUNQ_INIT_AUTO_ATTEMPT`, `BUNQ_INIT_RETRY_SECONDS`),
  - `/api/health` en `/api/admin/status` tonen nu expliciete Bunq-contextstatus en laatste init-fout.
- Documentatie is bijgewerkt op bovenstaande flow in:
  - `README.md`
  - `SYNOLOGY_INSTALL.md`
  - `SECURITY.md`
  - `TROUBLESHOOTING.md`

## Opslagstatus

- Wijzigingen van de 4-stappenreeks en docs staan op `main`.
- Laatste commit: `6b67696` (`Finalize P1/P2 hardening and sync installation docs`).

## Directe vervolgacties

1. NAS update/deploy:
   - `cd /volume1/docker/bunq-dashboard`
   - `sudo git pull --rebase`
   - `sh scripts/install_or_update_synology.sh`
2. Basisvalidatie:
   - `curl -s http://127.0.0.1:5000/api/health`
   - `sudo docker service logs --since 3m bunq_bunq-dashboard | grep -E "API key retrieved from vault|Bunq API initialized|Incorrect API key or IP address|No valid API key|ERROR"`
3. Alleen bij IP-whitelist mismatch:
   - `TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard`
4. Functionele check (P1):
   - Action Plan met concrete levers
   - Data Quality detail
   - Accounts + Transactions endpoints op live data

## Update 2026-02-17 (startup + Vaultwarden stabiliteit)

### Wat is gefixt

- Startup crash opgelost door log-level normalisatie in backend:
  - in `api_proxy.py` gebruikt logging nu `os.getenv('LOG_LEVEL', 'INFO').upper()`.
- Vaultwarden CLI race onder Gunicorn workers opgelost:
  - `BITWARDENCLI_APPDATA_DIR` wordt nu per process opgebouwd (`<base>-<pid>`).
- Wijzigingen staan op `main`:
  - commit `0d9f5ae` (`Harden startup log level and isolate bw CLI state per worker`).

### Huidige operationele status (NAS)

- `bunq_bunq-dashboard` service is running en healthcheck blijft groen (`/api/health` = 200).
- Runtime knobs op NAS:
  - `BUNQ_PREBOOT_INIT=false`
  - `GUNICORN_WORKERS=1`
- Geen crashloop meer (`Unknown level: 'info'` verdwenen).

### Nog open

- Bunq API context initialisatie faalt nog met:
  - `HTTP Response Code: 400`
  - `Incorrect API key or IP address`
- Gevolg: app/auth werkt, maar Bunq data endpoints kunnen `503` teruggeven tot whitelist/key matcht.

### Aanbevolen vervolgstappen (direct uitvoerbaar op NAS)

1. Container egress IP bepalen.
2. `scripts/register_bunq_ip.sh` in veilige 2-staps modus draaien op die IP:
   - stap 1: `DEACTIVATE_OTHERS=false`
   - stap 2: `DEACTIVATE_OTHERS=true`
3. Contextbestanden verwijderen (`/app/config/bunq_production.conf`, `/app/config/bunq_sandbox.conf`) en service forceren.
4. Logs valideren op `Bunq API initialized successfully` zonder `Incorrect API key or IP address`.

## Update 2026-02-17 (Bunq SDK validatie + parsingfixes)

### Wat is aangepast

- `api_proxy.py` gevalideerd tegen officiële Bunq SDK code (`https://github.com/bunq/sdk_python.git`).
- Belangrijkste technische mismatch die is opgelost:
  - `MonetaryAccountApiObject` kan wrapper-objecten teruggeven met nested varianten (`MonetaryAccountSavings`, `MonetaryAccountInvestment`, etc.).
  - Counterparty data kan nested zitten onder `MonetaryAccountReference` (`label_monetary_account`, `label_user`, `pointer`).
  - MCC (`merchant_category_code`) moet ook uit nested alias-velden gelezen worden.
- Gefixte onderdelen in backend:
  - account-unwrapping + sterkere accounttypeclassificatie voor savings/investment;
  - diepere alias traversal voor naam/IBAN extractie;
  - MCC extractie uit nested alias-structuren;
  - transaction-categorisatie gebruikt verbeterde MCC-extractie.

### Commitstatus

- Commit gepusht op `main`:
  - `acadc97` — `Fix savings classification and merchant/MCC extraction`

### Praktische verificatie op NAS

1. Build/deploy nieuwe versie:
   - `cd /volume1/docker/bunq-dashboard`
   - `sudo git pull --rebase origin main`
   - `TAG=$(date +%Y%m%d%H%M%S)`
   - `sudo docker build --build-arg BW_VERSION=2026.1.0 --build-arg BW_NPM_VERSION=2026.1.0 -t bunq-dashboard:$TAG -t bunq-dashboard:local .`
   - `sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'`
   - `sudo docker service update --image bunq-dashboard:$TAG --force bunq_bunq-dashboard`
2. Savings-classificatie valideren:
   - `curl -sS -m 10 http://127.0.0.1:5000/api/accounts | jq -r '.data[] | [.id, .description, .account_type, .account_class] | @tsv'`
3. Merchant/category output valideren:
   - `curl -sS -m 20 'http://127.0.0.1:5000/api/transactions?days=90&page=1&page_size=200&exclude_internal=true' | jq -r '.data[] | [.date, .merchant, .category, .description] | @tsv' | head -n 40`
4. Dekkingsratio in lokale transaction cache:
   - `BUNQ_CONTAINER=$(sudo docker ps --filter name=bunq_bunq-dashboard -q | head -n1)`
   - `sudo docker exec "$BUNQ_CONTAINER" python3 -c "import sqlite3; c=sqlite3.connect('/app/config/dashboard_data.db'); c.row_factory=sqlite3.Row; r=c.execute(\"SELECT COUNT(*) total, SUM(CASE WHEN merchant IS NOT NULL AND TRIM(merchant)!='' AND LOWER(TRIM(merchant)) NOT IN ('unknown','onbekend') THEN 1 ELSE 0 END) merchant_named, SUM(CASE WHEN category IS NOT NULL AND TRIM(category)!='' AND LOWER(TRIM(category)) NOT IN ('overig','unknown','onbekend') THEN 1 ELSE 0 END) categorized FROM transaction_cache\").fetchone(); print(dict(r)); c.close()"`
