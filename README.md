# 💰 Bunq Financial Dashboard

**Spectaculaire visualisaties van je Bunq transactiedata**

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bunq API](https://img.shields.io/badge/Bunq-API-orange.svg)](https://doc.bunq.com/)

> 🚀 Krachtige, interactieve financiële analytics met real-time Bunq API integratie

![Dashboard Preview](https://via.placeholder.com/1200x600/667eea/ffffff?text=Bunq+Financial+Dashboard)

---

## ✨ Features

- 🎨 **Glassmorphism Design** - Modern blur & transparantie effecten
- 📊 **11+ Visualisaties** - Sankey, Sunburst, 3D Time-Travel, en meer
- 🔄 **Real-time Data** - Direct gekoppeld aan Bunq API
- 📱 **Fully Responsive** - Van mobiel tot 4K schermen
- 🌓 **Dark/Light Mode** - Toggle tussen thema's
- 🔒 **Veilig** - API keys blijven server-side
- 🏠 **NAS Ready** - Host op je eigen infrastructuur

---

## 🚀 Quick Start

### Kies je editie:

1. **🌐 Web Dashboard** (Aanbevolen voor productie)
   - Host op je NAS
   - Toegankelijk vanaf elk device
   - Premium glassmorphism design
   - [→ Start met Web Dashboard](README_WEB.md)

2. **📓 Jupyter Notebook** (Voor data analyse)
   - Ideaal voor experimenten
   - Alle visualisaties in één notebook
   - Google Colab compatible
   - [→ Start met Jupyter Notebook](JUPYTER_README.md)

---

## 📊 Visualisaties

### Beschikbaar in beide versies:

1. **💰 KPI Cards** - Income, Expenses, Savings, Rates
2. **📈 Cashflow Timeline** - Interactieve tijdlijn
3. **🌊 Sankey Diagram** - Visualiseer geldstromen
4. **⭕ Sunburst Chart** - Hierarchische breakdown
5. **🚀 3D Time-Space** - Geanimeerde tijdreis
6. **🔥 Heatmap** - Dag-van-week patronen
7. **🏪 Top Merchants** - Waar geef je het meest uit
8. **🏔️ Ridge Plot** - Joy Division style distributie
9. **🏁 Racing Bar** - Animated category competition
10. **🎯 Insights Cards** - AI-powered inzichten

---

## 📦 Installatie

### Web Dashboard (Productie)

```bash
# 1. Clone repository
git clone https://github.com/richardvankampen/Bunq-Jupyter.git
cd Bunq-Jupyter

# 2. Installeer dependencies
pip install -r requirements_web.txt

# 3. Set API key
export BUNQ_API_KEY="your_api_key_here"

# 4. Start backend
python api_proxy.py

# 5. Open index.html in browser
python -m http.server 8000
```

### Jupyter Notebook (Analyse)

```bash
# 1. Clone repository
git clone https://github.com/richardvankampen/Bunq-Jupyter.git
cd Bunq-Jupyter

# 2. Open in Jupyter of Google Colab
jupyter lab bunq_visualization.ipynb
```

**Voor Google Colab:** Upload notebook en sla API key op in Colab Secrets

---

## 🐳 Docker Deployment

```bash
# Build image
docker build -t bunq-dashboard .

# Run container
docker run -d \
  -p 8000:8000 \
  -p 5000:5000 \
  -e BUNQ_API_KEY="your_key" \
  --name bunq-dashboard \
  bunq-dashboard
```

---

## 🔒 Veiligheid

### Best Practices

✅ **API Key Management**
- Gebruik environment variables
- Nooit committen naar Git
- Rotate keys regelmatig

✅ **HTTPS**
- Gebruik SSL voor productie
- Let's Encrypt voor gratis certificates

✅ **Firewall**
- Beperk access tot lokaal netwerk
- Of gebruik VPN voor remote access

✅ **Authentication**
- Overweeg basic auth voor dashboard
- IP whitelisting mogelijk

---

## 📱 Platform Support

| Platform | Web Dashboard | Jupyter Notebook |
|----------|---------------|------------------|
| 🖥️ Desktop | ✅ Perfect | ✅ Perfect |
| 📱 Mobile | ✅ Optimized | ⚠️ Basic |
| 📺 TV Display | ✅ 4K Ready | ❌ |
| 🏠 NAS | ✅ Native | ⚠️ Via Docker |
| ☁️ Cloud | ✅ Any VPS | ✅ Google Colab |

---

## 🎨 Customization

### Kleuren aanpassen

In `styles.css`:
```css
:root {
    --accent-primary: #667eea;  /* Your color */
    --accent-success: #10b981;  /* Your color */
}
```

### Logo vervangen

In `index.html`:
```html
<div class="logo-icon">
    <img src="your-logo.png">
</div>
```

---

## 🛠️ Tech Stack

**Frontend:**
- HTML5 + CSS3 (Glassmorphism)
- JavaScript (ES6+)
- Plotly.js - Interactive charts
- Chart.js - Sparklines
- Particles.js - Animated background

**Backend:**
- Python 3.8+
- Flask - REST API
- bunq-sdk-python - Official SDK

**Analytics:**
- Jupyter Notebook
- Pandas - Data manipulation
- NumPy - Numerical computing

---

## 📚 Documentatie

- [Web Dashboard Guide](README_WEB.md)
- [Jupyter Notebook Guide](JUPYTER_README.md)
- [API Documentatie](API_DOCS.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Troubleshooting](TROUBLESHOOTING.md)

---

## 🐛 Known Issues

- [ ] Racing bar animation needs optimization for large datasets
- [ ] Safari iOS has minor CSS rendering issue
- [ ] Chord diagram requires manual refresh in some cases

[→ Report bugs](https://github.com/richardvankampen/Bunq-Jupyter/issues)

---

## 🗺️ Roadmap

### v2.0 (Planned)
- [ ] Budget tracking & alerts
- [ ] Email/Telegram notifications
- [ ] Export to PDF/Excel
- [ ] Multi-user support
- [ ] Machine learning insights
- [ ] Mobile app (React Native)
- [ ] Home Assistant integration

[→ View full roadmap](ROADMAP.md)

---

## 🤝 Contributing

Contributions zijn welkom! Please:

1. Fork het project
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

[→ Contributing Guidelines](CONTRIBUTING.md)

---

## 📄 License

Dit project is gelicenseerd onder de MIT License - zie [LICENSE](LICENSE) voor details.

---

## 🙏 Acknowledgments

- [Bunq](https://www.bunq.com/) - Voor de geweldige API
- [Plotly](https://plotly.com/) - Visualisatie library
- [Flask](https://flask.palletsprojects.com/) - Web framework
- Community contributors

---

## 📞 Support

- 💬 [GitHub Discussions](https://github.com/richardvankampen/Bunq-Jupyter/discussions)
- 🐛 [Issues](https://github.com/richardvankampen/Bunq-Jupyter/issues)
- 📧 Email: [your-email@example.com]
- 💬 Discord: [Your Discord Server]

---

## ⭐ Show Your Support

Als je dit project nuttig vindt, geef het een ⭐ op GitHub!

---

## 📸 Screenshots

### Web Dashboard
![Dashboard](https://via.placeholder.com/800x400/667eea/ffffff?text=Dashboard+Overview)

### Visualisaties
![Sankey](https://via.placeholder.com/800x400/764ba2/ffffff?text=Sankey+Diagram)
![3D Chart](https://via.placeholder.com/800x400/10b981/ffffff?text=3D+Time+Travel)

---

## 💡 Use Cases

### Personal Finance
- Track spending patterns
- Optimize savings rate
- Identify expense categories

### Business Analytics
- Company expense tracking
- Department budgets
- Vendor analysis

### Financial Planning
- Budget vs actual comparison
- Trend analysis
- Forecasting

---

**Made with ❤️ and lots of ☕**

*Geniet van je Bunq Dashboard!* 🚀

---

## 🔗 Links

- [Bunq API Documentation](https://doc.bunq.com/)
- [Bunq Community](https://together.bunq.com/)
- [Python SDK GitHub](https://github.com/bunq/sdk_python)

---

**Last Updated:** February 2026
**Version:** 1.0.0
