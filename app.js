// ============================================
// BUNQ FINANCIAL DASHBOARD - MAIN APPLICATION
// Advanced JavaScript with API Integration
// ============================================

// Global Configuration
const CONFIG = {
    apiEndpoint: localStorage.getItem('apiEndpoint') || 'http://localhost:5000/api',
    refreshInterval: parseInt(localStorage.getItem('refreshInterval')) || 0,
    enableAnimations: localStorage.getItem('enableAnimations') !== 'false',
    enableParticles: localStorage.getItem('enableParticles') !== 'false',
    timeRange: 90 // days
};

// Global State
let transactionsData = null;
let refreshIntervalId = null;
let isLoading = false;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Bunq Dashboard Initializing...');
    
    // Initialize particles background
    if (CONFIG.enableParticles) {
        initializeParticles();
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Load initial data (using demo data for now)
    loadDemoData();
    
    // Initialize auto-refresh if enabled
    if (CONFIG.refreshInterval > 0) {
        startAutoRefresh();
    }
});

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        refreshData();
    });
    
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => {
        toggleTheme();
    });
    
    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => {
        openSettings();
    });
    
    document.getElementById('closeSettings').addEventListener('click', () => {
        closeSettings();
    });
    
    document.getElementById('saveSettings').addEventListener('click', () => {
        saveSettings();
    });
    
    // Time range selector
    document.getElementById('timeRange').addEventListener('change', (e) => {
        CONFIG.timeRange = e.target.value === 'all' ? 9999 : parseInt(e.target.value);
        refreshData();
    });
    
    // Animation controls
    document.getElementById('play3D')?.addEventListener('click', () => {
        play3DAnimation();
    });
    
    document.getElementById('playRace')?.addEventListener('click', () => {
        playRacingAnimation();
    });
}

// ============================================
// DATA LOADING & GENERATION
// ============================================

function loadDemoData() {
    showLoading();
    
    // Simulate API delay
    setTimeout(() => {
        transactionsData = generateDemoTransactions(CONFIG.timeRange);
        processAndRenderData(transactionsData);
        hideLoading();
        updateLastUpdateTime();
    }, 1500);
}

