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

### Opgeslagen gegevens
- De vlag "interne overboeking" van opgeslagen transacties wordt bij elke keer laden opnieuw gecontroleerd met je huidige eigen rekeningen en IBAN's (en tegengestelde boekingen tussen eigen rekeningen) en in de database gecorrigeerd, zodat backend-cijfers zoals datakwaliteit overeenkomen met het dashboard.
- De reserve-saldohistorie uit snapshots gebruikt per rekening het huidige type.

### Categorieëngrafiek
- `Verdeling in categorieën` groepeert filialen net als `Top tegenrekeningen`, en een terugbetaling gaat af van de winkel waar hij vandaan komt in plaats van van alle winkels in de categorie.
- Hover-teksten tonen zinvolle aandelen (uitgaven als % van de inkomsten, categorie als % van de uitgaven, tegenrekening als % van de categorie); duidelijkere labels ("Kleinere categorieën", "Overige tegenrekeningen", "Totaal").
- Nieuw detailvenster met bedrag, aandeel en top 3 tegenrekeningen per categorie, plus de transacties.

### Datakwaliteit
- Waarschuwingen staan er niet meer dubbel in (backend en dashboard hadden elk hun eigen formulering); bij elke waarschuwing hoort één advies.
- Alle dekkingscijfers worden over dezelfde set gemeten: echte uitgaven in je selectie, zonder overboekingen tussen je eigen rekeningen.
- "Laatste synchronisatie" volgt de laatste sync met Bunq, zodat rustige dagen geen waarschuwing "ouder dan 24 uur" meer geven.
- Teksten in het Nederlands, met verwijzingen naar instellingen die je kunt vinden (bv. "Interne overboekingen uitsluiten").

### Inzichten en categorieën
- Nieuwe categorie `Alimentatie` (noodzakelijk, vaste last, geen bezuinigingsadvies). Een afschrijving vanaf een eigen subrekening met een naam die zegt waarvoor die is (bv. "Alimentatie") krijgt die categorie; eigen regels kun je zetten in `config/category_rules.json` (zie README).
- Opgelost: betalingen waarvan de categorie gelijk was aan de naam van een eigen rekening (bv. alimentatie vanaf subrekening "Alimentatie") werden als interne overboeking gezien en vielen uit alle cijfers.
- `Duurste dag` kijkt alleen naar variabele uitgaven; `Aandeel top-tegenrekening` laat wonen, belastingen en alimentatie weg; `Grootste categorie` toont ook de grootste variabele categorie.
- `Liquiditeitsrunway` gebruikt de uitgaven van alle rekeningen, net als het saldo; de maandprognose negeert eigen overboekingen; de volgende beste actie toont de zekerheid; "Laatst bijgewerkt" in het Nederlands.

### Trends
- Tegeltrends voor `Inkomsten` en `Uitgaven` gebruiken dezelfde maandcijfers als de inzichten (inclusief salarismaand-correctie) en vergelijken de laatste volledige maand met maximaal drie maanden daarvoor.
- Pijlen volgen de richting van de verandering (geen vaste pijl omhoog/omlaag meer); de kleur toont of dat gunstig is.
- Periodes korter dan 60 dagen: geen trend voor inkomen of sparen (`n.v.t.`, die zijn maandelijks); de uitgaventrend vergelijkt variabele uitgaven tussen de twee helften.
- Een trend met een kleine vergelijkingsbasis (onder €50) toont het verschil in euro in plaats van een extreem percentage; percentages in Nederlandse notatie met teken (`+12,3%`).

### Spaarquote
- `Spaarquote` toont `n.v.t.` als de selectie geen inkomsten heeft behalve rente (bv. alleen spaarrekeningen geselecteerd), in plaats van `0.0%` of absurde percentages.
- Overboekingen tussen je eigen Triodos-rekening en je spaarrekeningen tellen niet meer als sparen.
- Percentages in Nederlandse notatie (`16,7%`); ontbrekende waarden tonen `n.v.t.`.

