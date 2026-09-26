# Context Handover

Laatste update: 2026-09-25 (inzichtregels gecorrigeerd: maandbasis, runway, prognose, terugkerende kosten, volatiliteit, actieplan)

## Canonieke status

Dit bestand is de actuele bron voor overdracht.
- Informatie staat hier bewust maar 1x.
- Verouderde aannames zijn verwijderd.

## Productiestatus (bevestigd)

- Vaultwarden-first werkt (`USE_VAULTWARDEN=true`).
- Bunq context init werkt op productie.
- Session-auth met secure cookies werkt.
- Dashboard draait via Synology + Docker Swarm + Gunicorn.

## Documentatie-talen (actueel)

- User-facing docs hebben nu een Engelse hoofdversie (`*.md`) en een Nederlandse variant (`*-NL.md`).
- Nederlandstalige docs zijn taalkundig opgeschoond op onnodig Engels in koppen en uitlegzinnen (technische termen behouden waar logisch).
- Huidige mapping:
  - `README.md` (EN) / `README-NL.md` (NL)
  - `SECURITY.md` (EN) / `SECURITY-NL.md` (NL)
  - `SYNOLOGY_INSTALL.md` (EN) / `SYNOLOGY_INSTALL-NL.md` (NL)
  - `TROUBLESHOOTING.md` (EN) / `TROUBLESHOOTING-NL.md` (NL)
- `README.md` bevat expliciete taalkeuze zodat gebruikers EN/NL direct kunnen kiezen.
- Korte release-samenvatting voor docs-updates is nu tweetalig beschikbaar:
  - `RELEASE_NOTES.md` (EN)
  - `RELEASE_NOTES-NL.md` (NL)
- Operationele markdown-instructies zijn gesynchroniseerd op de huidige updateflow:
  - `git pull` voorbeelden gebruiken nu `sudo git pull --rebase origin main`;
  - README EN/NL bevatten nu ook expliciet quick code-only redeploy (`scripts/quick_redeploy.sh`);
  - troubleshooting/synology NL voorbeelden voor full deploy gebruiken `.env`-load + `docker service update --force --image bunq-dashboard:$TAG ...` in dezelfde shell.
- `scripts/register_bunq_ip.sh` gedrag vereenvoudigd:
  - default non-interactive flow is nu `NO_PROMPT=true sh scripts/register_bunq_ip.sh`;
  - target-IP wordt automatisch bepaald (host `curl -4` first, container egress fallback);
  - oude cleanup/deactivation flow via `DEACTIVATE_OTHERS/SAFE_TWO_STEP` is uit dit script verwijderd.
  - stap 4 probeert eerst de whitelist-API met bestaande context; lukt dat niet (geen context of SDK-beperking `credential-password`), dan force-recreate van de context vanaf het container-egress-IP.
  - fallback-output rapporteert `ip` (werkelijk geregistreerd egress-IP) en `requested_ip` (`TARGET_IP`), met `WARN` bij verschil.
- Vaultwarden DNS-override:
  - `docker-compose.yml` gebruikt `extra_hosts` via `VAULTWARDEN_EXTRA_HOST` (`<hostnaam>:<ip>`, optioneel, uit `.env`); default is een onschadelijke placeholder.
  - productie-NAS moet deze variabele in `.env` hebben (Vaultwarden-host → huidig NAS LAN-IP) om verouderde Docker DNS na subnetwijziging te omzeilen.
  - wijziging vereist full stack deploy (niet quick redeploy).
- README EN/NL bevatten nu ook een compacte “IP change runbook” met 3 commando’s:
  - whitelist update;
  - restart/startup-check;
  - directe `/api/health` verificatie.
- README/install/troubleshooting EN/NL bevatten nu expliciet advies voor stabiel publiek egress-IP:
  - voorkeur voor vast publiek IP, minimaal sticky dynamisch IP;
  - uitleg waarom dit relevant is voor Bunq whitelist stabiliteit;
  - in troubleshooting staat extra toelichting op vast vs sticky + providerpraktijk.
- `TROUBLESHOOTING-NL.md` is inhoudelijk opgeschoond:
  - sterk verouderde/inconsistente instructies verwijderd;
  - structuur teruggebracht naar actuele diagnose + deploy/redeploy flows + kernincidenten;
  - taalconsistentie NL verbeterd en commando's geharmoniseerd op `sudo` + huidige scripts.

## Grafiekregels (actueel)

