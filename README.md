# 💰 Bunq Financial Dashboard

**Secure web-based visualizations of your Bunq transaction data (Synology-first).**
Read-only dashboard that fetches data from the Bunq API and presents it clearly.

## 🌐 Language

- English (this file): [README.md](README.md)
- Dutch: [README-NL.md](README-NL.md)

Every document has an English (`*.md`) and a Dutch (`*-NL.md`) version with the same content:
- [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md) / [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
- [SECURITY.md](SECURITY.md) / [SECURITY-NL.md](SECURITY-NL.md)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) / [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)
- [RELEASE_NOTES.md](RELEASE_NOTES.md) / [RELEASE_NOTES-NL.md](RELEASE_NOTES-NL.md)

The dashboard itself is available in English and Dutch: use the **NL/EN** switch in the header. This document uses the English names you see in the dashboard.

⚠️ **IMPORTANT:** access the dashboard ONLY from your home network, through a VPN or through Tailscale. NEVER forward ports to the internet.

---

## ✨ Key Features

- Single-port dashboard (frontend + API) on port 5000
- Dashboard in English or Dutch: the NL/EN switch in the header changes every text, chart label and number/date format (the choice is remembered per browser)
- Read-only Bunq API access (payments and, where available, card payments; SDK-first account retrieval incl. savings)
- Local transaction store (SQLite): loads come from the store with an incremental background sync; a monthly reconcile keeps it in line with Bunq and keeps history Bunq no longer serves
- Balance history rebuilt from stored transactions (falls back to daily snapshots)
- Automatic categorisation (internal transfers, merchant category codes, text rules, sub-account names) plus your own rules in `config/category_rules.json`; refunds lower the spending of the original category
- Internal transfers between own accounts are filtered out; transfers to/from your own linked accounts at other banks count as neither income nor spending
- EUR totals for non-EUR accounts (FX conversion with caching)
- Monthly trends, budget discipline (50/30/20), insight cards and a data quality check, with explanations in tooltips
- Vaultwarden-first key management (recommended), with an optional direct fallback
- Vaultwarden decrypt via the `bw` CLI (master-password secret)
  - Intel/amd64: native pinned `bw` binary (automatic npm fallback if a release asset is temporarily unavailable)
  - ARM64: pinned `@bitwarden/cli` npm fallback
- Production runtime via Gunicorn (no Flask development server in the container)
- Synology-ready deployment with install/update, quick-redeploy and IP-whitelist scripts
- Admin maintenance in Settings, with a guide per problem (status with advice, egress IP, whitelist update, Bunq context re-init, full maintenance run, reconcile with Bunq, terminal commands with explanations)

**Dashboard widgets:**
- Balance tiles: Current accounts (total), Savings accounts (total)
- KPI tiles with trend vs previous months: Income, Expenses, Savings, Savings rate
- Cash flow (timeline): income/expenses per day, week or month plus cumulative net
- Money flows: Sankey from income sources via needs/wants to spending categories, plus what was saved
- Breakdown by category: sunburst by category and counterparty
- Budget discipline (50/30/20)
- Daily pattern: heatmap of variable spending by weekday and time of day
- Top counterparties: largest counterparties after refunds
- Spending spread: spread of spending amounts per category
- Category race: animated category race over the period
- Insight cards: largest category, average daily spending, spending volatility, most expensive day, trend, liquidity runway, needs vs wants, 50/30/20 fit, top counterparty share, recurring costs, next best action, expected net this month, data quality
- Per-account balance details with transactions

## 🔒 Security (Short)

- Session-based auth with HttpOnly cookies and CSRF protection
- `SESSION_COOKIE_SECURE=true` as secure default (set to `false` only for local HTTP)
- Secrets via Vaultwarden + Docker Swarm secrets (Vaultwarden preferred; `VAULTWARDEN_ACCESS_METHOD=cli`)
- Access only via your home network, a VPN or Tailscale; no public exposure
- Rate limiting for login and API

More details: [SECURITY.md](SECURITY.md)
Dutch version: [SECURITY-NL.md](SECURITY-NL.md)

## 🚀 Quick Start (Synology)

