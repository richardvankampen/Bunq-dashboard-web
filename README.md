# 💰 Bunq Financial Dashboard

**Secure web-based visualizations of your Bunq transaction data (Synology-first).**
Read-only dashboard that fetches data from the Bunq API and presents it clearly.

## 🌐 Language

- English (this file): [README.md](README.md)
- Dutch: [README-NL.md](README-NL.md)

Dutch companion docs:
- [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
- [SECURITY-NL.md](SECURITY-NL.md)
- [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)

⚠️ **IMPORTANT:** Access ONLY via VPN. NEVER forward ports to the internet.

---

## ✨ Key Features

- Single-port dashboard (frontend + API) on port 5000
- Real-time data from the Bunq API (read-only)
- Vaultwarden-first key management (recommended), with optional direct fallback
- Vaultwarden decrypt via `bw` CLI (master-password secret) for reliable key retrieval
  - Intel/amd64: native pinned `bw` binary (with automatic npm fallback if a release asset is temporarily unavailable)
  - ARM64: pinned `@bitwarden/cli` npm fallback (officially recommended for ARM)
- Production runtime via Gunicorn (no Flask development server in the container)
- Local history storage (SQLite) for longer-term insights
- EUR totals for non-EUR accounts (with FX conversion and caching)
- Transaction coverage via Bunq `payment` and (where available) `card-payment` endpoints
- 11+ visualizations (cashflow, trends, categories)
- Actionable insight cards (runway, needs-vs-wants, merchant concentration, monthly net projection) with deep-dive details
- Caching and pagination for performance
- Synology-ready deployment
- Admin maintenance tools in Settings (status, egress IP, Bunq context re-init, bundled maintenance run with options)
- Terminal-helper buttons in the admin panel (copy-ready install/update and restart commands)

**Visualizations:**
- KPI Cards (income/expenses/savings)
- Cashflow timeline
- Sankey diagram (money flow)
- Sunburst (categories)
- 3D time-space chart
- Heatmap (day/hour)
- Top merchants
- Ridge plot (distribution)
- Racing bar chart
- Insights (automatic)
- Custom charts

## 🔒 Security (Short)

- Session-based auth with HttpOnly cookies and CSRF protection
- `SESSION_COOKIE_SECURE=true` as secure default (set to `false` only for local HTTP)
- Secrets via Vaultwarden + Docker Swarm secrets (Vaultwarden preferred; `VAULTWARDEN_ACCESS_METHOD=cli`)
- VPN-only access, no public exposure
- Rate limiting for login and API

More details: [SECURITY.md](SECURITY.md)  
Dutch version: [SECURITY-NL.md](SECURITY-NL.md)

## 🚀 Quick Start (Synology)

1. Install **Container Manager** (Package Center)
2. Ensure **VPN-only access** (no public exposure)
3. Follow the full installation guide: [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
4. Use **Vaultwarden as the primary Bunq API key source** (`USE_VAULTWARDEN=true`)
5. Use `VAULTWARDEN_ACCESS_METHOD=cli` + secret `bunq_vaultwarden_master_password`
   - Set `VAULTWARDEN_URL` to an **HTTPS** URL (reverse proxy/domain with valid certificate)
6. Use direct `bunq_api_key` only as an emergency fallback (`USE_VAULTWARDEN=false`)
7. For install/update on Synology, always run as root:
   - `sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh`
   - Do not run as a regular user.
8. On new Bunq API key or IP change: run `scripts/register_bunq_ip.sh`
   - Safe non-interactive default: `TARGET_IP=<PUBLIC_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=false sh scripts/register_bunq_ip.sh`
   - Optional cleanup pass afterwards: `... DEACTIVATE_OTHERS=true ...`
9. After deploy/restart, run startup validation with `sudo sh scripts/restart_bunq_service.sh` (uses git tag by default + prunes old `bunq-dashboard` images)
10. Build/deploy also checks egress IP vs active Bunq whitelist and prints a direct recovery command on mismatch

Health endpoints:
- Liveness: `GET /api/live` (container/app process up)
- Readiness: `GET /api/health` (Bunq context state; may return `503` on key/IP mismatch)

Transaction diagnostics:
- `GET /api/transactions` returns extra fields:
  - `truncated` (true/false)
  - `truncated_accounts` (per-account paging-cap info)
  - `amount_eur_missing_count` (non-EUR transactions without EUR conversion)
- Dashboard shows explicit warnings for these cases instead of silent underreporting.

Savings accounts (SDK-first):
- Account retrieval follows official Bunq SDK endpoints:
  - `MonetaryAccount.list(...)` (unified)
  - `MonetaryAccountSavings.list(...)`
  - `MonetaryAccountExternalSavings.list(...)`
- Only when SDK deserialization fails on savings, backend uses a limited raw fallback on:
  - `/user/{user_id}/monetary-account`
  - `/user/{user_id}/monetary-account-savings`
  - `/user/{user_id}/monetary-account-external-savings`

Quick check after deploy:
```bash
TAG=$(sudo git rev-parse --short HEAD)
sudo docker build --no-cache -t bunq-dashboard:$TAG .
sudo docker tag bunq-dashboard:$TAG bunq-dashboard:local
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
sudo sh scripts/restart_bunq_service.sh

# Manual fallback:
sudo docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard
sudo docker service logs --since 3m bunq_bunq-dashboard | grep -E "Retrieving API key from Vaultwarden|API key retrieved from vault|No valid API key"
curl -s http://127.0.0.1:5000/api/live
curl -s http://127.0.0.1:5000/api/health
```

Useful script options:
- `AUTO_TAG_FROM_GIT=false` to restart without image-tag override
- `CLEANUP_OLD_IMAGES=false` to keep old images
- `KEEP_IMAGE_COUNT=3` to keep more recent older tags

Automated install/update (after Vaultwarden setup):
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

Important (Synology):
- Always run the install/update script using `sudo sh ...`.
- If you run it as a regular user, `docker stack deploy` can start with default values (`*.yourdomain.com`) instead of your `.env` values.

By default, the script asks:
- `Use clean Docker build (--no-cache)? [Y/n]`

Useful overrides:
- `sudo sh -c 'NO_CACHE=false sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'` (faster, cached build)
- `sudo sh -c 'NO_CACHE=true sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh'` (fully clean build)
- In non-interactive runs, safe default `NO_CACHE=true` remains active.

When to use `NO_CACHE=false`:
- Only code/documentation changes (for example `app.js`, `api_proxy.py`, `index.html`, `.md`) and no dependency/base-image changes.
- You want faster deploys by reusing Docker cache.

When to use `NO_CACHE=true`:
- Changes in `Dockerfile`, dependencies, base image, or build issues that may involve stale layers.

---

## 📄 License

MIT License - See [LICENSE](LICENSE)