- Dagindeling in lokale (Nederlandse) tijd: `toDateKey()` / `dateFromKey()`; geen `toISOString().slice(0, 10)` voor dagen.
- Interne overboekingen: één regel `isInternalOwnTransfer()` (backend-vlag, eigen account-id/IBAN, of tegenpartij met naam van eigen rekening) in `applyClientFilters`, voor alle tegels en grafieken als de instelling aan staat; bij uit voor geen enkele grafiek.
- `Sparen`-tegel en detail `Spaarrekening mutaties`: `buildSavingsWidgetTransactions()` = mutaties op geselecteerde spaarrekeningen (excl. spaar→spaar via `isInternalSavingsToSavingsTransfer`: tegenpartij is andere spaarrekening op id/IBAN/naam, niet alleen backend-vlag) + voor niet-geselecteerde spaarrekeningen de overboekingen vanaf geselecteerde rekeningen (teken omgedraaid, `savings_via_transfer`). Beleggingsrekeningen tellen niet mee, overboekingen met de eigen Triodos-rekening ook niet (`isOwnExternalTransfer`). Trend/sparkline op dezelfde data. `Spaarquote` = Sparen / inkomsten; `n.v.t.` (met uitleg) als de selectie geen inkomsten behalve rente heeft (bv. alleen spaarrekeningen geselecteerd). Percentages in Nederlands formaat via `formatPercent`/`formatRatioPercent` (`16,7%`, `n.v.t.`).
- "Overgehouden" (50/30/20, `Netto` in budgetdetail, actieplan-20%-doel, `50/30/20-fit` als `N / V / O`) = inkomen − uitgaven, ook wat op de betaalrekening blijft; bewust andere naam dan `Sparen`.
- Saldo-tegels (`Betaalrekeningen`/`Spaarrekeningen (totaal)`): trend = saldo nu t.o.v. het eerste punt van de saldohistorie in de periode (`calculateSeriesChange`, `null` → `n.v.t.` via `setBalanceTrend`, met teken, pijl en kleur; tooltip noemt de startdatum). Reeks uit `/api/history/balances` (zie Transactie-opslag); zonder history reconstrueert de frontend uit **ongefilterde** transacties (incl. interne overboekingen).
- Periode: backend `period_cutoff(days)` = middernacht Nederlandse tijd `days` dagen terug (gelijk aan frontend `getSelectedPeriodStart`); `buildDailyTotals` geeft één punt per dag van periodebegin t/m vandaag (lege dagen = 0).
- Terugbetalingen (`Terugbetaling`, positief; `isRefundTransaction`) zijn geen inkomen maar verlagen uitgaven: `calculateKPIs` (`Inkomsten`, `Uitgaven`, `Spaarquote`), `buildDailyTotals`, detailvensters, `Gemiddelde daguitgaven`, `Geldstromen` (knoop `Terugbetalingen` → `Noodzakelijk`/`Vrij besteedbaar` volgens `refund_category`; alleen een overschot boven alle uitgaven telt als inkomen). Netto verandert niet.
- `Cashflow (tijdslijn)` (tegel + detail, één bouwer `buildCashflowFigure`): staven inkomsten/uitgaven per dag (≤92 dagen), week vanaf maandag (≤366) of maand, plus lijn `Netto cumulatief` op rechteras; nullijnen van beide assen uitgelijnd (`alignedZeroRanges`).
- Tegeltrends (`calculateTileTrends`): periode ≥60 dagen → laatste volledige maand vs gemiddelde van tot 3 eerdere volledige maanden (`TREND_MONTHS_BACK`); `Inkomsten`/`Uitgaven` uit `summarizeCompleteMonths` (zelfde basis als `compareLatestCompleteMonth`, inzichten en `Uitgavenmomentum`: salarismaand-correctie, eigen overboekingen eruit), `Sparen` uit de spaarmutaties. Periode <60 dagen: `Inkomsten`/`Sparen` `n.v.t.` (maandelijks), `Uitgaven` = variabele uitgaven (zonder vaste lasten) tweede vs eerste helft. Basis <€50 → verschil in euro (`+€ 300,00`). Pijl (↑/↓/→) volgt de richting, kleur of dat goed is; percentages Nederlands met teken (`formatSignedPercent`). Alle `…%`-teksten gebruiken `formatPercent` (`16,7%`).
- Budgetdiscipline: `summarizeMonthlyBudgetDiscipline` laat maanden weg die vóór het periodebegin starten, markeert lopende maand (`isCurrent`, label `(lopend)`); grafiek toont maanden zonder inkomen als gat; y-as tot de hoogste waarde (kan >100%); inzichten/actieplan/detail gebruiken `latestCompleteBudgetMonth`.
- Inkomen: positief, geen terugbetaling, geen overboeking met eigen Bunq-rekening of eigen gekoppelde externe rekening (Triodos: `isOwnExternalTransfer` op IBAN/account-id van niet-Bunq-rekeningen uit `/api/accounts`; blijft buiten de interne-overboekingsvlag, maar valt weg in `applyClientFilters` als het filter aan staat en altijd in budgetweergaven — geldt voor bij- én afschrijvingen). Backend `/api/statistics` idem (`extract_linked_external_ibans`, refunds verlagen uitgaven).
- Inzichtkaarten: `Grootste categorie` + grootste variabele categorie; `Duurste dag` alleen variabele uitgaven (`isVariableSpending`); `Aandeel top-tegenrekening` zonder `NON_ACTIONABLE_CATEGORIES` (Wonen, Belastingen, Alimentatie) in teller én noemer; `Liquiditeitsrunway` burn over alle rekeningen (`allAccountsTransactions`, net als het saldo); `Verwacht netto per maand` en de fallback van `estimateMonthlyNet` zonder eigen overboekingen; `Volgende beste actie` toont `zekerheid x%` met uitleg. `isInternalOwnTransfer` matcht niet meer op categorie = eigen rekeningnaam (dat verborg o.a. alimentatie vanaf subrekening "Alimentatie").
- `Verdeling in categorieën` (sunburst + detail `categories`): `buildCategoryBreakdown` — inkomsten per categorie (zonder terugbetalingen), uitgaven per categorie per tegenrekeninggroep (`merchantGroupKey`); een terugbetaling gaat af van de eigen winkel, alleen zonder aankoop in de periode wordt hij over de categorie verdeeld. Hover: Uitgaven als % van de inkomsten, categorie als % van inkomsten/uitgaven, tegenrekening als % van de categorie; midden "Totaal" (hover: netto). Restgroepen "Kleinere categorieën" en "Overige tegenrekeningen".
- Uitgaven in alle uitgavenweergaven (Top tegenrekeningen, Aandeel top-tegenrekening, Grootste categorie, Uitgavenmomentum, Categorie-race, besparingshefbomen/actieplan): `spendingEntries` — afschrijvingen positief, terugbetalingen negatief op `refund_category` en dezelfde tegenrekening; `buildExpenseByCategory` en `netSpendingByMerchant` zijn netto. Totalen per tegenrekening groeperen filialen via `merchantGroupLabel`/`merchantGroupKey` (afkappen bij eerste token met ≥3 cijfers, `NLD`/`NL` en B.V./N.V. eraf); transactielijsten tonen de originele naam. `Dagpatroon` toont alleen variabele uitgaven (zonder `FIXED_COST_CATEGORIES`, want incasso's worden 's nachts geboekt). `Maandverdeling` blijft bruto (verdeling van losse betalingen).
- Vast inkomen (`isRegularIncome`): `Salaris`, `Uitkeringen & toeslagen`, `Rente`, of een tegenpartij (IBAN/naam) met ≥3 maanden ≥€250 binnen ±25% van de mediaan (`detectRecurringIncomeSources`); telt ook mee in de salarismaand-correctie. Inkomstendetail splitst vast/terugkerend vs incidenteel (top 5 incidenteel). `Verdeling in categorieën`: terugbetalingen niet als inkomen, maar verlagen hun aankoopcategorie (winkels schalen mee).
- Budgetregels (50/30/20, `Noodzaak vs wens`, `Geldstromen`): overboekingen tussen eigen rekeningen (incl. Triodos) tellen nooit mee, ongeacht de instelling (`excludeOwnTransfersForBudget`); terugbetalingen verlagen de bak van hun aankoop (`refundBudgetBucket` op `refund_category`, onbekend = vrij besteedbaar), wat een bak niet kan opvangen gaat van de andere af (`applyBudgetRefunds`); salaris net over een maandgrens (maand met 2+ salarisbetalingen, buurmaand 0, binnen 7 dagen van de grens) telt voor de buurmaand (`assignSalaryMonths`); `Overig` telt als vrij besteedbaar en wordt per maand getoond (`uncategorized`: hover + detailsamenvatting).
- Maandverdeling (spreiding): `buildSpendingSpread` met bedragklassen `SPREAD_BUCKETS`, top 4 categorieën op totaalbedrag, % van betalingen per categorie.
- Labels in grafieken en detailvensters in het Nederlands (noodzakelijk / vrij besteedbaar / overgehouden).
- Browsercheck (niet in repo): headless Chromium met gemockte `/api/*` en lokale Plotly/Chart.js; alle grafieken renderen zonder JS-fouten.

