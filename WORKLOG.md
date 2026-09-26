# Worklog

Dit bestand houdt een compacte voortgangshistorie bij, zodat chatcontextverlies geen impact heeft.

## 2026-09-26

### Opgeleverd — instellingen gecontroleerd en gecorrigeerd

- Bevindingen en oplossingen:
  1. Rekeningselectie werd server-side gefilterd (`account_ids`), waardoor "alle rekeningen"-cijfers (runway-burn, sparen via overboekingen) alleen de selectie zagen → altijd alle rekeningen ophalen, selectie client-side.
  2. Vinkjes werden direct opgeslagen maar pas bij Opslaan toegepast; sluiten liet opslag en scherm uit elkaar lopen → concept, toegepast bij Opslaan.
  3. "Alles geselecteerd" werd als expliciete ids opgeslagen → later geopende rekeningen vielen stil buiten beeld; verwijderde ids verstoorden de telling → leeg = alles, onbekende ids weg.
  4. Auto-refresh-interval werd pas na herladen actief (en 0 stopte een lopende niet) → herstart bij opslaan; stil vernieuwen zonder laadscherm (dat de pagina verborg en de scrollpositie wiste), pauze bij verborgen tabblad, geen herschudden van demodata.
  5. API-endpoint zonder controle (leeg of ongeldig maakte het dashboard onbruikbaar) → validatie, leeg = standaard, standaard niet opgeslagen.
  6. Interval: NaN/negatief/onbegrensd → hele minuten 0–1440.
  7. Echte-data-schakelaar sloeg `true` op vóór de logincheck → pas opslaan na geldige keuze.
  8. Filter/selectie wijzigen haalde alles opnieuw op (en herschudde demodata) → alleen opnieuw tekenen.
  9. Periode werd niet onthouden → `timeRange` in localStorage.
  10. Helptekst interne overboekingen noemt nu ook gekoppelde externe rekeningen (Triodos); uitleg bij interval en rekeningselectie.
- Verificatie: pytest 337 groen; headless Chromium met gemockte API: verouderde id 99 + alles geselecteerd → `[]`, geen `account_ids` in de request, sluiten zonder opslaan verandert niets, opslaan met 2 van 3 rekeningen → uitgaven €1.814 → €1.214 zonder nieuwe request, interval 5 → timer aan, 0 → uit, ongeldig endpoint → melding en paneel blijft open, leeg → standaard, periode 30 na herladen behouden, geen JS-fouten.

### Opgeleverd — taalkeuze NL/EN in het dashboard

- Vraag: taalswitch NL/EN, met alle getoonde tekst in beide talen.
- Wat: `i18n.js` (t(), locale, DOM-observer voor statische teksten en tooltips, taalknop), `translations.js` (±410 teksten NL→EN en ±140 EN→NL), `app.js` omgezet (samengestelde teksten, grafieklabels, hovertemplates, dialogen, getal-/datumformaat via `uiLocale()`, Plotly-locale `nl`, herrender bij taalwissel incl. open detailvenster), knop in `index.html` + CSS, fullscreen-selectors via `data-action`. Nederlandse bronteksten die nog Engels bevatten ("Login required om …", "target", "cuts", "Top merchant") vernederlandst. `STATIC_FILES` en Dockerfile uitgebreid met de twee nieuwe bestanden. NL-docs gebruiken nu de Nederlandse knopnamen van het beheeronderhoud.
- Verificatie: pytest 337 groen (nieuw `tests/test_translations.py`: alle t()-teksten en index.html-teksten hebben een vertaling, placeholders kloppen, categorieën); headless Chromium met demodata: EN en NL volledig (tegels, alle grafieken incl. Sankey/sunburst/heatmap, 13 detailvensters, inzichten, instellingen), wissel heen en terug en herladen met opgeslagen taal, geen JS-fouten.

### Opgeleverd — documentatie bijgewerkt, EN en NL gelijkgetrokken

