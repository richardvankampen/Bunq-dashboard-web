# 💰 Bunq Financial Dashboard

**Veilige webgebaseerde visualisaties van je Bunq transactiedata (Synology-first)**
Read-only dashboard dat data uit de Bunq API haalt en overzichtelijk visualiseert.

## 🌐 Taal

- Nederlands (dit bestand): [README-NL.md](README-NL.md)
- English: [README.md](README.md)

Elk document heeft een Engelse (`*.md`) en een Nederlandse (`*-NL.md`) versie met dezelfde inhoud:
- [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md) / [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
- [SECURITY.md](SECURITY.md) / [SECURITY-NL.md](SECURITY-NL.md)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) / [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)
- [RELEASE_NOTES.md](RELEASE_NOTES.md) / [RELEASE_NOTES-NL.md](RELEASE_NOTES-NL.md)

⚠️ **BELANGRIJK:** Gebruik alleen toegang via VPN. Zet nooit poorten open naar het internet.

---

## ✨ Belangrijkste functies

- Dashboard op één poort (frontend + API) op poort 5000
- Dashboard in het Nederlands of Engels: de NL/EN-knop in de header wisselt alle teksten, grafieklabels en getal-/datumnotatie (de keuze wordt per browser onthouden)
- Alleen-lezen toegang tot de Bunq API (betalingen en, waar beschikbaar, kaartbetalingen; rekeningen SDK-first inclusief sparen)
- Lokale transactieopslag (SQLite): laden gebeurt uit de opslag met een incrementele sync op de achtergrond; een maandelijkse controle houdt hem gelijk met Bunq en bewaart geschiedenis die Bunq niet meer levert
- Saldoverloop opgebouwd uit opgeslagen transacties (met dagelijkse snapshots als terugval)
- Automatische indeling in categorieën (interne overboekingen, merchant-categoriecodes, tekstregels, namen van subrekeningen) plus eigen regels in `config/category_rules.json`; terugbetalingen verlagen de uitgaven van de oorspronkelijke categorie
- Interne overboekingen tussen eigen rekeningen worden weggefilterd; overboekingen van/naar eigen gekoppelde externe rekeningen tellen niet als inkomsten of uitgaven
- EUR-totalen voor niet-EUR-rekeningen (omrekening met caching)
- Maandtrends, budgetdiscipline (50/30/20), inzichtkaarten en een datakwaliteitscontrole, met uitleg in tooltips
- Sleutelbeheer via Vaultwarden (aanbevolen), met optionele directe fallback
- Vaultwarden ontsleutelen via de `bw` CLI (secret met hoofdwachtwoord)
  - Intel/amd64: native vastgepinde `bw`-binary (automatische npm-fallback als een release tijdelijk niet beschikbaar is)
  - ARM64: vastgepinde `@bitwarden/cli` via npm