function generateDemoTransactions(days) {
    const transactions = [];
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const categories = {
        'Boodschappen': { avg: -75, std: 25, freq: 0.5, color: '#3b82f6' },
        'Horeca': { avg: -35, std: 20, freq: 0.3, color: '#8b5cf6' },
        'Vervoer': { avg: -45, std: 15, freq: 0.35, color: '#ec4899' },
        'Wonen': { avg: -850, std: 50, freq: 0.033, color: '#ef4444' },
        'Utilities': { avg: -120, std: 30, freq: 0.033, color: '#f59e0b' },
        'Shopping': { avg: -65, std: 40, freq: 0.2, color: '#10b981' },
        'Entertainment': { avg: -25, std: 15, freq: 0.17, color: '#06b6d4' },
        'Zorg': { avg: -80, std: 30, freq: 0.067, color: '#6366f1' },
        'Salaris': { avg: 2800, std: 100, freq: 0.033, color: '#22c55e' }
    };
    
    const merchants = {
        'Boodschappen': ['Albert Heijn', 'Jumbo', 'Lidl', 'Aldi', 'Plus'],
        'Horeca': ['Starbucks', 'De Kroeg', 'Restaurant Plaza', 'Burger King', 'Dominos'],
        'Vervoer': ['NS', 'Shell', 'Parking Amsterdam', 'Uber', 'Swapfiets'],
        'Wonen': ['Verhuurder B.V.', 'Hypotheek Bank'],
        'Utilities': ['Eneco', 'Ziggo', 'Waternet'],
        'Shopping': ['Bol.com', 'Zara', 'H&M', 'MediaMarkt', 'Coolblue'],
        'Entertainment': ['Netflix', 'Spotify', 'Pathé', 'Concert Tickets'],
        'Zorg': ['Apotheek', 'Tandarts', 'Fysiotherapie'],
        'Salaris': ['Werkgever B.V.']
    };
    
    let currentDate = new Date(startDate);
    let transactionId = 1;
    
    while (currentDate <= endDate) {
        for (const [category, params] of Object.entries(categories)) {
            if (Math.random() < params.freq) {
                const amount = Math.random() * params.std * 2 - params.std + params.avg;
                const merchant = merchants[category][Math.floor(Math.random() * merchants[category].length)];
                
                transactions.push({
                    id: transactionId++,
                    date: new Date(currentDate),
                    amount: parseFloat(amount.toFixed(2)),
                    category: category,
                    merchant: merchant,
                    description: `${category} - ${merchant}`,
                    color: params.color
                });
            }
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return transactions.sort((a, b) => a.date - b.date);
}

// ============================================
// DATA PROCESSING
// ============================================

function processAndRenderData(data) {
    console.log(`📊 Processing ${data.length} transactions...`);
    
    // Calculate KPIs
    const kpis = calculateKPIs(data);
    renderKPIs(kpis);
    
    // Render all visualizations
    renderCashflowChart(data);
    renderSankeyChart(data);
    renderSunburstChart(data);
    renderTimeTravelChart(data);
    renderHeatmapChart(data);
    renderMerchantsChart(data);
    renderRidgePlot(data);
    renderRacingChart(data);
    renderInsights(data, kpis);
    
    console.log('✅ All visualizations rendered!');
}

function calculateKPIs(data) {
    const income = data.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const expenses = Math.abs(data.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));
    const netSavings = income - expenses;
    const savingsRate = income > 0 ? (netSavings / income * 100) : 0;
    
    // Calculate trends (compare last 30 days with previous 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    
    const recent = data.filter(t => t.date >= thirtyDaysAgo);
    const previous = data.filter(t => t.date >= sixtyDaysAgo && t.date < thirtyDaysAgo);
    
    const recentIncome = recent.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const previousIncome = previous.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const incomeTrend = previousIncome > 0 ? ((recentIncome - previousIncome) / previousIncome * 100) : 0;
    
    const recentExpenses = Math.abs(recent.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));
    const previousExpenses = Math.abs(previous.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));
    const expensesTrend = previousExpenses > 0 ? ((recentExpenses - previousExpenses) / previousExpenses * 100) : 0;
    
    const recentSavings = recentIncome - recentExpenses;
    const previousSavings = previousIncome - previousExpenses;
    const savingsTrend = previousSavings !== 0 ? ((recentSavings - previousSavings) / Math.abs(previousSavings) * 100) : 0;
    
    return {
        income,
        expenses,
        netSavings,
        savingsRate,
        incomeTrend,
        expensesTrend,
        savingsTrend
    };
}

// ============================================
// KPI RENDERING
// ============================================

function renderKPIs(kpis) {
    // Update values
    document.getElementById('totalIncome').textContent = formatCurrency(kpis.income);
    document.getElementById('totalExpenses').textContent = formatCurrency(kpis.expenses);
    document.getElementById('netSavings').textContent = formatCurrency(kpis.netSavings);
    document.getElementById('savingsRate').textContent = `${kpis.savingsRate.toFixed(1)}%`;
    
    // Update trends
    document.getElementById('incomeTrend').textContent = `${kpis.incomeTrend >= 0 ? '+' : ''}${kpis.incomeTrend.toFixed(1)}%`;
    document.getElementById('expensesTrend').textContent = `${kpis.expensesTrend >= 0 ? '+' : ''}${kpis.expensesTrend.toFixed(1)}%`;
    document.getElementById('savingsTrend').textContent = `${kpis.savingsTrend >= 0 ? '+' : ''}${kpis.savingsTrend.toFixed(1)}%`;
    
    // Update savings rate circle
    const circle = document.getElementById('savingsCircle');
    const circumference = 2 * Math.PI * 25;
    const offset = circumference - (kpis.savingsRate / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    
    // Render sparklines
    renderSparklines();
}

function renderSparklines() {
    // Simple sparkline charts for KPI cards
    const recentData = transactionsData.slice(-30);
    
    // Income sparkline
    const incomeData = recentData.filter(t => t.amount > 0);
    createSparkline('incomeSparkline', incomeData.map(t => t.amount), '#22c55e');
    
    // Expenses sparkline
    const expenseData = recentData.filter(t => t.amount < 0);
    createSparkline('expensesSparkline', expenseData.map(t => Math.abs(t.amount)), '#ef4444');
    
    // Savings sparkline (cumulative)
    const dailySavings = [];
    let cumulative = 0;
    for (let i = 0; i < recentData.length; i++) {
        cumulative += recentData[i].amount;
        dailySavings.push(cumulative);
    }
    createSparkline('savingsSparkline', dailySavings, '#10b981');
}

function createSparkline(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map((_, i) => i),
            datasets: [{
                data: data,
                borderColor: color,
                backgroundColor: `${color}20`,
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: { display: false },
                y: { display: false }
            }
        }
    });
}

