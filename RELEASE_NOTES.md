# Release Notes

## 🌐 Language

- English (this file): [RELEASE_NOTES.md](RELEASE_NOTES.md)
- Dutch: [RELEASE_NOTES-NL.md](RELEASE_NOTES-NL.md)

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