- Productieruntime via Gunicorn (geen Flask-ontwikkelserver in de container)
- Klaar voor Synology, met scripts voor install/update, snelle redeploy en IP-whitelist
- Beheeronderhoud in Instellingen (status, egress-IP, whitelistupdate, Bunq-context opnieuw opbouwen, volledige onderhoudsrun, kant-en-klare terminalcommando's)

**Dashboardwidgets:**
- Saldotegels: Betaalrekeningen (totaal), Spaarrekeningen (totaal)
- KPI-tegels met trend t.o.v. vorige maanden: Inkomsten, Uitgaven, Sparen, Spaarquote
- Cashflow (tijdslijn): inkomsten/uitgaven per dag, week of maand plus cumulatief netto
- Geldstromen: Sankey van inkomstenbronnen via noodzakelijk/vrij besteedbaar naar uitgavencategorieën, plus wat overbleef
- Verdeling in categorieën: sunburst per categorie en tegenrekening
- Budgetdiscipline (50/30/20)
- Dagpatroon: heatmap van variabele uitgaven per weekdag en dagdeel
- Top tegenrekeningen: grootste tegenrekeningen na terugbetalingen
- Maandverdeling: spreiding van uitgavenbedragen per categorie
- Categorie-race: geanimeerde race van categorieën over de periode
- Inzichtkaarten: grootste categorie, gemiddelde daguitgaven, uitgavenvolatiliteit, duurste dag, trend, liquiditeitsrunway, noodzaak vs wens, 50/30/20-fit, aandeel top-tegenrekening, terugkerende kosten, volgende beste actie, verwacht netto per maand, datakwaliteit
- Saldodetail per rekening met transacties

## 🔒 Beveiliging (kort)

- Sessiegebaseerde authenticatie met HttpOnly cookies en CSRF‑bescherming
- `SESSION_COOKIE_SECURE=true` als veilige default (zet alleen op `false` bij lokale HTTP)
- Secrets via Vaultwarden + Docker Swarm secrets (Vaultwarden is preferred; `VAULTWARDEN_ACCESS_METHOD=cli`)
- VPN‑only toegang, geen publieke exposure
- Rate limiting op login en API

Meer details: [SECURITY-NL.md](SECURITY-NL.md)  
Engelse versie: [SECURITY.md](SECURITY.md)

## 🚀 Snelle start (Synology)

1. Installeer **Container Manager** (Package Center)
2. Zorg voor **VPN-only toegang** (geen publieke exposure)
3. Volg de volledige installatiegids: [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
4. Gebruik **Vaultwarden als primaire Bunq API key bron** (`USE_VAULTWARDEN=true`)
5. Gebruik `VAULTWARDEN_ACCESS_METHOD=cli` + secret `bunq_vaultwarden_master_password`
   - Zet `VAULTWARDEN_URL` op een **HTTPS** URL (reverse proxy/domein met geldig certificaat)
6. Gebruik directe `bunq_api_key` alleen als nood-fallback (`USE_VAULTWARDEN=false`)
7. Voor install/update op Synology: voer dit altijd als root uit:
   - `sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh`
   - Niet als normale user uitvoeren.
8. Bij nieuwe Bunq API key of IP-wijziging: run `scripts/register_bunq_ip.sh`
   - Veilige niet-interactieve standaard (target-IP automatisch bepaald): `NO_PROMPT=true sh scripts/register_bunq_ip.sh`
   - Optionele expliciete override: `TARGET_IP=<PUBLIEK_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh`
9. Na deploy/herstart kun je startup-validatie doen met `sudo sh scripts/restart_bunq_service.sh` (gebruikt standaard git-tag + ruimt oude `bunq-dashboard` images op)
10. Build/deploy controleert ook egress-IP vs actieve Bunq whitelist en geeft direct herstelcommando bij mismatch
11. Sterk aanbevolen: gebruik een vast publiek IP-adres, of minimaal een sticky dynamisch publiek IP-adres, om Bunq-whitelist problemen en onverwachte auth-fouten te beperken

IP-wijziging runbook (copy/paste):
```bash
cd /volume1/docker/bunq-dashboard
sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard
sudo sh scripts/restart_bunq_service.sh
curl -s http://127.0.0.1:5000/api/health
```

Health endpoints:
- Liveness: `GET /api/live` (container/app process up)
- Readiness: `GET /api/health` (Bunq context state; kan `503` geven bij key/IP mismatch)

Publiek-IP opmerking:
- Bunq API toegang is gekoppeld aan je huidige publieke egress-IP.
- Als je provider dat IP wijzigt, kan Bunq verzoeken weigeren tot je `scripts/register_bunq_ip.sh` opnieuw draait.
- Zie [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md), sectie `Publiek IP-beleid (vast vs sticky)`.

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
sudo git pull --rebase origin main
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

Snelle redeploy voor alleen codewijzigingen (geen `.env` / compose / secrets / netwerkwijzigingen):
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

Belangrijk (Synology):
- Voer het install/update-script altijd met `sudo sh ...` uit.
- Als je het als normale user draait, kan `docker stack deploy` met default-waarden starten (`*.jouwdomein.nl`) i.p.v. je `.env` waarden.

Het script vraagt standaard:
- `Use clean Docker build (--no-cache)? [Y/n]`

Handige overrides:
- `sudo sh -c 'NO_CACHE=false sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'` (sneller, cached build)
- `sudo sh -c 'NO_CACHE=true sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'` (volledig schone build)
- In niet-interactieve runs blijft veilige default `NO_CACHE=true` actief.

Wanneer `NO_CACHE=false` gebruiken:
- Alleen code/documentatie wijzigingen (bijv. `app.js`, `api_proxy.py`, `index.html`, `.md`) en geen dependency/base-image wijzigingen.
- Je wilt sneller deployen en Docker-cache hergebruiken.

Wanneer `NO_CACHE=true` gebruiken:
- Wijzigingen in `Dockerfile`, dependencies, base image, of build issues met mogelijk stale layers.

---

## 🏷️ Eigen categorieregels

Transacties worden automatisch gecategoriseerd. Een afschrijving vanaf een eigen subrekening met een naam die zegt waarvoor die is (bv. "Alimentatie", "Boodschappen") krijgt die categorie als niets anders past. Voor de rest kun je eigen regels zetten in `config/category_rules.json` op de NAS (`/volume1/docker/bunq-dashboard/config/`, niet in git):

```json
{
  "rules": [
    {"category": "Alimentatie", "account": "Alimentatie"},
    {"category": "Sport", "counterparty": "Tennisclub"},
    {"category": "Wonen", "iban": "NL00BANK0123456789"},
    {"category": "Zorg", "account": "Gezamenlijk", "description": "fysio"}
  ]
}
```

Alle velden in een regel moeten kloppen (tekst: hoofdletterongevoelig, komt voor in rekeningnaam / tegenrekening / omschrijving; IBAN: exact). Eigen regels gaan voor de ingebouwde. Na het aanpassen: `sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false`; opgeslagen transacties worden bij de start eenmalig opnieuw ingedeeld.

## 🧪 Tests (ontwikkeling)

Backend unit- en routetests staan in `tests/` en draaien zonder Bunq, Vaultwarden of Docker (alle externe toegang wordt via omgevingsvariabelen in `tests/conftest.py` uitgeschakeld):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements_dev.txt
.venv/bin/python -m pytest tests -q
```

GitHub Actions (`.github/workflows/tests.yml`) draait dezelfde tests plus `pyflakes` bij elke pull request en push naar `main`.

---

## 📄 License

MIT License - See [LICENSE](LICENSE)