## Inzichtregels (actueel)

- Maandvergelijkingen via volledige kalendermaanden (`summarizeCompleteMonths`, `compareLatestCompleteMonth`): trend-kaart, inkomens-/uitgavenalerts in actieplan en venster `Uitgavenmomentum`. Geen rollende 30-dagenvensters meer (`splitRollingWindows` verwijderd).
- `Liquiditeitsrunway`/buffer-acties: `computeDailyBurn` = max(−gem. maandnetto, 0) / 30,44 (`estimateMonthlyNet`: volledige maanden, anders periode tot nu toe).
- `Verwacht netto per maand`: `projectCurrentMonthNet` = maand tot nu toe + gemiddeld netto na de huidige dag-van-de-maand in recente volledige maanden.
- `Terugkerende kosten`: `summarizeRecurringCosts` telt alleen tegenrekeningen in ≥2–3 maanden met ≤2 betalingen/maand en stabiel maandbedrag (cv ≤ 0,35).
- `Uitgavenvolatiliteit`: `computeWeeklySpendingVolatility` over volledige weken, zonder `FIXED_COST_CATEGORIES`; Hoog ≥ 60%, Middel ≥ 30%.
- Actieplan: `NON_ACTIONABLE_CATEGORIES` (Wonen, Belastingen) uitgesloten van concentratie-, tegenrekening-, terugkerende-kosten- en hefboomadvies; hefbomen op maandgemiddelde van volledige maanden.
- `Gemiddelde daguitgaven`: totaal / `periodDaysCovered` (kalenderdagen van de periode).
- Datakwaliteit (`computeDataQualitySummary`): alle dekkingscijfers (aantallen én bedragen) over één set: echte uitgaven in de selectie (afschrijvingen zonder eigen overboekingen incl. Triodos, `excludeOwnTransfersForBudget`). Backend levert alleen actieve dagen, dataspan, EUR-dekking en tijd van laatste sync (`bunq_sync_state.last_sync_at`, niet `last_seen_at`). Eén lijst waarschuwingen met elk één advies (backend-waarschuwingen worden niet meer samengevoegd). Labels Goed/Redelijk/Aandacht nodig; aandeel interne overboekingen op ongefilterde data (waarschuwing alleen als het filter uit staat); minimum aantal transacties ≈ 1,33 × periodedagen (20–400), ook in de backend. Backend `build_data_quality_summary` telt interne overboekingen niet als uitgave.

