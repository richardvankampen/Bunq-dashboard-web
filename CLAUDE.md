# CLAUDE.md — Bunq Financial Dashboard

## Project overview

Python/Flask web dashboard for Bunq bank data. Deployed on Synology NAS via Docker Swarm + Gunicorn.

- Backend: `api_proxy.py` (Flask + Bunq SDK)
- Dependencies: `requirements_web.txt`
- Deployment: `docker-compose.yml` + `scripts/`
- Secrets: Vaultwarden (`USE_VAULTWARDEN=true`)
- Auth: session-based with secure cookies

## Key files

| File | Purpose |
|------|---------|
| `api_proxy.py` | Main backend — all API routes and Bunq SDK logic |
| `docker-compose.yml` | Docker Swarm stack config |
| `requirements_web.txt` | Python dependencies |
| `scripts/quick_redeploy.sh` | Fast redeploy without stack restart |
| `scripts/install_or_update_synology.sh` | Full install/update on Synology |
| `scripts/check_accounts_api.py` | Validate savings accounts in `/api/accounts` |
| `scripts/debug_raw_monetary_accounts.sh` | Raw Bunq API debug |
| `CONTEXT_HANDOVER.md` | Canonical current project state — always read this first |
| `WORKLOG.md` | Chronological change log |

## Working rules

1. Before starting: read `CONTEXT_HANDOVER.md` (canonical state), then recent entries in `WORKLOG.md`.
2. After every code or script change: update both `CONTEXT_HANDOVER.md` and `WORKLOG.md`.
   - `CONTEXT_HANDOVER.md`: keep current/best info only, remove outdated statements, no duplicates.
   - `WORKLOG.md`: append what changed, why, and result.
3. Do not add wide probe matrices or undocumented Bunq API routes. SDK-first, minimal raw fallback.

## Deploy (Synology)

**Code-only change** (most common):
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
```

**Config change** (`.env`, `docker-compose.yml`, secrets, network):
```bash
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
```

**Install/update**:
```bash
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

## Bunq account fetching

SDK-first order:
1. `MonetaryAccount` (unified endpoint — stops here if savings already present)
2. `MonetaryAccountSavings`
3. `MonetaryAccountExternalSavings`

Raw fallback only if SDK result lacks savings. Uses only official routes:
- `/user/{id}/monetary-account`
- `/user/{id}/monetary-account-savings`
- `/user/{id}/monetary-account-external-savings`

## Internal transfer filtering

- Deterministic: match on own account-id + IBAN (from full fetched account list).
- Cross-account reconcile: `payment-id + minute + amount + currency` pair with opposite sign on different own accounts.
- Triodos `MonetaryAccountExternal` = NOT internal. Bunq `ExternalSavings` = internal.
- Applied in `/api/transactions` and `/api/statistics`.

## Documentation conventions

- User-facing docs have English main (`*.md`) and Dutch variant (`*-NL.md`).
- Keep EN and NL in sync on every change.
- Docs: `README`, `SECURITY`, `SYNOLOGY_INSTALL`, `TROUBLESHOOTING`, `RELEASE_NOTES` (each with `-NL` variant).

## Frontend conventions

- UI language: Dutch (NL).
- Widget labels: `Inkomsten`, `Uitgaven`, `Sparen`, `Cashflow (tijdslijn)`, `Geldstromen`, `Verdeling in categorieën`, `Categorie-race`, `Dagpatroon`, `Top tegenrekeningen`, `Maandverdeling`.
- Charts: Plotly with transparent `plot_bgcolor` (no white chart backgrounds inside tiles).
- Particles: `#particles-js` on `z-index: 0` + `pointer-events: none`; `.dashboard-container` on `z-index: 1`.
