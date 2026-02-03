# 💰 Bunq Financial Dashboard

**Spectaculaire web-based visualisaties van je Bunq transactiedata**

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bunq API](https://img.shields.io/badge/Bunq-READ--ONLY-orange.svg)](https://doc.bunq.com/)
[![Security](https://img.shields.io/badge/Security-Vaultwarden-green.svg)](https://github.com/dani-garcia/vaultwarden)

> 🚀 Professionele, veilige financiële analytics met real-time Bunq API integratie
> 
> 🔒 Security-first design met Vaultwarden secret management
> 
> 🏠 Optimized voor Synology NAS deployment

---

## ✨ Features

- 🎨 **Glassmorphism Design** - Modern UI met blur effecten
- 📊 **11+ Visualisaties** - Sankey, Sunburst, 3D Time-Travel
- 🔄 **Real-time Data** - Direct van Bunq API (READ-ONLY)
- 📱 **Fully Responsive** - Mobiel tot 4K
- 🔒 **Vaultwarden Integratie** - Secrets veilig opgeslagen
- 🏠 **Synology Ready** - One-click deployment

---

## 🏠 Synology NAS Deployment

### Quick Start (15 minuten)

**Stap 1: Installeer Container Manager**
```
Control Panel → Package Center → Zoek "Container Manager" → Install
```

**Stap 2: Deploy via Deze Guide**

Volg de complete instructies hieronder →

---

## 📚 Complete Installatie Guide

Zie [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md) voor:
- ✅ Stap-voor-stap Vaultwarden setup
- ✅ Dashboard deployment met Docker
- ✅ Security hardening
- ✅ Troubleshooting guide

---

## 📊 Visualisaties

1. **💰 KPI Cards** - Income, Expenses, Savings
2. **📈 Cashflow Timeline** - Interactieve tijdlijn  
3. **🌊 Sankey Diagram** - Geldstromen
4. **⭕ Sunburst Chart** - Hierarchische breakdown
5. **🚀 3D Time-Space** - Geanimeerde tijdreis
6. **🔥 Heatmap** - Dag-van-week patronen
7. **🏪 Top Merchants** - Top uitgaven
8. **🏔️ Ridge Plot** - Distributie visualisatie
9. **🏁 Racing Bar** - Animated competitie
10. **🎯 Insights** - Auto-calculated

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

### 🔐 Vaultwarden Integration
- API keys in encrypted vault
- Runtime secret retrieval
- Zero plain-text storage
- Easy key rotation

---

## 🐳 Docker Deployment

```bash
# Clone repo
git clone https://github.com/richardvankampen/Bunq-Jupyter.git
cd Bunq-Jupyter

# Configure
cp .env.example .env
# Edit .env with your Vaultwarden credentials

# Start
docker-compose up -d

# Open
http://your-nas-ip:8000
```

---

## 📖 Documentation

- [Synology Installation Guide](SYNOLOGY_INSTALL.md)
- [Vaultwarden Setup](VAULTWARDEN_SETUP.md)
- [Security Best Practices](SECURITY.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [API Documentation](API_DOCS.md)

---

## 🐛 Troubleshooting

**Container won't start?**
```bash
docker logs bunq-dashboard
```

**Vaultwarden connection failed?**
- Check container is running
- Verify client_id/secret correct
- Check network connectivity

**Dashboard not accessible?**
- Check firewall rules
- Verify port 8000 not blocked
- Check container logs

---

## 🤝 Contributing

Pull requests welkom! See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📄 License

MIT License - See [LICENSE](LICENSE)

---

## ⭐ Support

Als je dit project nuttig vindt, geef het een ⭐!

---

**Made with ❤️ for Bunq users**

*Veilig, mooi, en production-ready!* 🚀
