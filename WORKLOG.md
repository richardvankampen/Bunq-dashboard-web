# Worklog

Dit bestand houdt een compacte voortgangshistorie bij, zodat chatcontextverlies geen impact heeft.

## 2026-03-01

### Opgeleverd

- SDK-first cleanup na succesvolle live validatie:
  - savings-ophaalpad nu expliciet gebaseerd op officiële Bunq SDK endpoints:
    - `MonetaryAccount(ApiObject)`
    - `MonetaryAccountSavings(ApiObject)`
    - `MonetaryAccountExternalSavings(ApiObject)`
  - brede endpoint-discovery/probe-logica voor monetary accounts verwijderd.
- Kritische correctness/performance fixes in `api_proxy.py`:
  - `parse_pagination()` is nu robuust tegen ongeldige/negatieve querywaarden (`limit/page/page_size/offset`) en voorkomt 500s op `int(...)` parsefouten.
  - `list_monetary_accounts()` stopt nu eerder wanneer het canonieke unified endpoint al savings bevat (minder onnodige endpoint-calls).
  - raw savings fallback wordt nu alleen nog gestart als SDK-resultaat daadwerkelijk geen savings bevat (niet meer bij elke partiële endpoint-fout).
  - mode-fallback in `list_monetary_accounts()` is explicieter gemaakt (`mode_signature_error`) voor leesbaarheid en onderhoudbaarheid.
- Raw fallback sterk vereenvoudigd:
  - routeplan teruggebracht naar alleen gedocumenteerde `/user/{id}/monetary-account*` routes.
  - context-scoped en niet-gedocumenteerde route-varianten verwijderd.
- Incidentstatus bevestigd als opgelost:
  - live checker geeft `Validation OK` met `Spaarrekening (EUR)` en `Spaargeld in ZAR (ZAR)` in `/api/accounts`.
- Handover opgeschoond naar actuele waarheid:
  - `CONTEXT_HANDOVER.md` herschreven zonder verouderde matrix/probe-status.

- Nieuwe deterministische API-validatie voor het savings-incident:
  - `scripts/check_accounts_api.py` toegevoegd.
  - Script logt in op dashboard, haalt `/api/accounts` op en valideert verwachtte accounts op:
    - `description` (rekeningnaam),
    - `balance.currency`,
    - `balance.value` (met configureerbare tolerantie).
  - Verwachtingen zijn mee te geven via `EXPECTED_ACCOUNTS_JSON`, zodat bekende productiegevallen per deploy reproduceerbaar checkbaar zijn.
- Handover bijgewerkt met vaste verificatiestap na deploy:
  - `CONTEXT_HANDOVER.md` bevat nu een concrete run van `check_accounts_api.py` voor `Spaarrekening` en `Spaargeld in ZAR`.
  - voorbeeld-check gebruikt bewust alleen `description` + `currency` (geen placeholder-saldi meer);
    `balance` is optioneel en alleen voor echte live waarden.
- Raw monetary-account fallback diagnostiek aangescherpt:
  - `list_monetary_accounts_raw_api(..., soft_fail=False)` toegevoegd; merge-pad gebruikt nu `soft_fail=True` zodat een partiële raw-fallback niet de hele account-ophaalflow als failure markeert.
  - Per raw endpoint wordt nu expliciet gelogd:
    - `no parsable monetary accounts` (incl. result/payload type),
    - `parsed only duplicate accounts`,
    - `endpoint unavailable (skip)` bij 404/route-not-found.
  - Hiermee is direct zichtbaar of savings-data niet geleverd wordt, of wel geleverd maar niet parsebaar is.
