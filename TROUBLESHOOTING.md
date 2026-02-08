# 🐛 Troubleshooting Guide - Bunq Dashboard

Comprehensive troubleshooting guide voor alle bekende problemen en hun oplossingen.

**Last Updated:** February 2026  
**Applies to:** All versions (Basic, Secure, Session)

---

## 🧭 Navigatie

- Startpunt en overzicht: [README.md](README.md)
- Synology install: [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
- Security hardening: [SECURITY.md](SECURITY.md)
- Session auth upgrades: [SESSION_AUTH_INSTALL.md](SESSION_AUTH_INSTALL.md)

## 📋 Quick Diagnostic

Start hier als je niet zeker weet wat het probleem is:

```bash
# Swarm stack name: bunq (pas aan als je een andere naam gebruikt)
# Check if containers are running
docker ps

# Swarm convenience: get the running task container id
BUNQ_CONTAINER=$(docker ps --filter name=bunq_bunq-dashboard -q | head -n1)

# Check container logs
docker service logs bunq_bunq-dashboard
docker logs vaultwarden

# Check API health
curl http://localhost:5000/api/health

# Check environment variables
cat .env | grep -v SECRET | grep -v PASSWORD
docker secret ls | grep bunq_
```

---

## 🔴 KRITIEKE PROBLEMEN

### 1. Container Won't Start

**Symptomen:**
- Container stopt direct na start
- `docker ps` toont geen bunq-dashboard
- Error in logs bij `docker stack deploy`

**Mogelijke Oorzaken & Oplossingen:**

#### A. Port Already in Use
```bash
# Check wat port 5000 gebruikt
sudo netstat -tulpn | grep 5000

# Oplossing 1: Stop conflicterende service
sudo systemctl stop [conflicting-service]

# Oplossing 2: Wijzig port in docker-compose.yml
ports:
  - "5001:5000"  # Gebruik 5001 i.p.v. 5000
```

#### B. Missing Dependencies
```bash
# Rebuild zonder cache
docker build -t bunq-dashboard:local .

# Check requirements_web.txt bestaat
ls -la requirements_web.txt

# Manually install dependencies in container
docker exec -it "$BUNQ_CONTAINER" pip install -r requirements_web.txt
```

#### C. Permission Issues
```bash
# Fix permissions op volumes
sudo chown -R $(whoami) /volume1/docker/bunq-dashboard
sudo chmod -R 755 /volume1/docker/bunq-dashboard

# Recreate containers
docker stack rm bunq
# Redeploy (reload .env)
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

#### D. Syntax Error in Code
```bash
# Check Python syntax
docker exec "$BUNQ_CONTAINER" python -m py_compile api_proxy.py

# Check logs for specific error
docker service logs bunq_bunq-dashboard 2>&1 | grep -i error
```

---

### 2. Dashboard Not Accessible (HTTP 502/503)

**Symptomen:**
- Browser kan niet verbinden
- "502 Bad Gateway" of "503 Service Unavailable"
- Timeout errors

**Oplossingen:**

#### A. Container Not Running
```bash
# Check status
docker ps | grep bunq-dashboard

# If not running, check why:
docker service logs bunq_bunq-dashboard

# Restart service
docker service update --force bunq_bunq-dashboard

# If service doesn't exist, redeploy:
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

#### B. Firewall Blocking
```bash
# Synology: Check firewall rules
Control Panel → Security → Firewall → Edit Rules

# Allow port 5000 for local network:
Source IP: 192.168.0.0/16
Port: 5000
Action: Allow

# Linux: Check iptables
sudo iptables -L | grep 5000

# Allow if blocked:
sudo iptables -A INPUT -p tcp --dport 5000 -j ACCEPT
```

#### C. Wrong IP Address
```bash
# Check your NAS IP
ifconfig | grep "inet "
# or
ip addr show

# Access via correct IP:
http://192.168.1.XXX:5000  # Replace XXX with your IP
```

#### D. DNS Issues (Domain Names)
```bash
# If using domain name, test DNS:
nslookup bunq.yourdomain.com

# Fallback to IP if DNS fails
http://192.168.1.100:5000
```

---

### 3. Authentication Failed / 401 Unauthorized

**Voor Session-Based Auth:**

#### A. Wrong Credentials
```bash
# Verify username in .env
cat .env | grep BASIC_AUTH_USERNAME

# Verify secret exists
docker secret ls | grep bunq_basic_auth_password

# Reset password (rotate secret):
sudo docker secret rm bunq_basic_auth_password
printf "NewStrongPassword" | sudo docker secret create bunq_basic_auth_password -

# Redeploy (reload .env)
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

#### B. Session Expired
```bash
# Sessions expire after 24 hours by default
# Solution: Just login again

# To check session lifetime:
grep PERMANENT_SESSION_LIFETIME api_proxy.py

# To extend (edit api_proxy.py):
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=48)
```

#### C. Flask Secret Not Set or Changed
```bash
# Check if secret exists
docker secret ls | grep bunq_flask_secret_key