## Frontend detailweergave (actueel)

- In de bestaande detailmodal staat nu een tweede sectie met individuele transacties.
- Deze sectie is aangesloten voor:
  - `Betaalrekeningen` (balanskaart — toont alle transacties op betaalrekeningen incl. interne)
  - `Spaarrekeningen` (balanskaart — toont alle transacties op spaarrekeningen incl. interne)
  - `Inkomsten`
  - `Uitgaven`
  - `Spaarrekening mutaties`
  - `Cashflow (tijdslijn)`
  - `Noodzaak vs wens`
  - `Aandeel top-tegenrekening`
  - `Uitgavenmomentum` (laatste 30 dagen)
  - `Geldstromen detail`
- Kolommen in de transactieview:
  - `Datum`
  - `Tijd`
  - `Eigen Bunq rekening`
  - `Tegenrekening / merchant + rekeningnummer` (IBAN of account-id indien beschikbaar)
  - `Omschrijving`
  - `Bedrag`
- KPI-afstemming:
  - `Sparen` gebruikt nu dezelfde datasetlogica als de secondary view `Spaarrekening mutaties` (stortingen minus opnames), inclusief negatieve bedragen.
  - `Spaarquote` (was `Savings Rate`) wordt afgeleid van diezelfde `Sparen`-netto.
- Performance/UX:
  - dubbele oude individuele opsomming verwijderd bij detailviews met second-view transactietabel (geen dubbeling meer).
  - modal rendert transacties in batches (`Toon meer`) i.p.v. alles in 1 keer om UI-lag bij grote periodes te beperken.
  - client-side zoekveld toegevoegd (eigen rekening, merchant/tegenrekening, omschrijving, datum, bedrag).
  - client-side sortering toegevoegd (datum, bedrag, naam).
  - `Geldstromen` detail ondersteunt klikbare categorie-rijen met gefilterde transactietabel en standaard ingeklapte sectie `Alle transacties in de periode`.
  - geldstromen-detail klikhandler is robuust gemaakt voor browservarianten waar `event.target` geen direct `Element` is.
  - tekst `Alle transacties in de periode` staat nu alleen in het bovenste categoriepaneel; de tabelsectie onderin gebruikt neutrale titel `Transacties (...)`.

## Internal transfer filtering (actueel)

- `exclude_internal=true` filtering is aangescherpt:
  - backend markeert internal transfers primair op deterministische signalen: eigen account-id en eigen IBAN (afgeleid uit de volledige opgehaalde Bunq-rekeninglijst).
  - linked external accounts (zoals Triodos `MonetaryAccountExternal`) tellen expliciet niet als intern; Bunq `ExternalSavings` blijft wel intern.
  - backend detectie leest geneste alias-account-id (`extract_alias_account_id`) plus IBANs uit `counterparty_alias`, `monetary_account_counterparty` en `merchant_reference`.
  - backend draait daarnaast een cross-account reconcile-pass (`reconcile_internal_transfers`) over alle opgehaalde transacties:
    - pass 1: match op `payment-id + minute + amount + currency` met plus/min-tegenboeking op verschillende eigen Bunq-rekeningen.
  - overfilter-correctie (inkomsten/uitgaven op 0 voorkomen):
    - deterministische account-id-match markeert alleen intern als `counterparty_account_id` een eigen Bunq-account is én verschilt van de bronrekening (`account_id`);
    - reconcile pass 1 gebruikt nu ook minuut-timestamp in de key (`payment-id + minute + amount + currency`) om false matches tussen ongerelateerde transacties te voorkomen.
  - `/api/accounts` levert `ibans` per rekening zodat ook frontend-fallback op rekeningnummer kan matchen.
  - deze detectie wordt toegepast in zowel `/api/transactions` als `/api/statistics`.
  - frontend bevat alleen nog deterministische fallback-filtering op tegenrekening-account-id en tegenrekening-IBAN.
  - frontend account-id fallback respecteert nu ook bronrekening-id (zelfde account-id wordt niet automatisch intern weggefilterd).
  - balanswidgets voor betaal/spaar gebruiken nu alleen eigen Bunq-rekeningen (Triodos valt buiten `Betaalrekeningen (totaal)`).
  - widgetspecifiek:
    - `Top tegenrekeningen` en `Verdeling in categorieën` filteren nu ook expliciet interne/eigen tegenrekeningen weg op account-id, IBAN en eigen Bunq-rekeningnaam (zodat o.a. `Richard` niet meer verschijnt).

## Widgetteksten (actueel)

- KPI labels:
  - `Inkomsten`
  - `Uitgaven`
  - `Sparen`
  - `Spaarquote`
- Visualisatie labels:
  - `Cashflow (tijdslijn)`
  - `Geldstromen`
  - `Verdeling in categorieën`