1. Install **Container Manager** (Package Center)
2. Arrange **private remote access**: Tailscale (Package Center, no open router port) or a VPN; no public exposure (see [SECURITY.md](SECURITY.md))
3. Follow the full installation guide: [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
4. Use **Vaultwarden as the primary Bunq API key source** (`USE_VAULTWARDEN=true`)
5. Use `VAULTWARDEN_ACCESS_METHOD=cli` + secret `bunq_vaultwarden_master_password`
   - Set `VAULTWARDEN_URL` to an **HTTPS** URL (reverse proxy/domain with valid certificate)
6. Use direct `bunq_api_key` only as an emergency fallback (`USE_VAULTWARDEN=false`)
7. For install/update on Synology, always run as root:
   - `sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh`
   - Do not run as a regular user.
8. On new Bunq API key or IP change: run `scripts/register_bunq_ip.sh`
   - Safe non-interactive default (auto-detect target IP): `NO_PROMPT=true sh scripts/register_bunq_ip.sh`
   - Optional explicit target override: `TARGET_IP=<PUBLIC_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh`
9. After deploy/restart, run startup validation with `sudo sh scripts/restart_bunq_service.sh` (uses git tag by default + prunes old `bunq-dashboard` images)
10. Build/deploy also checks egress IP vs active Bunq whitelist and prints a direct recovery command on mismatch
11. Strongly recommended: use a fixed public IP, or at least a sticky dynamic public IP, for your internet connection to reduce Bunq whitelist drift and unexpected auth failures

IP change runbook (copy/paste):
```bash
cd /volume1/docker/bunq-dashboard
sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard
sudo sh scripts/restart_bunq_service.sh
curl -s http://127.0.0.1:5000/api/health
```

Health endpoints:
- Liveness: `GET /api/live` (container/app process up)
- Readiness: `GET /api/health` (Bunq context state; may return `503` on key/IP mismatch)

Public IP note:
- Bunq API access is tied to your current public egress IP.
- If your ISP changes that IP, Bunq may reject requests until you re-run `scripts/register_bunq_ip.sh`.
- With Tailscale, don't let the NAS use an exit node: Bunq would then see the exit node's IP.
- See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) section `Public IP strategy (fixed vs sticky)` for details.

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
sudo git pull --rebase origin main
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh
```

Quick redeploy for code-only changes (no `.env` / compose / secrets / network changes):
```bash
cd /volume1/docker/bunq-dashboard
sudo git pull --rebase origin main
sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false
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

## 🏷️ Personal category rules

Transactions are categorised automatically. An outgoing payment from an own sub-account whose name contains a Dutch purpose word (such as `boodschappen` → Groceries, `huur` → Housing, `vakantie` → Travel, `zorg` → Healthcare) gets that category when nothing else matches; for other account names, use a rule with `account` below. For anything else, add your own rules in `config/category_rules.json` on the NAS (`/volume1/docker/bunq-dashboard/config/`, not in git):

```json
{
  "rules": [
    {"category": "Wonen", "account": "Rent"},
    {"category": "Sport", "counterparty": "Tennis club"},
    {"category": "Wonen", "iban": "NL00BANK0123456789"},
    {"category": "Zorg", "account": "Household", "description": "physio"}
  ]
}
```

- **Fields:** `account` (name of your own account), `counterparty`, `description` and `iban`. All fields in a rule must match (text: case-insensitive, contained in the text; IBAN: exact). Personal rules win over the built-in ones.
- **Category names** in the file are the internal names; the dashboard shows them in the chosen language:

| Internal name | Shown in English |
|---|---|
| `Boodschappen` | Groceries |
| `Horeca` | Eating out |
| `Vervoer` | Transport |
| `Wonen` | Housing |
| `Utilities` | Utilities & telecom |
| `Abonnementen` | Subscriptions |
| `Verzekering` | Insurance |
| `Belastingen` | Taxes |
| `Kinderopvang` | Childcare |
| `Alimentatie` | Alimony |
| `Shopping` | Shopping |
| `Entertainment` | Leisure |
| `Sport` | Sports |
| `Reizen` | Travel |
| `Zorg` | Healthcare |
| `Salaris` | Salary |
| `Uitkeringen` | Benefits & allowances |
| `Rente` | Interest |
| `Overig` | Other |

After editing the file run `sudo sh scripts/quick_redeploy.sh bunq_bunq-dashboard false`; stored transactions are recategorised once on startup.

## 🧪 Tests (development)

Backend unit/route tests live in `tests/` and run without Bunq, Vaultwarden, or Docker (all external access is disabled via environment variables in `tests/conftest.py`):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements_dev.txt
.venv/bin/python -m pytest tests -q
```

GitHub Actions (`.github/workflows/tests.yml`) runs the same tests plus `pyflakes` on every pull request and push to `main`.

---

## 📄 License

MIT License - See [LICENSE](LICENSE)
