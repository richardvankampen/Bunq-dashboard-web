# 🔒 Beveiligingsrichtlijnen - Bunq Dashboard

Volledige beveiligingsgids voor veilig gebruik van het Bunq Dashboard.

**Laatst bijgewerkt:** February 2026
**Beveiligingsniveau:** Production-grade with session-based authentication

---

## 🧭 Navigatie

- Startpunt en overzicht: [README-NL.md](README-NL.md)
- Installatie: [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md)
- Troubleshooting: [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md)

## 🎯 Beveiligingsoverzicht

Het Bunq Dashboard is ontworpen met **security-first** principes:

| Security Feature | Implementation | Status |
|------------------|----------------|--------|
| **API Access** | READ-ONLY | ✅ Verified |
| **Authentication** | Session-based cookies | ✅ Recommended |
| **Secret Management** | Vaultwarden + Swarm secrets | ✅ Encrypted |
| **Network Access** | VPN-only | ✅ Required |
| **CSRF Protection** | SameSite cookies | ✅ Enabled |
| **XSS Protection** | HttpOnly cookies | ✅ Enabled |
| **Rate Limiting** | 30 req/min + 5 login/min | ✅ Active |
| **Session Expiry** | 24 hours | ✅ Automatic |
| **Password Verification** | Constant-time comparison | ✅ Implemented |
| **Runtime Server** | Gunicorn (WSGI) | ✅ Production default |

---

## 🛡️ Kritieke beveiligingseisen

### 1. ⚠️ VPN Access ONLY

**Why:** Your financial data should NEVER be accessible from the internet.

**Requirements:**
- ✅ Access dashboard ONLY via VPN
- ✅ NEVER forward port 5000 on your router
- ✅ NEVER expose dashboard to public internet
- ✅ Use Synology VPN Server (OpenVPN or L2TP/IPSec)

**VPN instellen:**

```bash
# Synology NAS:
Control Panel → VPN Server → OpenVPN
├── Enable OpenVPN server
├── Maximum connections: 5
├── Maximum connections from same IP: 1
├── Port: 1194 (default)
└── Dynamic IP: enabled

# Generate client config:
VPN Server → OpenVPN → Export configuration
└── Download .ovpn file

# Install on your devices:
# Windows: OpenVPN GUI
# Mac: Tunnelblick
# iOS/Android: OpenVPN Connect
# Linux: openvpn client
```

**Controleer of de VPN werkt:**
```bash
# Before connecting to VPN:
curl http://192.168.1.100:5000
# Should TIMEOUT (not accessible)

# After connecting to VPN:
curl http://192.168.1.100:5000
# Should return dashboard
```

---

### 2. 🔐 Gebruik sessiegebaseerde authenticatie

**Why:** Session auth is the most secure option.

**Session-based kenmerken:**
- ✅ Credentials worden server-side beheerd
- ✅ HttpOnly + SameSite cookies
- ✅ CSRF bescherming
- ✅ Auto-logout (24 uur)

**Instellen:**
```bash
# Session-based auth is default (api_proxy.py)
# Key requirements:
1. Secret `bunq_basic_auth_password` (12+ chars)
2. Secret `bunq_flask_secret_key` (64 chars hex)
3. ALLOWED_ORIGINS properly configured
4. SESSION_COOKIE_SECURE=true (default); zet alleen false bij lokale HTTP
```

---

### 3. 🔑 Vaultwarden voor geheimbeheer

**Why:** Never store API keys in plain text.

**Best Practices:**

```bash
# ✅ DO:
- Store Bunq API key in Vaultwarden vault
- Use strong Vaultwarden master password (20+ chars)
- Enable 2FA on Vaultwarden if available
- Backup Vaultwarden data regularly
- Set SIGNUPS_ALLOWED=false after first account

# ❌ DON'T:
- Store API key in .env file
- Commit .env to git
- Share Vaultwarden master password
- Use weak passwords
- Enable signups permanently
```

**Vaultwarden vs Docker Swarm secrets (aanbevolen):**
- Vaultwarden: ideaal voor de Bunq API key (rotatie, audit logs, UI).
- Swarm secrets: ideaal voor runtime-only secrets (dashboard wachtwoord, Flask secret key).
- Aanbevolen split: Bunq API key in Vaultwarden, overige secrets in Swarm.
- Zonder Vaultwarden: gebruik `bunq_api_key` als Swarm secret, maar je mist rotatie/audit en het UI-gemak.
- Let op: Swarm secrets beschermen tegen accidental leaks, maar root op de host kan ze nog steeds lezen.