// ============================================
// CASHFLOW CHART
// ============================================

function renderCashflowChart(data) {
    // Group by month
    const monthlyData = {};
    
    data.forEach(t => {
        const month = t.date.toISOString().slice(0, 7); // YYYY-MM
        if (!monthlyData[month]) {
            monthlyData[month] = { income: 0, expenses: 0 };
        }
        if (t.amount > 0) {
            monthlyData[month].income += t.amount;
        } else {
            monthlyData[month].expenses += Math.abs(t.amount);
        }
    });
    
    const months = Object.keys(monthlyData).sort();
    const incomeValues = months.map(m => monthlyData[m].income);
    const expenseValues = months.map(m => monthlyData[m].expenses);
    const netValues = months.map(m => monthlyData[m].income - monthlyData[m].expenses);
    
    const trace1 = {
        x: months,
        y: incomeValues,
        name: 'Income',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#22c55e', width: 3 },
        marker: { size: 8 },
        fill: 'tozeroy',
        fillcolor: 'rgba(34, 197, 94, 0.1)'
    };
    
    const trace2 = {
        x: months,
        y: expenseValues,
        name: 'Expenses',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#ef4444', width: 3 },
        marker: { size: 8 },
        fill: 'tozeroy',
        fillcolor: 'rgba(239, 68, 68, 0.1)'
    };
    
    const trace3 = {
        x: months,
        y: netValues,
        name: 'Net Savings',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#3b82f6', width: 3, dash: 'dash' },
        marker: { size: 10, symbol: 'diamond' }
    };
    
    const layout = {
        title: '',
        height: 400,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#a0aec0' },
        xaxis: { gridcolor: '#2a2f4a', showgrid: true },
        yaxis: { gridcolor: '#2a2f4a', showgrid: true, title: 'Amount (€)' },
        legend: { orientation: 'h', y: 1.1 },
        hovermode: 'x unified',
        margin: { t: 20, b: 50, l: 60, r: 20 }
    };
    
    Plotly.newPlot('cashflowChart', [trace1, trace2, trace3], layout, { responsive: true });
}

// ============================================
// SANKEY CHART
// ============================================

function renderSankeyChart(data) {
    const expenses = data.filter(t => t.amount < 0);
    
    // Get top categories
    const categoryTotals = {};
    expenses.forEach(t => {
        categoryTotals[t.category] = (categoryTotals[t.category] || 0) + Math.abs(t.amount);
    });
    
    const topCategories = Object.entries(categoryTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([cat, _]) => cat);
    
    // Build Sankey data
    const labels = ['💰 Income'];
    const sources = [];
    const targets = [];
    const values = [];
    const colors = [];
    
    const colorPalette = [
        'rgba(59, 130, 246, 0.6)',
        'rgba(139, 92, 246, 0.6)',
        'rgba(236, 72, 153, 0.6)',
        'rgba(239, 68, 68, 0.6)',
        'rgba(245, 158, 11, 0.6)',
        'rgba(16, 185, 129, 0.6)'
    ];
    
    topCategories.forEach((category, idx) => {
        labels.push(`📊 ${category}`);
        const categoryIdx = labels.length - 1;
        
        sources.push(0);
        targets.push(categoryIdx);
        values.push(categoryTotals[category]);
        colors.push(colorPalette[idx % colorPalette.length]);
        
        // Add top 2 merchants per category
        const categoryExpenses = expenses.filter(t => t.category === category);
        const merchantTotals = {};
        categoryExpenses.forEach(t => {
            merchantTotals[t.merchant] = (merchantTotals[t.merchant] || 0) + Math.abs(t.amount);
        });
        
        const topMerchants = Object.entries(merchantTotals)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2);
        
        topMerchants.forEach(([merchant, amount]) => {
            labels.push(`🏪 ${merchant}`);
            const merchantIdx = labels.length - 1;
            
            sources.push(categoryIdx);
            targets.push(merchantIdx);
            values.push(amount);
            colors.push(colorPalette[idx % colorPalette.length]);
        });
    });
    
    const trace = {
        type: 'sankey',
        node: {
            pad: 15,
            thickness: 20,
            line: { color: 'black', width: 0.5 },
            label: labels,
            color: 'lightblue'
        },
        link: {
            source: sources,
            target: targets,
            value: values,
            color: colors
        }
    };
    
    const layout = {
        title: '',
        height: 500,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { size: 11, color: '#a0aec0' },
        margin: { t: 10, b: 10, l: 10, r: 10 }
    };
    
    Plotly.newPlot('sankeyChart', [trace], layout, { responsive: true });
}

