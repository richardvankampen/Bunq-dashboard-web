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
