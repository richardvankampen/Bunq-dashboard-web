# 💰 Bunq Financial Dashboard

**Veilige webgebaseerde grafieken van je Bunq-transacties (gemaakt voor Synology).**
Alleen-lezen dashboard dat gegevens uit de Bunq API haalt en overzichtelijk laat zien.

## 🌐 Taal

- Nederlands (dit bestand): [README-NL.md](README-NL.md)
- English: [README.md](README.md)

Elk document heeft een Engelse (`*.md`) en een Nederlandse (`*-NL.md`) versie met dezelfde inhoud:
- [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md) / [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
- [SECURITY.md](SECURITY.md) / [SECURITY-NL.md](SECURITY-NL.md)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) / [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)
- [RELEASE_NOTES.md](RELEASE_NOTES.md) / [RELEASE_NOTES-NL.md](RELEASE_NOTES-NL.md)

Het dashboard zelf is er in het Nederlands en Engels: gebruik de knop **NL/EN** in de header. Dit document gebruikt de Nederlandse namen uit het dashboard.

⚠️ **BELANGRIJK:** open het dashboard ALLEEN vanuit je thuisnetwerk, via een VPN of via Tailscale. Zet nooit poorten open naar internet.

---

## ✨ Belangrijkste functies

- Dashboard op één poort (frontend + API): poort 5000
- Dashboard in het Nederlands of Engels: de knop NL/EN in de header wisselt alle teksten, grafieklabels en de notatie van getallen en datums (de keuze wordt per browser onthouden)
- Alleen-lezen toegang tot de Bunq API (betalingen en, waar beschikbaar, kaartbetalingen; rekeningen via de officiële SDK, inclusief spaarrekeningen)
- Lokale transactieopslag (SQLite): gegevens komen uit de opslag, nieuwe transacties worden op de achtergrond opgehaald; een maandelijkse controle houdt de opslag gelijk met Bunq en bewaart geschiedenis die Bunq niet meer levert
- Saldoverloop opgebouwd uit opgeslagen transacties (met dagelijkse momentopnamen als terugval)
- Automatische indeling in categorieën (interne overboekingen, categoriecodes van winkels, tekstregels, namen van subrekeningen) plus eigen regels in `config/category_rules.json`; terugbetalingen verlagen de uitgaven van de oorspronkelijke categorie
- Interne overboekingen tussen eigen rekeningen worden weggefilterd; overboekingen van/naar je eigen gekoppelde rekeningen bij andere banken tellen niet als inkomsten of uitgaven
- EUR-totalen voor rekeningen in vreemde valuta (omrekening met tijdelijke opslag van koersen)
- Maandtrends, budgetdiscipline (50/30/20), inzichtkaarten en een controle van de datakwaliteit, met uitleg bij het aanwijzen
- Sleutelbeheer via Vaultwarden (aanbevolen), met een directe sleutel als noodoplossing
- Vaultwarden ontsleutelen via de `bw` CLI (secret met hoofdwachtwoord)
  - Intel/amd64: vaste versie van de `bw`-binary (valt automatisch terug op npm als een release tijdelijk niet beschikbaar is)
  - ARM64: vaste versie van `@bitwarden/cli` via npm
