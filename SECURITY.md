# 🔒 Security Guide - Bunq Dashboard

Complete security guide for running the Bunq Dashboard safely.

**Language versions**
- English (this file): [SECURITY.md](SECURITY.md)
- Dutch: [SECURITY-NL.md](SECURITY-NL.md)

---

## 🧭 Navigation

- Overview: [README.md](README.md)
- Synology installation: [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## 🎯 Security Overview

The dashboard is built for a private, read-only view of your finances.

| Security feature | Implementation |
|------------------|----------------|
| **Bunq API access** | Read-only (the dashboard cannot make payments) |
| **Authentication** | Session-based, server-side session cookie |
| **Cookies** | `HttpOnly`, `SameSite=Lax`, `Secure` by default |
| **Secret management** | Vaultwarden (Bunq API key) + Docker Swarm secrets |
| **Network access** | Only via VPN or Tailscale, no port forwarding |
| **CSRF protection** | `SameSite=Lax` cookies, plus: every POST must be JSON and come from an allowed origin (`ALLOWED_ORIGINS` or the dashboard's own host) |
| **Response headers** | Content-Security-Policy (scripts only from the dashboard and cdnjs/unpkg), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Cache-Control: no-store` on all API responses |
| **Rate limiting** | 30 requests/min on the API, 5 login attempts/min (see the note below) |
| **Session expiry** | 24 hours |
| **Password check** | Constant-time comparison |
| **Runtime server** | Gunicorn (no Flask development server) |
| **Public endpoints** | Only `/api/live`, `/api/health` (no error details without login), `/api/auth/*` and the static files |

**Note on rate limiting:** the limits are counted per Gunicorn worker (2 by default) and per source IP. Behind Docker Swarm's ingress network or a reverse proxy, all requests reach the dashboard from the same internal IP, so the limits apply to everyone together: after 5 failed logins in a minute, logging in is blocked for everybody for that minute. For a private, single-user dashboard behind a VPN or Tailscale that is the intended trade-off; it is not a protection against a determined attacker on your network.

---

## 🛡️ Critical Requirements

### 1. ⚠️ Private access only: VPN or Tailscale

**Why:** your financial data must never be reachable from the internet.

Requirements:
- ✅ Access the dashboard only from your home network, through a VPN, or through Tailscale
- ✅ Never forward port 5000 on your router
- ✅ Keep the dashboard on a private network segment

Choose one of the two options below. Tailscale needs no open port on your router and is the easiest to set up; a classic VPN keeps everything on your own hardware.

#### Option A: Tailscale (recommended for remote access)

Tailscale builds a private network (a "tailnet") between your own devices, based on WireGuard. Nothing is opened on your router.

```text
1. Create a Tailscale account (tailscale.com) and sign in on your phone/laptop with the Tailscale app.
2. Synology: Package Center → search "Tailscale" → Install → open it and sign in to the same account.
3. In the Tailscale admin console (login.tailscale.com → Machines): note the NAS name
   (e.g. nas) and its Tailscale IP (100.x.y.z). Optionally disable "key expiry" for the NAS.
4. Open the dashboard from a device in your tailnet: http://100.x.y.z:5000
```

**HTTPS with a Tailscale name (recommended):** enable **MagicDNS** and **HTTPS certificates** in the admin console (DNS page), then on the NAS via SSH:
```bash
sudo tailscale serve --bg 5000
# The dashboard is now at https://nas.<your-tailnet>.ts.net (only inside your tailnet)
sudo tailscale serve status
# Must show "(tailnet only)" and "proxy http://127.0.0.1:5000"; never "Funnel on"
```
The first time, Tailscale may answer `Serve is not enabled on your tailnet` with a link (`https://login.tailscale.com/f/serve?node=…`). That is a one-time approval: open the link while signed in as the tailnet admin, confirm, and run the command again. The first visit to the `https://` address can take a moment while the certificate is requested.
Set in `.env` and do a full deploy (config change):
```bash
ALLOWED_ORIGINS=https://nas.<your-tailnet>.ts.net
SESSION_COOKIE_SECURE=true
```

Tailscale tips:
- Use **only `tailscale serve`**, never `tailscale funnel`: funnel publishes the dashboard on the internet.
- Don't make the NAS use an **exit node**: Bunq would then see the exit node's public IP, which is not on your Bunq whitelist.
- Share the NAS only with your own devices; with Tailscale ACLs you can limit which users/devices reach port 5000.
- If the Synology firewall blocks the Tailscale traffic, allow `100.64.0.0/10` (the Tailscale address range) for port 5000 (see Firewall below).

#### Option B: Synology VPN Server

**Set up the VPN (Synology):**

```text
Control Panel → VPN Server → OpenVPN
├── Enable OpenVPN server
├── Maximum connections: 5
├── Maximum connections from the same IP: 1
├── Port: 1194 (default)
└── Dynamic IP: enabled

Client config:
VPN Server → OpenVPN → Export configuration → download the .ovpn file

Clients:
Windows: OpenVPN GUI · Mac: Tunnelblick · iOS/Android: OpenVPN Connect · Linux: openvpn
```

#### Verify from outside your network (e.g. phone on mobile data)

```bash
# Without VPN/Tailscale connected:
curl http://<your-public-ip>:5000
# Must time out (not reachable)

# With VPN connected:
curl http://192.168.1.100:5000
# With Tailscale connected:
curl http://100.x.y.z:5000
# Both return the dashboard
```

---

### 2. 🔐 Session-based authentication

Session auth is the default and only login mode.

- ✅ Credentials are checked server-side (constant-time)
- ✅ `HttpOnly` + `SameSite=Lax` cookies (protection against XSS cookie theft and CSRF)
- ✅ Automatic logout after 24 hours

Requirements:
1. Secret `bunq_basic_auth_password` (at least 12 characters)
2. Secret `bunq_flask_secret_key` (64 hex characters)
3. `ALLOWED_ORIGINS` set to your exact dashboard origin
4. `SESSION_COOKIE_SECURE=true` (default); set `false` only for local HTTP testing

---

### 3. 🔑 Vaultwarden for secret management

**Why:** never store API keys in plain text.

```text
✅ DO:
- Store the Bunq API key in Vaultwarden
- Use a strong Vaultwarden master password (20+ characters)
- Enable 2FA on Vaultwarden if available
- Back up Vaultwarden data regularly
- Set SIGNUPS_ALLOWED=false after creating your account

❌ DON'T:
- Put the API key in .env
- Commit .env to git
- Share the Vaultwarden master password
- Use weak passwords
- Leave signups enabled
```

**Vaultwarden vs Docker Swarm secrets (recommended split):**
- Vaultwarden: the Bunq API key (rotation, audit log, UI).
- Swarm secrets: runtime-only secrets (dashboard password, Flask secret key, Vaultwarden client ID/secret/master password).
- Without Vaultwarden: use `bunq_api_key` as a Swarm secret (`USE_VAULTWARDEN=false`); you lose rotation/audit and the UI.
- Note: Swarm secrets protect against accidental leaks, but root on the host can still read them.

Recommended settings:
- `USE_VAULTWARDEN=true`
- `VAULTWARDEN_ACCESS_METHOD=cli` (decrypts the vault item via the `bw` CLI)
- `VAULTWARDEN_URL=https://...` (the CLI flow requires HTTPS)

**Vaultwarden hardening (in Vaultwarden's own compose file):**
```yaml
environment:
  SIGNUPS_ALLOWED: "false"           # critical
  ADMIN_TOKEN: "random-token-here"   # enables the admin panel
  INVITATIONS_ALLOWED: "false"       # no invites
  WEBSOCKET_ENABLED: "false"         # if you do not need it
```
Generate an admin token with `openssl rand -base64 48`.

---

### 4. 🔒 Strong passwords and keys

**Flask secret key:**
```bash
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
printf "%s" "$SECRET_KEY" | docker secret create bunq_flask_secret_key -
```
- 64 hexadecimal characters, randomly generated, unique per installation
- Never share it or commit it to git
- ⚠️ Rotating this key logs out all active sessions

**Dashboard password:**
```bash
DASHBOARD_PASSWORD=$(openssl rand -base64 32)
printf "%s" "$DASHBOARD_PASSWORD" | docker secret create bunq_basic_auth_password -
```
- At least 12 characters (a long passphrase is fine)
- Not reused from other services
- Change it every 3-6 months

**Vaultwarden master password:**
- At least 20 characters, strong passphrase or random password
- Stored only in your password manager
- Change it yearly

---

## 🔧 Security Configuration

### Recommended `.env` and secrets

```bash
# Login (non-secret)
BASIC_AUTH_USERNAME=admin

# Sessions
SESSION_COOKIE_SECURE=true        # secure default (HTTPS / reverse proxy)
# Local HTTP only:
# SESSION_COOKIE_SECURE=false
# HttpOnly and SameSite are enforced in code (api_proxy.py)

# CORS (critical)
ALLOWED_ORIGINS=https://bunq.yourdomain.com   # your origin only, no wildcards

# Vaultwarden
USE_VAULTWARDEN=true
VAULTWARDEN_ACCESS_METHOD=cli
VAULTWARDEN_URL=https://vault.yourdomain.com  # CLI flow requires HTTPS

# Bunq
BUNQ_ENVIRONMENT=PRODUCTION
AUTO_SET_BUNQ_WHITELIST_IP=true
AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS=false

# Application
FLASK_DEBUG=false                 # never true in production
LOG_LEVEL=INFO
BUNQ_INIT_AUTO_ATTEMPT=true
BUNQ_INIT_RETRY_SECONDS=120

# Runtime (Gunicorn)
GUNICORN_WORKERS=2
GUNICORN_THREADS=4
GUNICORN_TIMEOUT=120
GUNICORN_KEEPALIVE=5
GUNICORN_MAX_REQUESTS=1200
GUNICORN_MAX_REQUESTS_JITTER=120
GUNICORN_LOG_LEVEL=info
BUNQ_PREBOOT_INIT=true

# Docker Swarm secrets (created separately):
# - bunq_basic_auth_password
# - bunq_flask_secret_key
# - bunq_vaultwarden_client_id
# - bunq_vaultwarden_client_secret
# - bunq_vaultwarden_master_password
# - bunq_api_key (only when USE_VAULTWARDEN=false)
```

**File permissions:**
```bash
# .env holds no secrets, but does hold your configuration
chmod 600 /volume1/docker/bunq-dashboard/.env
```

### Sensitive data on disk

`/volume1/docker/bunq-dashboard/config/` (mounted as `/app/config`) contains:
- `dashboard_data.db`: SQLite store with your full transaction history, balances and snapshots
- `category_rules.json`: your personal category rules (may contain IBANs or names)
- the Bunq API context (installation/device registration)

Keep this folder out of git (it is), restrict access to admins, and include it in encrypted backups only.

### Bunq IP whitelist (critical)

Bunq API keys can be restricted to IP addresses. Your container's public egress IP must then be allowed, otherwise you get
`Incorrect API key or IP address`.

**After an API key rotation or a network change (new provider, router, VPN or Tailscale exit node):**
```bash
cd /volume1/docker/bunq-dashboard
sudo env NO_PROMPT=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard
# Optional explicit override:
# sudo env TARGET_IP=<PUBLIC_IPV4> NO_PROMPT=true sh scripts/register_bunq_ip.sh bunq_bunq-dashboard
```

The script:
- shows the container's current public egress IP
- uses a safe 2-step Bunq allowlist update (activate first, then deactivate others)
- validates the `bunq_api_key` secret format in the direct-key flow
- creates a new Bunq `ApiContext` (installation + device registration)
- restarts the service and shows the relevant logs
- checks the egress IP against the active whitelist and stops with a recovery command on mismatch

**Alternative via the UI:** dashboard → Settings → `Admin maintenance` (see also the situation "Your public IP address has changed" in the panel):
- `Check egress IP` shows which public IP must be whitelisted
- `Set Bunq API whitelist IP` performs only the safe 2-step whitelist update
- `Run full maintenance (recommended)` with the default options:
  - `Try to determine whitelist IP (egress) automatically` is off by default (or enter an IP manually)
  - the API key refresh option is off by default (only needed after key rotation)
- A manual IP is validated as a public IPv4 address (no private/local ranges)

---

## 🌐 Network Security

### Firewall

**Synology firewall:**
```text
Control Panel → Security → Firewall → Edit Rules

Allow rule:
├── Ports: 5000 (dashboard), your Vaultwarden port, 1194 (VPN, only with option B)
├── Source IP: 192.168.0.0/16 (local network only)
└── Action: Allow

Allow rule (only with Tailscale):
├── Ports: 5000
├── Source IP: 100.64.0.0/10 (Tailscale address range)
└── Action: Allow

Deny rule (below it):
├── Source IP: All
└── Action: Deny
```

**Linux iptables:**
```bash
# Local network only
sudo iptables -A INPUT -p tcp --dport 5000 -s 192.168.0.0/16 -j ACCEPT
# Tailscale (only with option A)
sudo iptables -A INPUT -p tcp --dport 5000 -s 100.64.0.0/10 -j ACCEPT
# VPN (only with option B)
sudo iptables -A INPUT -p udp --dport 1194 -j ACCEPT
# Drop everything else on the dashboard port
sudo iptables -A INPUT -p tcp --dport 5000 -j DROP
sudo iptables-save > /etc/iptables/rules.v4
```

### Reverse proxy with HTTPS (recommended)

With Tailscale, `tailscale serve` (option A above) already gives you HTTPS with a valid certificate; you don't need the reverse proxy below for the dashboard.

**Synology reverse proxy:**
```text
Control Panel → Login Portal → Advanced → Reverse Proxy → Create
├── Source: HTTPS, hostname bunq.yourdomain.com, port 443
├── Enable HSTS and HTTP/2
└── Destination: HTTP, localhost, port 5000

Certificate:
Control Panel → Security → Certificate → Add → Let's Encrypt
```

**Nginx (advanced):**
```nginx
server {
    listen 443 ssl http2;
    server_name bunq.yourdomain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 80;
    server_name bunq.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

**After enabling HTTPS**, set in `.env`:
```bash
SESSION_COOKIE_SECURE=true
ALLOWED_ORIGINS=https://bunq.yourdomain.com
```
and redeploy (config change):
```bash
sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'
```

---

## 🔍 Security Monitoring

### Log lines to watch

The backend logs these security events:
- `🚫 Failed login attempt: <user> from <ip>`
- `🚫 Rate limit exceeded for <client> on <endpoint>`
- `🚫 Unauthorized access attempt from <ip>`

```bash
# Live
sudo docker service logs -f bunq_bunq-dashboard | grep -E "WARNING|ERROR|🚫"

# Counts
sudo docker service logs bunq_bunq-dashboard | grep -c "Failed login attempt"
sudo docker service logs bunq_bunq-dashboard | grep -c "Rate limit exceeded"
sudo docker service logs bunq_bunq-dashboard | grep -c "Unauthorized access attempt"
```

Container alerts on Synology: Control Panel → Notification → Email.

Monitor the health endpoints:
- Liveness: `/api/live`
- Readiness: `/api/health`

### Regular checks

**Monthly:**
- Review the log lines above
- Verify the firewall rules are still active
- Check for dashboard and Vaultwarden image updates
- Check that your backups of `config/` ran

**Quarterly:**
- Rotate the dashboard password (`bunq_basic_auth_password`)
- Optionally rotate the Bunq API key: create a new key in the Bunq app, update it in Vaultwarden, run `register_bunq_ip.sh`, test
- Update to the latest code: `sudo sh scripts/install_or_update_synology.sh`
- Test that the VPN or Tailscale still works and the dashboard is not reachable without it

**Yearly:**
- Rotate all credentials, including `bunq_flask_secret_key`
- Test a restore from backup
- Review this guide against your setup

---

## 🚨 Incident Response

### Suspected unauthorized access

```bash
# 1. Block access immediately
sudo docker stack rm bunq

# 2. Save the logs
sudo docker service logs bunq_bunq-dashboard > incident-$(date +%Y%m%d).log   # before step 1 if possible

# 3. Change all credentials
#    - Vaultwarden master password
#    - bunq_basic_auth_password
#    - bunq_flask_secret_key (invalidates all sessions)
#    - Bunq API key (Bunq app)

# 4. Review your transactions in the Bunq app
#    (the dashboard is read-only and cannot create transactions)

# 5. Redeploy with the new credentials
sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh

# 6. Contact Bunq support if you find unauthorized transactions
```

### Compromised dashboard host

```bash
# 1. Revoke the Bunq API key immediately (Bunq app → API keys)

# 2. Back up everything for analysis
sudo tar -czf bunq-dashboard-incident-$(date +%Y%m%d).tar.gz /volume1/docker/bunq-dashboard

# 3. Reinstall from a clean clone following SYNOLOGY_INSTALL.md

# 4. Create new credentials: Bunq API key, Vaultwarden master password, Flask secret key, dashboard password

# 5. Audit: review local code changes (git status / git diff), verify the image was built from the official repository
```

---

## 📋 Security Checklist

### Initial setup
- [ ] VPN or Tailscale installed and tested (no `tailscale funnel`, no exit node on the NAS)
- [ ] Firewall rules block external access
- [ ] Port 5000 NOT forwarded on the router
- [ ] Vaultwarden with a strong master password and `SIGNUPS_ALLOWED=false`
- [ ] Bunq API key stored in Vaultwarden (not in `.env`)
- [ ] Secret `bunq_flask_secret_key` created (64 hex characters)
- [ ] Secret `bunq_basic_auth_password` created (12+ characters)
- [ ] `ALLOWED_ORIGINS` set to your exact origin
- [ ] `FLASK_DEBUG=false`
- [ ] HTTPS via reverse proxy and `SESSION_COOKIE_SECURE=true`
- [ ] `/api/live` and `/api/health` monitored
- [ ] Encrypted backups of `config/` configured

### Monthly
- [ ] Logs reviewed for failed logins / unauthorized access
- [ ] Firewall rules verified
- [ ] Image updates checked
- [ ] Backups verified

### Quarterly
- [ ] Dashboard password rotated
- [ ] Code and images updated
- [ ] Access only via VPN/Tailscale re-tested

### Yearly
- [ ] All credentials rotated (including secret keys)
- [ ] Restore from backup tested
- [ ] Security review done

---

## 🔐 Vulnerability Reporting

If you find a security vulnerability:

**Do:**
1. Report it privately via GitHub: repository → **Security** → **Report a vulnerability** (private security advisory)
2. Include a description, steps to reproduce, potential impact and a suggested fix if you have one
3. Allow time for a fix before public disclosure

**Don't:**
1. Open a public GitHub issue for a security vulnerability
2. Disclose it publicly before a fix is released
3. Exploit it

---

## 📚 Additional Resources

- [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md) - installation guide
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - common issues
- [Bunq API documentation](https://doc.bunq.com/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Docker security](https://docs.docker.com/engine/security/)

---

**Remember:** security is an ongoing process, not a one-time setup.
