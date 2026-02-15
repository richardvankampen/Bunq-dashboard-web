# Context Handover

Laatste update: 2026-02-14 (P1 actionable update)

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