// (Continued in next part...)

// ============================================
// SUNBURST CHART
// ============================================

function renderSunburstChart(data) {
    const expenses = data.filter(t => t.amount < 0);
    
    const labels = ['All Expenses'];
    const parents = [''];
    const values = [0];
    const colors = [];
    
    // Group by category
    const categoryData = {};
    expenses.forEach(t => {
        if (!categoryData[t.category]) {
            categoryData[t.category] = { total: 0, merchants: {} };
        }
        categoryData[t.category].total += Math.abs(t.amount);
        categoryData[t.category].merchants[t.merchant] = 
            (categoryData[t.category].merchants[t.merchant] || 0) + Math.abs(t.amount);
    });
    
    // Add categories and merchants
    Object.entries(categoryData).forEach(([category, data]) => {
        labels.push(category);
        parents.push('All Expenses');
        values.push(data.total);
        
        Object.entries(data.merchants).forEach(([merchant, amount]) => {
            labels.push(merchant);
            parents.push(category);
            values.push(amount);
        });
    });
    
    const trace = {
        type: 'sunburst',
        labels: labels,
        parents: parents,
        values: values,
        branchvalues: 'total',
        marker: {
            colorscale: 'Viridis'
        },
        hovertemplate: '<b>%{label}</b><br>€%{value:,.2f}<br>%{percentParent}<extra></extra>'
    };
    
    const layout = {
        height: 500,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        margin: { t: 0, b: 0, l: 0, r: 0 },
        font: { color: '#a0aec0' }
    };
    
    Plotly.newPlot('sunburstChart', [trace], layout, { responsive: true });
}

// ============================================
// 3D TIME TRAVEL CHART
// ============================================

function renderTimeTravelChart(data) {
    const expenses = data.filter(t => t.amount < 0);
    
    // Group by week and category
    const weeklyData = {};
    
    expenses.forEach(t => {
        const week = getWeekNumber(t.date);
        const key = `${week}-${t.category}`;
        
        if (!weeklyData[key]) {
            weeklyData[key] = {
                week,
                category: t.category,
                amount: 0,
                count: 0,
                color: t.color
            };
        }
        weeklyData[key].amount += Math.abs(t.amount);
        weeklyData[key].count += 1;
    });
    
    const plotData = Object.values(weeklyData);
    
    // Calculate cumulative amounts
    const categories = [...new Set(plotData.map(d => d.category))];
    const cumulativeData = {};
    
    categories.forEach(cat => {
        cumulativeData[cat] = 0;
    });
    
    plotData.sort((a, b) => a.week - b.week);
    plotData.forEach(d => {
        cumulativeData[d.category] += d.amount;
        d.cumulative = cumulativeData[d.category];
    });
    
    const trace = {
        type: 'scatter3d',
        mode: 'markers',
        x: plotData.map(d => d.week),
        y: plotData.map(d => d.category),
        z: plotData.map(d => d.cumulative),
        marker: {
            size: plotData.map(d => Math.sqrt(d.count) * 4),
            color: plotData.map(d => d.cumulative),
            colorscale: 'Viridis',
            showscale: true,
            colorbar: { title: '€' }
        },
        text: plotData.map(d => `Week ${d.week}<br>${d.category}<br>€${d.amount.toFixed(2)}<br>${d.count} transactions`),
        hovertemplate: '%{text}<extra></extra>'
    };
    
    const layout = {
        height: 600,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        scene: {
            xaxis: { title: 'Week', gridcolor: '#2a2f4a', color: '#a0aec0' },
            yaxis: { title: 'Category', gridcolor: '#2a2f4a', color: '#a0aec0' },
            zaxis: { title: 'Cumulative €', gridcolor: '#2a2f4a', color: '#a0aec0' },
            camera: {
                eye: { x: 1.5, y: 1.5, z: 1.3 }
            },
            bgcolor: 'transparent'
        },
        margin: { t: 0, b: 0, l: 0, r: 0 }
    };
    
    Plotly.newPlot('timeTravelChart', [trace], layout, { responsive: true });
}