- Kleine widgets onder de race-sectie zijn vertaald:
  - `Dagpatroon`
  - `Top tegenrekeningen`
  - `Maandverdeling`
- Bovenstaande widgettitels hebben korte hover-uitleg (native tooltip via `title`).
- Insights-kaarten (o.a. `Terugkerende kosten`, `Volgende beste actie`, `Datakwaliteit`) zijn ook vertaald naar Nederlands en voorzien van korte hover-uitleg.
  - tooltip op insight-kaarten staat nu op de hele tegel (`.insight-card`), niet alleen op de `h4`-titel.
  - tooltips zijn nu ook statisch in de HTML op elke inzichttegel gezet (`title` op elk `.insight-card`) en daarnaast als custom CSS-tooltip (`data-tooltip`) gerenderd voor consistente hover-weergave in browsers die `title` op `div` beperkt tonen.
- `Geldstromen` samenvattingstekst (`In · Uit · Netto`) staat nu als HTML-balk boven de Sankey i.p.v. als Plotly-annotatie; dit voorkomt render-artifacts in fullscreen (tekst werd een dunne onleesbare lijn).
- Op `Cashflow (tijdslijn)` is de downloadknop verwijderd; detailview opent via de detailactieknop.
- `Top tegenrekeningen` en `Categorie-race` gebruiken nu transparante Plotly-plotachtergrond (`plot_bgcolor`) zodat geen witte chart-achtergrond meer zichtbaar is binnen de tegel.
- `Budget discipline` en `Categorie-race` gebruiken nu dezelfde standaard tegelrand als andere widgets (featured-card rand verwijderd).
- Safari hover-fix inzichttegels:
  - JS-gestuurde floating tooltip toegevoegd (`.insight-hover-tooltip`) die op `mouseenter/focus` op inzichttegels toont.
  - oude native `title` mouse-overs op inzichttegels worden nu runtime verwijderd, zodat alleen de nieuwe custom tooltip zichtbaar is.
  - CSS pseudo-tooltips worden automatisch uitgeschakeld wanneer JS-tooltip actief is (`body.js-insight-tooltips`) om dubbele tooltips te voorkomen.
  - tooltip volgt nu de cursor en wordt net onder de muis getoond (met viewport fallback boven de cursor indien nodig).
  - floating tooltip heeft nu een lichtere glass-tint met subtiele magenta-accenten voor betere zichtbaarheid.
  - doel: ook in Safari (maximized/fullscreen) consistente tooltipweergave.

## Detailmodal styling (actueel)

- `Actieplan` detail gebruikt nu een gestapelde rijweergave voor tekstregels (`balance-detail-list-stacked`) zodat kopteksten/inhoud horizontaal leesbaar blijven (geen verticaal “ingedrukte” tekstblokken).

## Header UX (actueel)

- Op het bewegende Bunq-icoon naast `Bunq Financial Dashboard` staat nu een hover/focus popover met klikbare support-link:
  - tekst: `Click on the logo to buy me a coffee if you like using this free dashboard`
  - URL: `https://bunq.me/BunqFinancialDashboard/3.50`
  - zowel de popover-link als klik op het bewegende logo openen deze URL in een nieuw tabblad (`target="_blank"` + `rel="noopener noreferrer"`).
  - popoverstijl is nu donkerder/frosted voor beter contrast.

## Settings UX (actueel)

- Instelling `Enable background particles` is visueel opgewaardeerd naar een prominente feature-togglekaart met:
  - heldere glass gradient (cyan/magenta accenten),
  - badge + titel + korte uitleg,
  - custom switch met glow/pulse-animatie wanneer actief.
- Technisch blijft dezelfde instelling behouden (`id="enableParticles"`), dus bestaande save/load logica in `app.js` is ongewijzigd.
- Particles-rendering is nu robuuster gemaakt:
  - particlelaag staat boven de body-achtergrond (`#particles-js` op `z-index: 0`) en vangt geen clicks (`pointer-events: none`);
  - dashboardcontent staat expliciet erboven (`.dashboard-container` op `z-index: 1`);
  - init/destroy flow ruimt stale canvassen op en herstelt correcte particles-status bij toggle.

## Categorie-race (actueel)

- Widgetnaam is `Categorie-race`.
- Raceframes zijn nu dag-gebaseerd (i.p.v. maand-gebaseerd), met cumulatieve uitgaven per categorie per dag.
- Playback draait op `2 fps` (`RACING_ANIMATION_FPS=2`), zodat ~90 dagen ongeveer 45 seconden animatie geven.
- Slider/label tonen dagframes (datum) in plaats van maandlabels.

## Frontend codestructuur (actueel)

- `styles.css`: `.clickable-kpi`, `.clickable-kpi-detail`, `.clickable-viz` zijn samengevoegd tot één selector. `.viz-card.featured-card` en de dubbele `height` op `.kpi-metric-chart` zijn verwijderd. Modal `max-width` regels zijn verwijderd waar `min()` al de cap handhaaft.
- `index.html`: AOS stylesheet staat in `<head>`. Plotly, Chart.js en Particles.js laden met `defer` zodat HTML-parsing niet geblokkeerd wordt.
- `app.js`: onbereikbare `if (declaredType === 'checking')` branch verwijderd uit `classifyAccountType`. `handleLogin` herstelt nu `innerHTML` (met icon) bij reset van de loginknop.

