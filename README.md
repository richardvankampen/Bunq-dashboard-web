# 💰 Bunq Financial Dashboard

**Spectaculaire web-based visualisaties van je Bunq transactiedata**

[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bunq API](https://img.shields.io/badge/Bunq-READ--ONLY-orange.svg)](https://doc.bunq.com/)
[![Security](https://img.shields.io/badge/Security-Session--Based-green.svg)](https://github.com/dani-garcia/vaultwarden)

> 🚀 Professionele, veilige financiële analytics met real-time Bunq API integratie
> 
> 🔒 Security-first design met session-based authentication & Vaultwarden secret management
> 
> 🏠 Optimized voor Synology NAS deployment

⚠️ **IMPORTANT:** Access ONLY via VPN for security. NEVER forward ports to the internet!

---

## 🔐 Security Model

Deze repository gebruikt **standaard session-based authentication**:

- **Bestanden:** `api_proxy.py` + `app.js`
- **Security:** HttpOnly cookies, CSRF protection, auto-expiry (24h)
- **Voor:** Productie gebruik
- **Guide:** [SESSION_AUTH_INSTALL.md](SESSION_AUTH_INSTALL.md)

---

## ✨ Features

- 🎨 **Glassmorphism Design** - Modern UI met blur effecten
- 📊 **11+ Visualisaties** - Sankey, Sunburst, 3D Time-Travel
- 🔄 **Real-time Data** - Direct van Bunq API (READ-ONLY)
- 📱 **Fully Responsive** - Mobiel tot 4K
- 🔌 **Single-Port Deployment** - Frontend + API op poort 5000
- 🔒 **Vaultwarden Integratie** - Secrets veilig opgeslagen
- 🔐 **Session-Based Auth** - HttpOnly cookies, CSRF protection
- 🏠 **Synology Ready** - One-click deployment
- 🛡️ **VPN Required** - Maximum security

---

## 🚀 Quick Start (15 minuten)

### Synology NAS Deployment

**Stap 1: Installeer Container Manager**
```
Control Panel → Package Center → Zoek "Container Manager" → Install
```

**Stap 2: Setup VPN (KRITIEK voor security)**
```
Control Panel → Network → VPN Server → Install OpenVPN
Volg wizard → Genereer client config → Installeer op je devices
```

**Stap 3: Deploy Dashboard**

Volg de complete instructies in → [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)

De frontend en API draaien samen op poort 5000 (`/` en `/api`).

**Stap 4: (Alleen bij upgrade) Session Authentication**

Gebruik je een **oude installatie** (localStorage/basic auth)? Volg dan → [SESSION_AUTH_INSTALL.md](SESSION_AUTH_INSTALL.md)  
Nieuwe installs gebruiken dit al standaard.

---

## 🐳 Docker Deployment (Advanced)

```bash
# Clone repo
git clone https://github.com/richardvankampen/Bunq-dashboard-web.git
cd Bunq-dashboard-web

# Configure environment
cp .env.example .env
# Edit .env with your settings:
#   - FLASK_SECRET_KEY (generate with: python3 -c "import secrets; print(secrets.token_hex(32))")
#   - BASIC_AUTH_PASSWORD (strong password!)
#   - VAULTWARDEN credentials
#   - Your NAS IP in ALLOWED_ORIGINS

# Start containers
docker-compose up -d

# Note: Vaultwarden must be running separately (see SYNOLOGY_INSTALL.md)
# Not on Synology? Update bind-mount paths in docker-compose.yml to valid local paths.

# Check logs
docker-compose logs -f

# Access dashboard (via VPN!)
# http://your-nas-ip:5000
```

---

## 📊 Visualisaties

1. **💰 KPI Cards** - Income, Expenses, Savings
2. **📈 Cashflow Timeline** - Interactieve tijdlijn  
3. **🌊 Sankey Diagram** - Geldstromen visualisatie
4. **⭕ Sunburst Chart** - Hierarchische breakdown
5. **🚀 3D Time-Space** - Geanimeerde tijdreis
6. **🔥 Heatmap** - Dag-van-week patronen
7. **🏪 Top Merchants** - Top uitgaven
8. **🏔️ Ridge Plot** - Distributie visualisatie
9. **🏁 Racing Bar** - Animated competitie
10. **🎯 Insights** - Auto-calculated insights
11. **📊 Custom Charts** - Aanpasbare grafieken

---

## 🔒 Security

### ✅ Read-Only API
```python
# ALLEEN deze operations worden gebruikt:
MonetaryAccountBank.list()  # ✅ READ
Payment.list()               # ✅ READ  
User.get()                   # ✅ READ

# NOOIT gebruikt:
Payment.create()            # ❌ DISABLED
DraftPayment.create()       # ❌ DISABLED
```

### 🔐 Session-Based Authentication (Aanbevolen)
- ✅ HttpOnly cookies (JavaScript kan niet bij credentials)
- ✅ CSRF protection (SameSite cookies)
- ✅ Auto-expiry (24 uur)
- ✅ Rate limiting (5 login attempts/min)
- ✅ Constant-time password comparison
- ✅ Server-side session management

### 🛡️ Vaultwarden Integration
- ✅ API keys in encrypted vault
- ✅ Runtime secret retrieval
- ✅ Zero plain-text storage
- ✅ Easy key rotation
- ✅ Audit logging

### 🌐 VPN Requirement
**⚠️ CRITICAL:** Access dashboard ONLY via VPN!

- ✅ Never forward port 5000 on your router
- ✅ Use Synology VPN Server (OpenVPN/L2TP)
- ✅ Strong VPN passwords
- ✅ Two-factor authentication where possible

**Remark (SRI/CDN):** Subresource Integrity is useful for public-facing apps, but for a VPN-only, single-user setup the practical risk is low. We intentionally keep Google Fonts on the CDN without SRI to avoid extra complexity. If you expose this publicly or add users, reconsider SRI or self-hosting fonts.

**VPN-only verification checklist:**
1. From a phone on **5G without VPN**, run: `curl -vk --connect-timeout 5 https://your-subdomain.your-domain`
2. Expected result: **timeout / no response** (good). Any HTML/headers means it’s publicly reachable (bad).
3. From **LAN/Wi-Fi**, you may see a certificate warning if you use a self-signed cert. That’s normal for internal access.
4. From **VPN**, the dashboard should load at `https://your-subdomain.your-domain`.

---

## 📖 Complete Documentation

- **[🏠 Synology Installation Guide](SYNOLOGY_INSTALL.md)** - Complete stap-voor-stap setup
- **[🔐 Session Authentication Guide](SESSION_AUTH_INSTALL.md)** - Upgrade naar session-based auth
- **[🔒 Security Best Practices](SECURITY.md)** - Security checklist en hardening tips

---

## 🐛 Troubleshooting

### Container won't start?
```bash
# Check logs
docker-compose logs bunq-dashboard

# Common fixes:
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Vaultwarden connection failed?
```bash
# Test connectivity
docker exec bunq-dashboard ping vaultwarden

# Check Vaultwarden running
docker ps | grep vaultwarden

# Verify credentials in .env
cat .env | grep VAULTWARDEN
```

### Dashboard not accessible?
1. Check VPN connection active
2. Verify firewall rules (allow port 5000)
3. Check container logs: `docker logs bunq-dashboard`
4. Test health endpoint: `curl http://localhost:5000/api/health`

### Authentication fails?
```bash
# Verify credentials in .env
cat .env | grep BASIC_AUTH

# Check Flask secret key is set (64 chars)
cat .env | grep FLASK_SECRET_KEY

# Restart container
docker-compose restart bunq-dashboard
```

### Demo data keeps loading (no real data)?
1. Check Bunq API key in Vaultwarden
2. Verify `USE_VAULTWARDEN=true` in .env
3. Check logs for Vaultwarden connection errors
4. Enable "Use real Bunq data" in settings (if using session auth)

Voor meer troubleshooting, zie de volledige installatie guides.

---

## ⚙️ Configuration

### Environment Variables

Zie [.env.example](.env.example) voor een complete lijst met alle configuratie opties.

**Kritieke variabelen:**
- `FLASK_SECRET_KEY` - Voor session encryption (64 chars random hex)
- `BASIC_AUTH_PASSWORD` - Dashboard login wachtwoord
- `VAULTWARDEN_CLIENT_ID` - Voor API key retrieval
- `VAULTWARDEN_CLIENT_SECRET` - Voor API key retrieval
- `ALLOWED_ORIGINS` - CORS policy (je NAS IP)
- `CACHE_ENABLED` - Cache API responses (true/false)
- `CACHE_TTL_SECONDS` - Cache TTL in seconden
- `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` - Paginatie voor transactions
- `MAX_DAYS` - Maximale tijdsrange voor requests

**Genereer secret key:**
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## 🔧 Development

### Setup Local Development

```bash
# Clone repo
git clone https://github.com/richardvankampen/Bunq-dashboard-web.git
cd Bunq-dashboard-web

# Install Python dependencies
pip install -r requirements_web.txt

# Run locally (demo mode)
python api_proxy.py

# Session auth (default)
python api_proxy.py

# Access: http://localhost:5000
```

### Testing

```bash
# Test API health
curl http://localhost:5000/api/health

# Test authentication (session version)
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}' \
  http://localhost:5000/api/auth/login

# Use session cookie for authenticated requests
curl -b cookies.txt http://localhost:5000/api/accounts
```

### API Parameters (Transactions)

`/api/transactions` ondersteunt pagination en caching:
- `page` / `page_size` (default `page=1`)
- of `limit` / `offset`
- `sort=asc|desc`
- `days=90`
- `cache=false` om cache te omzeilen

---

## 🤝 Contributing

Contributions zijn welkom! Voor nu:

1. Fork het project
2. Maak een feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit je changes (`git commit -m 'Add some AmazingFeature'`)
4. Push naar de branch (`git push origin feature/AmazingFeature`)
5. Open een Pull Request

**Development Guidelines:**
- Follow existing code style
- Add comments for complex logic
- Test thoroughly before submitting
- Update documentation when needed

---

## 📄 License

MIT License - See [LICENSE](LICENSE)

---

## ⭐ Support

Als je dit project nuttig vindt:
- Geef het een ⭐ op GitHub
- Share met andere Bunq users
- Contribute met verbeteringen

---

## 📞 Contact & Support

**Voor vragen of problemen:**
1. Check eerst de documentatie (guides hierboven)
2. Bekijk de troubleshooting sectie
3. Open een GitHub Issue met:
   - Beschrijving van het probleem
   - Log output (`docker-compose logs`)
   - Je configuratie (zonder credentials!)

**Community:**
- GitHub Issues: [Create Issue](https://github.com/richardvankampen/Bunq-dashboard-web/issues)
- GitHub Discussions: [Join Discussion](https://github.com/richardvankampen/Bunq-dashboard-web/discussions)

---

## 🎯 Roadmap

Planned features:
- [ ] Automated backups
- [ ] Budget management
- [ ] Multi-user support
- [ ] Mobile app
- [ ] Advanced analytics
- [ ] Export functionality
- [ ] Custom alerts

---

## 🙏 Acknowledgments

- **Bunq** - Voor de excellent API
- **Vaultwarden** - Voor secure secret management
- **Synology** - Voor de stabiele NAS platform
- **Community** - Voor feedback en contributions

---

**Made with ❤️ for Bunq users**

*Veilig, mooi, en production-ready!* 🚀

**Version:** 3.0.0 (Session Auth)  
**Last Updated:** February 2026  
**Status:** ✅ Production Ready
