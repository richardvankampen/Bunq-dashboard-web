# 🚀 Bunq Financial Dashboard - Web Edition

## Spectaculaire, Interactieve Web Dashboard voor Bunq Financiën

Een volledig responsive, glassmorphism-styled web dashboard met real-time Bunq API integratie, geanimeerde visualisaties, en WOW-factor design.

---

## ✨ Features

### 🎨 Design & UX
- **Glassmorphism Effect** - Modern blur en transparantie design
- **Dark/Light Mode** - Toggle tussen thema's
- **Animated Background** - Particles.js voor dynamische achtergrond
- **Responsive Design** - Werkt perfect op mobiel, tablet, desktop én 4K
- **Smooth Animations** - AOS (Animate On Scroll) effecten
- **Premium Typography** - Inter & JetBrains Mono fonts

### 📊 Visualisaties (11+)
1. **KPI Cards** met sparklines (4 cards)
2. **Cashflow Timeline** - Interactieve lijndiagram
3. **Sankey Diagram** - Geldstromen visualisatie
4. **Sunburst Chart** - Hierarchische breakdown
5. **3D Time-Space Travel** - Geanimeerde 3D scatter
6. **Heatmap** - Dag-van-week patronen
7. **Top Merchants** - Bar chart
8. **Ridge Plot** - Monthly distributions
9. **Racing Bar Chart** - Geanimeerde competitie
10. **Insights Cards** - AI-powered inzichten

### 🔧 Functionaliteit
- **Refresh Button** - Update data on-demand
- **Time Range Selector** - Filter per periode
- **Settings Modal** - Configureerbaar
- **Auto-refresh** - Optionele automatische updates
- **Export Ready** - Screenshot & print optimized
- **Fullscreen Visualizations** - Expand any chart

---

## 🖥️ Architectuur

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  📱 Frontend (Static HTML/JS)                   │
│  ├── index.html     - Main dashboard           │
│  ├── styles.css     - Glassmorphism styling    │
│  └── app.js         - Interactivity & charts   │
│                                                 │
└────────────┬────────────────────────────────────┘
             │ HTTPS/API Calls
             ↓
┌─────────────────────────────────────────────────┐
│                                                 │
│  🐍 Backend (Flask Python API)                  │
│  └── api_proxy.py   - Secure Bunq API wrapper  │
│                                                 │
└────────────┬────────────────────────────────────┘
             │ SDK Calls
             ↓
┌─────────────────────────────────────────────────┐
│                                                 │
│  🏦 Bunq API (bunq-sdk-python)                  │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 📦 Installatie

### Vereisten
- **NAS** met Docker support (Synology, QNAP, etc.) OF Linux server
- **Python 3.8+** voor backend
- **Bunq API Key** (verkrijg via Bunq app)
- **Moderne browser** (Chrome, Firefox, Safari, Edge)

### Stap 1: Download Bestanden

```bash
# Clone of download dit project
cd /volume1/web/bunq-dashboard  # Pas pad aan voor jouw NAS
```

Zorg dat je deze bestanden hebt:
- `index.html`
- `styles.css`
- `app.js`
- `api_proxy.py`
- `requirements.txt`

### Stap 2: Python Backend Installeren

```bash
# Installeer Python dependencies
pip3 install -r requirements.txt

# Of met virtual environment (aanbevolen)
python3 -m venv venv
source venv/bin/activate  # Op Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Stap 3: Bunq API Key Configureren

**Verkrijg API Key:**
1. Open Bunq app op je telefoon
2. Profiel → Security & Settings → Developers
3. API Keys → + Add API Key
4. Naam: "NAS Dashboard"
5. Kopieer de key

**Stel environment variable in:**

```bash
# Linux/Mac/NAS
export BUNQ_API_KEY="your_api_key_here"

# Windows PowerShell
$env:BUNQ_API_KEY="your_api_key_here"

# Of maak een .env bestand
echo "BUNQ_API_KEY=your_api_key_here" > .env
```

### Stap 4: Start Backend API

```bash
python3 api_proxy.py
```

Je zou moeten zien:
```
🚀 Starting Bunq Dashboard API...
📡 Environment: PRODUCTION
✅ Bunq API initialized
 * Running on http://0.0.0.0:5000
