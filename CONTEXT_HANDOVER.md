# Context Handover

Laatste update: 2026-02-14

## Waar we staan

- Vaultwarden-first setup blijft de voorkeursroute (`USE_VAULTWARDEN=true`).
- Dashboard draait via Synology + Docker Swarm.
- Recente fixes zijn gepusht op `main`:
  - `fc30a08`: balance/merchant analytics + UI/visualisatie fixes
  - `8c8a69e`: worklog update

## Wat net is aangepast (samenvatting)

- Savings/account classificatie verbeterd (incl. extra trefwoorden).
- EUR-conversie van rekeningen verbetert door eerst Bunq `balance_converted` te gebruiken.
- Merchant/category datakwaliteit verbeterd (fallbacks + MCC-regels).
- KPI mini-charts tonen nu assen.
- Balans-modals zijn breder en viewport-safe.
- Balans-detail lijst is alfabetisch.
- Cashflow download-knop werkt.
- Day Pattern is vereenvoudigd naar duidelijke dagdelen.
- Sunburst/Top Merchants/Category Race tonen meer data.

## Belangrijk voor volgende sessie

- Open punt: valideren op echte data op NAS of:
  - spaarrekeningen nu correct totaal tonen (EUR + ZAR),
  - merchants/categorieën volledig genoeg zijn,
  - gewenste UX van day-pattern helder genoeg is.
- Daarna doorgaan met volgende P1-substap op visualisaties.

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
