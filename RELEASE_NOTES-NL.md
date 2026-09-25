# Release-opmerkingen

## 🌐 Taal

- Nederlands (dit bestand): [RELEASE_NOTES-NL.md](RELEASE_NOTES-NL.md)
- English: [RELEASE_NOTES.md](RELEASE_NOTES.md)

## 2026-09-25

### Data en snelheid
- Transacties worden opgeslagen in SQLite: het dashboard leest uit de database, haalt bij Bunq alleen nieuwe transacties op (op de achtergrond als de periode al is opgeslagen) en hergebruikt de rekeninglijst een minuut.
- Maandelijkse nachtelijke controle (de 1e, 03:00–06:00) tegen Bunq: nieuwe en gewijzigde transacties worden verwerkt; transacties die Bunq niet meer teruggeeft worden verborgen, behalve als ze ouder zijn dan Bunq nog aanlevert.
- Opstarten: API key wordt 1x uit Vaultwarden gehaald; elke worker verbindt direct met Bunq; healthcheck-startperiode 300s.

### Grafieken
- Dagen worden in Nederlandse tijd geteld (een betaling om 00:30 hoort bij die dag).
- `Sparen`: trend en mini-grafiek volgen nu het spaarbedrag zelf, en de tegel houdt rekening met de rekeningselectie.
- Trends tonen `n.v.t.` in plaats van `0.0%` als de eerste helft van de periode geen waarde heeft.
- Budgetdiscipline (50/30/20): maanden die maar deels in de periode vallen worden weggelaten, de lopende maand is gemarkeerd als `(lopend)`, terugbetalingen verlagen de uitgaven in plaats van als inkomen te tellen, maanden zonder inkomen zijn gaten; inzichten gebruiken de laatste volledige maand.
- `Maandverdeling` (spreiding uitgaven): bedragklassen €0–5 … €1000+, top 4 categorieën op bedrag, aandeel van de betalingen per categorie.
- Eén regel voor interne overboekingen in alle tegels en grafieken, volgens de instelling.
- Nederlandse labels in alle grafieken en detailvensters; €-bedragen in de hover van `Top tegenrekeningen` en `Categorie-race`.
- Uitgaande rente (`Rente`) wordt niet meer als `Wonen` gecategoriseerd.

### Tooling
- Testsuite (`tests/`, pytest) en GitHub Actions CI; dev-tools verplaatst naar `requirements_dev.txt`.

## 2026-03-07

### Backend verbeteringen
- `api_proxy.py`: `RateLimiter` geheugenfix (onbegrensd groei onder botverkeer); endpoint discovery gecachet na eerste aanroep; vijf `discover_*_endpoints()` functies samengevoegd in één generieke helper; `list_payments_for_account` en `list_card_payments_for_account` samengevoegd met gedeelde paginatie; bool env-helpers; moduleniveau page-size constanten; `executemany` voor batch DB-writes; dode code verwijderd.

### Frontend verbeteringen
- CSS: dubbele `cursor: pointer` classes samengevoegd; dode `.viz-card.featured-card` selector verwijderd; overbodige `max-width` declaraties verwijderd.
- HTML: AOS stylesheet verplaatst naar `<head>` (voorkomt flikkering bij laden); Plotly, Chart.js en Particles.js laden nu met `defer` (blokkeren HTML-parsing niet meer).
- JS: onbereikbare branch verwijderd in `classifyAccountType`; loginknop-icoon wordt nu correct hersteld na een mislukte loginpoging.

### Tooling
- `CLAUDE.md` toegevoegd aan repo root voor Claude Code sessie-context.
- GitHub CLI (`gh`) geïnstalleerd en geauthenticeerd voor remote repo-beheer.

## 2026-03-06

### Functies
- IP-wijziging runbook toegevoegd aan `README.md` / `README-NL.md`: copy/paste blok met drie commando's voor whitelist-update, service-restart en health check.

### Scripts
- `scripts/register_bunq_ip.sh` herschreven: target-IP wordt nu automatisch bepaald (host publieke IPv4 via `curl -4`, container egress als fallback); harde fout als geen publiek IP gevonden; deactivation/cleanup-flow verwijderd.

### Documentatie
- `README.md`, `README-NL.md`, `TROUBLESHOOTING.md`, `TROUBLESHOOTING-NL.md`, `SECURITY.md`, `SECURITY-NL.md`, `SYNOLOGY_INSTALL-NL.md` bijgewerkt met nieuwe IP-registratieflow en advies voor vast/sticky publiek IP.

## 2026-03-01

### Documentatie
- Nederlandstalige user-facing documentatie is taalkundig opgeschoond om onnodig Engels te verminderen, terwijl technische termen waar passend behouden zijn.
- Bijgewerkte bestanden:
  - `README-NL.md`
  - `SECURITY-NL.md`
  - `SYNOLOGY_INSTALL-NL.md`
  - `TROUBLESHOOTING-NL.md`
- Geen runtime- of API-gedragswijzigingen in deze update.