- Draait in productie met Gunicorn (geen Flask-ontwikkelserver in de container)
- Klaar voor Synology, met scripts voor installeren/bijwerken, snelle redeploy en de IP-whitelist
- Beheeronderhoud in Instellingen, met een gids per probleem (status met advies, egress-IP, whitelist bijwerken, Bunq-context opnieuw opbouwen, volledig onderhoud, controle met Bunq, terminalcommando's met uitleg)

**Dashboardwidgets:**
- Saldotegels: Betaalrekeningen (totaal), Spaarrekeningen (totaal)
- KPI-tegels met trend t.o.v. vorige maanden: Inkomsten, Uitgaven, Sparen, Spaarquote
- Cashflow (tijdslijn): inkomsten/uitgaven per dag, week of maand plus cumulatief netto
- Geldstromen: Sankey-diagram van inkomstenbronnen via noodzakelijk/vrij besteedbaar naar uitgavencategorieën, plus wat overbleef
- Verdeling in categorieën: zonnediagram per categorie en tegenrekening
- Budgetdiscipline (50/30/20)
- Dagpatroon: warmtekaart van variabele uitgaven per weekdag en dagdeel
- Top tegenrekeningen: grootste tegenrekeningen na terugbetalingen
- Maandverdeling: spreiding van uitgavenbedragen per categorie
- Categorie-race: geanimeerde race van categorieën over de periode
- Inzichtkaarten: grootste categorie, gemiddelde daguitgaven, uitgavenvolatiliteit, duurste dag, trend, liquiditeitsrunway, noodzaak vs wens, 50/30/20-fit, aandeel top-tegenrekening, terugkerende kosten, volgende beste actie, verwacht netto per maand, datakwaliteit
- Saldodetail per rekening met transacties

## 🔒 Beveiliging (kort)

- Inloggen met een sessie: HttpOnly-cookies en bescherming tegen CSRF
- `SESSION_COOKIE_SECURE=true` als veilige standaard (alleen `false` bij lokale HTTP)
- Geheimen via Vaultwarden en Docker Swarm secrets (Vaultwarden heeft de voorkeur; `VAULTWARDEN_ACCESS_METHOD=cli`)
- Alleen toegang via je thuisnetwerk, een VPN of Tailscale; niet bereikbaar vanaf internet
- Begrenzing van het aantal verzoeken op inloggen en API

Meer details: [SECURITY-NL.md](SECURITY-NL.md)
Engelse versie: [SECURITY.md](SECURITY.md)

## 🚀 Snelle start (Synology)

1. Installeer **Container Manager** (Package Center)
2. Regel **privé toegang van buitenaf**: Tailscale (Package Center, geen open poort op de router) of een VPN; niet bereikbaar vanaf internet (zie [SECURITY-NL.md](SECURITY-NL.md))
3. Volg de volledige installatiegids: [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
4. Gebruik **Vaultwarden als hoofdbron voor de Bunq API key** (`USE_VAULTWARDEN=true`)
5. Gebruik `VAULTWARDEN_ACCESS_METHOD=cli` + secret `bunq_vaultwarden_master_password`
   - Zet `VAULTWARDEN_URL` op een **HTTPS**-URL (reverse proxy/domein met geldig certificaat)
6. Gebruik een directe `bunq_api_key` alleen als noodoplossing (`USE_VAULTWARDEN=false`)
7. Installeren/bijwerken op Synology altijd als root:
   - `sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh`
   - Niet als gewone gebruiker uitvoeren.
8. Bij een nieuwe Bunq API key of een IP-wijziging: voer `scripts/register_bunq_ip.sh` uit
   - Veilige standaard zonder vragen (doel-IP wordt automatisch bepaald): `NO_PROMPT=true sh scripts/register_bunq_ip.sh`
   - Zelf een doel-IP opgeven: `TARGET_IP=<PUBLIEK_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh`
9. Controleer na een deploy of herstart of het opstarten lukt met `sudo sh scripts/restart_bunq_service.sh` (gebruikt standaard de git-tag en ruimt oude `bunq-dashboard`-images op)
10. Bouwen/deployen controleert ook of het egress-IP op de actieve Bunq-whitelist staat, en geeft anders direct een herstelcommando
11. Sterk aanbevolen: een vast publiek IP-adres, of minimaal een sticky dynamisch publiek IP-adres, om problemen met de Bunq-whitelist en onverwachte inlogfouten bij Bunq te beperken

Stappen bij een IP-wijziging (kopiëren en plakken):
```bash
cd /volume1/docker/bunq-dashboard
sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard
sudo sh scripts/restart_bunq_service.sh
curl -s http://127.0.0.1:5000/api/health
```

Health-endpoints:
- Liveness: `GET /api/live` (container/app-proces draait)
- Readiness: `GET /api/health` (status van de Bunq-context; kan `503` geven als key en IP niet kloppen)

Over het publieke IP:
- Toegang tot de Bunq API is gekoppeld aan je huidige publieke egress-IP.
- Als je provider dat IP wijzigt, kan Bunq verzoeken weigeren tot je `scripts/register_bunq_ip.sh` opnieuw uitvoert.
- Laat de NAS bij Tailscale geen exit node gebruiken: Bunq ziet dan het IP van de exit node.
- Zie [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md), sectie `Publiek IP-beleid (vast vs sticky)`.

Controle van transacties:
- `GET /api/transactions` geeft extra velden terug:
  - `truncated` (true/false)
  - `truncated_accounts` (per rekening: grens van het aantal pagina's bereikt)
  - `amount_eur_missing_count` (transacties in vreemde valuta zonder omrekening naar EUR)
- Het dashboard toont hiervoor duidelijke waarschuwingen in plaats van stilletjes te lage cijfers.

Spaarrekeningen (eerst via de SDK):
- Rekeningen worden opgehaald via de officiële Bunq SDK-endpoints:
  - `MonetaryAccount.list(...)` (alle soorten)
  - `MonetaryAccountSavings.list(...)`
  - `MonetaryAccountExternalSavings.list(...)`
- Alleen als de SDK spaarrekeningen niet kan inlezen, gebruikt de backend een beperkte directe aanroep van:
  - `/user/{user_id}/monetary-account`
  - `/user/{user_id}/monetary-account-savings`
  - `/user/{user_id}/monetary-account-external-savings`

Snelle controle na een deploy:
```bash
TAG=$(sudo git rev-parse --short HEAD)
sudo docker build --no-cache -t bunq-dashboard:$TAG .
sudo docker tag bunq-dashboard:$TAG bunq-dashboard:local
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo sh scripts/restart_bunq_service.sh

# Handmatig alternatief:
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
sudo docker service logs --since 3m bunq_bunq-dashboard | grep -E "Retrieving API key from Vaultwarden|API key retrieved from vault|No valid API key"
curl -s http://127.0.0.1:5000/api/live
curl -s http://127.0.0.1:5000/api/health
```

Handige scriptopties:
- `AUTO_TAG_FROM_GIT=false` om te herstarten zonder een andere image-tag
- `CLEANUP_OLD_IMAGES=false` om oude images te bewaren
- `KEEP_IMAGE_COUNT=3` om meer recente oudere tags te bewaren

Automatisch installeren/bijwerken (nadat Vaultwarden is ingesteld):
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

Snelle redeploy als alleen de code is gewijzigd (geen wijziging in `.env` / compose / secrets / netwerk):
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

Belangrijk (Synology):
- Voer het install/update-script altijd uit met `sudo sh ...`.
- Als gewone gebruiker kan `docker stack deploy` starten met standaardwaarden (`*.jouwdomein.nl`) in plaats van je `.env`-waarden.

Het script vraagt standaard:
- `Use clean Docker build (--no-cache)? [Y/n]`

Vooraf kiezen:
- `sudo sh -c 'NO_CACHE=false sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'` (sneller, bouwt met cache)
- `sudo sh -c 'NO_CACHE=true sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'` (volledig schoon bouwen)
- Zonder vragen (niet-interactief) blijft de veilige standaard `NO_CACHE=true` gelden.

Wanneer `NO_CACHE=false`:
- Alleen wijzigingen in code of documentatie (bv. `app.js`, `api_proxy.py`, `index.html`, `.md`), geen wijzigingen in afhankelijkheden of de basisimage.
- Je wilt sneller deployen door de Docker-cache te hergebruiken.

Wanneer `NO_CACHE=true`:
- Wijzigingen in de `Dockerfile`, afhankelijkheden of de basisimage, of bouwproblemen door verouderde lagen.

---

## 🏷️ Eigen categorieregels

Transacties worden automatisch ingedeeld. Een afschrijving vanaf een eigen subrekening met een naam die zegt waarvoor die is (bv. "Boodschappen", "Huur" of "Vakantie") krijgt die categorie als niets anders past. Voor de rest kun je eigen regels zetten in `config/category_rules.json` op de NAS (`/volume1/docker/bunq-dashboard/config/`, niet in git):

```json
{
  "rules": [
    {"category": "Wonen", "account": "Huur"},
    {"category": "Sport", "counterparty": "Tennisclub"},
    {"category": "Wonen", "iban": "NL00BANK0123456789"},
    {"category": "Zorg", "account": "Huishouden", "description": "fysio"}
  ]
}
```

- **Velden:** `account` (naam van je eigen rekening), `counterparty` (tegenrekening), `description` (omschrijving) en `iban`. Alle velden in een regel moeten kloppen (tekst: hoofdletterongevoelig, komt voor in de tekst; IBAN: exact). Eigen regels gaan voor de ingebouwde.
- **Categorienamen** in het bestand zijn de interne namen; het dashboard toont ze in de gekozen taal:

| Interne naam | Getoond in het Nederlands |
|---|---|
| `Boodschappen` | Boodschappen |
| `Horeca` | Horeca |
| `Vervoer` | Vervoer |
| `Wonen` | Wonen |
| `Utilities` | Energie & telecom |
| `Abonnementen` | Abonnementen |
| `Verzekering` | Verzekering |
| `Belastingen` | Belastingen |
| `Kinderopvang` | Kinderopvang |
| `Alimentatie` | Alimentatie |
| `Shopping` | Winkelen |
| `Entertainment` | Vrije tijd |
| `Sport` | Sport |
| `Reizen` | Reizen |
| `Zorg` | Zorg |
| `Salaris` | Salaris |
| `Uitkeringen` | Uitkeringen & toeslagen |
| `Rente` | Rente |
| `Overig` | Overig |

Voer na het aanpassen `sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false` uit; opgeslagen transacties worden bij het starten eenmalig opnieuw ingedeeld.

## 🧪 Tests (ontwikkeling)

Unit- en routetests van de backend staan in `tests/` en draaien zonder Bunq, Vaultwarden of Docker (alle externe toegang wordt via omgevingsvariabelen in `tests/conftest.py` uitgeschakeld):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements_dev.txt
.venv/bin/python -m pytest tests -q
```

GitHub Actions (`.github/workflows/tests.yml`) draait dezelfde tests plus `pyflakes` bij elke pull request en elke push naar `main`.

---

## 📄 Licentie

MIT-licentie - zie [LICENSE](LICENSE)
