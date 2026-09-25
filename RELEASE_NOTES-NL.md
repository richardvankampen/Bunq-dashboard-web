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

### Categorieën
- Trefwoorden matchen op hele woorden: namen en woorden als "Bart", "lens", "nov", "Gastouder", "Pinterest" of "Disney Plus" komen niet meer in Horeca, Vervoer, Utilities, Rente of Boodschappen terecht.
- Meer merchantcodes van kaartbetalingen herkend (trein, parkeren, brandstof, vluchten, hotels, bouwmarkten, kleding, opticiens, ziekenhuizen); nieuwe categorieën `Reizen`, `Sport` en `Kinderopvang`; drogisterijen zijn `Zorg`, bij kaartbetaling én overboeking.
- Inkomend geld voor een aankoop (kaartretour, Tikkie voor een gedeeld etentje, eindafrekening energie) telt als terugbetaling in plaats van inkomen in een uitgavencategorie; toeslagen en verzekeringsuitkeringen houden hun categorie.
- Categorienamen zijn Nederlands in het dashboard (`Interne overboeking`, `Terugbetaling`, `Energie & telecom`, `Winkelen`, `Vrije tijd`).
- Opgeslagen transacties worden na een update eenmalig opnieuw gecategoriseerd, zodat verbeterde regels ook voor de historie gelden.

### Inzichten
- Waar het ertoe doet op maandbasis (salaris en huur zijn maandelijks): trend, inkomens-/uitgavenalerts en het venster `Uitgavenmomentum` vergelijken de laatste volledige maand met de maand(en) daarvoor.
- `Liquiditeitsrunway`: gemiddeld maandnetto van volledige maanden per kalenderdag (was: netto van de laatste 30 dagen gedeeld door dagen *met* transacties).
- `Verwacht netto per maand`: maand tot nu toe plus wat er na deze datum meestal nog binnenkomt en uitgaat (was: lineair doortrekken, waardoor een vroeg salaris werd vermenigvuldigd).
- `Terugkerende kosten`: alleen vaste maandposten (±1 betaling per maand, stabiel bedrag); supermarkt en horeca tellen niet meer mee.
- `Uitgavenvolatiliteit`: variabele uitgaven per week zonder vaste lasten (was: per dag, altijd "Hoog" door de huurdag).
- Actieplan: geen "bezuinig hierop"-advies voor wonen en belastingen; besparingshefbomen gebruiken echte maandgemiddelden.
- `Gemiddelde daguitgaven` per kalenderdag van de gekozen periode; Nederlandse labels en `n.v.t.` in kaarten en datakwaliteit; waarschuwing over aantal transacties schaalt mee met de periode.

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