- Waarom: EN-versies van SECURITY/SYNOLOGY_INSTALL/TROUBLESHOOTING waren samenvattingen ("Dutch (full original)"), NL-versies deels Engels; troubleshooting had per taal andere secties; docs bevatten verouderde knopnamen ("Admin Maintenance (P1)", "Run maintenance now"), placeholder "[your-email]", niet-bestaand backuppad, compose-snippet met variabelen die compose niet doorgeeft, en een README-featurelijst met oude widgets ("3D time-space chart").
- Wat: SECURITY, SYNOLOGY_INSTALL en TROUBLESHOOTING in beide talen herschreven met identieke opbouw (NL = vertaling van EN); troubleshooting samengevoegd (login, CORS, sessie, performance/truncatie, categorieën, spaarrekeningen + raw debug, handige commando's, diagnostiekpakket, hulp) en hernummerd 1–12; README EN/NL: actuele features en widgets, overzicht van alle taalparen; RELEASE_NOTES EN/NL: sectie Documentatie; installatiegids verwijst naar de meegeleverde `docker-compose.yml` i.p.v. een eigen kopie; `.env`-tabel splitst compose-variabelen en code-only variabelen.
- Resultaat: alle vijf docparen hebben evenveel koppen en regels (behalve README/RELEASE_NOTES met ±1 regel); feiten gecontroleerd tegen `api_proxy.py`, `index.html` en `docker-compose.yml`.

### Opgeleverd — opgeslagen gegevens volgen de actuele logica

- Controle: categorieën en `refund_category` worden al per regelversie herberekend; weergavelogica is live en hoeft niet in de database. Twee gaten gedicht:
  1. `is_internal_transfer` werd alleen bij ophalen bepaald (met de toen bekende eigen rekeningen/IBAN's; koppeling van tegengestelde boekingen alleen in het geheugen) → bij elke load opnieuw bepaald en nieuw herkende interne overboekingen teruggeschreven; een refetch haalt de vlag niet meer weg.
  2. Snapshot-fallback van de saldohistorie gebruikte het rekeningtype van die dag → type uit de meest recente snapshot.
- Verificatie: pytest 310 groen (nieuw: vlag via nieuw bekende eigen IBAN teruggeschreven; koppeling tegengestelde boekingen opgeslagen en blijft na reconcile; snapshot-historie met gecorrigeerd type).

### Opgeleverd — categorieëngrafiek gecontroleerd en gecorrigeerd

- 5 bevindingen opgelost: filialen apart binnen categorieën → gegroepeerd zoals Top tegenrekeningen; terugbetaling verlaagde alle winkels in de categorie → gaat af van de eigen winkel; betekenisloze "% van bovenliggend" op het hoogste niveau → % van inkomsten/uitgaven/categorie; labels ("Overig categorieen", "Overig winkels", "Alles") → "Kleinere categorieën", "Overige tegenrekeningen", "Totaal"; geen detailvenster → knop met tabel (bedrag, aandeel, top 3 tegenrekeningen) en transacties.
- Verificatie: headless Chromium: Coolblue €400 − €300 retour = €100 terwijl Bol.com €50 blijft, Albert Heijn 1234 + 5678 = €80, Uitgaven "49,7% van de inkomsten", detailvenster met 4 categorieën, geen JS-fouten; pytest 307 groen.

### Opgeleverd — datakwaliteit gecontroleerd en gecorrigeerd

- 6 bevindingen opgelost: dubbele waarschuwingen (backend + frontend in andere woorden, telling tot 2× te hoog) → één lijst; popup mengde selectie-aantallen met backend-bedragen → alles uit dezelfde set; interne overboekingen telden als goed gecategoriseerde uitgave (en Triodos als ongecategoriseerd) → echte uitgaven; "cache ouder dan 24 uur" op rustige dagen → versheid uit laatste sync; vaste drempel 120 in backend → geschaald; Engelse/technische teksten (`Unknown`, `exclude_internal=true`, FX-advies, "non-EUR", "real data") → Nederlands.
- Verificatie: pytest 307 groen (nieuw: interne overboeking geen uitgave in backend-metrics; versheid volgt laatste sync); headless Chromium met gemockte backend-samenvatting met dubbele waarschuwingen en afwijkend bedrag: één waarschuwing, bedragen gelijk aan aantallen-basis, geen JS-fouten.

### Opgeleverd — inzichten opnieuw gecontroleerd + alimentatie + eigen categorieregels

- 7 bevindingen opgelost: Duurste dag (was huur-/alimentatiedag) → alleen variabele uitgaven; Aandeel top-tegenrekening (was verhuurder) → zonder wonen/belastingen/alimentatie; Liquiditeitsrunway: burn over alle rekeningen zoals het saldo, Nederlandse notatie; Verwacht netto en runway-fallback zonder eigen overboekingen; Grootste categorie + grootste variabele; "zekerheid x%" met uitleg; "Last updated" → "Laatst bijgewerkt".
- Gebruiker: alimentatie gaat vanaf eigen subrekening "Alimentatie" naar een persoon, zonder trefwoord. Nieuwe categorie `Alimentatie` (trefwoorden + hint uit eigen rekeningnaam, noodzakelijk/vast/niet-stuurbaar) en eigen regels in `config/category_rules.json` (niet in git; geen namen in code). `CATEGORIZATION_VERSION` 5 (+ hash eigen regels).
- Gevonden bij de browsercheck: `isInternalOwnTransfer` zag categorie = eigen rekeningnaam als interne overboeking, waardoor de alimentatie vanaf "Alimentatie" uit alle cijfers verdween → check verwijderd.
- Verificatie: pytest 305 groen; headless Chromium: alimentatie €800/mnd vanaf subrekening telt als noodzakelijk (N 108% bij €2.000 inkomen), Duurste dag = boodschappendag, top-tegenrekening Albert Heijn (71,4% van stuurbare uitgaven), runway 1.479 dagen ook met alleen de betaalrekening geselecteerd (was ∞), geen JS-fouten.

### Opgeleverd — trendlogica gecontroleerd en gecorrigeerd

- 6 bevindingen, allemaal opgelost:
  1. Tegeltrends zonder salarismaand-correctie en met andere basis (3 vs 2 maanden) dan inzichten → één maandbasis (`summarizeCompleteMonths`), overal tot 3 eerdere maanden.
  2. Vaste pijlen in de HTML (Inkomsten ↑, Uitgaven ↓, Sparen ↑) → pijl volgt de richting (`setTrendArrow`).
  3. Korte periodes (<60 dagen): Inkomsten/Sparen `n.v.t.`, Uitgaven op variabele uitgaven per halve periode.
  4. Kleine basis gaf extreme percentages → verschil in euro bij basis <€50.
  5. `12.3%` zonder teken → `+12,3%`; alle `%`-teksten in Nederlandse notatie.
  6. Saldotrend-tooltip noemt nu de werkelijke startdatum van de saldohistorie.
- Verificatie: headless Chromium (180 dagen, salaris één keer op de 30e): Inkomsten `+14,0%` (extra uitkering/verkoop, geen salarissprong), Uitgaven `-1,5%` met pijl ↓ en groen, Sparen `+€ 300,00` (kleine basis), saldotrend met startdatum; 30 dagen: Inkomsten/Sparen `n.v.t.`, Uitgaven op variabele uitgaven; inzicht "1,5% lager"; geen JS-fouten; pytest 298 groen.

### Opgeleverd — spaarquote gecontroleerd en gecorrigeerd

- 4 bevindingen, allemaal opgelost:
  1. Zonder inkomsten toonde `Spaarquote` `0.0%` → `n.v.t.` met uitleg.
  2. Alleen spaarrekeningen geselecteerd → noemer was alleen rente (bv. 20000%) → `n.v.t.` zonder inkomsten behalve rente.
  3. Overboekingen tussen eigen Triodos-rekening en spaarrekeningen telden als sparen → uitgesloten uit `Sparen`/`Spaarquote`/`Spaarrekening mutaties` (keuze gebruiker).
  4. Percentages `16.7%` en `N/A` → Nederlands formaat `16,7%`, `n.v.t.`.
- Verificatie: headless Chromium met gemockte API: Sparen €1.005 zonder €2.000 van Triodos, Spaarquote `16,7%`, alleen spaarrekeningen → `n.v.t.` met tooltip, geen JS-fouten; pytest 298 groen.

### Opgeleverd — uitgavenlogica gecontroleerd en gecorrigeerd

- Review van alle uitgavenweergaven; 5 bevindingen, allemaal opgelost:
  1. Terugbetalingen telden nog als uitgave in Top tegenrekeningen, Aandeel top-tegenrekening, Grootste categorie, Uitgavenmomentum, Categorie-race en besparingshefbomen → `spendingEntries`/`netSpendingByMerchant`/`buildExpenseByCategory` netto.
  2. Filialen (Albert Heijn 1234 / 5678 UTRECHT NLD) telden als aparte tegenrekeningen → `merchantGroupLabel` voor totalen (ook terugkerende kosten en hefbomen).
  3. `Dagpatroon` werd gedomineerd door nachtelijke incasso's van vaste lasten → alleen variabele uitgaven, hover-tekst aangepast.
  4. Categorie-race negeerde terugbetalingen → daalt nu op de dag van de terugbetaling.
  5. Engelse waarschuwing over vreemde valuta → Nederlands, noemt dat totalen te laag kunnen zijn.
- Verificatie: pytest 298 groen; headless Chromium met gemockte API: Albert Heijn 1234 + ALBERT HEIJN 5678 UTRECHT NLD = één regel €80 (na €10 terugbetaling), geretourneerde Coolblue-bestelling €0 (niet in top/categorieën, race Winkelen €0), Dagpatroon zonder huur ('s nachts €0), geen JS-fouten.

### Opgeleverd — inkomenslogica gecontroleerd en gecorrigeerd

- Review van inkomensregels (backend-categorisatie van inkomend geld, tegels, popups, budget, categorieën, `/api/statistics`); 6 bevindingen + gebruikerswens, allemaal opgelost:
  1. Salaris vaak `Overig` (loonbetaling, maandloon, vakantiegeld, eindejaarsuitkering, bonus) → uitgebreide salarisregels.
  2. Geen herkenning van vast inkomen zonder trefwoord ("Periode 9") → `detectRecurringIncomeSources` (mediaan ±25%, ≥3 maanden ≥€250), ook in salarismaand-correctie.
  3. Uitkeringen/pensioen/toeslagen in `Overig`/`Belastingen` → nieuwe categorie `Uitkeringen` (`Uitkeringen & toeslagen`); `CATEGORIZATION_VERSION` 4.
  4. `Verdeling in categorieën` telde terugbetalingen als inkomen → verlagen nu hun aankoopcategorie.
  5. `/api/statistics` telde terugbetalingen als inkomen → gelijk aan tegels.
  6. Geen onderscheid vast/incidenteel → inkomstendetail splitst en toont incidentele posten.
  - Gebruikerswens: overboekingen met eigen Triodos-rekening zijn geen inkomen (en geen uitgave); Triodos blijft buiten de interne-overboekingsvlag.
- Verificatie: pytest 298 groen, pyflakes schoon; headless Chromium met gemockte API: inkomen €16.450 (excl. €1.000 van Triodos en €20 terugbetaling), uitgaven €5.180 (excl. €500 naar Triodos), werkgever "Periode x" herkend als vast inkomen en salaris van de 30e naar de juiste maand (elke maand €3.200), popup vast €16.300 / incidenteel €150, categorie-ring zonder terugbetaling als inkomen, geen JS-fouten.

### Opgeleverd — budgetlogica gecontroleerd en gecorrigeerd

- Review van 50/30/20 (`summarizeMonthlyBudgetDiscipline`), `Noodzaak vs wens`, budgetgrafiek/-detail en `Geldstromen`; 7 bevindingen, allemaal opgelost:
  1. Met interne-overboekingen-filter uit telden eigen overboekingen als inkomen/vrij besteedbaar → budgetweergaven sluiten ze altijd uit.
  2. Alle terugbetalingen verlaagden vrij besteedbaar (ook energie-eindafrekening) → backend bewaart `refund_category` (`CATEGORIZATION_VERSION` 3, eenmalige migratie), frontend verlaagt de juiste bak.
  3. `Noodzaak vs wens` negeerde terugbetalingen → nu verrekend.
  4. Salaris net over de maandgrens (weekend) gaf maand met 2 en maand met 0 salarissen → `assignSalaryMonths`.
  5. Budgetgrafiek afgekapt op 100% → y-as tot hoogste waarde.
  6. `Overig` verdween ongezien in vrij besteedbaar → per maand zichtbaar (hover, detailrijen, samenvatting).
  7. Terugbetalingen boven vrij besteedbaar vielen weg → gaan van noodzakelijk af (`applyBudgetRefunds`).
- Verificatie: pytest 280 groen, pyflakes schoon; headless Chromium met gemockte API (filter uit, salaris 1e van de maand met één keer op de 29e): alle maanden €3.000 inkomen, overboekingen naar spaar genegeerd, energie-terugbetaling €80 verlaagt noodzakelijk en Tikkie €20 vrij besteedbaar, Geldstromen splitst Terugbetalingen naar beide bakken, samenvatting toont Overig-aandeel, geen JS-fouten.

### Opgeleverd — cashflowlogica gecontroleerd en gecorrigeerd

- Review van `Inkomsten`/`Uitgaven`, `Cashflow (tijdslijn)`, `Geldstromen`; 6 bevindingen, allemaal opgelost:
  1. Terugbetalingen telden als inkomen (Inkomsten én Uitgaven te hoog, Spaarquote te laag, anders dan 50/30/20) → verlagen nu uitgaven in tegels, cashflow, popups, gem. daguitgaven en Geldstromen (knoop `Terugbetalingen` → `Vrij besteedbaar`).
  2. Tijdslijn/sparklines/trends liepen van eerste tot laatste transactie → altijd periodebegin t/m vandaag.
  3. Tegeltrends (halve periodes) sprongen door 1 vs 2 salarissen → ≥60 dagen: laatste volledige maand vs eerdere volledige maanden.
  4. Tijdslijn met dagelijkse netto-pieken → staven per dag/week/maand + cumulatief netto op rechteras (nullijnen uitgelijnd).
  5. Backend-periode begon op "nu − N dagen" (UTC) → `period_cutoff`: middernacht Nederlandse tijd.
  6. Tegel en detail hadden elk eigen grafiekcode → `buildCashflowFigure`.
- Verificatie: pytest 274 groen, pyflakes schoon; headless Chromium (gemockte API, 90 dagen): inkomsten €9.000 excl. €90 terugbetalingen, uitgaven €4.323 netto, 91 dagpunten vanaf periodebegin, dagstaven bij 90 / week bij 365 / maand bij 1000 dagen, cumulatief eindigt op netto €4.677, Geldstromen met knoop Terugbetalingen, trend-tooltip "aug 26 t.o.v. gemiddelde van jul 26", geen JS-fouten.

## 2026-09-25

### Opgeleverd — spaarlogica gecontroleerd en gecorrigeerd

- Review van spaarrekening-classificatie, `Sparen`/`Savings Rate`, saldo-tegels en 50/30/20; 8 bevindingen, allemaal opgelost:
  1. Saldohistorie alleen uit snapshots (dagen waarop het dashboard open was; ontbrekende spaarsnapshot = €0-dip; oude classificatie) → `build_balance_history_from_store()` reconstrueert uit de transactie-opslag per Nederlandse dag; snapshots alleen als fallback.
  2. Frontend-fallback reconstrueerde uit gefilterde data (interne overboekingen eruit → spaarlijn vlak) → ongefilterde data.
  3. Rekeningnaam "Shared household"/"Stockholm reis" → belegging → korte hints alleen als heel woord (backend + frontend); frontend volgt backend-type.
  4. `Sparen` = €0 als spaarrekeningen niet geselecteerd → overboekingen vanaf geselecteerde rekeningen naar niet-geselecteerde spaarrekeningen tellen mee.
  5. Twee betekenissen van "sparen" → 50/30/20 en actieplan heten nu "overgehouden" (inkomen − uitgaven), met uitleg; `Sparen` = stortingen op spaarrekeningen.
  6. Spaar→spaar alleen via backend-vlag → ook op id/IBAN/naam.
  7. Saldotrend `0.0%` bij startwaarde 0, geen kleur, `N/A` → `n.v.t.`, +/−-teken en kleur.
  8. `Savings Rate` → `Spaarquote`; hover-teksten voor Spaarrekeningen/Sparen/Spaarquote/50/30/20-fit.
- Beslissing gebruiker: beleggingsrekeningen tellen niet mee in `Sparen`/`Spaarquote`.
- Verificatie: pytest 273 groen, pyflakes schoon; headless Chromium met gemockte API (3 rekeningen): Sparen €1.005 (2× €500 + €5 rente, spaar→spaar €200 via IBAN uitgesloten), alleen betaalrekening geselecteerd → €1.000 via overboekingen, spaarsaldo-trend +13,2% uit ongefilterde data, label Spaarquote, geen JS-fouten.

### Opgeleverd — categorisatielogica gecontroleerd en gecorrigeerd

- Review van `categorize_transaction` + frontendgebruik; 8 bevindingen, allemaal opgelost:
  1. Substring-matching: `bar` → Bart/Barbershop (Horeca), `ns`/`ov` → "lens"/"nov" (Vervoer), `gas` → Gastouder/Vegas, `interest` → Pinterest, `plus` → Disney Plus (Boodschappen), `dirk` → elke Dirk, `wage` → Wagenaar (Salaris), enz. → hele-woord-matching (`words`) + lange stammen voor samenstellingen (`stems`), accenten genegeerd, specifieke regels vóór generieke.
  2. Opgeslagen categorieën werden nooit bijgewerkt na regelwijzigingen → `migrate_stored_categories()` per `CATEGORIZATION_VERSION` bij opstart; payload bewaart nu MCC + tegenrekeningnaam.
  3. Ontbrekende MCC's (trein 4112, parkeren 7523, brandstof 5983, vliegen/hotels, bouwmarkt, kleding, opticien, ziekenhuis, …) toegevoegd.
  4. Drogisterij inconsistent (MCC → Zorg, tekst → Shopping) → beide `Zorg`.
  5. Geen regels voor sport, kinderopvang, reizen, bouwmarkten → nieuwe categorieën `Sport`, `Kinderopvang`, `Reizen`; bouwmarkt → Shopping.
  6. Inkomend geld kreeg uitgavencategorieën (Tikkie "pizza" = inkomen Horeca) → `Refund`, behalve Belastingen/Verzekering/Wonen.
  7. Engelse categorienamen in de UI → Nederlandse weergavenamen (`CATEGORY_DISPLAY_NAMES`).
  8. Tests dekten geen fout-positieven → regressietests voor alle bovenstaande gevallen + migratie.
- Verificatie: pytest 260 groen, pyflakes schoon; headless Chromium met gemockte API: alle categorieën Nederlands met eigen kleur, Kinderopvang/Energie & telecom als noodzakelijk en vaste last, geen JS-fouten.
- Na deploy: eerste start hercategoriseert de opgeslagen transacties eenmalig (log `🏷️ Recategorised N stored transaction(s)`). De eerstvolgende maandcontrole werkt daarna de hash bij van rijen die Bunq nog aanlevert (nieuwe payloadvelden); dat telt eenmalig als "bijgewerkt".

### Opgeleverd — inzichtlogica gecontroleerd en gecorrigeerd

- Review van alle 13 inzichtkaarten + actieplan; 10 bevindingen, allemaal opgelost:
  1. Runway/buffer-acties: 30d-netto gedeeld door dagen *met* transacties → nu gem. maandnetto volledige maanden / 30,44 (`computeDailyBurn`).
  2. Verwacht netto: lineaire extrapolatie → maand tot nu toe + typisch restant na deze dag uit recente maanden (`projectCurrentMonthNet`).
  3. Terugkerende kosten: elke tegenrekening in 2–3 maanden telde mee (supermarkt, horeca) → alleen ±1 betaling/maand met stabiel bedrag.
  4. Trend en inkomens-/uitgavenalerts: rollende 30d-vensters (0 of 2 salarissen mogelijk) → laatste volledige maand vs daarvoor; momentum-venster idem.
  5. Volatiliteit: dagelijks incl. huurdag (altijd Hoog) → wekelijkse variabele uitgaven zonder vaste lasten.
  6. Besparingshefbomen: maandbedrag × 30/actieve dagen → echte maandgemiddelden.
  7. Actieplan adviseerde huur/verhuurder te verlagen → Wonen/Belastingen uitgesloten van zulk advies.
  8. Gemiddelde daguitgaven: tooltip zei "per actieve dag", nu per kalenderdag van de gekozen periode.
  9. Engelse labels/N/A in datakwaliteit en kaarten → Nederlands, `n.v.t.` (ook backend-waarschuwingen).
  10. Datakwaliteit: vaste drempel 120 transacties → schaalt met periode; interne-overboekingsaandeel op ongefilterde data.
- `index.html`: hover-teksten van 6 inzichtkaarten aangepast aan de nieuwe berekening. `RELEASE_NOTES(-NL).md`: sectie Inzichten.
- Verificatie: headless Chromium (Europe/Amsterdam) met gemockte API: burn €9,86/dag bij −€300/mnd; prognose €2.000 bij salaris op de 1e en huur later (i.p.v. vermenigvuldigd); terugkerend = Verhuurder + Netflix (niet Albert Heijn); stabiele weekuitgaven + huur → Laag; actieplan zonder huuradvies; alle gewijzigde vensters openen zonder JS-fouten. pytest 208 groen.

### Opgeleverd — grafieklogica gecontroleerd en gecorrigeerd

- Review van alle grafieken en tegels in `app.js`; 9 bevindingen, allemaal opgelost:
  1. Dagen werden in UTC gegroepeerd (`toISOString`) → betalingen 00:00–02:00 NL-tijd op vorige dag; nu lokale datum (`toDateKey`/`dateFromKey`).
  2. `Sparen`-trend/sparkline toonden inkomsten−uitgaven i.p.v. spaarmutaties; nu dezelfde data als het getal.
  3. Trend gaf `0.0%` als eerste helft ≤ 0; nu `n.v.t.` (`calculateHalfPeriodChange`, `setTrendIndicator`), netto-reeksen t.o.v. |eerste helft|.
  4. Budgetdiscipline: partiële eerste maand weggelaten, lopende maand gemarkeerd, refunds verlagen vrij besteedbaar, maanden zonder inkomen als gat; inzichten/actieplan/detail op laatste volledige maand.
  5. Spreidingsgrafiek (Maandverdeling): vaste bedragklassen i.p.v. lineair tot grootste betaling; top 4 op bedrag; % per categorie.
  6. Interne overboekingen: één regel (`isInternalOwnTransfer`) voor alle grafieken via `applyClientFilters`; Verdeling/Top tegenrekeningen filterden eerder ook bij uitgeschakelde instelling.
  7. `Sparen` negeerde rekeningselectie; nu `buildSavingsWidgetTransactions` via `applyClientFilters`.
  8. Engelse labels vertaald (Cashflow, Geldstromen, Verdeling, Budgetdiscipline, detailvensters, actieplan).
  9. Hover met € en 2 decimalen in Top tegenrekeningen en Categorie-race.
- `index.html`: kop `Budgetdiscipline (50/30/20)`. `RELEASE_NOTES(-NL).md`: sectie 2026-09-25 (alle wijzigingen van vandaag).
- Verificatie: headless Chromium (Europe/Amsterdam) met gemockte API en lokale Plotly 2.27.0/Chart.js 4.4.0: functiechecks (dag-sleutel 00:30, trend n.v.t., budget-maanden/refund, spreiding, interne regel, Sparen-filter) kloppen; alle grafieken en gewijzigde detailvensters renderen zonder JS-fouten. `node --check` OK; pytest 208 groen.

### Opgeleverd — dashboard laden sneller (achtergrond-sync, rekeninglijst-cache, card-backoff)

- Productielogs na de transactie-opslag: herladen even traag als eerste load. Oorzaak niet de transacties (pagina uit opslag: 0,05s) maar Bunq-calls vóór het lezen:
  - `list_monetary_accounts()` ~6,5s (SDK + 6 raw savings-fallback calls), bij élke request (accounts + elke transactiepagina);
  - incrementele check na >60s: ~23,5s (13 rekeningen × payment-check + mislukkende card-payment-endpoint die nooit werd overgeslagen).
- `api_proxy.py`:
  - `get_monetary_accounts()`: cache per proces (vers 60s, daarna geserveerd + achtergrond-refresh tot 30 min); gebruikt in `/api/accounts`, `/api/transactions`, `/api/statistics`. Reconcile blijft live ophalen. Cache geleegd na fork.
  - `load_transactions`: als opslag de periode dekt (`store_covers_period`) → direct uit opslag + `_start_background_sync`; anders blokkerende sync (eerste load / langere periode).
  - card-payment fout → backoff per rekening (`SOURCE_FAILURE_BACKOFF_SECONDS`, 1u).
  - achtergrondtaken resetten de Bunq-context bij `UnauthorizedException` (zoals de request-handlers).
- Tests: 5 nieuwe (direct serveren zonder wachten, blokkerend bij ontbrekende periode, achtergrond-sync slaat nieuwe op, card-backoff, rekeninglijst-cache); fixtures joinen achtergrondthreads en legen module-caches. Suite: 208 groen.
- Docs: TROUBLESHOOTING EN/NL 5b, `.env.example`, `CLAUDE.md`.

### Opgeleverd — transactie-opslag met incrementele sync en maandelijkse controle

- Analyse vooraf: de DB was alleen een bijproduct. Transacties werden nooit uit de DB gelezen; elke request haalde de hele periode opnieuw uit Bunq (per pagina opnieuw, cache-key per pagina). Sleutel `transaction_cache` = hash incl. bedrag/omschrijving → wijzigingen bij Bunq gaven dubbele rijen; verwijderingen werden nooit verwerkt; `/api/statistics` persisteerde niet; `exclude_internal=true` filterde vóór opslaan.
- `api_proxy.py`:
  - nieuwe tabellen `bunq_transactions`, `bunq_sync_state`, `bunq_reconcile_runs`, `app_state`; `transaction_cache` niet meer gebruikt.
  - `_list_payments_paginated`: `stop_at_id` (stop bij bekend nieuwste id) en `start_older_id` (backfill); zelfde gedocumenteerde `older_id`-paginatie.
  - `normalize_bunq_payment()` uit `get_account_transactions` gehaald (gedeeld door live pad, sync en controle).
  - `load_transactions()` / `sync_transactions()` / `read_stored_transactions()`: `/api/transactions` en `/api/statistics` lezen na incrementele sync uit de opslag.
  - `run_full_reconcile()` + `reconcile_account_source()`: nieuw/gewijzigd/hersteld/verwijderd; verwijderen alleen binnen door Bunq aangeleverd bereik; te oude rijen blijven zichtbaar.
  - scheduler (`start_reconcile_scheduler`, via Gunicorn `post_worker_init`), `is_reconcile_due`, file-lock; admin `GET/POST /api/admin/reconcile`.
  - data-quality summary leest `bunq_transactions` (zonder verwijderde rijen), versheid via `last_seen_at`.
- `requirements_web.txt`: `tzdata` (tijdzone voor schema in slim image). `.env.example`: optionele `SYNC_MIN_INTERVAL_SECONDS`/`RECONCILE_*`.
- Docs: TROUBLESHOOTING EN/NL 5b, CLAUDE.md sectie Transaction store.
- Tests: `tests/test_transaction_store.py` (29 tests; nep-Bunq via echte paginatie). Suite: 203 groen. Smoke-test Gunicorn met DB: tabellen aangemaakt, scheduler actief, admin-endpoint OK.
- Let op: eerste load na deploy vult de nieuwe tabel vanuit Bunq (zelfde duur als voorheen); daarna alleen nieuwe data. Eerste maandelijkse controle draait de eerstvolgende nacht (nog geen succesvolle run deze maand).

### Opgeleverd — API key nog maar 1x ophalen bij opstarten

- Voorheen per start 4+ Vaultwarden-fetches (~35s elk): preboot-import, preboot `init_bunq(refresh_key=True)`, import per Gunicorn-worker, en opnieuw bij elke worker-recycle (`max_requests`).
- `scripts/run_server.sh`: los Python-preboot-blok verwijderd; Gunicorn draait met `--preload` (app + key 1x geladen in de master).
- `scripts/gunicorn_conf.py`: `on_starting` → `run_preboot_init()` (init met `refresh_key=False` + auto-whitelist, 1x in master); `post_fork` → `reset_bunq_state_after_fork()` (geërfde Bunq-state wissen, key behouden); `post_worker_init` blijft de warm-up per worker starten.
- `api_proxy.py`: `run_preboot_init()` en `reset_bunq_state_after_fork()` toegevoegd.
- Gevolg: na key-rotatie in Vaultwarden de service herstarten (gedocumenteerd in TROUBLESHOOTING EN/NL).
- Tests: 5 nieuwe (hooks, preboot, fork-reset); 174 groen. Smoke-test met echte Gunicorn (`--preload`, 2 workers, `--max-requests 2`): 1 key-fetch over master + 6 (gerecyclede) workers; preboot 1x in master mét whitelist, workers zonder; `/api/health` direct `initialized`.

### Opgeleverd — Bunq warm-up per Gunicorn-worker

- Nieuw `scripts/gunicorn_conf.py` (`post_worker_init`) → `api_proxy.start_background_bunq_init()`: elke worker initialiseert zijn eigen BunqContext direct bij start in een achtergrondthread.
- `ensure_bunq_context_for_api_requests` wacht (max `BUNQ_WARMUP_WAIT_SECONDS`, default 60s) op een lopende warm-up, zodat eerste requests niet door de retry-throttle zonder Bunq-context doorlopen. Probes (`/api/live`, `/api/health`, `/api/ready`) wachten nooit.
- `scripts/run_server.sh`: Gunicorn start met `--config scripts/gunicorn_conf.py`; `Dockerfile` kopieert het bestand.
- Reden: preboot-init draait in een apart proces; workers hadden pas na het eerste echte API-request een Bunq-context. `/api/health` rapporteerde daardoor `api_key_only` (HTTP 503) terwijl alles werkte.
- Tests: `tests/test_worker_warmup.py` (5 tests); smoke-test met echte Gunicorn (2 workers): beide workers starten init zonder request, `/api/live` 200.

### Opgeleverd — healthcheck start-periode 20s → 300s

- `docker-compose.yml`, `Dockerfile`, `SYNOLOGY_INSTALL-NL.md`: healthcheck `start_period` van 20s naar 300s.
- Reden: op productie werd de container herhaaldelijk als `unhealthy` gekild (exit 137). Opstarten haalt de API key meerdere keren uit Vaultwarden (~35s per keer: import in preboot, `init_bunq(refresh_key=True)`, import per Gunicorn-worker) voordat `/api/live` antwoordt; 20s + 3×30s was te kort.
- Mede-oorzaak op de NAS: `.env` had `VAULTWARDEN_ITEM_NAME` met kleine `k` (`Bunq API key`), vault-item heet `Bunq API Key` → key niet gevonden, extra vertraging. Handmatig gecorrigeerd in `.env`.
- `TROUBLESHOOTING(.md|-NL.md)`: sectie 4b toegevoegd (exit 137 unhealthy + item-naam hoofdlettergevoelig, directe fix via `docker service update --health-start-period`).
- Vervolgkandidaat (niet gedaan): dubbele key-fetch bij opstarten verminderen.

### Opgeleverd — `config/` in `.gitignore`

- `.gitignore`: `/config/` toegevoegd (runtime-state: Bunq context, `vaultwarden_device_id`, history-DB; bind-mount naar `/app/config`).
- Reden: op de NAS was `config/vaultwarden_device_id` per ongeluk in een lokale commit beland; bij `git reset --hard origin/main` zou dat live bestand verwijderd worden (nieuw Vaultwarden device-ID). Op `main` stond niets onder `config/` in git.
- NAS-herstel (handmatig uitgevoerd): lokale commits bewaard in branch `nas-backup-20260925` + stash, device-ID veiliggesteld, reset naar `origin/main`, compose-overrides verplaatst naar `.env` (`VAULTWARDEN_EXTRA_HOST` toegevoegd; `VAULTWARDEN_URL`/`ALLOWED_ORIGINS` stonden er al).

### Opgeleverd — dev-dependencies gesplitst

- `requirements_web.txt`: `pytest` en `black` verwijderd; bevat nu alleen runtime-dependencies (dit bestand wordt in de Docker image geïnstalleerd).
- Nieuw `requirements_dev.txt`: `-r requirements_web.txt` + `pytest`, `pyflakes`, `black` (versies gepind).
- `.github/workflows/tests.yml`: installeert `requirements_dev.txt` (pip-cache key op beide bestanden).
- `README.md` / `README-NL.md`, `CLAUDE.md`: test-instructies en dependency-overzicht bijgewerkt.
- Effect: Docker image bevat geen test/format-tooling meer (kleiner, minder attack surface). De pip-layer wordt bij de volgende image-build opnieuw gebouwd omdat `requirements_web.txt` wijzigt.

### Opgeleverd — categorisatie: uitgaande rente niet meer als `Wonen`

- `api_proxy.py` `categorize_transaction`: `rent` matcht nu alleen als heel woord (`\brent\b`); daarna nieuwe regel `rente`/`interest` → `Rente` (ongeacht teken).
  - Reden: substring `'rent'` matchte ook `Rente`/`Debetrente`, waardoor uitgaande rente als `Wonen` (essentiële uitgave) telde.
  - Hypotheekrente blijft `Wonen` (via `hypotheek`, dat eerder wordt gecontroleerd).
- `tests/test_categorization.py`: regressietests (`Rente`, `Debetrente`, `Interest charge` → `Rente`; `Hypotheekrente`, `Rent march` → `Wonen`; `Parenting` → niet `Wonen`). Falen op oude code, slagen nu.
- Effect: bestaande transacties met rente in de omschrijving verschuiven bij volgende ophaling van `Wonen` naar `Rente`.
- Resultaat: 164 tests groen, `pyflakes` schoon.

### Opgeleverd — pytest-suite voor api_proxy.py

- Nieuwe map `tests/` (158 tests, draait in <1s, geen netwerk/Bunq/Vaultwarden/Docker nodig):
  - `conftest.py`: zet env vóór import (`USE_VAULTWARDEN=false`, lege `BUNQ_API_KEY`, `BUNQ_INIT_AUTO_ATTEMPT=false`, `DATA_DB_ENABLED=false`, vaste testcredentials) en reset de globale rate limiter per test.
  - `test_helpers.py`: env/config helpers, `safe_float`, `parse_monetary_value`, `clamp_days`, `parse_pagination`, IBAN/alias-extractie, datetime/IPv4-validatie, whitelist-helpers, `RateLimiter` (limieten, window, sweep).
  - `test_internal_transfers.py`: `is_own_bunq_account` (Triodos `MonetaryAccountExternal` niet intern, `ExternalSavings` wel), eigen account-ids/IBANs, `reconcile_internal_transfers` (payment-id + minuut + bedrag + valuta, tegengesteld teken, verschillende eigen rekeningen).
  - `test_categorization.py`: MCC-mapping, tekstregels, inkomende-bedragregels, `classify_account_type`.
  - `test_auth_routes.py`: login/logout/status, cookie-flags, login rate limit (5/min → 429), 401 op beschermde endpoints, verlopen/ongeldige sessie, static allowlist (geen `api_proxy.py`/`.env` etc.), liveness/readiness.
- `README.md` / `README-NL.md`: sectie over tests draaien toegevoegd.
- `.github/workflows/tests.yml`: GitHub Actions draait `pyflakes` + `pytest` (Python 3.11, gelijk aan Dockerfile) op elke PR en push naar `main`.
- Bevinding (niet gewijzigd): `categorize_transaction` matcht `'rent'` als substring, waardoor een uitgaande `Rente`-betaling als `Wonen` wordt gecategoriseerd.
- Lokale noot: `bunq-sdk==1.28.0` bouwt niet met Debian's systeem-setuptools (`install_layout`-fout); in een venv met recente setuptools wel.
- Resultaat: `pytest tests` 158 passed; `pyflakes` schoon.

### Opgeleverd — repo-review fixes (hardcoded host, whitelist-rapportage, lint, docs)

- `docker-compose.yml`: hardcoded `extra_hosts` (eigen Vaultwarden-hostnaam + LAN-IP) vervangen door `${VAULTWARDEN_EXTRA_HOST:-vaultwarden-extra-host.invalid:127.0.0.1}`.
  - Reden: persoonlijke hostnaam/IP hoort niet in de repo en brak deploys voor anderen / bij volgende subnetwijziging.
  - Actie op NAS: `VAULTWARDEN_EXTRA_HOST=<vault-hostnaam>:<nas-lan-ip>` in `.env` zetten vóór de volgende full stack deploy (quick redeploy behoudt de bestaande service-spec).
- `.env.example`, `SYNOLOGY_INSTALL(.md|-NL.md)`, `TROUBLESHOOTING(.md|-NL.md)`: nieuwe optionele variabele `VAULTWARDEN_EXTRA_HOST` gedocumenteerd (EN/NL in sync).
- `SYNOLOGY_INSTALL-NL.md`: voorbeeld-IP bij `--advertise-addr` terug naar generiek `192.168.1.100` (echte NAS-IP was in docs beland).
- `scripts/register_bunq_ip.sh` (stap 4 fallback): rapporteert nu het daadwerkelijk geregistreerde container-egress-IP (`ip`) naast `requested_ip`, met `WARN` als die verschillen. Reden: context-recreate registreert het egress-IP, niet `TARGET_IP`; oude output toonde altijd `TARGET_IP`.
- `api_proxy.py` lint (pyflakes schoon): ongebruikte `Response` import, 4 f-strings zonder placeholders en ongebruikte `global` in `ensure_bunq_initialized` verwijderd. Geen gedragswijziging.
- Resultaat: `py_compile`, `sh -n`, `node --check` en `pyflakes` groen; compose YAML valide.

### Opgeleverd — WORKLOG datumvolgorde

- Alle datumsecties in `WORKLOG.md` consequent nieuw → oud gesorteerd (2026-02-13 t/m 2026-02-24 stonden oud → nieuw onderaan; 2026-03-14 stond boven 2026-03-15).
- Losse secties `Huidige status (samenvatting)` en `Openstaande focus` horen bij het 2026-02-13-snapshot en staan nu als subsecties onder die datum.
- Alleen volgorde/kopniveau gewijzigd; inhoud geverifieerd ongewijzigd.

## 2026-03-15

### Opgeleverd — betaal/spaarrekeningen detailmodal: transactielijst hersteld

- `app.js` `showBalanceDetail`: transactiefiltering toegevoegd op basis van account-ID's van het betreffende type (checking of savings).
- `transactionRows` en `transactionsTitle` worden nu meegegeven aan `openDetailModal`, zodat de sorteer/zoek/filter transactielijst ook verschijnt bij de betaalrekeningen- en spaarrekeningen-kaarten.
- Gebruikt `excludeInternalTransfers: false` zodat ook interne overboekingen (bijv. stortingen op spaarrekening) zichtbaar zijn in de lijst.
- Reden: bij een eerdere refactor was deze second-view per abuis weggevallen voor de balanswidgets.

## 2026-03-14

### Opgeleverd — IP/DNS-herstel na subnetwijziging (achteraf gelogd)

- `scripts/register_bunq_ip.sh` stap 4: eerst whitelist-API met bestaande context; bij ontbrekende context of SDK-beperking (`credential-password` endpoint) fallback naar force-recreate van de Bunq context vanaf het huidige publieke IP (commit `5c63dbd`).
- `docker-compose.yml`: `extra_hosts` toegevoegd voor verouderde Docker DNS van de Vaultwarden-host na NAS-subnetwijziging (commit `95efdc1`; op 2026-09-25 geparametriseerd via `.env`).

## 2026-03-07

### Opgeleverd (2 — frontend simplify)

- `styles.css`: drie losse `cursor: pointer` classes samengevoegd (`clickable-kpi`, `clickable-kpi-detail`, `clickable-viz`); dode `.viz-card.featured-card` selector verwijderd; dubbele `height: 110px` in `.kpi-metric-chart` verwijderd; overbodige `max-width` op 4 modal-regels verwijderd (min() enforced al).
- `index.html`: AOS stylesheet verplaatst van body-bottom naar `<head>` (voorkomt FOUC); `defer` toegevoegd aan Plotly, Chart.js en Particles.js zodat HTML-parsing niet langer geblokkeerd wordt.
- `app.js`: onbereikbare branch verwijderd in `classifyAccountType`; `handleLogin` herstelt nu het icoontje in de loginknop na een mislukte login (gebruikte `textContent` i.p.v. `innerHTML`).

### Opgeleverd (1 — api_proxy.py + tooling)

- `api_proxy.py` code-kwaliteit en efficiency verbeterd (alle wijzigingen getest op productie):
  - `RateLimiter`: stale IP-entries worden nu direct verwijderd na sliding-window trim + periodieke full sweep elke 1000 requests (voorkwam onbegrensd geheugengebruik bij bots/scanners).
  - `discover_*_endpoints()`: resultaten worden nu gecachet in `_ENDPOINT_DISCOVERY_CACHE` na eerste aanroep; `dir(endpoint)` en `pkgutil.iter_modules` worden niet meer per request herhaald.
  - Vijf `discover_*_endpoints()` functies samengevoegd tot één generieke `_discover_endpoints()` helper (~150 regels verwijderd).
  - `list_payments_for_account` en `list_card_payments_for_account` samengevoegd: gedeelde paginatielogica geëxtraheerd naar `_list_payments_paginated()`; publieke functies zijn nu ~10 regels (~110 regels verwijderd).
  - `CACHE_ENABLED`, `DATA_DB_ENABLED`, `FX_ENABLED` gebruiken nu `get_bool_env` (ondersteunt ook `'yes'`/`'1'`/`'on'`).
  - `USE_VAULTWARDEN` wordt nu eenmalig op moduleniveau geladen; 4 inline `os.getenv`-parses verwijderd.
  - Bunq page-size/max-pages constanten op moduleniveau gezet; `get_int_env` + clamp-logica in 4 functies verwijderd.
  - `sorted(counterparty_account_ibans)[0]` vervangen door `next(iter(...), None)` (O(1)).
  - Dode code verwijderd: `netflix`/`spotify`/`disney+` in `Entertainment`-branch van `categorize_transaction` waren onbereikbaar (Abonnementen-branch komt eerst).
  - `persist_transactions`: individuele `execute()` per rij vervangen door `executemany()`.
- `CLAUDE.md` toegevoegd aan repo root voor Claude Code sessie-context.
- Workflow hersteld: alle wijzigingen via lokale Mac repo → commit → push → `git pull` op Synology.
- `gh` CLI geïnstalleerd en geauthenticeerd (`richardvankampen`).

## 2026-03-06

### Opgeleverd

- README-runbook toegevoegd voor IP-wijziging (EN + NL):
  - compacte copy/paste blokken met:
    - `NO_PROMPT=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard`
    - `sudo sh scripts/restart_bunq_service.sh`
    - `curl -s http://127.0.0.1:5000/api/health`

- `scripts/register_bunq_ip.sh` aangepast op basis van live incident:
  - target whitelist IP wordt nu standaard automatisch bepaald (host publieke IPv4 via `curl -4` eerst, daarna container-egress fallback);
  - duidelijke hard fail wanneer auto-detect geen publiek IPv4 oplevert;
  - whitelist update vereenvoudigd naar alleen target-IP activeren (deactivation/cleanup-pad verwijderd uit dit script).
- Herstelhints in scriptoutput aangepast naar nieuwe eenvoudige syntax:
  - standaard: `NO_PROMPT=true sh scripts/register_bunq_ip.sh <service>`
  - expliciete override: `TARGET_IP=<PUBLIEK_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh <service>`
- Documentatie en install-output geharmoniseerd op deze nieuwe flow:
  - `README.md`, `README-NL.md`
  - `TROUBLESHOOTING.md`, `TROUBLESHOOTING-NL.md`
  - `SECURITY.md`, `SECURITY-NL.md`
  - `SYNOLOGY_INSTALL-NL.md`
  - `scripts/install_or_update_synology.sh` herstelregels.

## 2026-03-01

### Opgeleverd

- Particles achtergrond zichtbaarheidsfix:
  - `#particles-js` naar `z-index: 0` gezet en `pointer-events: none` toegevoegd.
  - `.dashboard-container` op `position: relative; z-index: 1` gezet zodat content boven de particles blijft.
  - particles init/destroy flow gehard in `app.js`:
    - stale `pJSDom`/canvas state wordt opgeschoond,
    - togglen van de setting gebruikt nu centrale `destroyParticles()` helper.

- Supportlink voor het bewegende Bunq-logo aangepast naar:
  - `https://bunq.me/BunqFinancialDashboard/3.50`
  - toegepast op zowel logo-click als tooltip-link in de header.

- Documentatie uitgebreid met advies voor **vast/sticky publiek IP** in alle relevante user-docs:
  - `README.md` en `README-NL.md`: expliciete aanbeveling + verwijzing naar troubleshooting-sectie.
  - `SYNOLOGY_INSTALL.md` en `SYNOLOGY_INSTALL-NL.md`: netwerkvereisten aangevuld met vast/sticky publiek IP-advies.
  - `TROUBLESHOOTING.md` en `TROUBLESHOOTING-NL.md`: nieuwe uitlegsectie over:
    - verschil tussen vast, sticky dynamisch en regulier dynamisch publiek IP,
    - waarom dit direct impact heeft op Bunq IP-whitelist stabiliteit,
    - praktische providercontext (NL) en herstelstappen bij IP-wijziging.

- `TROUBLESHOOTING-NL.md` grondig opgeschoond:
  - document grotendeels herschreven naar een actuele, compacte runbook-structuur.
  - verouderde/inconsistente instructies verwijderd (historische varianten, mixed flows, taalmix EN/NL).
  - redeploy/deploy instructies afgestemd op huidige standaard:
    - code-only: `quick_redeploy.sh`
    - configwijziging: `.env`-load + stack deploy + image-force update
    - volledige routine: `install_or_update_synology.sh`

- Header support-hover bijgewerkt op verzoek:
  - popovertekst gewijzigd naar `Click on the logo to buy me a coffee if you like using this free dashboard`.
  - klik op het bewegende logo zelf opent nu ook dezelfde support-link in nieuw tabblad.
  - popover visueel donkerder en meer frosted gemaakt.
  - linktekst in popover niet meer onderstreept.

- Markdown instructie-audit uitgevoerd en gecorrigeerd op nieuwe deployflow:
  - `README.md` en `README-NL.md`: `sudo git pull` vervangen door `sudo git pull --rebase origin main` en quick code-only redeploy toegevoegd (`sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false`).
  - `TROUBLESHOOTING.md`: full deploy snippet geüpdatet naar `.env` load + `docker service update --force --image bunq-dashboard:$TAG ...`; quick redeploy sectie expliciet toegevoegd.
  - `TROUBLESHOOTING-NL.md`: kritieke redeploy/recovery snippets aangepast naar quick redeploy of full deploy met `.env` + image-force update.
  - `SYNOLOGY_INSTALL-NL.md`: update-sectie aangevuld met `git pull --rebase` en quick code-only redeploy; korte troubleshootingblokken consistent gemaakt met huidige flow.

- Settings “Enable background particles” wow-upgrade:
  - standaard checkbox vervangen door een prominente visual FX togglekaart.
  - nieuwe kaart bevat badge, duidelijke titel/subtitel en custom switch.
  - stijl: helderder glass gradient met cyan/magenta accenten, inclusief subtiele sheen-hover en pulse-glow in actieve stand.
  - mobile gedrag toegevoegd: kaart stapelt netjes en switch blijft goed uitgelijnd op kleine schermen.
  - compatibiliteit behouden: dezelfde input-id (`enableParticles`) blijft gebruikt door bestaande settings-logica.

- Header support-hover toegevoegd:
  - bewegende Bunq-icoon in de header heeft nu een hover/focus popover met klikbare link.
  - linktekst: `buy me a coffee if you enjoy using this dashboard`.
  - linktarget: `https://bunq.me/BunqFinancialDashboard/3.50` (nieuw tabblad, `noopener noreferrer`).
  - visueel gestyled als opvallende glass/magenta link-popover.

- Safari tooltip-compatibiliteit voor inzichttegels toegevoegd:
  - native/psuedo hover-tooltip aangevuld met JS-gedreven floating tooltipcomponent (`#insightHoverTooltip`).
  - actieve kaart toont tooltip bij `mouseenter`/`focus` met viewport-aware positionering (boven of onder de kaart).
  - pseudo-tooltips worden uitgeschakeld zodra JS-tooltips actief zijn (`body.js-insight-tooltips`) om dubbele weergave te voorkomen.
  - floating tooltip visuele stijl omgezet naar dezelfde glassmorphism variabelen als de overige tegels voor consistente look.
  - reden: Safari in gemaximaliseerd/fullscreen venster toonde tooltip niet consistent.

- Tooltip-UX verfijning op verzoek:
  - oude native `title` mouse-overs op inzichttegels runtime verwijderd, zodat alleen custom tooltip zichtbaar blijft.
  - custom tooltip volgt nu de cursor en verschijnt net onder de muis (met automatische fallback boven de cursor bij weinig ruimte).
  - tooltipstijl lichter gemaakt met subtiele magenta glass-tint voor extra contrast/zichtbaarheid.

- Stilistische widgetfixes:
  - `Top tegenrekeningen` en `Categorie-race` renderen nu met transparante plotachtergrond (`plot_bgcolor`) zodat de tegelachtergrond zichtbaar blijft (geen witte chart-vlakken).
  - `Budget discipline` en `Categorie-race` hebben niet langer de aparte featured-card rand; ze gebruiken nu dezelfde standaard randstijl als andere widgets.

- `Action plan` detailweergave leesbaarheidsfix:
  - detailmodal ondersteunt nu optionele lijstklasse per widget (`listClassName` in `openDetailModal`).
  - voor `action-plan` wordt `balance-detail-list-stacked` gebruikt, waardoor koptekst + toelichting horizontaal onder elkaar staan i.p.v. ingedrukt naast elkaar.
  - y-as labels in de action-plan impactgrafiek gefixeerd op horizontale tickhoek (`tickangle: 0`).

- Tooltip/hover-fix inzichttegels robuuster gemaakt:
  - `syncInsightCardTooltips()` zet nu naast `title` ook `data-tooltip` op elke `.insight-card`.
  - nieuwe CSS-tooltiplaag toegevoegd (`::before/::after` op `.insight-card[data-tooltip]`) zodat hover-uitleg zichtbaar blijft in browsers waar native `title` op `div` onbetrouwbaar is.

- `Geldstromen` fullscreen renderfix:
  - samenvattingstekst (`In ... · Uit ... · Netto ...`) verplaatst van Plotly `annotations` naar een stabiele HTML-regel (`.sankey-summary`) boven de grafiek.
  - specifieke fullscreen hoogte voor `#sankeyChart` aangepast zodat de summary-regel niet over de grafiek heen valt.
  - doel: voorkomen dat de samenvatting in fullscreen als onleesbare witte puntjes/lijntjes rendert.

- Tooltipdekking inzichttegels hard gemaakt:
  - op elke `.insight-card` is nu direct een `title`-attribuut gezet in `index.html`;
  - hierdoor werkt mouse-over uitleg per inzichttegel ook als JS-tooltip-sync niet draait.

- KPI/tooltip correcties:
  - `Savings Rate` gebruikt nu dezelfde gecorrigeerde `Sparen`-netto als de spaarmutatie-view (negatieve mutaties tellen dus mee).
  - inzicht-tegel tooltips worden nu op de hele kaart gezet (`.insight-card`), niet alleen op de kopregel.

- `Sparen` KPI-berekening gecorrigeerd:
  - widgetwaarde wordt nu berekend op exact dezelfde savings-subset als de secondary view (`Spaarrekening mutaties`);
  - netto = positieve mutaties + negatieve mutaties (dus opnames worden afgetrokken i.p.v. genegeerd).

- Detailtransactietabel uitgebreid:
  - kolom `Tegenrekening / merchant` toont nu ook rekeningnummer (voorkeur: `counterparty_iban`, fallback: `counterparty_account_id`);
  - zoekveld doorzoekt nu ook het rekeningnummer;
  - kolomtitel en placeholdertekst geüpdatet naar `... + rekeningnummer`.

- Widgetfiltering aangescherpt:
  - `Top tegenrekeningen` en `Verdeling in categorieën` gebruiken nu extra widgetfilter op interne/eigen tegenrekeningen.
  - filtering gebruikt `is_internal_transfer` + deterministische checks op eigen account-id, eigen IBAN en eigen Bunq-rekeningnaam.
  - doel: interne tegenrekeninglabels (zoals `Richard`) uit deze twee widgets verwijderen.

- Persoonsnaam-gebaseerde internal-transfer workarounds verwijderd (deterministische matching):
  - backend internal detectie gebruikt nu alleen account-id en IBAN-signalen (`counterparty_alias`, `monetary_account_counterparty`, `merchant_reference`);
  - naam/omschrijving-fallbacks verwijderd uit backend en frontend;
  - cross-account reconcile teruggebracht naar deterministische pass (`payment-id + minute + amount + currency`);
  - `/api/accounts` levert `ibans` per rekening en frontend fallback matcht daarop.

- Interne detectie op rekeningnaam/rekeningnummer aangescherpt:
  - backend leest nu ook rekeningnaam + alias-IBAN uit `monetary_account_counterparty`;
  - backend matcht `merchant_reference` nu ook op eigen IBAN/eigen rekeningnaam;
  - `/api/accounts` bevat nu `ibans` per account (naast `identity_names`);
  - frontend fallback gebruikt `counterparty_iban` vs eigen `ibans`, zodat interne transacties ook zonder goede naamherkenning weggefilterd worden.

- Interne tegenpartij op eigen naam (bijv. `Richard`) nu ook gefilterd:
  - backend identity-extractie uitgebreid met account-houder/co-owner/aliasnamen (`display_name`, `public_nick_name`, `first_name + last_name`, etc.);
  - `extract_own_account_names(...)` gebruikt nu deze bredere identity-set, zodat interne transacties zonder bruikbaar account-id/IBAN alsnog als intern worden gemarkeerd;
  - `/api/accounts` levert per rekening `identity_names` mee;
  - frontend `getOwnBunqAccountIdentitySets()` gebruikt `identity_names` als extra fallback voor client-side filtering.

- Overfilter-correctie voor `exclude internal` (inkomsten/uitgaven vielen naar 0):
  - backend deterministic internal-check markeert alleen intern als `counterparty_account_id` in eigen Bunq-ids zit én verschilt van bron `account_id`;
  - backend `reconcile_internal_transfers` pass 1 aangescherpt naar `payment-id + minute + amount + currency` om false pairings te vermijden;
  - frontend fallbackfilter op `counterparty_account_id` respecteert nu ook `account_id` (zelfde id niet automatisch wegfilteren).

- Categorie-race frame-rate aangepast:
  - `RACING_ANIMATION_FPS` gewijzigd van 10 naar 2.
  - gevolg: daganimatie speelt rustiger af (~45s bij ~90 frames).

- Geldstromen detailweergave klikfix:
  - klikafhandeling op categorie-rijen robuust gemaakt voor browservarianten met non-Element `event.target`.
  - interactieve rijstijl toegevoegd (`.balance-detail-row-action`) zodat klikbare categorieën duidelijk zichtbaar en focusable zijn.
  - onderliggende transactiesectie gebruikt nu titel `Transacties (...)`; label `Alle transacties in de periode` staat in het bovenste categoriepaneel.

- Root-cause fix voor niet-gefilterde negatieve interne overboekingen:
  - oorzaak vastgesteld: in bepaalde Bunq SDK responses miste tegenrekeningmetadata op het standaardpad (`counterparty_account_id/IBAN/naam`), waardoor uitgaande interne transacties niet als intern gemarkeerd werden.
  - backend uitgebreid met:
    - `extract_alias_account_id(...)` voor geneste aliasvarianten;
    - description-gebaseerde fallbackmatch op eigen Bunq-rekeningnamen.
    - nieuwe cross-account reconciliatie (`reconcile_internal_transfers`) die plus/min tegenboekingen tussen eigen Bunq-rekeningen markeert op basis van:
      - payment-id + amount/currency, en
      - fallback signature (minuut + abs(amount) + description/counterparty).
  - frontend fallback uitgebreid met description-match op eigen Bunq-rekeningnamen.
  - resultaat: negatieve interne overboekingen worden nu ook uitgefilterd bij `exclude internal`.

- Categorie-race verbeterd:
  - widgettitel hernoemd van `Category Race Over Time` naar `Categorie-race`.
  - race-opbouw omgezet van maandframes naar dagframes (cumulatieve uitgaven per categorie).
  - afspeelsnelheid ingesteld op 10 fps (`RACING_ANIMATION_FPS`), waardoor een periode van ~90 dagen ~9 seconden animatie geeft.
  - frame-label naast slider toont nu datum i.p.v. maand.
- Kleine widgets rond de race-sectie vertaald en voorzien van hover-uitleg:
  - `Day Pattern` -> `Dagpatroon`
  - `Monthly Distribution` -> `Maandverdeling`
  - `Top Merchants` -> `Top tegenrekeningen`
  - korte tooltip-uitleg toegevoegd op titel (`title`).
- Insights-sectie ook naar Nederlands gebracht met tooltip-uitleg:
  - o.a. `Recurring Costs` -> `Terugkerende kosten`
  - `Next Best Action` -> `Volgende beste actie`
  - daarnaast ook overige insighttitels vertaald (incl. `Datakwaliteit`, `Verwacht netto per maand`, `Aandeel top-tegenrekening`).

- Tweede feedbackronde voor widgets/detailviews doorgevoerd:
  - KPI-labels hernoemd naar `Inkomsten`, `Uitgaven`, `Sparen`.
  - visualisatiekoppen hernoemd naar `Cashflow (tijdslijn)`, `Geldstromen`, `Verdeling in categorieën`.
  - download-icoon verwijderd van `Cashflow (tijdslijn)`; detailview toegevoegd via actieknop.
  - nieuwe `cashflow` second-view toont individuele bij-/afschrijvingen met dezelfde sorteer/zoektabel.
- Internal-transfer filtering verder gecorrigeerd voor externe rekeningen:
  - backend detectie behandelt alleen eigen Bunq-rekeningen als intern; `MonetaryAccountExternal` (zoals Triodos) wordt expliciet extern gehouden.
  - frontend fallback filter gebruikt nu ook `counterparty_account_id` naast naammatching.
  - gevolg: interne overboekingen worden consistenter weggefilterd bij uitgaven/inkomsten, terwijl Triodos-transacties extern blijven.
- Balansweergave opgeschoond:
  - `Betaalrekeningen (totaal)`/`Spaarrekeningen (totaal)` detail blijft grafiek-only (geen dubbele tekstopsomming).
  - berekening voor balans-KPI’s gebruikt alleen eigen Bunq-rekeningen (Triodos buiten de Bunq checking/savings widgets).

- Frontend second-view feedback verwerkt:
  - dubbele oude individuele opsomming verwijderd in detailmodals waar de nieuwe transactietabel actief is (inkomsten/uitgaven/spaarmutaties).
  - transactietabel uitgebreid met extra velden:
    - `Eigen Bunq rekening`
    - `Omschrijving`
  - zoekfunctie in detailtabel uitgebreid met deze nieuwe velden.
- Internal transfer filtering aangescherpt in backend:
  - internal-transfer detectie nu lijst-gebaseerd op volledige eigen rekeninglijst (account-id/IBAN/naam), zodat overboekingen tussen eigen rekeningen als intern worden gemarkeerd.
  - toegepast in zowel `/api/transactions` als `/api/statistics`.
  - frontend `exclude internal` kreeg daarnaast een extra fallback-filter op tegenrekening/merchant-naam vs eigen rekeningnamen voor runtimegevallen waar backend-flagging niet volledig is.

- SDK-first cleanup na succesvolle live validatie:
  - savings-ophaalpad nu expliciet gebaseerd op officiële Bunq SDK endpoints:
    - `MonetaryAccount(ApiObject)`
    - `MonetaryAccountSavings(ApiObject)`
    - `MonetaryAccountExternalSavings(ApiObject)`
  - brede endpoint-discovery/probe-logica voor monetary accounts verwijderd.
- Kritische correctness/performance fixes in `api_proxy.py`:
  - `parse_pagination()` is nu robuust tegen ongeldige/negatieve querywaarden (`limit/page/page_size/offset`) en voorkomt 500s op `int(...)` parsefouten.
  - `list_monetary_accounts()` stopt nu eerder wanneer het canonieke unified endpoint al savings bevat (minder onnodige endpoint-calls).
  - raw savings fallback wordt nu alleen nog gestart als SDK-resultaat daadwerkelijk geen savings bevat (niet meer bij elke partiële endpoint-fout).
  - mode-fallback in `list_monetary_accounts()` is explicieter gemaakt (`mode_signature_error`) voor leesbaarheid en onderhoudbaarheid.
- Raw fallback sterk vereenvoudigd:
  - routeplan teruggebracht naar alleen gedocumenteerde `/user/{id}/monetary-account*` routes.
  - context-scoped en niet-gedocumenteerde route-varianten verwijderd.
- Incidentstatus bevestigd als opgelost:
  - live checker geeft `Validation OK` met `Spaarrekening (EUR)` en `Spaargeld in ZAR (ZAR)` in `/api/accounts`.
- Handover opgeschoond naar actuele waarheid:
  - `CONTEXT_HANDOVER.md` herschreven zonder verouderde matrix/probe-status.

- Nieuwe deterministische API-validatie voor het savings-incident:
  - `scripts/check_accounts_api.py` toegevoegd.
  - Script logt in op dashboard, haalt `/api/accounts` op en valideert verwachtte accounts op:
    - `description` (rekeningnaam),
    - `balance.currency`,
    - `balance.value` (met configureerbare tolerantie).
  - Verwachtingen zijn mee te geven via `EXPECTED_ACCOUNTS_JSON`, zodat bekende productiegevallen per deploy reproduceerbaar checkbaar zijn.
- Handover bijgewerkt met vaste verificatiestap na deploy:
  - `CONTEXT_HANDOVER.md` bevat nu een concrete run van `check_accounts_api.py` voor `Spaarrekening` en `Spaargeld in ZAR`.
  - voorbeeld-check gebruikt bewust alleen `description` + `currency` (geen placeholder-saldi meer);
    `balance` is optioneel en alleen voor echte live waarden.
- Raw monetary-account fallback diagnostiek aangescherpt:
  - `list_monetary_accounts_raw_api(..., soft_fail=False)` toegevoegd; merge-pad gebruikt nu `soft_fail=True` zodat een partiële raw-fallback niet de hele account-ophaalflow als failure markeert.
  - Per raw endpoint wordt nu expliciet gelogd:
    - `no parsable monetary accounts` (incl. result/payload type),
    - `parsed only duplicate accounts`,
    - `endpoint unavailable (skip)` bij 404/route-not-found.
  - Hiermee is direct zichtbaar of savings-data niet geleverd wordt, of wel geleverd maar niet parsebaar is.
- Nieuw NAS-vriendelijk debugscript toegevoegd voor raw endpoints zonder handmatige heredoc:
  - `scripts/debug_raw_monetary_accounts.sh`
  - script detecteert container + user-id, initialiseert Bunq context en test raw monetary routes.
  - output bevat `parsed_accounts`, `payload_type` en sample accountregels.
  - script is aangescherpt na live NAS-feedback:
    - initialiseert eerst `init_bunq(...)` in dezelfde container-exec context (voorkomt `ApiContext has not been loaded`);
    - draait route-probing in één exec-run (voorkomt herhaalde Vaultwarden decrypt per endpoint);
    - parseert user-id via marker `CODX_USER_ID=...` i.p.v. shellvariabele `UID` (readonly in shell).
    - streamt nu live output tijdens run (geen buffered stilte tot einde).
    - gebruikt nu `python3 -u` (ongebufferde output), toont `attempt_count`, en rapporteert correcte exit-code bij failures.
    - `python -c` quoting-probleem gefixt door over te stappen op `python3 -u -` met ingebedde multiline scriptinhoud.
    - script ondersteunt nu ook `MAX_ROWS` als 2e positional argument (`scripts/debug_raw_monetary_accounts.sh <service> <max_rows>`) om sudo-env issues te vermijden.
- Live NAS-observatie vastgelegd:
  - `/v1/user/{id}/monetary-account*` raw paden geven op deze runtime allemaal `404 Route not found`.
  - hierop is `_raw_monetary_attempt_plan(...)` verbreed naar deterministische route- en param-varianten:
    - prefixes `/v1/user`, `/user`, `user`;
    - suffixes `monetary-account*` inclusief `-bank/-savings/-external/-joint/-card`;
    - params varianten met/zonder `status` en `count`.
- Raw payload parsing verder gehard op basis van NAS-debug:
  - `_extract_json_payload(...)` prioriteert nu `raw_body/raw_response/...` boven `.value` en valt pas terug op lege payloads als er niets beters is.
  - voorkomt scenario waarin een lege sdk-wrapper `.value` de echte JSON-body maskeert.
  - `_extract_monetary_accounts_from_raw_payload(...)` accepteert nu ook directe account-dicts zonder `MonetaryAccount*` wrapper key.
  - nieuw: `_extract_monetary_accounts_from_raw_result(...)` parseert ook sdk model-object resultaten (niet-JSON) uit raw client calls.
  - `list_monetary_accounts_raw_api(...)` en `scripts/debug_raw_monetary_accounts.sh` gebruiken nu deze gecombineerde extractor.
  - extractor is verder aangescherpt om false positives te vermijden:
    - alleen account-like mappings/objecten worden nog geaccepteerd (vereist o.a. `id` + `balance` of duidelijk monetary-account class-hint);
    - brede `display_name`-achtige matches zonder accountkenmerken worden niet meer als account geteld.
  - debugscript toont nu per route ook `first_account=<id>|<description>|<currency>|<type>` zodat `MAX_ROWS=0` toch bruikbare identificatie geeft.
- `scripts/check_accounts_api.py` default timeout verhoogd naar 120s (was 20s) vanwege langzamere `/api/accounts` runs tijdens uitgebreide raw probing.
- Raw route-probing verder verbreed voor SDK-contextinjectie:
  - naast expliciete `/user/{id}/...` paden probeert `_raw_monetary_attempt_plan(...)` nu ook context-scoped routes zonder user-id:
    - `/v1/monetary-account*`
    - `/monetary-account*`
    - `monetary-account*`
  - doel: sdk-varianten opvangen die user-scope intern toevoegen en daardoor met expliciete user-id lege/non-JSON responses geven.
- Debugscript introspectie toegevoegd voor lege raw responses:
  - bij eerste `parsed_accounts=0` toont script nu `result_type` plus type/size van relevante response-attributen (`value`, `raw_body`, `response`, `json`, etc.).
  - doel: exact bepalen waar de SDK-wrapper de daadwerkelijke payload verbergt.
- BunqResponseRaw payloadextractie verder uitgebreid op basis van documentatie-aanwijzingen:
  - `_extract_json_payload(...)` probeert nu expliciet ook `get_*` methoden (`get_value/get_body/get_raw_body/get_response_body/get_json/get_data`) naast velden.
  - private objectvelden worden nu ook meegenomen via `__dict__`-scan met prioriteit op payload-achtige keys (`raw/body/response/json/...`).
  - `_extract_monetary_accounts_from_raw_payload(...)` accepteert nu ook single-object payloads zonder `Response[]` wrapper en nested `value/data/result` payloads.
- Debugscript probe-matrix uitgebreid voor BunqResponseRaw:
  - toegevoegd: `get_*` probes en `__dict__`, zodat we bij `parsed_accounts=0` direct zien waar de SDK-runtime de body bewaart.
- Nieuw snel redeployscript toegevoegd:
  - `scripts/quick_redeploy.sh`
  - doet bewust geen `docker stack deploy`; alleen:
    - cached image build (default),
    - `docker service update --force --image ...` met retry bij `update out of sequence`.
  - doel: snellere debug-loop bij pure codewijzigingen (`api_proxy.py`, frontend, scripts).
  - expliciete waarschuwing in script: bij `.env`/`docker-compose.yml`/secrets/netwerkwijzigingen wel volledige stack deploy doen.
- Volgende-sessie checklist expliciet vastgelegd in `CONTEXT_HANDOVER.md`:
  - redeploy met `.env` geladen;
  - raw debug rerun + grep met `first_account=...`;
  - checker rerun met `EXPECTED_ACCOUNTS_JSON` (typo-valkuil `EXPECTED_ACTS_JSON` benoemd).
- Installatie-instructies aangescherpt op Synology:
  - `scripts/install_or_update_synology.sh` expliciet als root laten uitvoeren (`sudo sh ...`).
  - `NO_CACHE` overrides nu gedocumenteerd via root-shell variant (`sudo sh -c 'NO_CACHE=... sh ...'`) om sudo-env valkuilen te vermijden.
- Documentatie geüpdatet:
  - `README.md`
  - `SYNOLOGY_INSTALL.md`
  - `CONTEXT_HANDOVER.md`
  - `AGENTS.md` (vaste startup-instructies voor nieuwe sessies)
- Operationele les vastgelegd:
  - Als install/update als normale user wordt gedraaid, kan deploy op compose-defaults terugvallen (`*.jouwdomein.nl`) ondanks correcte `.env`, met Vaultwarden `ENOTFOUND` en demo mode als gevolg.
- Savings-debug vervolg:
  - raw fallback resolveert nu daadwerkelijk een SDK client (`ApiClient.__init__`), maar call-signatuur mismatch vastgesteld:
    - `ApiClient.get() missing 2 required positional arguments: 'params' and 'custom_headers'`.
  - `_call_api_client_get(...)` uitgebreid met Bunq-compatibele `get/request/execute` callvarianten met verplichte positional args en lege headers.
- SDK-first savings-ophaalpad verder aangescherpt (minder fuzzy fallback):
  - endpoint-discovery blijft standaard strict (`BUNQ_STRICT_ENDPOINT_DISCOVERY=true`);
  - raw monetary fallback gebruikt nu alleen gedocumenteerde Bunq paden:
    - `/v1/user/{id}/monetary-account`
    - `/v1/user/{id}/monetary-account-savings`
    - `/v1/user/{id}/monetary-account-external-savings`
  - brede pad/probe-combinaties verwijderd; logregel verduidelijkt naar `Using documented raw Bunq monetary-account endpoint`.
  - cooldown blijft actief om herhaalde mislukte raw-pogingen te dempen (`BUNQ_RAW_FALLBACK_COOLDOWN_SECONDS`, default 120s).

### Frontend detailmodal: individuele transacties als second view

- Vraag uit gebruikersflow opgepakt: naast totalen in detailkaarten nu ook individuele transacties zichtbaar.
- `index.html`:
  - nieuwe sectie in `#balanceDetailModal` toegevoegd met transactietabel (`Datum`, `Tijd`, `Tegenrekening / merchant`, `Bedrag`).
- `styles.css`:
  - styling toegevoegd voor de nieuwe transactiesectie incl. scrollable tabel en kleurcodering van bedragen.
- `app.js`:
  - `openDetailModal(...)` uitgebreid met `transactionRows` + `transactionsTitle`.
  - rendering toegevoegd voor transactietabel in de modal.
  - transactietabel rendering geoptimaliseerd voor grote datasets:
    - batchgrootte `200` rijen per stap;
    - `Toon meer` knop + teller (`x van y transacties`);
    - voorkomt zware DOM-render in één keer.
  - transactietabel interactie uitgebreid:
    - zoekveld (merchant/tegenrekening/datum/bedrag);
    - sortering (datum nieuw/oud, bedrag op grootte, naam A-Z/Z-A).
  - `showTransactionDetail(...)` aangesloten voor:
    - `income`
    - `expenses`
    - `savings-transfers`
    - `needs-vs-wants`
    - `merchant-concentration`
    - `expense-momentum` (laatste 30d uitgaven)
    - `money-flow`
- Resultaat:
  - gebruiker ziet nu in dezelfde detailweergave zowel samenvatting/grafiek als individuele transactieregels voor de gekozen context/periode.
- Validatie:
  - lokale JS syntax-check via `node --check` kon niet worden uitgevoerd in deze omgeving (`node`/`nodejs` niet aanwezig).

### User-documentatie: EN/NL splitsing

- User-facing markdown-documentatie opgesplitst naar taal:
  - Engelse hoofdversies blijven op standaardnamen:
    - `README.md`
    - `SECURITY.md`
    - `SYNOLOGY_INSTALL.md`
    - `TROUBLESHOOTING.md`
  - Nederlandse versies staan nu naast de hoofdversies met `-NL` suffix:
    - `README-NL.md`
    - `SECURITY-NL.md`
    - `SYNOLOGY_INSTALL-NL.md`
    - `TROUBLESHOOTING-NL.md`
- `README.md` bevat nu expliciete taalkeuze (EN/NL) zodat gebruikers direct tussen beide readme-varianten kunnen kiezen.
- Links in NL-documentatie zijn aangepast naar `*-NL.md` targets zodat de NL-flow intern consistent blijft.
- NL-documentatie inhoudelijk opgeschoond op onnodig Engels (koppen en begeleidende zinnen) in:
  - `README-NL.md`
  - `SECURITY-NL.md`
  - `SYNOLOGY_INSTALL-NL.md`
  - `TROUBLESHOOTING-NL.md`
- Korte changelogtekst toegevoegd aan nieuwe release-notes file:
  - `RELEASE_NOTES.md`
- Release notes nu ook tweetalig gemaakt met taal-links:
  - `RELEASE_NOTES.md` (EN)
  - `RELEASE_NOTES-NL.md` (NL)

## 2026-02-28

### Opgeleverd

- Savings-incident extra gehard op backend:
  - monetary-account list calls sturen nu altijd `count` mee via nieuwe helper (`BUNQ_ACCOUNT_PAGE_SIZE`, default/max 200), inclusief `status=ACTIVE` modes;
  - raw-client resolutie uitgebreid naar endpoint-module en endpoint-klassen (`MonetaryAccount*`, `PaymentApiObject`);
  - verbeterde diagnostiek voor raw fallback (`api_client unavailable (candidates: ...)`) zodat runtime-verschillen sneller traceerbaar zijn.
  - false-positive client-resolutie gefixt:
    - endpoint class (`MonetaryAccountApiObject.self`) werd ten onrechte als HTTP client gezien;
    - `_is_http_client_like` sluit endpoint classes/modelobjecten nu uit;
    - `_call_api_client_get` probeert alleen aanwezige methodes en logt duidelijker typefoutcontext.
  - raw client discovery uitgebreid:
    - extra session/context accessors toegevoegd;
    - objectgraph-discovery volgt nu ook private SDK contextvelden;
    - discovery-diepte naar 3 verhoogd voor interne session-client paden.
  - nieuwe constructor-fallback toegevoegd:
    - backend probeert nu SDK HTTP-client direct te bouwen vanuit `ApiContext` via `bunq.sdk.http.api_client*` klassen/factories;
    - signature-gebaseerde arg-mapping toegevoegd voor SDK-variantcompatibiliteit.
- Savings-account incidentanalyse aangescherpt op live NAS-data:
  - bevestigd dat `/api/accounts` alleen checking/external teruggeeft;
  - bevestigd dat SDK-savings endpoints falen op `float(None)` parsefout.
- Backend account-enumeratie verder gehard in meerdere iteraties:
  - savings/accounttype-herkenning uitgebreid;
  - monetary-account discovery/list modes verbreed;
  - retries met `status=ACTIVE` toegevoegd;
  - raw monetary-account fallback toegevoegd;
  - api-client resolutie voor raw fallback verbreed;
  - multi-user-id discovery toegevoegd om accounts over meerdere user-contexten te kunnen ophalen.
- Runtime-validatie toegevoegd op NAS:
  - `discover_bunq_user_ids()` geeft momenteel één id terug (`75231272`);
  - daardoor is multi-user mismatch niet de primaire oorzaak.
  - resterende blocker: raw fallback meldt nog `bunq-sdk api_client unavailable`.
- Nieuwe fix voorbereid:
  - `_resolve_bunq_api_client` uitgebreid met adapter/request/execute varianten om raw fallback alsnog te activeren.
- Handover-documentatie opgeschoond naar een enkele actuele statusweergave zonder duplicaten.

### Relevante commits

- `948a564` Discover multiple Bunq user IDs for account enumeration
- `223396f` Resolve Bunq api client variants for raw account fallback
- `6909e51` Add raw monetary-account fallback for SDK parse failures
- `dcc7bb7` Retry monetary account list with active-status modes
- `adb96f0` Broaden monetary account endpoint discovery and list modes
- `e9da54c` Fix savings account classification for balance widgets

### Openstaand

- Op NAS valideren of `count`-param in monetary-account list de ontbrekende savings al oplost.
- Daarna valideren dat nieuwe endpoint-gebaseerde api-client-resolutie raw fallback activeert en de twee spaarrekeningen teruggeeft.
- Als dat niet zo is: gerichte raw endpoint inspectie per user-id uitvoeren en fallback finaliseren op exact endpoint-niveau.

### Procesafspraak

- Bij elke codewijziging:
  - `WORKLOG.md` actualiseren;
  - `CONTEXT_HANDOVER.md` actualiseren;
  - verouderde info verwijderen i.p.v. dupliceren.

## 2026-02-25

### Opgeleverd

- Backend transactie-inname verder gehard voor SDK-varianten:
  - payment endpoint met paging-metadata (`truncated`, `truncated_accounts`);
  - card-payment endpoint support toegevoegd waar beschikbaar;
  - gecombineerde transactie-output inclusief expliciete datakwaliteitssignalen.
- Frontend feedback verbeterd bij onvolledige datasets:
  - dashboard toont nu waarschuwingen bij truncation en ontbrekende EUR-conversies.
- Savings transfer deep-dive robuuster gemaakt:
  - detailweergave gebruikt expliciet een filterpad waarbij interne transfers niet onbedoeld worden weggefilterd.
- Documentatie bijgewerkt op operationele tuning en diagnostiek:
  - `README.md`: transaction diagnostics velden beschreven;
  - `SYNOLOGY_INSTALL.md`: nieuwe Bunq payment/card-payment paging env knobs;
  - `TROUBLESHOOTING.md`: concrete truncated-check + redeploy flow.

## 2026-02-24

### Repo review + hardening pass

- Commit `9e15ee2` gepusht op `main`.
- Vaultwarden CLI flow aangescherpt:
  - `VAULTWARDEN_URL` moet expliciet gezet zijn.
  - Bij `VAULTWARDEN_ACCESS_METHOD=cli` wordt alleen HTTPS geaccepteerd (duidelijke runtime foutmelding bij HTTP).
- Bunq context herstel verbeterd:
  - als restore/init faalt met bestaand contextbestand, verwijdert backend stale context en probeert één keer opnieuw.
- Liveness/readiness gesplitst:
  - `/api/live` toegevoegd (altijd 200 als process leeft).
  - `/api/health` is readiness en retourneert 503 als API key aanwezig is maar Bunq context niet initialized is.
  - `/api/ready` toegevoegd als alias naar readiness.
  - Docker healthchecks gebruiken nu `/api/live` (compose + Dockerfile + Synology docs).
- Whitelist safety-default aangescherpt:
  - `scripts/register_bunq_ip.sh` default `DEACTIVATE_OTHERS=false`.
  - documentatie en recovery hints bijgewerkt naar veilige default + optionele cleanup-pass (`DEACTIVATE_OTHERS=true`) na validatie.
- Markdown docs geactualiseerd:
  - `README.md`, `SYNOLOGY_INSTALL.md`, `SECURITY.md`, `TROUBLESHOOTING.md`, `.env.example`.

## 2026-02-17

### Incidentfixes (startup en Vaultwarden-CLI stabiliteit)

- Root cause crashloop gefixt:
  - app faalde op `ValueError: Unknown level: 'info'` tijdens import in `api_proxy.py`.
  - fix: `LOG_LEVEL` normaliseren via `os.getenv('LOG_LEVEL', 'INFO').upper()`.
- Vaultwarden CLI race-condition onder Gunicorn workers gefixt:
  - Bitwarden CLI appdata nu per worker-proces (`.../bwcli-dashboard-<pid>`), zodat sessiestate niet gedeeld wordt tussen workers.
- Commit en push:
  - `0d9f5ae` — `Harden startup log level and isolate bw CLI state per worker`.

### NAS runtime status (na deploy)

- Service convergeert en blijft draaien op Gunicorn.
- `/api/health` geeft stabiel `200`.
- `BUNQ_PREBOOT_INIT=false` en `GUNICORN_WORKERS=1` gebruikt op NAS om startup stabiel te houden.

### Openstaand operationeel issue

- Bunq-context init faalt nog op live environment met:
  - `HTTP Response Code: 400`
  - `Error message: User credentials are incorrect. Incorrect API key or IP address.`
- Gevolg: app is gezond, maar Bunq-data endpoints kunnen `503` geven zolang key/IP-whitelist niet matcht.

### Volgende concrete stappen op NAS

1. Bepaal actuele container-egress IP.
2. Run veilige 2-staps whitelist-flow met die IP:
   - eerst `DEACTIVATE_OTHERS=false`,
   - daarna `DEACTIVATE_OTHERS=true`.
3. Verwijder Bunq context files en force service restart.
4. Valideer logs op `Bunq API initialized successfully` (zonder `Incorrect API key or IP address`).

### SDK-validatie en datakwaliteit fixes (savings + merchant/category)

- `api_proxy.py` gevalideerd tegen officiële Bunq Python SDK broncode (`bunq/sdk_python`):
  - `MonetaryAccountApiObject` kan concrete varianten wrappen (`MonetaryAccountSavings`, `MonetaryAccountInvestment`, etc.).
  - `PaymentApiObject` gebruikt `counterparty_alias` via `MonetaryAccountReference`, vaak met nested label/pointer structuur.
  - `LabelMonetaryAccountObject` en `MasterCardActionApiObject` bevatten MCC-signalen (`merchant_category_code`) die voor categorisatie gebruikt moeten worden.
- Backend verbeteringen doorgevoerd:
  - account-unwrapping voor wrapped `MonetaryAccount` varianten;
  - robuustere savings/investment classificatie via embedded type hints + modelvelden;
  - diepere alias traversal voor counterparty/IBAN/merchant-data;
  - MCC extractie uit nested alias-structuur.
- Resultaat:
  - savings-accounts worden consistenter als `savings` herkend;
  - merchant labels en categorieën krijgen betere dekking door correctere alias/MCC parsing.
- Commit en push:
  - `acadc97` — `Fix savings classification and merchant/MCC extraction`.

### Verificatie op NAS (na deploy)

1. Bouw/deploy:
   - `cd /volume1/docker/bunq-dashboard`
   - `sudo git pull --rebase origin main`
   - `TAG=$(date +%Y%m%d%H%M%S)`
   - `sudo docker build --build-arg BW_VERSION=2026.1.0 --build-arg BW_NPM_VERSION=2026.1.0 -t bunq-dashboard:$TAG -t bunq-dashboard:local .`
   - `sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'`
   - `sudo docker service update --image bunq-dashboard:$TAG --force bunq_bunq-dashboard`
2. Savings-account classificatie checken:
   - `curl -sS -m 10 http://127.0.0.1:5000/api/accounts | jq -r '.data[] | [.id, .description, .account_type, .account_class] | @tsv'`
3. Merchant/category output checken:
   - `curl -sS -m 20 'http://127.0.0.1:5000/api/transactions?days=90&page=1&page_size=200&exclude_internal=true' | jq -r '.data[] | [.date, .merchant, .category, .description] | @tsv' | head -n 40`
4. Datadekking direct uit lokale history DB:
   - `BUNQ_CONTAINER=$(sudo docker ps --filter name=bunq_bunq-dashboard -q | head -n1)`
   - `sudo docker exec "$BUNQ_CONTAINER" python3 -c "import sqlite3; c=sqlite3.connect('/app/config/dashboard_data.db'); c.row_factory=sqlite3.Row; r=c.execute(\"SELECT COUNT(*) total, SUM(CASE WHEN merchant IS NOT NULL AND TRIM(merchant)!='' AND LOWER(TRIM(merchant)) NOT IN ('unknown','onbekend') THEN 1 ELSE 0 END) merchant_named, SUM(CASE WHEN category IS NOT NULL AND TRIM(category)!='' AND LOWER(TRIM(category)) NOT IN ('overig','unknown','onbekend') THEN 1 ELSE 0 END) categorized FROM transaction_cache\").fetchone(); print(dict(r)); c.close()"`

## 2026-02-16

### Aanvullende P1-finetuning (actionability + datakwaliteit)

- Action plan verfijnd met dynamische impactdrempels en confidence-score per actie.
- `Next Best Action` toont nu confidence naast prioriteit/impact.
- Nieuwe action rules toegevoegd:
  - structurele vaste-lasten-risico (hoog aandeel recurring costs),
  - income-side focus wanneer essentials structureel dominant zijn.
- Data quality uitgebreid met bedrag-gedreven dekking:
  - category coverage op aantallen én op uitgavenvolume,
  - merchant coverage op aantallen én op uitgavenvolume.
- Data quality gebruikt nu ook dagdekking/datasetspan signalen in warnings/recommendations.
- Data quality detailmodal uitgebreid met actieve transactiedagen, dataspan en bedrag-gebaseerde dekkingsregels.

### Relevante commit

- `94e5b9d` Refine P1 action plan scoring and data-quality diagnostics

### Aanvullende P1/P2 batch (4-stappenreeks)

- P1 real-data/actionability uitgebreid:
  - nieuwe categorie `Abonnementen` (MCC + merchant keyword mapping),
  - verbeterde merchant/category signalen voor NL data.
- P1 actionable recommendations verdiept:
  - concrete cost-levers per categorie/merchant,
  - action-plan regels tonen nu ook praktisch `Actie`/playbook in de detailmodal.
- P1/P2 operations hardening:
  - `scripts/register_bunq_ip.sh` ondersteunt nu standaard veilige 2-staps whitelist-flow (`SAFE_TWO_STEP=true`),
  - extra egress-vs-whitelist verificatie met duidelijke mismatch-remediatie,
  - install/restart scripts gebruiken dezelfde veilige flow-parameters.
- P2 runtime hardening:
  - container draait nu op Gunicorn i.p.v. Flask dev server,
  - `scripts/run_server.sh` toegevoegd als production launcher,
  - backend kreeg lazy/throttled Bunq init guard voor WSGI workers.
- Documentatie bijgewerkt:
  - `README.md`, `SYNOLOGY_INSTALL.md`, `SECURITY.md`, `TROUBLESHOOTING.md`.

### Opslagstatus

- Alle bovenstaande wijzigingen zijn vastgelegd op `main`.
- Laatste commit: `6b67696` (`Finalize P1/P2 hardening and sync installation docs`).

### Vervolgacties (volgende run op NAS)

1. Update en deploy op NAS:
   - `cd /volume1/docker/bunq-dashboard`
   - `sudo git pull --rebase`
   - `sh scripts/install_or_update_synology.sh`
2. Runtime valideren:
   - `curl -s http://127.0.0.1:5000/api/health`
   - `sudo docker service logs --since 3m bunq_bunq-dashboard | grep -E "API key retrieved from vault|Bunq API initialized|Incorrect API key or IP address|No valid API key|ERROR"`
3. Alleen bij Bunq IP mismatch:
   - `TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard`
4. Daarna P1 functionele validatie in UI:
   - Data Quality kaart + detailmodal
   - Action Plan concrete levers
   - Accounts/Transactions flow op live data

## 2026-02-15

### Opgeleverd

- Whitelist helper script robuuster gemaakt (`scripts/register_bunq_ip.sh`):
  - multi-source egress IP detectie,
  - publieke IPv4 validatie voor `TARGET_IP`,
  - non-interactive run met `NO_PROMPT=true`,
  - duidelijkere foutoutput bij whitelist failures.
- Auto-whitelist startup-noise afgezwakt in backend:
  - SDK-variant zonder credential-password endpoints logt nu warning i.p.v. error-noise.
- Dashboard admin knop `Set Bunq API whitelist IP` aangepast naar veilige vaste 2-staps flow:
  1. IP toevoegen/activeren zonder andere IPs te deactiveren,
  2. expliciete confirm voor deactiveren van overige ACTIVE IPs.
- Voor deze knop is nu ook een expliciete IP prompt toegevoegd (met fallback op ingevulde/suggested egress IP).

### Relevante commits

- `cb04bdd` Run whitelist button in safe two-step flow with IP prompt
- `e1cd3b3` Harden whitelist helper script and downgrade auto-whitelist noise

### Aanvullende P1-uitwerking (stap 1 t/m 4)

- Real-data validatie toegevoegd:
  - nieuwe backend endpoint `GET /api/admin/data-quality` met kwaliteitscore, dekking, warnings en aanbevelingen op basis van lokale history store.
  - nieuwe dashboard insight `Data Quality` met doorklikbare detailmodal en component-score grafiek.
- Actionable metrics verder verfijnd:
  - `Next Best Action` gebruikt nu ook inkomensdaling (30d vs prior 30d), categorie-concentratie en urgente runway-signalen (<60 dagen).
  - top-actie toont nu prioriteit expliciet (`P1/P2/P3`).
- Edge-cases verder gehard:
  - accounttype-herkenning uitgebreid (o.a. `potje`, `stash`, `etf/equity` signalen).
  - categorisatie uitgebreid met extra NL merchants/keywords (boodschappen, vervoer, utilities, shopping, entertainment, zorg).
- Visualisaties informatiever gemaakt:
  - Sankey bevat nu link-aandelen (% van bron) in hover + totaalannotatie (in/uit/netto).
  - Sunburst toont meer categorieën/merchants met share-aware selectie en duidelijke parent-percentage hover.

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

### Aanvullend opgeleverd (P1 - actionable visualisaties)

- Bunq transactiepaginatie robuuster gemaakt in backend:
  - `api_proxy.py` gebruikt nu expliciet `count` en `older_id` voor payment-lijsten.
  - paging stopt slim op `cutoff_date`, met deduplicatie en veilige fallback over SDK-varianten.
  - nieuwe env-tuning: `BUNQ_PAYMENT_PAGE_SIZE` (max 200) en `BUNQ_PAYMENT_MAX_PAGES`.
- Dashboardvisualisaties meer coachend en actiegericht gemaakt:
  - `3D Time-Space Journey` vervangen door `Budget Discipline (50/30/20)`.
  - nieuwe budgetdetail-modal met maandvergelijkingen (needs/wants/savings + income/net).
  - Sankey herschikt naar `Cash In -> Essentials/Discretionary -> categorieën + Net Saved/Buffer`.
  - Sunburst uitgebreid met `overig`-aggregatie op categorie- en merchantniveau zodat minder data wegvalt.
- Insights uitgebreid met direct bruikbare sturing:
  - nieuwe kaarten `50/30/20 Fit` en `Next Best Action`.
  - nieuwe detailweergave `Action plan` met geprioriteerde acties en geschatte impact.

### Relevante commit

- `8d6fb66` Improve bunq pagination and actionable budgeting views

### Aanvullende P1 verfijning (metrics + edge-cases)

- Insights verder verdiept:
  - `Spend Volatility` toegevoegd (coëfficiënt van variatie op dagelijkse uitgaven).
  - `Recurring Costs` toegevoegd met geschatte maandlast op basis van terugkerende merchants.
  - `Next Best Action` verfijnd met meer business rules en impactdrempels.
- Nieuwe deep-dive:
  - `Recurring costs` detailmodal met prioritering op gemiddelde maandlast en stabiliteit.
- Action-plan tuning:
  - baseline op meerdere maanden i.p.v. één maand.
  - extra regels voor recurring spend, volatiliteit en negatieve savings-maand.
  - deduplicatie en beperking op aantal acties om ruis te reduceren.
- Backend edge-cases verbeterd:
  - accounttype-classificatie gebruikt nu expliciete typevelden (`monetary_account_type`, profile/setting type).
  - categorie-indeling uitgebreid met `Verzekering`, `Belastingen`, `Refund`, `Rente`.
  - MCC-mapping en keywordregels aangescherpt; categorisatie ontvangt nu ook transactie-`amount`.

### Relevante commit

- `cc73d56` Deepen budgeting metrics and harden categorization edge cases

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

### Huidige status (samenvatting)

- Preferred secret-flow: `USE_VAULTWARDEN=true`.
- Directe `bunq_api_key` flow blijft fallback-only.
- Session auth actief; secure cookie instelling en CORS-checks aanwezig.
- P1 admin maintenance tooling staat in code en UI.

### Openstaande focus

- Doorgaan met volgende P1-substap voor dashboard/functionele verbeteringen op basis van jouw feedback.