**Vaultwarden Hardening:**
```bash
# In docker-compose.yml:
environment:
  SIGNUPS_ALLOWED: "false"           # ✅ Critical!
  ADMIN_TOKEN: "random-token-here"   # ✅ Enable admin panel
  INVITATIONS_ALLOWED: "false"       # ✅ No invites
  WEBSOCKET_ENABLED: "false"         # ⚠️ If not needed

# Generate admin token:
openssl rand -base64 48
```

---

### 4. 🔒 Strong Passwords & Keys

**Flask Secret Key:**
```bash
# Generate strong secret key (CRITICAL):
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")

# Create Docker secret:
printf "%s" "$SECRET_KEY" | docker secret create bunq_flask_secret_key -

# Output example (DO NOT USE THIS):
# a3f8b9c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1

# Rules:
- ✅ 64 characters hexadecimal
- ✅ Randomly generated
- ✅ Unique per installation
- ✅ NEVER share or commit to git
- ✅ Keep backed up securely
 - ⚠️ Rotating this key invalidates all active sessions
```

**Dashboard Password:**
```bash
# Generate strong password:
DASHBOARD_PASSWORD=$(openssl rand -base64 32)

# Create Docker secret:
printf "%s" "$DASHBOARD_PASSWORD" | docker secret create bunq_basic_auth_password -

# Or use passphrase (easier to remember):
# Example: "Bunq-Dashboard-2026-Super-Secure!"

# Requirements:
- ✅ Minimum 12 characters
- ✅ Mix of uppercase, lowercase, numbers, symbols
- ✅ Not reused from other services
- ✅ Changed every 3-6 months
```

**Vaultwarden Master Password:**
```bash
# Requirements:
- ✅ Minimum 20 characters
- ✅ Strong passphrase or random password
- ✅ Never written down (use password manager)
- ✅ Changed annually
```

---

## 🔧 Security Configuration

### Recommended .env + Secrets Settings

```bash
# ============================================
# PRODUCTION SECURITY CONFIGURATION
# ============================================

# Session Authentication (non-secret)
BASIC_AUTH_USERNAME=admin

# Session Settings
SESSION_COOKIE_SECURE=true   # veilige default (HTTPS/reverse proxy)
# Alleen bij lokale HTTP:
# SESSION_COOKIE_SECURE=false
# HttpOnly/SameSite are enforced in code (api_proxy.py)

# CORS (CRITICAL)
ALLOWED_ORIGINS=https://bunq.yourdomain.com  # YOUR domain only!

# Vaultwarden
USE_VAULTWARDEN=true         # Preferred/default
VAULTWARDEN_ACCESS_METHOD=cli  # Recommended: decrypts Vault item values via bw CLI
VAULTWARDEN_URL=https://vault.jouwdomein.nl  # CLI path requires HTTPS URL

# Bunq
BUNQ_ENVIRONMENT=PRODUCTION  # For real banking data
AUTO_SET_BUNQ_WHITELIST_IP=true
AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS=false

# Application
FLASK_DEBUG=false            # NEVER true in production!
LOG_LEVEL=INFO              # Or WARNING for production
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

# Docker Swarm secrets (create separately)
# - bunq_basic_auth_password
# - bunq_flask_secret_key
# - bunq_vaultwarden_client_id
# - bunq_vaultwarden_client_secret
# - bunq_vaultwarden_master_password
# - bunq_api_key (only if USE_VAULTWARDEN=false)
```

**File permissions (aanbevolen):**
```bash
# .env bevat geen secrets, maar bevat wel je configuratie
chmod 600 /volume1/docker/bunq-dashboard/.env
```

### Bunq IP Whitelist (Critical)

Bij Bunq API keys kan IP-restrictie actief zijn. Dan moet het publieke egress-IP van je container
toegestaan zijn, anders krijg je:
`Incorrect API key or IP address`.

**Aanbevolen procedure na API key rotatie of netwerk/VPN wijziging:**
```bash
cd /volume1/docker/bunq-dashboard
TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=false sh scripts/register_bunq_ip.sh
# Optioneel tweede pass (pas na validatie):
# TARGET_IP=<PUBLIEK_IPV4> SAFE_TWO_STEP=true NO_PROMPT=true DEACTIVATE_OTHERS=true sh scripts/register_bunq_ip.sh
```

**Alternatief via UI (P1):**
- Open dashboard → Settings → `Admin Maintenance (P1)`
- Gebruik `Run maintenance now` met standaardopties
  - Whitelist update is altijd actief
  - `Auto target IP (egress)` standaard uit (of vul handmatig IP in)
  - `Refresh key` standaard uit (alleen na key-rotatie)