```

### Stap 5: Start Frontend

**Optie A: Via Python HTTP Server**
```bash
# In een andere terminal
python3 -m http.server 8000
```

**Optie B: Via NAS Web Station**
- Upload `index.html`, `styles.css`, `app.js` naar je web root
- Toegankelijk via: `http://your-nas-ip/bunq-dashboard`

**Optie C: Via NGINX/Apache**
```nginx
# NGINX config voorbeeld
server {
    listen 80;
    server_name bunq.yourdomain.com;
    
    root /path/to/bunq-dashboard;
    index index.html;
    
    location /api/ {
        proxy_pass http://localhost:5000/api/;
    }
}
```

### Stap 6: Open Dashboard

Navigeer naar:
- `http://localhost:8000` (Python server)
- `http://your-nas-ip/bunq-dashboard` (NAS)
- `http://bunq.yourdomain.com` (Custom domain)

---

## 🔧 Configuratie

### Frontend Settings (via Settings knop in dashboard)

- **API Endpoint URL**: URL naar je backend API
  - Lokaal: `http://localhost:5000/api`
  - NAS: `http://192.168.1.100:5000/api`
  - Domain: `https://api.bunq.yourdomain.com/api`

- **Auto-refresh interval**: 0 = disabled, 1-60 minuten

- **Animations**: Enable/disable animaties voor performance

- **Particles**: Enable/disable achtergrond effecten

### Backend Configuration (api_proxy.py)

```python
# Pas deze variabelen aan in api_proxy.py
ENVIRONMENT = 'PRODUCTION'  # Of 'SANDBOX' voor testen
API_KEY = os.getenv('BUNQ_API_KEY')
CONFIG_FILE = 'bunq_production.conf'
```

---

## 🚢 Deployment op NAS

### Synology NAS

**Via Docker (Aanbevolen):**

```dockerfile
# Dockerfile
FROM python:3.9-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api_proxy.py .

ENV BUNQ_API_KEY=""

CMD ["python", "api_proxy.py"]
```

```bash
# Build image
docker build -t bunq-dashboard-api .

# Run container
docker run -d \
  -p 5000:5000 \
  -e BUNQ_API_KEY="your_key" \
  --name bunq-api \
  bunq-dashboard-api
```

**Via Task Scheduler:**
1. Control Panel → Task Scheduler
2. Create → Triggered Task → User-defined script
3. Script: `python3 /volume1/web/bunq-dashboard/api_proxy.py`
4. Schedule: At boot-up

### QNAP NAS

Via Container Station:
1. Pull Python image
2. Mount `/volume1/bunq-dashboard` als volume
3. Set environment variable `BUNQ_API_KEY`
4. Port mapping: 5000:5000

---

## 🔒 Beveiliging

### Best Practices

1. **API Key Opslag**
   - ✅ NOOIT in git committen
   - ✅ Gebruik environment variables
   - ✅ Of gebruik een `.env` file (add to `.gitignore`)
   - ✅ Rotate keys regelmatig

2. **HTTPS**
   - ✅ Gebruik HTTPS voor productie
   - ✅ Let's Encrypt voor gratis SSL
   - ✅ Reverse proxy (NGINX/Caddy)

3. **Firewall**
   - ✅ Beperk API access tot lokaal netwerk
   - ✅ Of gebruik VPN voor externe toegang
   - ✅ Rate limiting instellen

4. **Authentication**
   - Optional: Add basic auth to API
   - Optional: Use JWT tokens
   - Optional: IP whitelist

### NGINX met SSL Voorbeeld

```nginx
server {
    listen 443 ssl http2;
    server_name bunq.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    root /path/to/bunq-dashboard;
    index index.html;
    
    location /api/ {
        proxy_pass http://localhost:5000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 📱 Responsive Design

Het dashboard is volledig responsive en werkt op alle schermformaten:

- **📱 Mobile** (320px+): Stacked layout, touch-optimized
- **📱 Tablet** (768px+): 2-column grid
- **💻 Desktop** (1024px+): 3-column grid
- **🖥️ Large** (1440px+): Full dashboard layout
- **🖥️ 4K** (2560px+): Optimized for maximum detail

### Tips per Device

**Op Telefoon:**
- Gebruik landscape mode voor charts
- Pinch to zoom werkt op alle visualisaties
- Swipe voor animaties

**Op Tablet:**
- Perfect voor daily monitoring
- Mount op muur als info display
- Use auto-refresh voor live updates

**Op Desktop/4K:**
- Fullscreen mode (F11) voor maximale immersie
- Dual monitor: Dashboard op secundair scherm
- Export als PNG voor presentations

---

## 🎨 Aanpassingen

### Kleuren Veranderen

In `styles.css`, pas CSS variables aan:

```css
:root {
    --accent-primary: #667eea;    /* Paars → Jouw kleur */
    --accent-success: #10b981;     /* Groen → Jouw kleur */
    --accent-danger: #ef4444;      /* Rood → Jouw kleur */
}
```

### Extra Visualisaties Toevoegen

In `app.js`, voeg nieuwe functies toe:

```javascript
function renderMyCustomChart(data) {
    // Jouw custom Plotly/Chart.js code
    Plotly.newPlot('myChartDiv', traces, layout);
}