## api_proxy.py codestructuur (actueel)

- `_discover_endpoints()`: generieke endpoint-discovery helper met caching (`_ENDPOINT_DISCOVERY_CACHE`). Alle vijf `discover_*_endpoints()` functies zijn dunne wrappers.
- `_list_payments_paginated()`: gedeelde paginatieloop voor payments en card payments. `list_payments_for_account()` en `list_card_payments_for_account()` zijn ~10-regel wrappers.
- `RateLimiter`: stale IP-entries worden direct verwijderd na trim + periodieke full sweep elke 1000 requests.
- `USE_VAULTWARDEN`, `CACHE_ENABLED`, `DATA_DB_ENABLED`, `FX_ENABLED`: moduleniveau constanten via `get_bool_env`.
- Bunq page-size/max-pages: moduleniveau constanten (`_BUNQ_ACCOUNT_PAGE_SIZE`, `_BUNQ_PAYMENT_PAGE_SIZE`, etc.).
- `persist_transactions`: gebruikt `executemany` in plaats van per-rij `execute`.

## Categorisatie (actueel)

- `categorize_transaction` (backend, bij ophalen): intern → `Internal Transfer`; inkomend: refund-woorden → `Refund`, rente → `Rente`, salaris → `Salaris`; dan MCC (`_MCC_CATEGORIES`), dan tekstregels (`_TEXT_RULES`, eerste match wint); anders `Overig`.
- Tekstregels matchen op beschrijving + tegenrekeningnaam, kleine letters, accenten genegeerd. `words` alleen als heel woord (dus `bar` ≠ `Bart`, `ns` ≠ `lens`, `plus` ≠ `Disney Plus`); `stems` ook binnen Nederlandse samenstellingen (`zorgverzekering`, `debetrente`, `huurtoeslag`) en daarom alleen lange, eenduidige stammen.
- Volgorde: Abonnementen → Boodschappen → Horeca → Reizen → Vervoer → Belastingen (incl. `toeslag`) → Wonen → Rente → Verzekering → Kinderopvang → Utilities → Sport → Entertainment → Zorg → Shopping. Hypotheekrente = `Wonen`; drogisterij (Kruidvat/Etos, MCC 5912) = `Zorg`; bouwmarkt = `Shopping`; autohuur = `Vervoer`.
- Volgorde `categorize_transaction`: intern → eigen regels uit `config/category_rules.json` (`CATEGORY_RULES_PATH`, niet in git; velden `account`/`counterparty`/`description` bevatten, `iban` exact; alle opgegeven velden moeten kloppen; geladen bij de start) → inkomend-regels → MCC → tekstregels → voor afschrijvingen die `Overig` blijven: hint uit de naam van de eigen rekening (`_ACCOUNT_NAME_HINTS`, bv. subrekening "Alimentatie" → `Alimentatie`). `Alimentatie` (partner/kinderalimentatie, kinderbijdrage) is noodzakelijk, vaste last en niet-stuurbaar; inkomend blijft het `Alimentatie` (inkomen). Migratieversie = `CATEGORIZATION_VERSION` (5) + hash van de eigen regels (`categorization_state_version`): regels aanpassen → eenmalig hercategoriseren bij herstart.
- Inkomend (positief) vóór de gewone regels: refund-woorden → `Refund`; rente → `Rente`; salaris (`loon`, `bonus`, `13e maand`, `vakantietoeslag` als woord; stammen `salaris`, `loonbetaling`, `maandloon`, `vakantiegeld`, `eindejaarsuitkering` …) → `Salaris`; uitkeringen/pensioen/toeslagen (UWV, SVB, AOW, pensioenfondsen, DUO, `uitkering`, `toeslag`, `kinderbijslag`, `studiefinanciering`, `pensioen`, `bijstand`) → `Uitkeringen` (UI: `Uitkeringen & toeslagen`). Belastingteruggaaf blijft `Belastingen`. `CATEGORIZATION_VERSION` 4.
- Inkomend geld in een uitgavencategorie (kaartretour, Tikkie voor gedeeld etentje, eindafrekening energie) wordt `Refund`, met `refund_category` = categorie van de aankoop (`refund_source_category`, bv. `Utilities`; `None` als onbekend); alleen `Belastingen` (toeslagen/teruggave), `Verzekering` (uitkering), `Wonen`, `Rente`, `Salaris`, `Overig` blijven staan.
- Nieuwe categorieën: `Reizen`, `Sport`, `Kinderopvang` (noodzakelijk + vaste last in de frontend).
- Payload bewaart `merchant_category_code` en `counterparty_name`. Bij een regelwijziging `CATEGORIZATION_VERSION` ophogen: `migrate_stored_categories()` hercategoriseert bij opstart (import, 1× in de Gunicorn-master) eenmalig alle opgeslagen rijen (kolom + payload + hash), ook rijen die Bunq niet meer aanlevert. Oude kaartbetalingen zonder opgeslagen MCC houden hun oude categorie als de tekstregels niets vinden.
- Frontend toont Nederlandse namen via `CATEGORY_DISPLAY_NAMES` in `resolveCategoryLabel`: `Internal Transfer` → `Interne overboeking`, `Refund` → `Terugbetaling`, `Utilities` → `Energie & telecom`, `Shopping` → `Winkelen`, `Entertainment` → `Vrije tijd`. Frontendsets (`ESSENTIAL_CATEGORIES`, `FIXED_COST_CATEGORIES`, kleuren) gebruiken de Nederlandse namen.