# If missing, create:
python3 -c "import secrets; print(secrets.token_hex(32))" | sudo docker secret create bunq_flask_secret_key -

# Redeploy (reload .env)
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq

# ⚠️ WARNING: Changing secret key invalidates all sessions!
```

#### D. Cookies Not Accepted
```bash
# Check browser cookie settings
# Chrome: Settings → Privacy → Cookies
# Firefox: Settings → Privacy → Cookies

# Enable cookies for your domain
# Try different browser to isolate issue

# Check cookies via DevTools:
# Application/Storage → Cookies → jouw domein
# Controleer of er een `session` cookie staat met HttpOnly aangevinkt
```

**Voor Session Auth:**

```bash
# Clear browser cache/credentials
# Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

# Test login with curl:
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}' \
  http://192.168.1.100:5000/api/auth/login

# Use session cookie for authenticated requests:
curl -b cookies.txt http://192.168.1.100:5000/api/health
```

---

### 4. CORS Errors

**Symptomen:**
```
Access to fetch at 'http://192.168.1.100:5000/api/...' 
from origin 'http://192.168.1.100:5000' 
has been blocked by CORS policy
```

**Oplossingen:**

#### A. Wrong ALLOWED_ORIGINS
```bash
# Check .env
cat .env | grep ALLOWED_ORIGINS

# Should match your access URL exactly:
ALLOWED_ORIGINS=http://192.168.1.100:5000

# Multiple origins (comma-separated):
ALLOWED_ORIGINS=http://192.168.1.100:5000,http://10.8.0.5:5000

# After changing (reload .env):
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

#### B. Using Wrong Port
```bash
# If you see CORS error, you're likely using 2 ports
# Solution: Use SINGLE PORT (5000) for both frontend and API

# Check docker-compose.yml only has:
ports:
  - "5000:5000"

# Access via: http://192.168.1.100:5000
```

#### C. Mixed HTTP/HTTPS
```bash
# Ensure consistent protocol
# Either ALL http:// OR ALL https://

# Wrong:
Frontend: https://bunq.yourdomain.com
API calls: http://192.168.1.100:5000  # ❌ Mixed!

# Correct:
Frontend: https://bunq.yourdomain.com
API calls: https://bunq.yourdomain.com/api  # ✅ Same origin
```

---

### 5. Vaultwarden Connection Failed

**Symptomen:**
```
❌ Vaultwarden connection error
❌ API key not found in vault
❌ Vaultwarden authentication failed
```

**Oplossingen:**

#### A. Vaultwarden Not Running
```bash
# Check if running
docker ps | grep vaultwarden

# If not running, start:
docker start vaultwarden

# Check logs:
docker logs vaultwarden
```

#### B. Wrong Credentials
```bash
# Verify secrets exist
docker secret ls | grep bunq_vaultwarden_client

# Get correct credentials from Vaultwarden:
1. Login to http://192.168.1.100:9000
2. Account Settings → Security → API Key
3. Enter master password
4. Copy client_id and client_secret
5. Update secrets:
   - `sudo docker secret rm bunq_vaultwarden_client_id`
   - `printf "user.xxxx-xxxx-xxxx-xxxx" | sudo docker secret create bunq_vaultwarden_client_id -`
   - `sudo docker secret rm bunq_vaultwarden_client_secret`
   - `printf "your_client_secret" | sudo docker secret create bunq_vaultwarden_client_secret -`
6. Redeploy: `set -a; source .env; set +a; sudo -E docker stack deploy -c docker-compose.yml bunq`
```

#### C. Network Issues Between Containers
```bash
# Test connectivity
docker exec "$BUNQ_CONTAINER" ping vaultwarden

# If fails, check network:
docker network ls
docker network inspect bunq-net

# If bunq-net is missing:
sudo docker network create --driver overlay --attachable bunq-net

# Ensure Vaultwarden is attached:
sudo docker network connect bunq-net vaultwarden

# Redeploy (reload .env):
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

#### D. Item Name Mismatch
```bash
# Check item name in Vaultwarden vault
# Default: "Bunq API Key" (exact match required!)

# Verify in .env:
VAULTWARDEN_ITEM_NAME=Bunq API Key

# Check in Vaultwarden UI:
1. Login to http://192.168.1.100:9000
2. My Vault → Check item name
3. Must match EXACTLY (case-sensitive!)

