# Release Notes

## 🌐 Language

- English (this file): [RELEASE_NOTES.md](RELEASE_NOTES.md)
- Dutch: [RELEASE_NOTES-NL.md](RELEASE_NOTES-NL.md)

## 2026-09-25

### Data and speed
- Transactions are stored in SQLite: the dashboard reads from the database, only fetches new transactions from Bunq (in the background when the period is already stored), and reuses the account list for a minute.
- Monthly nightly check (1st, 03:00–06:00 Dutch time) against Bunq: new and changed transactions are applied; transactions Bunq no longer returns are hidden, except when they are older than Bunq still serves.
- Startup: the API key is fetched from Vaultwarden once; each worker connects to Bunq right away; healthcheck start period 300s.

### Charts
- Days are counted in Dutch time (a payment at 00:30 belongs to that day).
- `Sparen`: trend and mini-chart now follow the savings figure itself, and the tile respects the account selection.
- Trends show `n.v.t.` instead of `0.0%` when the first half of the period has no value.
- Budget discipline (50/30/20): months only partly inside the period are left out, the running month is marked `(lopend)`, refunds lower spending instead of counting as income, months without income show as gaps; insights use the last complete month.
- `Maandverdeling` (spending spread): amount buckets €0–5 … €1000+, top 4 categories by amount, share of payments per category.
- One internal-transfer rule for all tiles and charts, following the setting.
- Dutch labels throughout the charts and detail popups; € amounts in hover of `Top tegenrekeningen` and `Categorie-race`.
- Outgoing interest (`Rente`) is no longer categorised as `Wonen`.

### Trends
- Tile trends for `Inkomsten` and `Uitgaven` use the same monthly figures as the insights (including the salary-month correction) and compare the last complete month with up to three months before it.
- Arrows follow the direction of the change (no more fixed up/down arrows); colour shows whether that's good.
- Periods shorter than 60 days: no income or savings trend (`n.v.t.`, they are monthly); the spending trend compares variable spending between the two halves.
- A trend with a small comparison base (under €50) shows the euro difference instead of an extreme percentage; percentages use Dutch notation with a sign (`+12,3%`).

### Savings rate
- `Spaarquote` shows `n.v.t.` when the selection has no income apart from interest (e.g. only savings accounts selected) instead of `0.0%` or absurd percentages.
- Transfers between your own Triodos account and your savings accounts no longer count as saving.
- Percentages use Dutch notation (`16,7%`), and missing values show `n.v.t.`.

### Spending
- Refunds now lower spending everywhere, also in `Top tegenrekeningen`, `Categorie-race`, the largest-category and top-counterparty insights, `Uitgavenmomentum` and the savings levers (a returned order no longer shows up as spending).
- Branches of the same shop (e.g. "Albert Heijn 1234" and "ALBERT HEIJN 5678 UTRECHT") count as one counterparty in totals.
- `Dagpatroon` shows variable spending only: fixed-cost direct debits are booked at night and made the night look like the biggest spending moment.
- The foreign-currency warning is in Dutch.

### Income
- Salary is recognised more often (loonbetaling, maandloon, vakantiegeld, eindejaarsuitkering, bonus, 13th month), and a payer who pays about the same amount every month counts as regular income even without a keyword (e.g. "Periode 9").
- New category `Uitkeringen & toeslagen` for UWV, SVB (child benefit, AOW), pension funds, DUO student finance, allowances and municipal benefits (these used to be `Overig` or `Belastingen`). Stored transactions are updated once.
- Transfers with your own Triodos account are no longer income or spending.
- Refunds no longer show as income in `Verdeling in categorieën`; the income popup splits regular and one-off income.

### Budget
- 50/30/20, `Noodzaak vs wens` and `Geldstromen` never count transfers between your own accounts, even with the internal-transfer filter off.
- A refund lowers the kind of spending it belongs to: an energy settlement lowers essential spending, a Tikkie for dinner discretionary spending (stored transactions are updated once after the update).
- A salary that lands just across a month boundary (weekend) counts for the month it belongs to, so no month shows two salaries and the next none.
- The budget chart scales beyond 100% when a month's spending exceeds its income; uncategorised spending (`Overig`) is shown per month.

### Cashflow
- Refunds (card reversals, Tikkie for a shared dinner) lower spending instead of counting as income, in the tiles, `Spaarquote`, the cashflow timeline, the popups and `Geldstromen` (a separate "Terugbetalingen" flow into discretionary spending).
- `Cashflow (tijdslijn)` shows income and spending bars per day (up to 3 months), week (up to a year) or month, and the cumulative net since the start of the period; it always covers the whole selected period.
- Tile trends compare the last complete month with the months before it for periods of 60+ days (no more jumps from one vs two salaries in a half-period).
- The period starts at midnight Dutch time, so its first day is complete.