- Nieuw NAS-vriendelijk debugscript toegevoegd voor raw endpoints zonder handmatige heredoc:
  - `scripts/debug_raw_monetary_accounts.sh`
  - script detecteert container + user-id, initialiseert Bunq context en test raw monetary routes.
  - output bevat `parsed_accounts`, `payload_type` en sample accountregels.
  - script is aangescherpt na live NAS-feedback:
    - initialiseert eerst `init_bunq(...)` in dezelfde container-exec context (voorkomt `ApiContext has not been loaded`);
    - draait route-probing in één exec-run (voorkomt herhaalde Vaultwarden decrypt per endpoint);
    - parseert user-id via marker `CODX_USER_ID=...` i.p.v. shellvariabele `UID` (readonly in shell).
    - streamt nu live output tijdens run (geen buffered stilte tot einde).
    - gebruikt nu `python3 -u` (ongebufferde output), toont `attempt_count`, en rapporteert correcte exit-code bij failures.
    - `python -c` quoting-probleem gefixt door over te stappen op `python3 -u -` met ingebedde multiline scriptinhoud.
    - script ondersteunt nu ook `MAX_ROWS` als 2e positional argument (`scripts/debug_raw_monetary_accounts.sh <service> <max_rows>`) om sudo-env issues te vermijden.
- Live NAS-observatie vastgelegd:
  - `/v1/user/{id}/monetary-account*` raw paden geven op deze runtime allemaal `404 Route not found`.
  - hierop is `_raw_monetary_attempt_plan(...)` verbreed naar deterministische route- en param-varianten:
    - prefixes `/v1/user`, `/user`, `user`;
    - suffixes `monetary-account*` inclusief `-bank/-savings/-external/-joint/-card`;
    - params varianten met/zonder `status` en `count`.
- Raw payload parsing verder gehard op basis van NAS-debug:
  - `_extract_json_payload(...)` prioriteert nu `raw_body/raw_response/...` boven `.value` en valt pas terug op lege payloads als er niets beters is.
  - voorkomt scenario waarin een lege sdk-wrapper `.value` de echte JSON-body maskeert.
  - `_extract_monetary_accounts_from_raw_payload(...)` accepteert nu ook directe account-dicts zonder `MonetaryAccount*` wrapper key.
  - nieuw: `_extract_monetary_accounts_from_raw_result(...)` parseert ook sdk model-object resultaten (niet-JSON) uit raw client calls.
  - `list_monetary_accounts_raw_api(...)` en `scripts/debug_raw_monetary_accounts.sh` gebruiken nu deze gecombineerde extractor.
  - extractor is verder aangescherpt om false positives te vermijden:
    - alleen account-like mappings/objecten worden nog geaccepteerd (vereist o.a. `id` + `balance` of duidelijk monetary-account class-hint);
    - brede `display_name`-achtige matches zonder accountkenmerken worden niet meer als account geteld.
  - debugscript toont nu per route ook `first_account=<id>|<description>|<currency>|<type>` zodat `MAX_ROWS=0` toch bruikbare identificatie geeft.
- `scripts/check_accounts_api.py` default timeout verhoogd naar 120s (was 20s) vanwege langzamere `/api/accounts` runs tijdens uitgebreide raw probing.
- Raw route-probing verder verbreed voor SDK-contextinjectie:
  - naast expliciete `/user/{id}/...` paden probeert `_raw_monetary_attempt_plan(...)` nu ook context-scoped routes zonder user-id:
    - `/v1/monetary-account*`
    - `/monetary-account*`
    - `monetary-account*`
  - doel: sdk-varianten opvangen die user-scope intern toevoegen en daardoor met expliciete user-id lege/non-JSON responses geven.
- Debugscript introspectie toegevoegd voor lege raw responses:
  - bij eerste `parsed_accounts=0` toont script nu `result_type` plus type/size van relevante response-attributen (`value`, `raw_body`, `response`, `json`, etc.).
  - doel: exact bepalen waar de SDK-wrapper de daadwerkelijke payload verbergt.
- BunqResponseRaw payloadextractie verder uitgebreid op basis van documentatie-aanwijzingen:
  - `_extract_json_payload(...)` probeert nu expliciet ook `get_*` methoden (`get_value/get_body/get_raw_body/get_response_body/get_json/get_data`) naast velden.
  - private objectvelden worden nu ook meegenomen via `__dict__`-scan met prioriteit op payload-achtige keys (`raw/body/response/json/...`).
  - `_extract_monetary_accounts_from_raw_payload(...)` accepteert nu ook single-object payloads zonder `Response[]` wrapper en nested `value/data/result` payloads.