// ============================================
// HEATMAP CHART
// ============================================

function renderHeatmapChart(data) {
    const expenses = data.filter(t => t.amount < 0);
    
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const categories = [...new Set(expenses.map(t => t.category))].slice(0, 8);
    
    const heatmapData = {};
    categories.forEach(cat => {
        heatmapData[cat] = [0, 0, 0, 0, 0, 0, 0];
    });
    
    expenses.forEach(t => {
        const day = t.date.getDay();
        const dayIndex = day === 0 ? 6 : day - 1; // Convert Sunday from 0 to 6
        if (categories.includes(t.category)) {
            heatmapData[t.category][dayIndex] += Math.abs(t.amount);
        }
    });
    
    const z = categories.map(cat => heatmapData[cat]);
    
    const trace = {
        type: 'heatmap',
        z: z,
        x: days,
        y: categories,
        colorscale: 'YlOrRd',
        hoverongaps: false,
        hovertemplate: '%{y}<br>%{x}<br>€%{z:,.0f}<extra></extra>'
    };
    
    const layout = {
        height: 400,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        xaxis: { color: '#a0aec0', side: 'bottom' },
        yaxis: { color: '#a0aec0' },
        margin: { t: 10, b: 50, l: 120, r: 20 }
    };
    
    Plotly.newPlot('heatmapChart', [trace], layout, { responsive: true });
}

// ============================================
// TOP MERCHANTS CHART
// ============================================

function renderMerchantsChart(data) {
    const expenses = data.filter(t => t.amount < 0);
    
    const merchantTotals = {};
    expenses.forEach(t => {
        merchantTotals[t.merchant] = (merchantTotals[t.merchant] || 0) + Math.abs(t.amount);
    });
    
    const topMerchants = Object.entries(merchantTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    
    const trace = {
        type: 'bar',
        y: topMerchants.map(([m, _]) => m),
        x: topMerchants.map(([_, amt]) => amt),
        orientation: 'h',
        marker: {
            color: topMerchants.map((_, idx) => `hsl(${idx * 36}, 70%, 60%)`),
            line: { width: 0 }
        },
        hovertemplate: '<b>%{y}</b><br>€%{x:,.2f}<extra></extra>'
    };
    
    const layout = {
        height: 400,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        xaxis: { gridcolor: '#2a2f4a', color: '#a0aec0', title: 'Amount (€)' },
        yaxis: { color: '#a0aec0' },
        margin: { t: 10, b: 50, l: 150, r: 20 }
    };
    
    Plotly.newPlot('merchantsChart', [trace], layout, { responsive: true });
}

// ============================================
// RIDGE PLOT (Simplified with Canvas)
// ============================================

function renderRidgePlot(data) {
    const canvas = document.getElementById('ridgePlotCanvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Group by month
    const monthlyExpenses = {};
    data.filter(t => t.amount < 0).forEach(t => {
        const month = t.date.toISOString().slice(0, 7);
        if (!monthlyExpenses[month]) monthlyExpenses[month] = [];
        monthlyExpenses[month].push(Math.abs(t.amount));
    });
    
    const months = Object.keys(monthlyExpenses).sort().slice(-6);
    const datasets = months.map((month, idx) => ({
        label: month,
        data: createDensityData(monthlyExpenses[month]),
        backgroundColor: `hsla(${idx * 60}, 70%, 60%, 0.3)`,
        borderColor: `hsl(${idx * 60}, 70%, 60%)`,
        borderWidth: 2,
        fill: true
    }));
    
    new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'right', labels: { color: '#a0aec0' } }
            },
            scales: {
                x: { display: true, grid: { color: '#2a2f4a' }, ticks: { color: '#a0aec0' } },
                y: { display: false }
            }
        }
    });
}

