# 💰 Bunq Financial Dashboard

**Veilige web-based visualisaties van je Bunq transactiedata (Synology-first)**
Read-only dashboard dat data uit de Bunq API haalt en overzichtelijk visualiseert.

## 🌐 Taal

- Nederlands (dit bestand): [README-NL.md](README-NL.md)
- English: [README.md](README.md)

⚠️ **IMPORTANT:** Access ONLY via VPN. NEVER forward ports to the internet.

---

## ✨ Belangrijkste Features

- Single-port dashboard (frontend + API) op poort 5000
- Real-time data uit de Bunq API (read-only)
- Vaultwarden-first key management (aanbevolen), met optionele directe fallback
- Vaultwarden decrypt via `bw` CLI (master-password secret) voor betrouwbare key retrieval
  - Intel/amd64: native pinned `bw` binary (met automatische npm fallback als release-asset tijdelijk ontbreekt)
  - ARM64: pinned `@bitwarden/cli` npm fallback (officially recommended for ARM)
- Productie-runtime via Gunicorn (geen Flask development server in container)
- Lokale history-opslag (SQLite) voor langere-termijn inzichten
- EUR-totalen voor niet-EUR rekeningen (met FX conversie en caching)
- Transactie-dekking via Bunq `payment` én (waar beschikbaar) `card-payment` endpoints
- 11+ visualisaties (cashflow, trends, categorieën)
- Actionable insight cards (runway, needs-vs-wants, merchant concentration, monthly net projection) met deep-dive details
- Caching en pagination voor performance
- Synology‑ready deployment
- Admin maintenance tools in Settings (status, egress IP, Bunq context re-init, bundled maintenance run met opties)
- Terminal-helper knoppen in admin panel (tonen copy-ready install/update en restart commando's)

**Visualisaties:**
- KPI Cards (inkomsten/uitgaven/sparen)
- Cashflow timeline
- Sankey diagram (geldstromen)
- Sunburst (categorieën)
- 3D time-space chart
- Heatmap (dag/uur)
- Top merchants
- Ridge plot (distributie)
- Racing bar chart
- Insights (automatisch)
- Custom charts

## 🔒 Security (Kort)

- Session-based auth met HttpOnly cookies en CSRF‑bescherming
- `SESSION_COOKIE_SECURE=true` als veilige default (zet alleen op `false` bij lokale HTTP)
- Secrets via Vaultwarden + Docker Swarm secrets (Vaultwarden is preferred; `VAULTWARDEN_ACCESS_METHOD=cli`)
- VPN‑only toegang, geen publieke exposure
- Rate limiting op login en API
Meer details: [SECURITY-NL.md](SECURITY-NL.md)

## 🚀 Quick Start (Synology)

1. Installeer **Container Manager** (Package Center)
2. Zorg voor **VPN-only toegang** (geen publieke exposure)
3. Volg de volledige installatieguide: [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
4. Gebruik **Vaultwarden als primaire Bunq API key bron** (`USE_VAULTWARDEN=true`)
5. Gebruik `VAULTWARDEN_ACCESS_METHOD=cli` + secret `bunq_vaultwarden_master_password`
   - Zet `VAULTWARDEN_URL` op een **HTTPS** URL (reverse proxy/domein met geldig certificaat)
6. Gebruik directe `bunq_api_key` alleen als nood-fallback (`USE_VAULTWARDEN=false`)
7. Voor install/update op Synology: run altijd als root:
   - `sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh`
   - Niet als normale user uitvoeren.
8. Bij nieuwe Bunq API key of IP-wijziging: run `scripts/register_bunq_ip.sh`
   - Veilige non-interactive default: `TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=false sh scripts/register_bunq_ip.sh`
   - Optionele cleanup-pass daarna: `... DEACTIVATE_OTHERS=true ...`
9. Na deploy/herstart kun je startup-validatie doen met `sudo sh scripts/restart_bunq_service.sh` (gebruikt standaard git-tag + ruimt oude `bunq-dashboard` images op)
10. Build/deploy controleert ook egress-IP vs actieve Bunq whitelist en geeft direct herstelcommando bij mismatch

Health endpoints:
- Liveness: `GET /api/live` (container/app process up)
- Readiness: `GET /api/health` (Bunq context state; kan `503` geven bij key/IP mismatch)

Transactie-diagnostiek:
- `GET /api/transactions` retourneert extra velden:
  - `truncated` (true/false)
  - `truncated_accounts` (per account paging-cap info)
  - `amount_eur_missing_count` (non-EUR transacties zonder EUR-conversie)
- Dashboard toont hiervoor expliciete waarschuwingen i.p.v. stilzwijgende onderrapportage.

Savings-accounts (SDK-first):
- Accountophaalpad volgt de officiële Bunq SDK-endpoints:
  - `MonetaryAccount.list(...)` (unified)
  - `MonetaryAccountSavings.list(...)`
  - `MonetaryAccountExternalSavings.list(...)`
- Alleen als SDK-deserialisatie op savings faalt, gebruikt de backend een beperkte raw fallback op:
  - `/user/{user_id}/monetary-account`
  - `/user/{user_id}/monetary-account-savings`
  - `/user/{user_id}/monetary-account-external-savings`

Snelle check na deploy:
```bash
TAG=$(sudo git rev-parse --short HEAD)
sudo docker build --no-cache -t bunq-dashboard:$TAG .
sudo docker tag bunq-dashboard:$TAG bunq-dashboard:local
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo sh scripts/restart_bunq_service.sh

# Handmatige fallback:
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
sudo docker service logs --since 3m bunq_bunq-dashboard | grep -E "Retrieving API key from Vaultwarden|API key retrieved from vault|No valid API key"
curl -s http://127.0.0.1:5000/api/live
curl -s http://127.0.0.1:5000/api/health
```

Nuttige script-opties:
- `AUTO_TAG_FROM_GIT=false` om zonder image-tag override te herstarten
- `CLEANUP_OLD_IMAGES=false` om geen oude images te verwijderen
- `KEEP_IMAGE_COUNT=3` om meer recente oudere tags te bewaren

Geautomatiseerde install/update (na Vaultwarden setup):
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

Belangrijk (Synology):
- Run het install/update script altijd met `sudo sh ...`.
- Als je het als normale user draait, kan `docker stack deploy` met default-waarden starten (`*.jouwdomein.nl`) i.p.v. je `.env` waarden.

Het script vraagt standaard:
- `Use clean Docker build (--no-cache)? [Y/n]`

Handige overrides:
- `sudo sh -c 'NO_CACHE=false sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'` (sneller, cached build)
- `sudo sh -c 'NO_CACHE=true sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'` (volledig schone build)
- In non-interactive runs blijft veilige default `NO_CACHE=true` actief.

Wanneer `NO_CACHE=false` gebruiken:
- Alleen code/documentatie wijzigingen (bijv. `app.js`, `api_proxy.py`, `index.html`, `.md`) en geen dependency/base-image wijzigingen.
- Je wilt sneller deployen en Docker-cache hergebruiken.

Wanneer `NO_CACHE=true` gebruiken:
- Wijzigingen in `Dockerfile`, dependencies, base image, of build issues met mogelijk stale layers.

---

## 📄 License

MIT License - See [LICENSE](LICENSE)