- Handmatig IP wordt gevalideerd als publiek extern IPv4 (geen private/lokale ranges)
- Gebruik `Check egress IP` om te verifiëren welk publiek IP ge-whitelist moet zijn

Dit script:
- toont het actuele publieke egress-IP van de container
- gebruikt veilige 2-staps Bunq allowlist update (eerst activeren, daarna overige IPs deactiveren)
- bij directe key-flow valideert het `bunq_api_key` secret formaat
- maakt een nieuwe Bunq `ApiContext` (installation + device registration)
- herstart de service en toont relevante logs
- valideert egress-IP tegen actieve whitelist en stopt met herstelcommando bij mismatch

---

## 🌐 Network Security

### Firewall Configuration

**Synology Firewall:**
```bash
Control Panel → Security → Firewall → Edit Rules

# Create rule:
Ports:
├── 5000 (Dashboard)
├── 9000 (Vaultwarden)
└── 1194 (VPN)

Source IP: 192.168.0.0/16  # Local network only

Action: Allow

# Block all other IPs:
Source IP: All
Action: Deny
```

**Linux iptables:**
```bash
# Allow local network only
sudo iptables -A INPUT -p tcp --dport 5000 -s 192.168.0.0/16 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9000 -s 192.168.0.0/16 -j ACCEPT

# Allow VPN
sudo iptables -A INPUT -p udp --dport 1194 -j ACCEPT

# Drop all other connections
sudo iptables -A INPUT -p tcp --dport 5000 -j DROP
sudo iptables -A INPUT -p tcp --dport 9000 -j DROP

# Save rules
sudo iptables-save > /etc/iptables/rules.v4
```

---

### Reverse Proxy with HTTPS (Recommended)

**Why:** Adds encryption layer and proper SSL certificates.

**Synology Reverse Proxy:**
```bash
Control Panel → Login Portal → Advanced → Reverse Proxy

Create:
├── Reverse Proxy Name: bunq-dashboard
├── Protocol: HTTPS
├── Hostname: bunq.yourdomain.com
├── Port: 443
├── Enable HSTS: ✅
├── Enable HTTP/2: ✅
├── Backend Server: localhost
├── Port: 5000
└── Apply

# Then get SSL certificate:
Control Panel → Security → Certificate
└── Add → Let's Encrypt
```

**Nginx (Advanced):**
```nginx
server {
    listen 443 ssl http2;
    server_name bunq.yourdomain.com;

    # SSL Configuration
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Proxy to dashboard
    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name bunq.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

**After enabling HTTPS:**
```bash
# Update .env:
SESSION_COOKIE_SECURE=true
ALLOWED_ORIGINS=https://bunq.yourdomain.com

# Restart dashboard (reload .env):
set -a; source .env; set +a
docker stack deploy -c docker-compose.yml bunq
```

---

## 🔍 Security Monitoring

### Regular Security Checks

**Monthly:**
```bash
# 1. Check for unauthorized access attempts
docker service logs bunq_bunq-dashboard | grep "Unauthorized" | tail -20

# 2. Review active sessions (if implemented)
# Check Vaultwarden access logs

# 3. Verify firewall rules still active
sudo iptables -L | grep 5000

# 4. Check for container updates
docker images | grep bunq
docker images | grep vaultwarden

# 5. Backup check
ls -lh /volume1/docker/bunq-dashboard/backups/
```

**Quarterly:**
```bash
# 1. Rotate passwords
# - bunq_basic_auth_password
# - Vaultwarden master password (if needed)

# 2. Update Bunq API key (optional)
# - Generate new key in Bunq app
# - Update in Vaultwarden
# - Test dashboard still works

# 3. Review and update packages
TAG=$(git rev-parse --short HEAD)
docker build --no-cache -t bunq-dashboard:$TAG .
set -a; . .env; set +a
docker stack deploy -c docker-compose.yml bunq
docker service update --force --image bunq-dashboard:$TAG bunq_bunq-dashboard

# 4. Security audit
# - Review access logs
# - Check for outdated dependencies
# - Test VPN still works
```

**Annually:**
```bash
# 1. Full security review
# 2. Rotate all credentials (including bunq_flask_secret_key)
# 3. Update all Docker images
# 4. Test disaster recovery (restore from backup)
# 5. Review and update security policies
```

---

### Logging & Alerting

**Enable comprehensive logging:**
```bash
# In .env:
LOG_LEVEL=INFO

# In api_proxy.py, log important events:
# - Failed login attempts
# - Rate limit hits
# - API errors
# - Unusual access patterns
```

**Monitor logs:**
```bash
# Real-time monitoring
docker service logs -f bunq_bunq-dashboard | grep -E "(WARN|ERROR|Unauthorized)"