# If different, either:
# Option A: Rename item in Vaultwarden
# Option B: Update VAULTWARDEN_ITEM_NAME in .env
```

#### E. API Key Not in Vault
```bash
# Add Bunq API key to Vaultwarden:
1. Login to http://192.168.1.100:9000
2. My Vault → Add Item
3. Item Type: Login
4. Name: Bunq API Key  # Exactly this!
5. Username: bunq-dashboard
6. Password: <paste your Bunq API key here>
7. Save

# Restart dashboard:
docker service update --force bunq_bunq-dashboard
```

---

## 🟡 VEEL VOORKOMENDE PROBLEMEN

### 6. Dashboard Loads Demo Data (Not Real Bunq Data)

**Oplossingen:**

#### A. Not Logged In (Session Auth)
```bash
# For session-based auth:
1. Click login button (top right)
2. Enter credentials (username uit .env, wachtwoord via secret)
3. Enable "Use real Bunq data" checkbox
4. Click Refresh

# If login button missing: check you're using app.js
```

#### B. Vaultwarden Not Configured
```bash
# Check .env:
USE_VAULTWARDEN=true  # Must be true!

# Check credentials set:
docker secret ls | grep bunq_vaultwarden_client

# If not set, follow Vaultwarden setup in SYNOLOGY_INSTALL.md
```

#### C. Bunq API Key Invalid
```bash
# Check logs:
docker service logs bunq_bunq-dashboard | grep -i "api key"

# Test API key manually:
# In Bunq app:
# Profile → Security → API Keys
# Check if key is active and not revoked

# If invalid: Generate new key in Bunq app
# Update in Vaultwarden → Restart dashboard
```

#### D. Wrong Bunq Environment
```bash
# Check .env:
BUNQ_ENVIRONMENT=PRODUCTION  # For real banking
# or
BUNQ_ENVIRONMENT=SANDBOX     # For testing

# Ensure API key matches environment!
# Sandbox key doesn't work with PRODUCTION and vice versa

# After changing (reload .env):
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

---

### 7. Rate Limit Exceeded

**Symptomen:**
```
429 Too Many Requests
Rate limit exceeded. Please try again later.
```

**Oplossingen:**

#### A. Too Many Login Attempts
```bash
# Session auth has 5 login attempts per minute limit
# Solution: Wait 60 seconds, then try again

# To reset rate limiter:
docker service update --force bunq_bunq-dashboard

# To increase limit (api_proxy.py):
# Find: max_reqs = 5 if endpoint == 'login'
# Change to: max_reqs = 10 if endpoint == 'login'
# Then rebuild
```

#### B. Too Many API Calls
```bash
# General limit: 30 requests per minute
# Reduce refresh frequency in dashboard

# Or increase limit in api_proxy_*.py:
rate_limiter = RateLimiter(
    max_requests=60,  # Increase from 30
    window_seconds=60
)
# Then rebuild
```

---

### 8. Session Keeps Expiring

**Symptomen:**
- Logged out after few minutes
- Must login constantly
- Session doesn't persist across page reloads

**Oplossingen:**

#### A. Flask Secret Changes
```bash
# If secret key changes, all sessions invalidate
# Solution: Keep bunq_flask_secret_key constant!

# Check if it's set:
docker secret ls | grep bunq_flask_secret_key

# If missing, create:
python3 -c "import secrets; print(secrets.token_hex(32))" | sudo docker secret create bunq_flask_secret_key -
```

#### B. Browser Not Accepting Cookies
```bash
# Check browser settings allow cookies
# Especially in private/incognito mode

# Test in normal browser window first
# Disable strict tracking prevention if needed
```

#### C. SESSION_COOKIE_SECURE Mismatch
```bash
# Check .env:
SESSION_COOKIE_SECURE=false  # For HTTP
SESSION_COOKIE_SECURE=true   # For HTTPS

# Must match your access method!
# If accessing via http://, set to false
# If accessing via https://, set to true

# After changing (reload .env):
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

---

### 9. Slow Performance / Timeouts

**Symptomen:**
- Dashboard loads slowly
- Timeouts when fetching data
- Visualizations take long to render

**Oplossingen:**

#### A. Resource Constraints
```bash
# Check container resources:
docker stats "$BUNQ_CONTAINER"

# If CPU/Memory maxed out:
# Edit docker-compose.yml:
services:
  bunq-dashboard:
    deploy:
      resources:
        limits:
          cpus: '2.0'      # Increase from 1.0
          memory: 2048M    # Increase from 1024M

# Restart:
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

#### B. Bunq API Slow
```bash
# API might be slow during high load
# Add caching in api_proxy.py

# Or reduce data fetch interval
# In dashboard settings: increase refresh interval
```

#### C. Too Many Transactions
```bash
# If loading 1000+ transactions:
# Add pagination or date filter

# Edit api_proxy.py:
# In get_transactions():
params = {
    'count': 100,  # Limit results
}
```