## Transactie-opslag (actueel)

- Transacties staan in SQLite-tabel `bunq_transactions` (sleutel `account_id + source + bunq_id`, `payload_json` = volledige transactie, `content_hash` voor wijzigingsdetectie, `deleted_at` = soft delete). Oude tabel `transaction_cache` wordt niet meer gebruikt (blijft ongemoeid in bestaande DB's).
- `/api/transactions` en `/api/statistics` lezen uit de opslag (`load_transactions`). Dekt de opslag de periode (`store_covers_period`), dan draait de incrementele sync op de achtergrond (`_start_background_sync`) en wacht de request niet op Bunq; anders (eerste load / langere periode) wacht de request op `sync_transactions`. Sync haalt alleen pagina's nieuwer dan het opgeslagen nieuwste id (`stop_at_id`), eenmalige backfill (`start_older_id`). Hooguit 1 Bunq-check per `SYNC_MIN_INTERVAL_SECONDS` (60s) per rekening/bron.
- Rekeninglijst: request-handlers gebruiken `get_monetary_accounts()` (cache per proces: vers `ACCOUNTS_CACHE_SECONDS`=60s, daarna geserveerd + achtergrond-refresh tot `ACCOUNTS_STALE_SECONDS`=1800s). `list_monetary_accounts()` kost op productie ~6,5s (SDK + raw savings-fallback, 6 calls).
- Card-payment endpoint faalt op productie voor alle rekeningen; na een fout wordt die bron per rekening `SOURCE_FAILURE_BACKOFF_SECONDS` (1u) overgeslagen.
- Sync-bookmark per rekening/bron in `bunq_sync_state` (`newest_bunq_id`, `oldest_bunq_id`, `covered_from`, `history_complete`).
- Maandelijkse nachtelijke controle (`run_full_reconcile`): 1e van de maand, 03:00–06:00 Europe/Amsterdam (instelbaar via `RECONCILE_*`), 1 worker via file-lock `config/reconcile.lock`, gemiste nacht wordt de volgende nacht ingehaald, retry na 1 uur bij fout. Haalt alles op tot de oudste opgeslagen transactie en: voegt nieuwe toe, werkt gewijzigde bij, herstelt teruggekeerde, markeert ontbrekende als verwijderd **alleen binnen het bereik dat Bunq nog aanlevert** (bij `cutoff_reached` de hele opgeslagen periode, anders vanaf de oudste teruggegeven transactie). Oudere rijen blijven bewaard en zichtbaar. Bij een fout per rekening: geen verwijderingen voor die rekening.
- Runs worden gelogd in `bunq_reconcile_runs`; status via `GET /api/admin/reconcile`, handmatig starten via `POST /api/admin/reconcile` of `run_reconcile_exclusive('manual')` (TROUBLESHOOTING 5b).
- Saldohistorie (`/api/history/balances`): `build_balance_history_from_store()` reconstrueert per rekening het eindsaldo per Nederlandse kalenderdag = huidig saldo − latere `payment`-rijen (card_payment niet, die staan ook als payment geboekt), met de huidige classificatie; start op de eerste dag die voor alle eigen rekeningen gedekt is (`covered_from`/`history_complete`). Vreemde valuta tegen de huidige koers. Lukt dat niet (geen Bunq-context, rekening nooit gesynct) → fallback op `account_snapshots` (alleen dagen waarop het dashboard open was). Response-veld `source` = `transactions` | `snapshots`.
- Rekeningclassificatie op naam/typevelden: korte beleggingshints (`stock`, `share`, `etf`, `equity`) alleen als heel woord (`_looks_like_investment`, frontend `looksLikeInvestmentAccount`); frontend volgt de backend-`account_type` als die gezet is.
- Zonder `DATA_DB_ENABLED` blijft het oude gedrag (live ophalen per request).

## Opstartflow (actueel)

- Gunicorn draait met `--preload`: de API key wordt 1x uit Vaultwarden gehaald (import in de master); workers erven hem, ook na recycling (`max_requests`).
- `scripts/gunicorn_conf.py`: `on_starting` (master) → `run_preboot_init()` (context-file + auto-whitelist, `BUNQ_PREBOOT_INIT`); `post_fork` → `reset_bunq_state_after_fork()`; `post_worker_init` → `start_background_bunq_init()` (context restore per worker).
- Na key-rotatie in Vaultwarden: service herstarten (`docker service update --force`).

## Healthcheck (actueel)

- Elke Gunicorn-worker start bij opstarten een Bunq-init in de achtergrond (`scripts/gunicorn_conf.py` → `start_background_bunq_init`); `/api/health` is daardoor kort na start al accuraat. API-requests wachten max `BUNQ_WARMUP_WAIT_SECONDS` (60s) op die warm-up.

- Healthcheck op `/api/live` met `start_period: 300s` (compose + Dockerfile) als marge voor key-fetch (~35s) + Bunq-init bij opstarten.
- `VAULTWARDEN_ITEM_NAME` is hoofdlettergevoelig (exacte match op item-naam); productie-item heet `Bunq API Key`.

## Repo-hygiëne (actueel)

- `config/` staat in `.gitignore`: bevat alleen runtime-state (Bunq context, `vaultwarden_device_id`, `dashboard_data.db`) en mag nooit gecommit worden.
- NAS-specifieke instellingen horen in `.env`, niet als lokale wijziging in `docker-compose.yml`.

## Tests (actueel)

- `tests/` bevat een pytest-suite voor `api_proxy.py` (helpers, internal-transfer detectie/reconcile, categorisatie/accountclassificatie, auth/sessie/rate-limit, static allowlist, health-probes).
- Draaien: `python -m pytest tests -q` in een venv met `requirements_dev.txt` (bevat ook `requirements_web.txt`); geen Bunq/Vaultwarden/Docker nodig (`tests/conftest.py` zet de env vóór import).
- Dependencies gesplitst: `requirements_web.txt` = alleen runtime (Docker image); `requirements_dev.txt` = runtime + `pytest`, `pyflakes`, `black`.
- CI: `.github/workflows/tests.yml` installeert `requirements_dev.txt` en draait `pyflakes` + `pytest` op elke PR en push naar `main`.

## Savings-incident status

Status: opgelost op 2026-03-01.

Live validatie:
- `scripts/check_accounts_api.py` geeft nu `Validation OK`.
- `/api/accounts` bevat beide savings-accounts:
  - `Spaarrekening` (`EUR`)
  - `Spaargeld in ZAR` (`ZAR`)

## Root cause (bevestigd)

- In deze runtime faalde SDK-deserialisatie op savings objecten (`float(None)`).
- Raw responses bevatten wel savings-data, maar payload zat in `BunqResponseRaw` velden die niet volledig werden uitgelezen.

## Huidige implementatie (bewust SDK-first)

Bronleidraad: officiële Bunq SDK/API documentatie.

1. SDK-first accountophaalpad:
- `MonetaryAccountApiObject` / `MonetaryAccount`
- `MonetaryAccountSavingsApiObject` / `MonetaryAccountSavings`
- `MonetaryAccountExternalSavingsApiObject` / `MonetaryAccountExternalSavings`
- efficiëntie-optimalisatie: als het canonieke unified endpoint al savings bevat, stopt verdere subtype-probing vroegtijdig.

2. Minimalistische raw fallback (alleen bij SDK parse issues):
- uitsluitend gedocumenteerde user-routes:
  - `/user/{user_id}/monetary-account`
  - `/user/{user_id}/monetary-account-savings`
  - `/user/{user_id}/monetary-account-external-savings`
- beperkte params:
  - `{'status': 'ACTIVE', 'count': <page_size>}`
  - `{'count': <page_size>}`
- brede route-matrix/probe-combinaties zijn verwijderd.
- raw fallback merge draait nu alleen wanneer SDK-resultaat geen savings bevat.

3. Raw payload extractor:
- ondersteunt nu `BunqResponseRaw` accessors (`get_*`) en private `__dict__` payloadvelden.
- ondersteunt `Response[]` én single-object payloads plus nested `value/data/result`.

4. API robustness:
- `parse_pagination()` is gehard tegen ongeldige/negatieve querywaarden en voorkomt 500s door `int(...)` parsefouten.

## Deploystrategie op Synology

Snelle loop voor codewijzigingen (zonder stack deploy):

```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

Gebruik volledige stack deploy alleen bij wijzigingen aan:
- `.env`
- `docker-compose.yml`
- secrets/netwerk/deploy-config

Volledige deploy:

```bash
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

Belangrijk:
- install/update op Synology altijd als root uitvoeren:
  - `sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh`

## Validatiecommando's (actueel)

Savings-check:

```bash
EXPECTED_ACCOUNTS_JSON='[
  {"description":"Spaarrekening","currency":"EUR"},
  {"description":"Spaargeld in ZAR","currency":"ZAR"}
]'

DASHBOARD_USERNAME="<dashboard-user>" \
DASHBOARD_PASSWORD="<dashboard-pass>" \
python3 /volume1/docker/bunq-dashboard/scripts/check_accounts_api.py \
  --base-url "$BASE_URL" \
  --insecure \
  --expected-json "$EXPECTED_ACCOUNTS_JSON" \
  --timeout 180
```

Raw debug (alleen indien nodig):

```bash
sudo sh scripts/debug_raw_monetary_accounts.sh bunq_bunq-dashboard 0 | tee /tmp/monetary_debug.log
grep -E "^(attempt_count=|== /user/|parsed_accounts=|first_account=|result_type=|probe_|error=)" /tmp/monetary_debug.log
```

## Als regressie terugkomt

1. Eerst `check_accounts_api.py` draaien (zelfde expected JSON).
2. Daarna `debug_raw_monetary_accounts.sh` voor endpoint/result-type bewijs.
3. Alleen patchen op basis van officiële SDK/API routes en response-structuur.

## Documentatie-afspraak

Bij elke codewijziging:
- `WORKLOG.md` bijwerken met wat/waarom/resultaat.
- `CONTEXT_HANDOVER.md` actueel houden.