- Debugscript probe-matrix uitgebreid voor BunqResponseRaw:
  - toegevoegd: `get_*` probes en `__dict__`, zodat we bij `parsed_accounts=0` direct zien waar de SDK-runtime de body bewaart.
- Nieuw snel redeployscript toegevoegd:
  - `scripts/quick_redeploy.sh`
  - doet bewust geen `docker stack deploy`; alleen:
    - cached image build (default),
    - `docker service update --force --image ...` met retry bij `update out of sequence`.
  - doel: snellere debug-loop bij pure codewijzigingen (`api_proxy.py`, frontend, scripts).
  - expliciete waarschuwing in script: bij `.env`/`docker-compose.yml`/secrets/netwerkwijzigingen wel volledige stack deploy doen.
- Volgende-sessie checklist expliciet vastgelegd in `CONTEXT_HANDOVER.md`:
  - redeploy met `.env` geladen;
  - raw debug rerun + grep met `first_account=...`;
  - checker rerun met `EXPECTED_ACCOUNTS_JSON` (typo-valkuil `EXPECTED_ACTS_JSON` benoemd).
- Installatie-instructies aangescherpt op Synology:
  - `scripts/install_or_update_synology.sh` expliciet als root laten uitvoeren (`sudo sh ...`).
  - `NO_CACHE` overrides nu gedocumenteerd via root-shell variant (`sudo sh -c 'NO_CACHE=... sh ...'`) om sudo-env valkuilen te vermijden.
- Documentatie geüpdatet:
  - `README.md`
  - `SYNOLOGY_INSTALL.md`
  - `CONTEXT_HANDOVER.md`
  - `AGENTS.md` (vaste startup-instructies voor nieuwe sessies)
- Operationele les vastgelegd:
  - Als install/update als normale user wordt gedraaid, kan deploy op compose-defaults terugvallen (`*.jouwdomein.nl`) ondanks correcte `.env`, met Vaultwarden `ENOTFOUND` en demo mode als gevolg.
- Savings-debug vervolg:
  - raw fallback resolveert nu daadwerkelijk een SDK client (`ApiClient.__init__`), maar call-signatuur mismatch vastgesteld:
    - `ApiClient.get() missing 2 required positional arguments: 'params' and 'custom_headers'`.
  - `_call_api_client_get(...)` uitgebreid met Bunq-compatibele `get/request/execute` callvarianten met verplichte positional args en lege headers.
- SDK-first savings-ophaalpad verder aangescherpt (minder fuzzy fallback):
  - endpoint-discovery blijft standaard strict (`BUNQ_STRICT_ENDPOINT_DISCOVERY=true`);
  - raw monetary fallback gebruikt nu alleen gedocumenteerde Bunq paden:
    - `/v1/user/{id}/monetary-account`
    - `/v1/user/{id}/monetary-account-savings`
    - `/v1/user/{id}/monetary-account-external-savings`
  - brede pad/probe-combinaties verwijderd; logregel verduidelijkt naar `Using documented raw Bunq monetary-account endpoint`.
  - cooldown blijft actief om herhaalde mislukte raw-pogingen te dempen (`BUNQ_RAW_FALLBACK_COOLDOWN_SECONDS`, default 120s).

### Frontend detailmodal: individuele transacties als second view

- Vraag uit gebruikersflow opgepakt: naast totalen in detailkaarten nu ook individuele transacties zichtbaar.
- `index.html`:
  - nieuwe sectie in `#balanceDetailModal` toegevoegd met transactietabel (`Datum`, `Tijd`, `Tegenrekening / merchant`, `Bedrag`).
- `styles.css`:
  - styling toegevoegd voor de nieuwe transactiesectie incl. scrollable tabel en kleurcodering van bedragen.