---

### 10. Visualizations Not Showing

**Symptomen:**
- Blank charts
- "No data available"
- Loading spinner forever

**Oplossingen:**

#### A. No Transaction Data
```bash
# Check logs:
docker service logs bunq_bunq-dashboard | grep transaction

# Verify Bunq account has transactions
# Or use demo data for testing
```

#### B. JavaScript Errors
```bash
# Open browser console (F12)
# Check for errors

# Common: Plotly not loaded
# Solution: Check internet connection
# Plotly loads from CDN
```

#### C. Browser Compatibility
```bash
# Use modern browser:
# Chrome 90+, Firefox 88+, Safari 14+

# Update browser if old version
# Disable browser extensions that might interfere
```

---

## 🟢 CONFIGURATIE PROBLEMEN

### 11. Environment Variables Not Loading

```bash
# Check .env file location:
ls -la /volume1/docker/bunq-dashboard/.env

# Ensure .env is loaded into the shell before deploy:
set -a; source .env; set +a
# If using sudo, preserve env:
sudo -E docker stack deploy -c docker-compose.yml bunq

# Test variable loading:
docker exec "$BUNQ_CONTAINER" env | grep BUNQ

# Rebuild if needed:
docker stack rm bunq
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

---

### 12. SSL/HTTPS Issues

```bash
# If using reverse proxy with HTTPS:

# A. Mixed content errors:
# Ensure API calls use relative paths:
fetch('/api/transactions')  # ✅ Relative
fetch('http://...')         # ❌ Hardcoded

# B. Certificate errors:
# Check reverse proxy SSL cert valid
# Update SESSION_COOKIE_SECURE=true in .env

# C. HSTS issues:
# Clear HSTS settings in browser:
# Chrome: chrome://net-internals/#hsts
```

---

## 📊 DEBUGGING TIPS

### Enable Debug Logging

```bash
# In .env:
FLASK_DEBUG=true
LOG_LEVEL=DEBUG

# Restart (reload .env):
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq

# Watch logs:
docker service logs -f bunq_bunq-dashboard

# ⚠️ Disable in production! (exposes sensitive info)
```

### Test API Endpoints Manually

```bash
# Health check:
curl http://localhost:5000/api/health

# Login to get session cookie:
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}' \
  http://localhost:5000/api/auth/login

# Accounts (with session cookie):
curl -b cookies.txt http://localhost:5000/api/accounts

# Transactions:
curl -b cookies.txt http://localhost:5000/api/transactions

# Session status:
curl -b cookies.txt http://localhost:5000/api/auth/status
```

### Check File Permissions

```bash
# Verify all files readable:
ls -la /volume1/docker/bunq-dashboard/

# Fix if needed:
sudo chown -R $(whoami):$(whoami) /volume1/docker/bunq-dashboard/
sudo chmod -R 755 /volume1/docker/bunq-dashboard/
```

---

## 🆘 STILL HAVING ISSUES?

### Collecteer Diagnostic Info

```bash
# Run this script to collect info:
#!/bin/bash
echo "=== Docker Status ===" > diagnostic.txt
docker ps >> diagnostic.txt
BUNQ_CONTAINER=$(docker ps --filter name=bunq_bunq-dashboard -q | head -n1)
echo "
=== Container Logs ===" >> diagnostic.txt
docker service logs bunq_bunq-dashboard >> diagnostic.txt 2>&1
echo "
=== Environment (safe) ===" >> diagnostic.txt
docker exec "$BUNQ_CONTAINER" env | grep -v SECRET | grep -v PASSWORD >> diagnostic.txt
echo "
=== Network ===" >> diagnostic.txt
docker network inspect bunq-net >> diagnostic.txt
echo "
=== Health ===" >> diagnostic.txt
curl http://localhost:5000/api/health >> diagnostic.txt 2>&1

# Review diagnostic.txt before sharing (remove any secrets!)
cat diagnostic.txt
```

### Open GitHub Issue

1. Go to: https://github.com/richardvankampen/Bunq-dashboard-web/issues
2. Click "New Issue"
3. Provide:
   - Problem description
   - Steps to reproduce
   - Your configuration (no secrets!)
   - Diagnostic info (from above script)
   - Docker version: `docker --version`
   - NAS model (if Synology)

---

## 📚 Additional Resources

- [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md) - Complete installation guide
- [SESSION_AUTH_INSTALL.md](SESSION_AUTH_INSTALL.md) - Session auth setup
- [SECURITY.md](SECURITY.md) - Security configuration
- [README.md](README.md) - General documentation

---

**Last Updated:** February 2026  
**Maintained by:** Community Contributors

*Als je een oplossing vindt voor een nieuw probleem, overweeg dan een PR om deze guide te updaten!*
