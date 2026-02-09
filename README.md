# 💰 Bunq Financial Dashboard

**Veilige web-based visualisaties van je Bunq transactiedata (Synology-first)**
Read-only dashboard dat data uit de Bunq API haalt en overzichtelijk visualiseert.

⚠️ **IMPORTANT:** Access ONLY via VPN. NEVER forward ports to the internet.

---

## ✨ Belangrijkste Features

- Single-port dashboard (frontend + API) op poort 5000
- Real-time data uit de Bunq API (read-only)
- 11+ visualisaties (cashflow, trends, categorieën)
- Caching en pagination voor performance
- Synology‑ready deployment

**Visualisaties:**
- KPI Cards (inkomsten/uitgaven/sparen)
- Cashflow timeline
- Sankey diagram (geldstromen)
- Sunburst (categorieën)
- 3D time-space chart
- Heatmap (dag/uur)
- Top merchants
- Ridge plot (distributie)
- Racing bar chart
- Insights (automatisch)
- Custom charts

## 🔒 Security (Kort)

- Session-based auth met HttpOnly cookies en CSRF‑bescherming
- Secrets via Vaultwarden + Docker Swarm secrets
- VPN‑only toegang, geen publieke exposure
- Rate limiting op login en API
Meer details: [SECURITY.md](SECURITY.md)

## 🚀 Quick Start (Synology)

1. Installeer **Container Manager** (Package Center)
2. Zorg voor **VPN-only toegang** (geen publieke exposure)
3. Volg de volledige installatieguide: [SYNOLOGY_INSTALL.md](SYNOLOGY_INSTALL.md)

---

## 📄 License

MIT License - See [LICENSE](LICENSE)
