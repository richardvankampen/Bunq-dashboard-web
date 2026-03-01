# 🔒 Security Best Practices - Bunq Dashboard

Complete security guide for safe operation of Bunq Dashboard.

**Language versions**
- English (this file): [SECURITY.md](SECURITY.md)
- Dutch (full original): [SECURITY-NL.md](SECURITY-NL.md)

---

## 🧭 Navigation

- Overview: [README.md](README.md)
- Synology installation: [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## 🎯 Security Model

Bunq Dashboard is designed for a private, read-only financial view:

- Bunq API access is read-only
- Session-based authentication with secure cookies
- Secrets managed via Vaultwarden and/or Docker Swarm secrets
- Intended for VPN-only access
- Runtime served with Gunicorn (not Flask dev server)

## 🛡️ Critical Requirements

### 1. VPN-only Access

Never expose the dashboard to the public internet.

Required:
- Access the dashboard only through your VPN
- Do not forward dashboard port 5000 on your router
- Keep the dashboard on a private LAN/VPN segment

### 2. Session-based Auth

Session auth is the default and recommended mode.

Use:
- `HttpOnly` cookies
- `SameSite` cookie policy
- Strong session secret (`bunq_flask_secret_key`)
- Strong dashboard password (`bunq_basic_auth_password`)

### 3. Secure Cookie Settings

Use HTTPS + secure cookies in production:

- `SESSION_COOKIE_SECURE=true` (recommended/default)
- Only set `SESSION_COOKIE_SECURE=false` for local HTTP testing

### 4. Secret Management

Preferred split:
- Vaultwarden: Bunq API key
- Docker Swarm secrets: runtime-only secrets (dashboard password, Flask secret)

Recommended:
- `USE_VAULTWARDEN=true`
- `VAULTWARDEN_ACCESS_METHOD=cli`
- `VAULTWARDEN_URL=https://...` (HTTPS required for CLI flow)

## 🔑 Strong Secret Generation

### Flask Secret Key (64 hex chars)

```bash
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
printf "%s" "$SECRET_KEY" | docker secret create bunq_flask_secret_key -
```

### Dashboard Password

```bash
DASHBOARD_PASSWORD=$(openssl rand -base64 32)
printf "%s" "$DASHBOARD_PASSWORD" | docker secret create bunq_basic_auth_password -
```

## 🌍 CORS and Origins

Set strict allowed origins:

```bash
ALLOWED_ORIGINS=https://bunq.yourdomain.com
```

Do not use wildcard origins in production.

## 🔐 Vaultwarden Hardening

For the Vaultwarden container:

- `SIGNUPS_ALLOWED=false` after first account creation
- Set an admin token
- Disable features you do not need
- Use regular backups

## 🧪 Security Validation Checklist

- [ ] VPN access required and tested
- [ ] No internet port forwarding for dashboard
- [ ] `SESSION_COOKIE_SECURE=true` in production
- [ ] Strong dashboard secret in Swarm secrets
- [ ] Strong Flask secret in Swarm secrets
- [ ] `ALLOWED_ORIGINS` set to your exact frontend origin
- [ ] `USE_VAULTWARDEN=true`
- [ ] Vaultwarden signups disabled
- [ ] Readiness endpoint monitored: `/api/health`
- [ ] Liveness endpoint monitored: `/api/live`

## 🚨 Incident Playbook

If Bunq initialization fails:

1. Check `/api/health`
2. Check service logs
3. Validate egress IP vs Bunq whitelist
4. Run whitelist update safely (`SAFE_TWO_STEP=true`)
5. Reinitialize Bunq context if needed

## 📎 More Details

For the full Dutch, step-by-step and historical security document, see:
- [SECURITY-NL.md](SECURITY-NL.md)