- `app.js`:
  - `openDetailModal(...)` uitgebreid met `transactionRows` + `transactionsTitle`.
  - rendering toegevoegd voor transactietabel in de modal.
  - transactietabel rendering geoptimaliseerd voor grote datasets:
    - batchgrootte `200` rijen per stap;
    - `Toon meer` knop + teller (`x van y transacties`);
    - voorkomt zware DOM-render in één keer.
  - transactietabel interactie uitgebreid:
    - zoekveld (merchant/tegenrekening/datum/bedrag);
    - sortering (datum nieuw/oud, bedrag op grootte, naam A-Z/Z-A).
  - `showTransactionDetail(...)` aangesloten voor:
    - `income`
    - `expenses`
    - `savings-transfers`
    - `needs-vs-wants`
    - `merchant-concentration`
    - `expense-momentum` (laatste 30d uitgaven)
    - `money-flow`
- Resultaat:
  - gebruiker ziet nu in dezelfde detailweergave zowel samenvatting/grafiek als individuele transactieregels voor de gekozen context/periode.
- Validatie:
  - lokale JS syntax-check via `node --check` kon niet worden uitgevoerd in deze omgeving (`node`/`nodejs` niet aanwezig).

### User-documentatie: EN/NL splitsing

- User-facing markdown-documentatie opgesplitst naar taal:
  - Engelse hoofdversies blijven op standaardnamen:
    - `README.md`
    - `SECURITY.md`
    - `SYNOLOGY_INSTALL.md`
    - `TROUBLESHOOTING.md`
  - Nederlandse versies staan nu naast de hoofdversies met `-NL` suffix:
    - `README-NL.md`
    - `SECURITY-NL.md`
    - `SYNOLOGY_INSTALL-NL.md`
    - `TROUBLESHOOTING-NL.md`
- `README.md` bevat nu expliciete taalkeuze (EN/NL) zodat gebruikers direct tussen beide readme-varianten kunnen kiezen.
- Links in NL-documentatie zijn aangepast naar `*-NL.md` targets zodat de NL-flow intern consistent blijft.
- NL-documentatie inhoudelijk opgeschoond op onnodig Engels (koppen en begeleidende zinnen) in:
  - `README-NL.md`
  - `SECURITY-NL.md`
  - `SYNOLOGY_INSTALL-NL.md`
  - `TROUBLESHOOTING-NL.md`

## 2026-02-28

### Opgeleverd

- Savings-incident extra gehard op backend:
  - monetary-account list calls sturen nu altijd `count` mee via nieuwe helper (`BUNQ_ACCOUNT_PAGE_SIZE`, default/max 200), inclusief `status=ACTIVE` modes;
  - raw-client resolutie uitgebreid naar endpoint-module en endpoint-klassen (`MonetaryAccount*`, `PaymentApiObject`);
  - verbeterde diagnostiek voor raw fallback (`api_client unavailable (candidates: ...)`) zodat runtime-verschillen sneller traceerbaar zijn.
  - false-positive client-resolutie gefixt:
    - endpoint class (`MonetaryAccountApiObject.self`) werd ten onrechte als HTTP client gezien;
    - `_is_http_client_like` sluit endpoint classes/modelobjecten nu uit;
    - `_call_api_client_get` probeert alleen aanwezige methodes en logt duidelijker typefoutcontext.
  - raw client discovery uitgebreid:
    - extra session/context accessors toegevoegd;
    - objectgraph-discovery volgt nu ook private SDK contextvelden;
    - discovery-diepte naar 3 verhoogd voor interne session-client paden.
  - nieuwe constructor-fallback toegevoegd:
    - backend probeert nu SDK HTTP-client direct te bouwen vanuit `ApiContext` via `bunq.sdk.http.api_client*` klassen/factories;
    - signature-gebaseerde arg-mapping toegevoegd voor SDK-variantcompatibiliteit.
- Savings-account incidentanalyse aangescherpt op live NAS-data:
  - bevestigd dat `/api/accounts` alleen checking/external teruggeeft;
  - bevestigd dat SDK-savings endpoints falen op `float(None)` parsefout.
- Backend account-enumeratie verder gehard in meerdere iteraties:
  - savings/accounttype-herkenning uitgebreid;
  - monetary-account discovery/list modes verbreed;
  - retries met `status=ACTIVE` toegevoegd;
  - raw monetary-account fallback toegevoegd;
  - api-client resolutie voor raw fallback verbreed;
  - multi-user-id discovery toegevoegd om accounts over meerdere user-contexten te kunnen ophalen.
