# Context Handover

Laatste update: 2026-02-16 (P1 finetuning update)

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