# Failed login attempts
docker service logs bunq_bunq-dashboard | grep "Login failed" | wc -l

# Rate limit hits
docker service logs bunq_bunq-dashboard | grep "Rate limit" | wc -l

# Set up alerts (example with Synology)
Control Panel → Notification → Email
└── Configure alerts for container failures
```

---

## 🚨 Incident Response

### If You Suspect Unauthorized Access

**Immediate Actions:**
```bash
# 1. BLOCK ACCESS IMMEDIATELY
docker stack rm bunq

# 2. Change all credentials
# - Vaultwarden master password
# - bunq_basic_auth_password
# - bunq_flask_secret_key (invalidates all sessions)
# - Bunq API key (in Bunq app)

# 3. Review logs for breach
docker service logs bunq_bunq-dashboard > incident-$(date +%Y%m%d).log

# 4. Check Bunq transactions
# Open Bunq app → Review all recent transactions
# Look for unauthorized transactions
# (Remember: Dashboard is READ-ONLY, cannot create transactions)

# 5. Restart with new credentials
# Update Docker secrets / .env, then redeploy
set -a; source .env; set +a
docker stack deploy -c docker-compose.yml bunq

# 6. Report incident (if needed)
# Contact Bunq support if unauthorized transactions found
```

### If Dashboard is Compromised

```bash
# 1. Immediately revoke Bunq API key
# Bunq App → Security → API Keys → Revoke key

# 2. Backup everything first
sudo tar -czf bunq-dashboard-backup-$(date +%Y%m%d).tar.gz \
    /volume1/docker/bunq-dashboard

# 3. Complete reinstall
docker stack rm bunq  # Stop stack
rm -rf /volume1/docker/bunq-dashboard/*
# Re-deploy following SYNOLOGY_INSTALL-NL.md

# 4. Generate new credentials
# - New Bunq API key
# - New Vaultwarden master password
# - New Flask secret key
# - New dashboard password

# 5. Security audit
# - Review all code changes
# - Check for backdoors
# - Verify Docker image integrity
```

---

## 📋 Beveiligingschecklist

### Initial Setup
- [ ] VPN installed and configured
- [ ] Firewall rules configured (block external access)
- [ ] Vaultwarden installed with strong master password
- [ ] Vaultwarden signups disabled (`SIGNUPS_ALLOWED=false`)
- [ ] Bunq API key stored in Vaultwarden (not in .env)
- [ ] Session-based auth configured
- [ ] Secret `bunq_flask_secret_key` created (64 chars)
- [ ] Secret `bunq_basic_auth_password` set (12+ chars)
- [ ] `ALLOWED_ORIGINS` set to specific domain/IP
- [ ] `FLASK_DEBUG=false` in production
- [ ] HTTPS configured (if using reverse proxy)
- [ ] `SESSION_COOKIE_SECURE=true` (aanbevolen/default; alleen false bij lokale HTTP)
- [ ] Port 5000 NOT forwarded on router
- [ ] Regular backups configured

### Monthly Maintenance
- [ ] Review access logs for suspicious activity
- [ ] Verify firewall rules still active
- [ ] Check for Docker image updates
- [ ] Test backup restore procedure
- [ ] Verify VPN still working correctly

### Quarterly Review
- [ ] Rotate dashboard password
- [ ] Update Docker images
- [ ] Security audit (logs, configs)
- [ ] Test disaster recovery

### Annual Tasks
- [ ] Rotate all credentials (including secret keys)
- [ ] Full security review
- [ ] Update documentation
- [ ] Review and update security policies

---

## 🔐 Vulnerability Reporting

If you discover a security vulnerability:

**DO:**
1. Email security details to: [your-email]
2. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. Allow 90 days for fix before public disclosure

**DON'T:**
1. Open public GitHub issue for security vulnerabilities
2. Disclose vulnerability publicly before fix
3. Exploit vulnerability

**Response Timeline:**
- Acknowledgment: Within 48 hours
- Initial assessment: Within 1 week
- Fix development: Within 30 days
- Public disclosure: After fix released + 30 days

---

## 📚 Additional Resources

- [SYNOLOGY_INSTALL-NL.md](SYNOLOGY_INSTALL-NL.md) - Installation guide
- [TROUBLESHOOTING-NL.md](TROUBLESHOOTING-NL.md) - Common issues
- [Bunq API Security](https://doc.bunq.com/#/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Docker Security](https://docs.docker.com/engine/security/)

---

**Remember:** Security is an ongoing process, not a one-time setup!

**Last Updated:** February 2026
**Next Review:** May 2026
