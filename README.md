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

---

## 🧭 Documentation Map

- **Start here (overview):** This README
- **Synology install (full guide):** [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)
- **Security hardening:** [SECURITY.md](SECURITY.md)
- **Troubleshooting:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

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

---

## 🐳 Docker Deployment (Advanced)

```bash
# Clone repo
git clone https://github.com/richardvankampen/Bunq-dashboard-web.git
cd Bunq-dashboard-web

# Configure environment
cp .env.example .env
# Edit .env with non-secret settings:
#   - ALLOWED_ORIGINS (your NAS IP or domain)
#   - VAULTWARDEN_URL / VAULTWARDEN_ITEM_NAME
#   - USE_VAULTWARDEN / BUNQ_ENVIRONMENT

# One-time: initialize Swarm
docker swarm init

# One-time: create attachable network
docker network create --driver overlay --attachable bunq-net
# If it already exists, you can ignore the error.

# If Vaultwarden runs as standalone container, attach it:
docker network connect bunq-net vaultwarden
# If already attached, you can ignore the error.

# Create Docker secrets
printf "YourStrongPassword" | docker secret create bunq_basic_auth_password -
python3 -c "import secrets; print(secrets.token_hex(32))" | docker secret create bunq_flask_secret_key -
printf "user.xxxx-xxxx-xxxx-xxxx" | docker secret create bunq_vaultwarden_client_id -
printf "your_vaultwarden_client_secret" | docker secret create bunq_vaultwarden_client_secret -

# Build image
docker build -t bunq-dashboard:local .

# Load .env into your shell for variable substitution
set -a; source .env; set +a

# Deploy stack
docker stack deploy -c docker-compose.yml bunq

# Note: Vaultwarden must be running separately (see SYNOLOGY_INSTALL.md)
# Ensure it's attached to bunq-net and reachable as http://vaultwarden:80
# Not on Synology? Update bind-mount paths in docker-compose.yml to valid local paths.

# Check logs
docker service logs -f bunq_bunq-dashboard

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

## 🔒 Security (Short)

- Session-based auth with HttpOnly cookies and CSRF protection.
- Read-only Bunq API usage.
- Secrets via Vaultwarden + Docker Swarm.
- VPN-only access (no public exposure).

Full details and hardening: [SECURITY.md](SECURITY.md)

---

## 📖 Complete Documentation

- **[🏠 Synology Installation Guide](SYNOLOGY_INSTALL.md)** - Complete stap-voor-stap setup
- **[🔒 Security Best Practices](SECURITY.md)** - Security checklist en hardening tips

---

## 🐛 Troubleshooting

### Container won't start?
```bash
# Check logs
docker service logs bunq_bunq-dashboard

# Common fixes:
docker build -t bunq-dashboard:local .
set -a; source .env; set +a
docker stack deploy -c docker-compose.yml bunq
```

### Vaultwarden connection failed?
```bash
# Test connectivity
docker exec $(docker ps --filter name=bunq_bunq-dashboard -q | head -n1) ping vaultwarden

# Check Vaultwarden running
docker ps | grep vaultwarden

# Verify credentials in .env
cat .env | grep VAULTWARDEN
docker secret ls | grep bunq_vaultwarden_client
```

### Dashboard not accessible?
1. Check VPN connection active
2. Verify firewall rules (allow port 5000)
3. Check container logs: `docker service logs bunq_bunq-dashboard`
4. Test health endpoint: `curl http://localhost:5000/api/health`

### Authentication fails?
```bash
# Verify credentials in .env
cat .env | grep BASIC_AUTH_USERNAME

# Check secrets exist
docker secret ls | grep bunq_

# Restart (reload .env)
set -a; source .env; set +a
docker stack deploy -c docker-compose.yml bunq
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
`.env` bevat alleen niet‑gevoelige waarden; secrets gaan via Docker Swarm.

**Kritieke Docker secrets:**
- `bunq_flask_secret_key` - Voor session encryption (64 chars random hex)
- `bunq_basic_auth_password` - Dashboard login wachtwoord
- `bunq_vaultwarden_client_id` - Voor API key retrieval
- `bunq_vaultwarden_client_secret` - Voor API key retrieval
- `bunq_api_key` - Alleen als `USE_VAULTWARDEN=false`

**Belangrijke .env variabelen:**
- `ALLOWED_ORIGINS` - CORS policy (je NAS IP)
- `USE_VAULTWARDEN` - Vaultwarden aan/uit
- `CACHE_ENABLED` - Cache API responses (true/false)
- `CACHE_TTL_SECONDS` - Cache TTL in seconden
- `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` - Paginatie voor transactions
- `MAX_DAYS` - Maximale tijdsrange voor requests

**Genereer secret key (voor secret):**
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