- Runtime-validatie toegevoegd op NAS:
  - `discover_bunq_user_ids()` geeft momenteel één id terug (`75231272`);
  - daardoor is multi-user mismatch niet de primaire oorzaak.
  - resterende blocker: raw fallback meldt nog `bunq-sdk api_client unavailable`.
- Nieuwe fix voorbereid:
  - `_resolve_bunq_api_client` uitgebreid met adapter/request/execute varianten om raw fallback alsnog te activeren.
- Handover-documentatie opgeschoond naar een enkele actuele statusweergave zonder duplicaten.

### Relevante commits

- `948a564` Discover multiple Bunq user IDs for account enumeration
- `223396f` Resolve Bunq api client variants for raw account fallback
- `6909e51` Add raw monetary-account fallback for SDK parse failures
- `dcc7bb7` Retry monetary account list with active-status modes
- `adb96f0` Broaden monetary account endpoint discovery and list modes
- `e9da54c` Fix savings account classification for balance widgets

### Openstaand

- Op NAS valideren of `count`-param in monetary-account list de ontbrekende savings al oplost.
- Daarna valideren dat nieuwe endpoint-gebaseerde api-client-resolutie raw fallback activeert en de twee spaarrekeningen teruggeeft.
- Als dat niet zo is: gerichte raw endpoint inspectie per user-id uitvoeren en fallback finaliseren op exact endpoint-niveau.

### Procesafspraak

- Bij elke codewijziging:
  - `WORKLOG.md` actualiseren;
  - `CONTEXT_HANDOVER.md` actualiseren;
  - verouderde info verwijderen i.p.v. dupliceren.

## 2026-02-25

### Opgeleverd

- Backend transactie-inname verder gehard voor SDK-varianten:
  - payment endpoint met paging-metadata (`truncated`, `truncated_accounts`);
  - card-payment endpoint support toegevoegd waar beschikbaar;
  - gecombineerde transactie-output inclusief expliciete datakwaliteitssignalen.
- Frontend feedback verbeterd bij onvolledige datasets:
  - dashboard toont nu waarschuwingen bij truncation en ontbrekende EUR-conversies.
- Savings transfer deep-dive robuuster gemaakt:
  - detailweergave gebruikt expliciet een filterpad waarbij interne transfers niet onbedoeld worden weggefilterd.
- Documentatie bijgewerkt op operationele tuning en diagnostiek:
  - `README.md`: transaction diagnostics velden beschreven;
  - `SYNOLOGY_INSTALL.md`: nieuwe Bunq payment/card-payment paging env knobs;
  - `TROUBLESHOOTING.md`: concrete truncated-check + redeploy flow.

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

## 2026-02-24

### Repo review + hardening pass

- Commit `9e15ee2` gepusht op `main`.
- Vaultwarden CLI flow aangescherpt:
  - `VAULTWARDEN_URL` moet expliciet gezet zijn.
  - Bij `VAULTWARDEN_ACCESS_METHOD=cli` wordt alleen HTTPS geaccepteerd (duidelijke runtime foutmelding bij HTTP).
- Bunq context herstel verbeterd:
  - als restore/init faalt met bestaand contextbestand, verwijdert backend stale context en probeert één keer opnieuw.
- Liveness/readiness gesplitst:
  - `/api/live` toegevoegd (altijd 200 als process leeft).
  - `/api/health` is readiness en retourneert 503 als API key aanwezig is maar Bunq context niet initialized is.
  - `/api/ready` toegevoegd als alias naar readiness.
  - Docker healthchecks gebruiken nu `/api/live` (compose + Dockerfile + Synology docs).
- Whitelist safety-default aangescherpt:
  - `scripts/register_bunq_ip.sh` default `DEACTIVATE_OTHERS=false`.
  - documentatie en recovery hints bijgewerkt naar veilige default + optionele cleanup-pass (`DEACTIVATE_OTHERS=true`) na validatie.
- Markdown docs geactualiseerd:
  - `README.md`, `SYNOLOGY_INSTALL.md`, `SECURITY.md`, `TROUBLESHOOTING.md`, `.env.example`.
