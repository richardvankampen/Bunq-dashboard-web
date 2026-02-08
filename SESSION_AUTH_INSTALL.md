# 🔐 SESSION-BASED AUTHENTICATION - Installatie Guide

## 🧭 Navigatie

- Startpunt en overzicht: [README.md](README.md)
- Synology install: [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
- Security hardening: [SECURITY.md](SECURITY.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## ✨ WAT IS ER VERANDERD?

**Voorheen (Basic Auth met localStorage):**
- ❌ Wachtwoord opgeslagen in browser localStorage
- ❌ Base64 encoded (makkelijk te decoderen)
- ❌ Kwetsbaar als iemand toegang heeft tot je laptop

**Nu (Session-based Auth):**
- ✅ **GEEN credentials in localStorage**
- ✅ **Secure session cookies** (HttpOnly, SameSite)
- ✅ **Sessions verlopen automatisch** (24 uur)
- ✅ **Rate limiting op login** (5 pogingen/min)
- ✅ **Better be safe than sorry!** 🔒

---

## 📋 BENODIGDHEDEN

1. Je Synology NAS met Docker
2. Bestaande Bunq Dashboard installatie
3. 10 minuten tijd

**Let op:** Als je deze repo recent hebt gecloned (v3.0+), dan gebruik je **al** session‑based auth.  
In dat geval kun je **Stap 2–4 overslaan** en direct naar **Stap 5 (.env)** gaan.

---

## 🚀 STAP-VOOR-STAP INSTALLATIE

### STAP 1: Backup huidige bestanden

```bash
cd /volume1/docker/bunq-dashboard

# Backup
cp api_proxy.py api_proxy.py.OLD
cp app.js app.js.OLD
cp .env .env.OLD
```

### STAP 2: Update backend (Flask API)

```bash
# Gebruik de session-based backend
# Upload: api_proxy.py (session-based) naar je NAS
```

**Controleer of het bestand deze imports heeft:**
```python
from flask import session, make_response
app.config['SECRET_KEY'] = get_config('FLASK_SECRET_KEY', ..., 'flask_secret_key')
app.config['SESSION_COOKIE_HTTPONLY'] = True
```

### STAP 3: Update frontend (JavaScript)

```bash
# Gebruik de session-based frontend
# Upload: app.js (session-based) naar je NAS
```

**Controleer of het bestand deze functie heeft:**
```javascript
async function checkAuthStatus() {
    const response = await fetch(`${CONFIG.apiEndpoint}/auth/status`, {
        credentials: 'include'  // KRITIEK!
    });
    ...
}
```

### STAP 4: Controleer HTML (Login Modal aanwezig)

In deze repository is de login modal **al aanwezig** in `index.html`.
Gebruik je een aangepaste `index.html`? Zorg dan dat de login modal **VOOR de closing `</body>` tag** staat:

```html
<!-- LOGIN MODAL -->
<div id="loginModal" class="modal">
    <div class="modal-content">
        <div class="modal-header">
            <h2>🔐 Login Required</h2>
            <button class="close-btn" id="closeLogin">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <form id="loginForm" class="login-form">
            <div class="form-group">
                <label for="loginUsername">
                    <i class="fas fa-user"></i> Username
                </label>
                <input type="text" id="loginUsername" required>
            </div>
            
            <div class="form-group">
                <label for="loginPassword">
                    <i class="fas fa-lock"></i> Password
                </label>
                <input type="password" id="loginPassword" required>
            </div>
            
            <button type="submit" id="loginSubmit" class="btn-primary">
                <i class="fas fa-sign-in-alt"></i> Login
            </button>
        </form>
    </div>
</div>

<!-- Auth Controls in navbar -->
<div class="auth-controls">
    <span id="userDisplay" style="display: none;"></span>
    <button id="loginBtn" class="btn-icon">
        <i class="fas fa-sign-in-alt"></i>
    </button>
    <button id="logoutBtn" class="btn-icon" style="display: none;">
        <i class="fas fa-sign-out-alt"></i>
    </button>
</div>
```

**Kopieer ook de CSS** uit `styles.css` als je een eigen stylesheet gebruikt.

### STAP 5: Genereer Flask Secret Key

**BELANGRIJK:** Je hebt een unieke, random secret key nodig!

```bash
# Optie A: Op je NAS via SSH
python3 -c "import secrets; print(secrets.token_hex(32))"

# Optie B: Op je laptop
python -c "import secrets; print(secrets.token_hex(32))"

```

**Output bijvoorbeeld:**
```
a3f8b9c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
```

**Kopieer deze key!** Je hebt hem nodig in de volgende stap.

### STAP 6: Update .env bestand (niet‑gevoelig)

```bash
nano /volume1/docker/bunq-dashboard/.env
```

**Voeg toe / update (geen secrets):**

```bash
# Login username (wachtwoord via Docker secret)
BASIC_AUTH_USERNAME=admin

# Session cookie settings
# Set to 'true' als je HTTPS gebruikt
SESSION_COOKIE_SECURE=false

# CORS (vervang met je NAS IP!)
ALLOWED_ORIGINS=http://192.168.1.100:5000

# Rest blijft hetzelfde...
USE_VAULTWARDEN=true
BUNQ_ENVIRONMENT=PRODUCTION
# etc.
```

### STAP 6b: Maak Docker secrets (verplicht)

```bash
# Eenmalig (Swarm activeren)
sudo docker swarm init
# Als je een melding krijgt dat dit al actief is: negeren.

# Wachtwoord voor dashboard login
printf "JouwSterkeWachtwoord123!" | sudo docker secret create bunq_basic_auth_password -

# Flask Secret Key (uit stap 5)
printf "a3f8b9c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1" | sudo docker secret create bunq_flask_secret_key -
```

**⚠️ KRITIEK:**
- `bunq_flask_secret_key` moet **uniek** en **random** zijn
- **Bewaar deze key veilig** - als je hem kwijt bent, worden alle sessies ongeldig
- **Verander hem NIET** tenzij je alle users wilt uitloggen

### STAP 7: Rebuild en Restart (Swarm)

```bash
cd /volume1/docker/bunq-dashboard

# Rebuild image
sudo docker build -t bunq-dashboard:local .

# Deploy stack
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq

# Check logs
sudo docker service logs -f bunq_bunq-dashboard
```

**Je zou moeten zien:**
```
🚀 Starting Bunq Dashboard API (SESSION-BASED AUTH)...
🔐 Session cookie secure: False
⏱️  Session lifetime: 24 hours
🔒 CORS Origins: ['http://192.168.1.100:5000']
🔐 Authentication: ENABLED ✅
🍪 Session-based auth with secure cookies
⏱️  Rate Limiting: 30 req/min (general), 5 req/min (login)
🔑 Secret key: Set ✅
✅ Bunq API initialized
```

### STAP 8: Test de nieuwe auth

1. **Open dashboard:** `http://192.168.1.100:5000`

2. **Je zou nu demo data moeten zien** (nog niet ingelogd)

3. **Klik op login button** (rechts boven)

4. **Login modal verschijnt:**
   - Username: `admin`
   - Password: `[jouw wachtwoord uit .env]`

5. **Klik Login**

6. **Als succesvol:**
   - Modal sluit
   - Je ziet je username rechts boven
   - Logout button verschijnt
   - "Use real data" checkbox wordt enabled

7. **Enable "Use real Bunq data"**
   - Data wordt geladen van Bunq API
   - Session cookie wordt gebruikt (niet localStorage!)

8. **Test logout:**
   - Klik logout button
   - Sessie wordt vernietigd
   - Dashboard toont weer demo data

9. **Herlaad pagina:**
   - Als session nog geldig: blijf ingelogd
   - Na 24 uur: automatisch uitgelogd

---

## 🔍 VERIFICATIE

### Test 1: Geen credentials in localStorage

```javascript
// Open browser console (F12)
console.log(localStorage);
// Je zou GEEN password of auth token moeten zien!
```

### Test 2: Session cookie aanwezig (via DevTools)

1. Open browser DevTools → **Application/Storage** → **Cookies**
2. Selecteer je domein
3. Controleer of er een `session` cookie staat met **HttpOnly** aangevinkt

### Test 3: HttpOnly cookie (niet toegankelijk via JS)

```javascript
// Je zou GEEN "session" cookie moeten zien (HttpOnly)
document.cookie
// Output: geen "session" cookie in de lijst
```

### Test 4: Session expiry

```bash
# Check logs na 24 uur:
sudo docker service logs bunq_bunq-dashboard | grep "expired"

# Of forceer expiry door secret key te roteren:
# 1. Update `bunq_flask_secret_key` secret
# 2. Redeploy stack
# 3. Probeer API call → moet 401 geven
```

### Test 5: Rate limiting op login

```bash
# Probeer 6x snel achter elkaar in te loggen met verkeerd wachtwoord
# De 6e poging zou een "Rate limit exceeded" error moeten geven
```

---

## 🛡️ SECURITY VOORDELEN

### ✅ Wat is nu veiliger:

1. **Geen credentials in localStorage**
   - Malware kan je wachtwoord niet meer stelen
   - Browser extensions kunnen niet bij credentials

2. **HttpOnly cookies**
   - JavaScript kan session cookie niet lezen
   - XSS attacks kunnen sessie niet stelen

3. **SameSite cookies**
   - CSRF attacks worden voorkomen
   - Cookie wordt niet meegestuurd naar andere sites

4. **Auto-expiry**
   - Sessies verlopen automatisch na 24 uur
   - Vergeten uit te loggen? Geen probleem!

5. **Rate limiting op login**
   - Brute-force attacks zijn veel moeilijker
   - 5 pogingen per minuut maximum

6. **Server-side session management**
   - Logout vernietigt sessie onmiddellijk
   - Geen "rogue tokens" mogelijk

---

## ⚙️ CONFIGURATIE OPTIES

### Session Lifetime Aanpassen

In `api_proxy.py`, regel ~49:

```python
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)  # Pas aan!
```

Voorbeelden:
- 8 uur: `timedelta(hours=8)`
- 2 dagen: `timedelta(days=2)`
- 1 week: `timedelta(weeks=1)`

### HTTPS Aanzetten (Aanbevolen!)

Als je HTTPS gebruikt (via reverse proxy of Let's Encrypt):

```bash
# In .env:
SESSION_COOKIE_SECURE=true

# In ALLOWED_ORIGINS:
ALLOWED_ORIGINS=https://bunq.jouw-domein.nl
```

**⚠️ LET OP:** Met `SESSION_COOKIE_SECURE=true` werkt login ALLEEN via HTTPS!

### Rate Limits Aanpassen

In `api_proxy.py`, regel ~124:

```python
rate_limiter = RateLimiter(
    max_requests=30,      # Algemene endpoints
    window_seconds=60
)
```

En regel ~149 voor login:

```python
max_reqs = 5 if endpoint == 'login' else self.max_requests  # Login limiet
```

---

## 🐛 TROUBLESHOOTING

### Probleem: "Session expired" direct na login

**Oorzaak:** `bunq_flask_secret_key` secret ontbreekt of wijzigt bij restart

**Oplossing:**
```bash
# Check secrets:
docker secret ls | grep bunq_flask_secret_key

# Als ontbreekt:
python3 -c "import secrets; print(secrets.token_hex(32))" | sudo docker secret create bunq_flask_secret_key -

# Redeploy:
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

### Probleem: "CORS error" na update

**Oorzaak:** ALLOWED_ORIGINS mist je frontend URL

**Oplossing:**
```bash
# In .env:
ALLOWED_ORIGINS=http://192.168.1.100:5000

# Herstart (reload .env):
set -a; source .env; set +a
sudo -E docker stack deploy -c docker-compose.yml bunq
```

### Probleem: Login modal verschijnt niet

**Oorzaak:** HTML of JavaScript niet correct geupdate

**Oplossing:**
```bash
# Check of loginModal element bestaat:
# Open browser console:
document.getElementById('loginModal')
# Moet een element returnen, niet null

# Check of app.js wordt gebruikt:
# In browser Sources tab → check app.js bevat:
"async function checkAuthStatus()"
```

### Probleem: "Rate limit exceeded" na paar pogingen

**Oorzaak:** Dit is normaal gedrag! (5 login pogingen/min)

**Oplossing:**
```bash
# Optie 1: Wacht 60 seconden
# Optie 2: Herstart container (reset rate limiter):
docker service update --force bunq_bunq-dashboard

# Optie 3: Verhoog limiet in code (niet aanbevolen)
```

### Probleem: Sessions blijven niet bewaard

**Oorzaak:** Cookie wordt niet geaccepteerd door browser

**Check:**
1. Browser settings → Cookies allowed?
2. Third-party cookies blocked? (kan problemen geven)
3. Incognito mode? (cookies worden niet bewaard)

**Oplossing:**
```bash
# Test met verschillende browser
# Check browser console voor cookie warnings
```

---

## 📊 VOOR/NA VERGELIJKING

| Aspect | Basic Auth (localStorage) | Session Auth (Cookies) |
|--------|---------------------------|------------------------|
| **Credentials Storage** | ❌ localStorage (Base64) | ✅ Secure cookie (encrypted) |
| **JavaScript Access** | ❌ Ja (kwetsbaar) | ✅ Nee (HttpOnly) |
| **CSRF Protection** | ❌ Geen | ✅ SameSite cookie |
| **Auto Expiry** | ❌ Nooit | ✅ 24 uur |
| **Rate Limiting** | ⚠️ Algemeen (30/min) | ✅ Login (5/min) |
| **Logout Security** | ❌ Client-side alleen | ✅ Server-side sessie destroy |
| **Multi-tab Support** | ✅ Ja | ✅ Ja |
| **Security Level** | ⭐⭐⭐ Goed | ⭐⭐⭐⭐⭐ Excellent |

---

## ✅ FINAL CHECKLIST

Na installatie, controleer:

- [ ] Secret `bunq_flask_secret_key` aangemaakt (64 chars random)
- [ ] Secret `bunq_basic_auth_password` is sterk (min. 12 chars)
- [ ] `ALLOWED_ORIGINS` bevat je NAS IP/domein
- [ ] Login modal verschijnt bij klikken login button
- [ ] Login werkt met correcte credentials
- [ ] Na login zie je username + logout button
- [ ] "Use real data" laadt Bunq transacties
- [ ] Logout werkt en toont demo data
- [ ] Session blijft bewaard bij refresh (binnen 24h)
- [ ] Geen wachtwoord zichtbaar in browser localStorage
- [ ] Rate limiting werkt (5 failed logins = block)
- [ ] Container logs tonen "ENABLED ✅"

---

## 🎉 KLAAR!

Je Bunq Dashboard gebruikt nu **session-based authentication**!

**Voordelen die je nu hebt:**
- 🔒 Geen credentials in localStorage
- 🍪 Secure HttpOnly cookies
- ⏱️ Auto-expiry (24 uur)
- 🚫 CSRF bescherming
- 🔐 Rate-limited login
- 👋 Proper logout functionaliteit

**Better safe than sorry!** 🛡️

---

## 📞 Support

Bij problemen:
1. Check de logs: `docker service logs -f bunq_bunq-dashboard`
2. Verify .env settings
3. Test in verschillende browser
4. Open GitHub issue met logs

**Enjoy your ultra-secure Bunq Dashboard!** 💰🔐