### Savings
- Balance history (`Spaarrekeningen (totaal)`, `Betaalrekeningen`) is rebuilt from the stored transactions for every day of the period, instead of snapshots from days the dashboard happened to be opened (no more dips to €0, no more "since first use" trends). Balance trends show `n.v.t.` without a start balance, and a +/− sign and colour.
- `Sparen` also counts transfers into savings accounts that are not selected, and recognises moves between savings accounts by account, IBAN or name. `Savings Rate` is now `Spaarquote`. Investment accounts are not counted as savings.
- 50/30/20 and the action plan call income minus spending "overgehouden" (it includes money left on the checking account), so it is no longer confused with `Sparen`.
- Account names like "Shared household" or "Stockholm reis" are no longer classified as investments.

### Categories
- Keywords match whole words: names and words like "Bart", "lens", "nov", "Gastouder", "Pinterest" or "Disney Plus" no longer land in Horeca, Vervoer, Utilities, Rente or Boodschappen.
- More card merchant codes recognised (train, parking, fuel, flights, hotels, DIY stores, clothing, opticians, hospitals); new categories `Reizen`, `Sport` and `Kinderopvang`; drugstores are `Zorg` for both card payments and transfers.
- Incoming money for a purchase (card reversal, a Tikkie for a shared dinner, an energy settlement) counts as a refund instead of income in a spending category; tax allowances and insurance payouts keep their category.
- Category names are Dutch in the dashboard (`Interne overboeking`, `Terugbetaling`, `Energie & telecom`, `Winkelen`, `Vrije tijd`).
- Stored transactions are recategorised once after an update, so improved rules also apply to history.

### Insights
- Month-based where it matters (salary and rent are monthly): trend, income/spending alerts and the `Uitgavenmomentum` popup compare the last complete month with the month(s) before it.
- `Liquiditeitsrunway`: average monthly net of complete months per calendar day (was: net of the last 30 days divided by days *with* transactions).
- `Verwacht netto per maand`: month so far plus what usually still comes in and goes out after today's date (was: linear extrapolation, which multiplied an early salary).
- `Terugkerende kosten`: only fixed monthly items (±1 payment per month, stable amount); supermarkets and restaurants no longer count.
- `Uitgavenvolatiliteit`: weekly variable spending without fixed costs (was: daily, always "Hoog" because of rent day).
- Action plan: no "cut this" advice for housing or taxes; savings levers use real monthly averages.
- `Gemiddelde daguitgaven` per calendar day of the selected period; Dutch labels and `n.v.t.` in cards and data quality; transaction-count warning scales with the period.

### Tooling
- Test suite (`tests/`, pytest) and GitHub Actions CI; dev tools moved to `requirements_dev.txt`.

## 2026-03-07

### Backend improvements
- `api_proxy.py`: `RateLimiter` memory fix (unbounded growth under bot traffic); endpoint discovery cached after first call; five `discover_*_endpoints()` functions merged into one generic helper; `list_payments_for_account` and `list_card_payments_for_account` merged into shared paginator; bool env helpers; module-level page-size constants; `executemany` for batch DB writes; dead code removed.

### Frontend improvements
- CSS: merged duplicate `cursor: pointer` classes; removed dead `.viz-card.featured-card` rule and redundant `max-width` declarations.
- HTML: AOS stylesheet moved to `<head>` (prevents flash of unstyled content); Plotly, Chart.js, and Particles.js now load with `defer` (no longer block HTML parsing).
- JS: removed unreachable branch in `classifyAccountType`; login button icon now correctly restored after a failed login attempt.

### Tooling
- `CLAUDE.md` added to repo root for Claude Code session context.
- GitHub CLI (`gh`) installed and authenticated for remote repo management.

## 2026-03-06

### Features
- IP change runbook added to `README.md` / `README-NL.md`: three-command copy/paste block for whitelist update, service restart, and health check.

### Scripts
- `scripts/register_bunq_ip.sh` rewritten: target IP now auto-detected (host public IPv4 via `curl -4`, container egress fallback); hard fail if no public IP detected; deactivation/cleanup flow removed.

### Documentation
- Updated `README.md`, `README-NL.md`, `TROUBLESHOOTING.md`, `TROUBLESHOOTING-NL.md`, `SECURITY.md`, `SECURITY-NL.md`, `SYNOLOGY_INSTALL-NL.md` to reflect new IP registration flow and fixed/sticky public IP guidance.

## 2026-03-01

### Documentation
- Dutch user-facing docs were language-polished to reduce unnecessary English wording while keeping technical terms where appropriate.
- Updated files:
  - `README-NL.md`
  - `SECURITY-NL.md`
  - `SYNOLOGY_INSTALL-NL.md`
  - `TROUBLESHOOTING-NL.md`
- No runtime or API behavior changes in this update.