// Roep aan in processAndRenderData()
```

### Logo/Branding

In `index.html`, vervang logo section:

```html
<div class="logo-icon">
    <img src="your-logo.png" alt="Logo">
</div>
```

---

## 🐛 Troubleshooting

### Backend start niet

**Error: "No API key found"**
```bash
# Check of environment variable is set
echo $BUNQ_API_KEY

# Of set het opnieuw
export BUNQ_API_KEY="your_key"
```

**Error: "Module not found: bunq"**
```bash
pip install bunq-sdk-python
```

### Frontend kan API niet bereiken

**CORS Error:**
- Backend moet CORS enabled hebben (zie `api_proxy.py`)
- Check of `flask-cors` is geïnstalleerd

**Connection Refused:**
- Check of backend draait: `curl http://localhost:5000/api/health`
- Check firewall rules op NAS
- Pas API endpoint aan in Settings

### Visualisaties laden niet

**Plotly not defined:**
- Check internet connectie (CDN libraries)
- Of download Plotly lokaal

**Charts zijn leeg:**
- Open browser console (F12)
- Check for JavaScript errors
- Verify data format

### Performance Issues

**Dashboard is traag:**
```javascript
// In app.js, reduce data points
const recentData = data.slice(-100);  // Limit to 100 transactions
```

**Animaties stutteren:**
- Disable particles in Settings
- Reduce chart complexity
- Check CPU usage op NAS

---

## 📊 API Endpoints

### GET /api/health
Health check
```json
{
  "status": "healthy",
  "timestamp": "2024-..."
}
```

### GET /api/accounts
Get all accounts
```json
{
  "success": true,
  "data": [{
    "id": 123,
    "description": "Main Account",
    "balance": 1234.56,
    "currency": "EUR",
    "iban": "NL..."
  }]
}
```

### GET /api/transactions?days=90
Get transactions
```json
{
  "success": true,
  "data": [{
    "id": 456,
    "date": "2024-...",
    "amount": -12.50,
    "category": "Boodschappen",
    "merchant": "Albert Heijn"
  }],
  "count": 123
}
```

### GET /api/statistics?days=90
Get aggregated stats
```json
{
  "success": true,
  "data": {
    "income": 2800,
    "expenses": 1850,
    "net_savings": 950,
    "savings_rate": 33.9
  }
}
```

### GET /api/demo-data?days=90
Get demo data (no Bunq API needed)

---

## 🚀 Performance Tips

### Backend Optimization

```python
# Cache results voor betere performance
from flask_caching import Cache

cache = Cache(app, config={'CACHE_TYPE': 'simple'})

@app.route('/api/transactions')
@cache.cached(timeout=300)  # Cache 5 minuten
def get_transactions():
    # ...
```

### Frontend Optimization

```javascript
// Lazy load charts
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            renderChart(entry.target.id);
        }
    });
});
```

---

## 📝 License

MIT License - Vrij te gebruiken voor persoonlijk en commercieel gebruik.

---

## 🤝 Contributing

Verbeteringen? Pull requests welkom!

1. Fork het project
2. Create feature branch
3. Commit changes
4. Push to branch
5. Open Pull Request

---

## 💡 Roadmap

- [ ] Budget tracking & alerts
- [ ] Export to PDF/Excel
- [ ] Email reports
- [ ] Mobile app (React Native)
- [ ] Multi-user support
- [ ] Machine learning insights
- [ ] Voice commands
- [ ] Widget for Home Assistant

---

## 📞 Support

Issues? Open een GitHub issue of contact via email.

---

**Made with ❤️ and lots of ☕**

*Geniet van je spectaculaire Bunq Dashboard!* 🎉