### Uitgaven
- Terugbetalingen verlagen nu overal de uitgaven, ook in `Top tegenrekeningen`, `Categorie-race`, de inzichten grootste categorie en top-tegenrekening, `Uitgavenmomentum` en de besparingshefbomen (een geretourneerde bestelling telt niet meer als uitgave).
- Filialen van dezelfde winkel (bv. "Albert Heijn 1234" en "ALBERT HEIJN 5678 UTRECHT") tellen in totalen als één tegenrekening.
- `Dagpatroon` toont alleen variabele uitgaven: incasso's voor vaste lasten worden 's nachts geboekt en lieten de nacht lijken op het grootste uitgavenmoment.
- De waarschuwing over vreemde valuta is in het Nederlands.

### Inkomen
- Salaris wordt vaker herkend (loonbetaling, maandloon, vakantiegeld, eindejaarsuitkering, bonus, 13e maand), en een betaler die elke maand ongeveer hetzelfde bedrag betaalt telt als vast inkomen, ook zonder trefwoord (bv. "Periode 9").
- Nieuwe categorie `Uitkeringen & toeslagen` voor UWV, SVB (kinderbijslag, AOW), pensioenfondsen, DUO-studiefinanciering, toeslagen en gemeentelijke uitkeringen (voorheen `Overig` of `Belastingen`). Opgeslagen transacties worden eenmalig bijgewerkt.
- Overboekingen met je eigen Triodos-rekening zijn geen inkomen of uitgave meer.
- Terugbetalingen staan niet meer als inkomen in `Verdeling in categorieën`; het inkomstenvenster splitst vast en incidenteel inkomen.

### Budget
- 50/30/20, `Noodzaak vs wens` en `Geldstromen` tellen overboekingen tussen je eigen rekeningen nooit mee, ook niet met het filter voor interne overboekingen uit.
- Een terugbetaling verlaagt het soort uitgaven waar hij bij hoort: een energie-eindafrekening verlaagt noodzakelijk, een Tikkie voor een etentje vrij besteedbaar (opgeslagen transacties worden na de update eenmalig bijgewerkt).
- Een salaris dat net over de maandgrens valt (weekend) telt voor de maand waar het bij hoort, zodat geen maand twee salarissen toont en de volgende geen.
- De budgetgrafiek schaalt boven 100% als de uitgaven in een maand hoger zijn dan het inkomen; ongecategoriseerde uitgaven (`Overig`) worden per maand getoond.

### Cashflow
- Terugbetalingen (kaartretour, Tikkie voor een gedeeld etentje) verlagen de uitgaven in plaats van als inkomen te tellen, in de tegels, `Spaarquote`, de cashflow-tijdslijn, de detailvensters en `Geldstromen` (aparte stroom "Terugbetalingen" naar vrij besteedbaar).
- `Cashflow (tijdslijn)` toont staven voor inkomsten en uitgaven per dag (tot 3 maanden), week (tot een jaar) of maand, en het cumulatieve netto sinds het begin van de periode; de grafiek beslaat altijd de hele gekozen periode.
- Tegeltrends vergelijken bij periodes van 60+ dagen de laatste volledige maand met de maanden daarvoor (geen sprongen meer door één vs twee salarissen in een halve periode).
- De periode begint om middernacht Nederlandse tijd, zodat de eerste dag compleet is.

### Sparen
- Saldohistorie (`Spaarrekeningen (totaal)`, `Betaalrekeningen`) wordt voor elke dag van de periode opgebouwd uit de opgeslagen transacties, in plaats van snapshots van dagen waarop het dashboard toevallig open was (geen dips naar €0 meer, geen trends "sinds eerste gebruik"). Saldotrends tonen `n.v.t.` zonder beginsaldo, en een +/−-teken en kleur.
- `Sparen` telt ook overboekingen naar spaarrekeningen die niet geselecteerd zijn, en herkent verplaatsingen tussen spaarrekeningen op rekening, IBAN of naam. `Savings Rate` heet nu `Spaarquote`. Beleggingsrekeningen tellen niet als sparen.
- 50/30/20 en het actieplan noemen inkomen min uitgaven "overgehouden" (inclusief wat op de betaalrekening blijft), zodat het niet meer met `Sparen` wordt verward.
- Rekeningnamen als "Shared household" of "Stockholm reis" worden niet meer als belegging ingedeeld.

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

