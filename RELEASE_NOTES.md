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
