# Release Notes

## 🌐 Language

- English (this file): [RELEASE_NOTES.md](RELEASE_NOTES.md)
- Dutch: [RELEASE_NOTES-NL.md](RELEASE_NOTES-NL.md)

## 2026-09-26

### Security
- Every POST to the API must be JSON and come from an allowed origin (`ALLOWED_ORIGINS` or the dashboard's own host): extra CSRF protection next to `SameSite=Lax`, also against other sites on the same domain.
- New response headers: Content-Security-Policy (scripts only from the dashboard and cdnjs/unpkg; the inline script moved into `app.js`), `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Cache-Control: no-store` on all API responses.
- Login: a password with accented characters or a malformed request no longer causes a server error (500); usernames are sanitised in log lines.
- `/api/health` (public) only shows the last Bunq error to a logged-in session.
- Error notifications are shown as plain text (no HTML from messages).
- SECURITY describes how rate limiting behaves behind Docker Swarm or a reverse proxy.

### Admin maintenance
- New **What problem do you have?** guide in Settings → Admin maintenance: eight situations (no Bunq data / IP or key error, IP change, new API key, Vaultwarden error, missing or deleted transactions, outdated figures, new version, slow or restarting), each with numbered steps and buttons that run the right action (e.g. "Full maintenance with automatic IP") or show the right terminal commands.
- Every button says what it does and whether it changes anything; every option says what it does and which buttons use it.
- `Check status` also shows the last Bunq error, the transaction store, the last reconcile with Bunq and an **Advice** line pointing to the matching situation.
- New button `Reconcile with Bunq` (same as the monthly reconcile).
- Terminal commands now come with an explanation per line, use `sudo` like the docs, and cover five situations: install new version, restart and validate, Bunq whitelist, new API key, view logs.

### Settings
- The account selection is applied when you press Save (closing the panel discards it) and no longer triggers a new fetch: all accounts are always loaded and the selection is applied in the browser. This also fixes household figures (runway, savings via transfers) that only saw the selected accounts.
- "All accounts" is stored as all, so accounts opened later are included automatically; accounts that no longer exist are dropped from the selection.
- The auto-refresh interval takes effect on save (0 turns it off), runs in the background without the loading screen, and pauses while the tab is hidden. Values are whole minutes, up to 1440.
- The API endpoint is checked on save; an empty field restores the default.
- Changing the internal-transfer filter or the account selection redraws the dashboard without reloading data.
- The selected period is remembered.

### Language switch
- New NL/EN switch in the header: the whole dashboard (tiles, charts, tooltips, detail popups, insights, action plan, settings and admin maintenance) switches between Dutch and English, including number and date formats. The choice is remembered in the browser; Dutch is the default.
- Dutch texts that were still partly English (admin notices, action plan) are now fully Dutch.
- The Dutch docs use the Dutch button names of the admin maintenance panel.

### Documentation
- Remote access via **Tailscale** as an alternative to a VPN (install, HTTPS with `tailscale serve`, firewall, exit-node and funnel warnings) in SECURITY, SYNOLOGY_INSTALL, TROUBLESHOOTING and README.
- The English docs use the English names from the dashboard (with a table of internal category names for personal rules); the Dutch docs keep English only for established computer terms.
- Examples no longer refer to personal situations; linked accounts at other banks are described generically (also in the dashboard texts).
- English and Dutch documentation now have the same structure and content: `SECURITY`, `SYNOLOGY_INSTALL` and `TROUBLESHOOTING` are full guides in both languages (the English versions were short summaries, the Dutch versions were partly English).
- Up to date with the app: admin maintenance button names, current widget names and features in the README, the transaction store, personal category rules, and backups of `config/` (`dashboard_data.db`, `category_rules.json`).
- Settings the code reads but `docker-compose.yml` does not pass (paging, reconcile, sync intervals) are listed separately, with how to enable them.
- Vulnerabilities are reported via a private GitHub security advisory.

## 2026-09-25

Names below are the English names shown in the dashboard (NL/EN switch).

### Data and speed
- Transactions are stored in SQLite: the dashboard reads from the database, only fetches new transactions from Bunq (in the background when the period is already stored), and reuses the account list for a minute.
- Monthly nightly check (1st, 03:00–06:00 Amsterdam time) against Bunq: new and changed transactions are applied; transactions Bunq no longer returns are hidden, except when they are older than Bunq still serves.
- Startup: the API key is fetched from Vaultwarden once; each worker connects to Bunq right away; healthcheck start period 300s.

### Charts
- Days are counted in Amsterdam time (a payment at 00:30 belongs to that day).
- `Savings`: trend and mini-chart now follow the savings figure itself, and the tile respects the account selection.
- Trends show `n/a` instead of `0.0%` when the first half of the period has no value.
- Budget discipline (50/30/20): months only partly inside the period are left out, the running month is marked `(running)`, refunds lower spending instead of counting as income, months without income show as gaps; insights use the last complete month.
- `Spending spread`: amount buckets €0–5 … €1000+, top 4 categories by amount, share of payments per category.
- One internal-transfer rule for all tiles and charts, following the setting.
- Consistent labels throughout the charts and detail popups; € amounts in the hover of `Top counterparties` and `Category race`.
- Outgoing interest (`Interest`) is no longer categorised as `Housing`.

### Stored data
- The "internal transfer" flag of stored transactions is re-checked on every load with your current own accounts and IBANs (and matching opposite bookings between own accounts), and corrected in the database, so backend figures such as data quality agree with the dashboard.
- The fallback balance history from snapshots uses each account's current type.

### Categories chart
- `Breakdown by category` groups shop branches like `Top counterparties`, and a refund comes off the shop it came from instead of all shops in the category.
- Hover texts show meaningful shares (spending as % of income, category as % of spending, counterparty as % of the category); clearer labels ("Smaller categories", "Other counterparties", "Total").
- New detail popup with amount, share and top 3 counterparties per category, plus the transactions.

### Data quality
- Warnings are no longer shown twice (backend and dashboard each had their own wording); each warning comes with one piece of advice.
- All coverage figures are measured over the same set: real spending in your selection, without transfers between your own accounts.
- "Last sync" is measured from the last sync with Bunq, so quiet days no longer trigger an "older than 24 hours" warning.
- Texts refer to settings you can find (e.g. "Exclude internal transfers").

### Insights and categories
- New category `Alimony` for alimony and child support payments (essential, fixed cost, no cut-back advice). An outgoing payment from an own sub-account named after its purpose (e.g. a sub-account for groceries) gets that category when nothing else matches; personal rules can be added in `config/category_rules.json` (see README).
- Fixed: payments whose category matched the name of the own sub-account they came from were treated as internal transfers and left out of all figures.
- `Most expensive day` looks at variable spending only; `Top counterparty share` leaves out housing, taxes and alimony; `Largest category` also shows the biggest variable category.
- `Liquidity runway` uses the spending of all accounts, like the balance; the month forecast ignores own transfers; the next best action shows its confidence; "Last updated" is translated.

### Trends
- Tile trends for `Income` and `Expenses` use the same monthly figures as the insights (including the salary-month correction) and compare the last complete month with up to three months before it.
- Arrows follow the direction of the change (no more fixed up/down arrows); colour shows whether that's good.
- Periods shorter than 60 days: no income or savings trend (`n/a`, they are monthly); the spending trend compares variable spending between the two halves.
- A trend with a small comparison base (under €50) shows the euro difference instead of an extreme percentage; percentages have a sign (`+12.3%`).

### Savings rate
- `Savings rate` shows `n/a` when the selection has no income apart from interest (e.g. only savings accounts selected) instead of `0.0%` or absurd percentages.
- Transfers between your own accounts at another bank and your savings accounts no longer count as saving.
- Missing values show `n/a`.

### Spending
- Refunds now lower spending everywhere, also in `Top counterparties`, `Category race`, the largest-category and top-counterparty insights, `Spending momentum` and the savings levers (a returned order no longer shows up as spending).
- Branches of the same shop (e.g. "Albert Heijn 1234" and "ALBERT HEIJN 5678 UTRECHT") count as one counterparty in totals.
- `Daily pattern` shows variable spending only: fixed-cost direct debits are booked at night and made the night look like the biggest spending moment.
- The foreign-currency warning is translated.

### Income
- Salary is recognised more often (Dutch terms such as loonbetaling, maandloon, vakantiegeld, eindejaarsuitkering, plus bonus and 13th month), and a payer who pays about the same amount every month counts as regular income even without a keyword (e.g. "Periode 9").
- New category `Benefits & allowances` for UWV, SVB (child benefit, state pension), pension funds, DUO student finance, allowances and municipal benefits (these used to be `Other` or `Taxes`). Stored transactions are updated once.
- Transfers with your own accounts at another bank are no longer income or spending.
- Refunds no longer show as income in `Breakdown by category`; the income popup splits regular and one-off income.

### Budget
- 50/30/20, `Needs vs wants` and `Money flows` never count transfers between your own accounts, even with the internal-transfer filter off.
- A refund lowers the kind of spending it belongs to: an energy settlement lowers needs, a Tikkie for dinner lowers wants (stored transactions are updated once after the update).
- A salary that lands just across a month boundary (weekend) counts for the month it belongs to, so no month shows two salaries and the next none.
- The budget chart scales beyond 100% when a month's spending exceeds its income; uncategorised spending (`Other`) is shown per month.

### Cash flow
- Refunds (card reversals, Tikkie for a shared dinner) lower spending instead of counting as income, in the tiles, `Savings rate`, the cash flow timeline, the popups and `Money flows` (a separate "Refunds" flow into wants).
- `Cash flow (timeline)` shows income and spending bars per day (up to 3 months), week (up to a year) or month, and the cumulative net since the start of the period; it always covers the whole selected period.
- Tile trends compare the last complete month with the months before it for periods of 60+ days (no more jumps from one vs two salaries in a half-period).
- The period starts at midnight Amsterdam time, so its first day is complete.

### Savings
- Balance history (`Savings accounts (total)`, `Current accounts`) is rebuilt from the stored transactions for every day of the period, instead of snapshots from days the dashboard happened to be opened (no more dips to €0, no more "since first use" trends). Balance trends show `n/a` without a start balance, and a +/− sign and colour.
- `Savings` also counts transfers into savings accounts that are not selected, and recognises moves between savings accounts by account, IBAN or name. Investment accounts are not counted as savings.
- 50/30/20 and the action plan call income minus spending "saved" (it includes money left on the current account), separate from the `Savings` tile.
- Account names that merely contain a short word such as "share" or "stock" (e.g. a holiday or household sub-account) are no longer classified as investments.

### Categories
- Keywords match whole words: first names and words like "lens", "nov" or "Disney Plus" no longer land in the wrong category (eating out, transport, utilities, interest or groceries).
- More card merchant codes recognised (train, parking, fuel, flights, hotels, DIY stores, clothing, opticians, hospitals); new categories `Travel`, `Sports` and `Childcare`; drugstores are `Healthcare` for both card payments and transfers.
- Incoming money for a purchase (card reversal, a Tikkie for a shared dinner, an energy settlement) counts as a refund instead of income in a spending category; tax allowances and insurance payouts keep their category.
- Category names are shown consistently in the dashboard (`Internal transfer`, `Refund`, `Utilities & telecom`, `Shopping`, `Leisure`).
- Stored transactions are recategorised once after an update, so improved rules also apply to history.

### Insights
- Month-based where it matters (salary and rent are monthly): trend, income/spending alerts and the `Spending momentum` popup compare the last complete month with the month(s) before it.
- `Liquidity runway`: average monthly net of complete months per calendar day (was: net of the last 30 days divided by days *with* transactions).
- `Expected net this month`: month so far plus what usually still comes in and goes out after today's date (was: linear extrapolation, which multiplied an early salary).
- `Recurring costs`: only fixed monthly items (±1 payment per month, stable amount); supermarkets and restaurants no longer count.
- `Spending volatility`: weekly variable spending without fixed costs (was: daily, always "High" because of rent day).
- Action plan: no "cut this" advice for housing or taxes; savings levers use real monthly averages.
- `Average daily spending` per calendar day of the selected period; `n/a` in cards and data quality; the transaction-count warning scales with the period.

### Development
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