function createDensityData(values) {
    // Simple density estimation
    const sorted = values.sort((a, b) => a - b);
    const bins = 20;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const binSize = (max - min) / bins;
    
    const density = [];
    for (let i = 0; i < bins; i++) {
        const binStart = min + i * binSize;
        const binEnd = binStart + binSize;
        const count = sorted.filter(v => v >= binStart && v < binEnd).length;
        density.push({ x: (binStart + binEnd) / 2, y: count });
    }
    return density;
}

// ============================================
// RACING BAR CHART
// ============================================

function renderRacingChart(data) {
    // This will be animated later
    const expenses = data.filter(t => t.amount < 0);
    
    const monthlyCategories = {};
    expenses.forEach(t => {
        const month = t.date.toISOString().slice(0, 7);
        if (!monthlyCategories[month]) monthlyCategories[month] = {};
        monthlyCategories[month][t.category] = (monthlyCategories[month][t.category] || 0) + Math.abs(t.amount);
    });
    
    const firstMonth = Object.keys(monthlyCategories).sort()[0];
    const firstMonthData = monthlyCategories[firstMonth];
    
    const sortedCategories = Object.entries(firstMonthData)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
    
    const trace = {
        type: 'bar',
        y: sortedCategories.map(([cat, _]) => cat),
        x: sortedCategories.map(([_, amt]) => amt),
        orientation: 'h',
        marker: {
            color: sortedCategories.map((_, idx) => `hsl(${idx * 45}, 70%, 60%)`)
        },
        hovertemplate: '<b>%{y}</b><br>€%{x:,.2f}<extra></extra>'
    };
    
    const layout = {
        height: 400,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        xaxis: { gridcolor: '#2a2f4a', color: '#a0aec0', range: [0, Math.max(...sortedCategories.map(([_, amt]) => amt)) * 1.1] },
        yaxis: { color: '#a0aec0', categoryorder: 'total ascending' },
        margin: { t: 10, b: 50, l: 120, r: 20 }
    };
    
    Plotly.newPlot('racingChart', [trace], layout, { responsive: true });
}

// ============================================
// INSIGHTS
// ============================================

function renderInsights(data, kpis) {
    const expenses = data.filter(t => t.amount < 0);
    
    // Biggest category
    const categoryTotals = {};
    expenses.forEach(t => {
        categoryTotals[t.category] = (categoryTotals[t.category] || 0) + Math.abs(t.amount);
    });
    const biggestCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
    document.getElementById('biggestCategory').textContent = 
        `${biggestCategory[0]} (${formatCurrency(biggestCategory[1])})`;
    
    // Average daily
    const totalDays = CONFIG.timeRange;
    const avgDaily = kpis.expenses / totalDays;
    document.getElementById('avgDaily').textContent = formatCurrency(avgDaily);
    
    // Most expensive day
    const dailyTotals = {};
    expenses.forEach(t => {
        const day = t.date.toISOString().slice(0, 10);
        dailyTotals[day] = (dailyTotals[day] || 0) + Math.abs(t.amount);
    });
    const mostExpensive = Object.entries(dailyTotals).sort((a, b) => b[1] - a[1])[0];
    document.getElementById('expensiveDay').textContent = 
        `${new Date(mostExpensive[0]).toLocaleDateString('nl-NL')} (${formatCurrency(mostExpensive[1])})`;
    
    // Trend
    const trend = kpis.savingsTrend > 0 ? 'Improving' : kpis.savingsTrend < 0 ? 'Declining' : 'Stable';
    document.getElementById('trendInsight').textContent = 
        `${trend} (${kpis.savingsTrend >= 0 ? '+' : ''}${kpis.savingsTrend.toFixed(1)}%)`;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatCurrency(amount) {
    return new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ============================================
// UI FUNCTIONS
// ============================================

function showLoading() {
    document.getElementById('loading-screen').classList.remove('hidden');
    document.getElementById('main-content').style.display = 'none';
}

function hideLoading() {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('main-content').style.display = 'block';
}

function refreshData() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('loading');
    loadDemoData();
    setTimeout(() => btn.classList.remove('loading'), 1500);
}

function toggleTheme() {
    const body = document.body;
    const icon = document.querySelector('#themeToggle i');
    
    if (body.classList.contains('dark-theme')) {
        body.classList.remove('dark-theme');
        body.classList.add('light-theme');
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
    } else {
        body.classList.remove('light-theme');
        body.classList.add('dark-theme');
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
    }
}

function openSettings() {
    document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

function saveSettings() {
    CONFIG.apiEndpoint = document.getElementById('apiEndpoint').value;
    CONFIG.refreshInterval = parseInt(document.getElementById('refreshInterval').value);
    CONFIG.enableAnimations = document.getElementById('enableAnimations').checked;
    CONFIG.enableParticles = document.getElementById('enableParticles').checked;
    
    localStorage.setItem('apiEndpoint', CONFIG.apiEndpoint);
    localStorage.setItem('refreshInterval', CONFIG.refreshInterval);
    localStorage.setItem('enableAnimations', CONFIG.enableAnimations);
    localStorage.setItem('enableParticles', CONFIG.enableParticles);
    
    closeSettings();
    
    // Reinitialize particles if needed
    if (CONFIG.enableParticles) {
        initializeParticles();
    } else {
        if (window.pJSDom && window.pJSDom[0]) {
            window.pJSDom[0].pJS.fn.vendors.destroypJS();
        }
    }
}

function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = 
        `Last updated: ${now.toLocaleTimeString('nl-NL')}`;
}

function startAutoRefresh() {
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    refreshIntervalId = setInterval(() => {
        refreshData();
    }, CONFIG.refreshInterval * 60 * 1000);
}

// ============================================
// PARTICLES BACKGROUND
// ============================================

function initializeParticles() {
    if (typeof particlesJS === 'undefined') return;
    
    particlesJS('particles-js', {
        particles: {
            number: { value: 50, density: { enable: true, value_area: 800 } },
            color: { value: '#667eea' },
            shape: { type: 'circle' },
            opacity: { value: 0.3, random: true },
            size: { value: 3, random: true },
            line_linked: {
                enable: true,
                distance: 150,
                color: '#667eea',
                opacity: 0.2,
                width: 1
            },
            move: {
                enable: true,
                speed: 1,
                direction: 'none',
                random: true,
                straight: false,
                out_mode: 'out',
                bounce: false
            }
        },
        interactivity: {
            detect_on: 'canvas',
            events: {
                onhover: { enable: true, mode: 'grab' },
                onclick: { enable: true, mode: 'push' },
                resize: true
            },
            modes: {
                grab: { distance: 140, line_linked: { opacity: 0.5 } },
                push: { particles_nb: 4 }
            }
        },
        retina_detect: true
    });
}

// ============================================
// ANIMATION CONTROLS
// ============================================

function play3DAnimation() {
    // Implement 3D rotation animation
    const frames = 360;
    let frame = 0;
    
    const interval = setInterval(() => {
        if (frame >= frames) {
            clearInterval(interval);
            return;
        }
        
        const angle = (frame / frames) * 360;
        const layout = {
            scene: {
                camera: {
                    eye: {
                        x: Math.cos(angle * Math.PI / 180) * 1.5,
                        y: Math.sin(angle * Math.PI / 180) * 1.5,
                        z: 1.3
                    }
                }
            }
        };
        
        Plotly.relayout('timeTravelChart', layout);
        frame++;
    }, 20);
}

function playRacingAnimation() {
    // Implement racing bar animation
    console.log('Racing animation started!');
    // This would cycle through months and update the chart
}

console.log('✅ Bunq Dashboard Ready!');
