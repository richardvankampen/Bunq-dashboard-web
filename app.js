// ============================================
// BUNQ FINANCIAL DASHBOARD - SESSION AUTH
// No credentials stored in localStorage!
// ============================================

// Global Configuration
const DEFAULT_API_ENDPOINT = `${window.location.origin}/api`;
const ACCOUNT_STORAGE_KEY = 'selectedAccountIds';
const CONFIG = {
    apiEndpoint: localStorage.getItem('apiEndpoint') || DEFAULT_API_ENDPOINT,
    refreshInterval: parseInt(localStorage.getItem('refreshInterval')) || 0,
    enableAnimations: localStorage.getItem('enableAnimations') !== 'false',
    enableParticles: localStorage.getItem('enableParticles') !== 'false',
    excludeInternalTransfers: localStorage.getItem('excludeInternalTransfers') !== 'false',
    timeRange: 90,
    useRealData: localStorage.getItem('useRealData') === 'true'
};

// Global State
let transactionsData = null;
let refreshIntervalId = null;
let isLoading = false;
let isAuthenticated = false;
let accountsList = [];
let selectedAccountIds = new Set();
const chartRegistry = {
    chartjs: {},
    plotly: {}
};
let racingData = null;
let racingPlayInterval = null;
let timeTravelSpinInterval = null;

function loadSelectedAccountIds() {
    try {
        const stored = JSON.parse(localStorage.getItem(ACCOUNT_STORAGE_KEY) || '[]');
        if (Array.isArray(stored)) {
            selectedAccountIds = new Set(stored.map(String));
            return;
        }
    } catch (error) {
        console.warn('Failed to parse selectedAccountIds from storage');
    }
    selectedAccountIds = new Set();
}

loadSelectedAccountIds();

// ============================================
// SESSION-BASED AUTHENTICATION
// ============================================

/**
 * Check if user is authenticated (has valid session)
 */
async function checkAuthStatus() {
    try {
        const response = await fetch(`${CONFIG.apiEndpoint}/auth/status`, {
            credentials: 'include'  // CRITICAL: Include session cookie
        });
        
        if (response.ok) {
            const data = await response.json();
            isAuthenticated = data.authenticated;
            
            if (isAuthenticated) {
                console.log(`✅ Authenticated as: ${data.username}`);
                updateAuthUI(true, data.username);
                await loadAccounts();
            } else {
                console.log('❌ Not authenticated');
                updateAuthUI(false);
                renderAccountsFilter([]);
            }
            
            return isAuthenticated;
        }
        
        return false;
        
    } catch (error) {
        console.error('Error checking auth status:', error);
        return false;
    }
}

/**
 * Login user with username and password
 */
async function login(username, password) {
    try {
        const response = await fetch(`${CONFIG.apiEndpoint}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',  // CRITICAL: Allow setting cookies
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            console.log('✅ Login successful');
            isAuthenticated = true;
            updateAuthUI(true, data.username);
            hideLoginModal();
            await loadAccounts();
            
            // Load data after successful login
            if (CONFIG.useRealData) {
                await loadRealData();
            }
            
            return true;
        } else {
            console.error('❌ Login failed:', data.error);
            showError(data.error || 'Login failed');
            return false;
        }
        
    } catch (error) {
        console.error('Login error:', error);
        showError('Login failed. Please try again.');
        return false;
    }
}

/**
 * Logout user (destroy session)
 */
async function logout() {
    try {
        await fetch(`${CONFIG.apiEndpoint}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        
        isAuthenticated = false;
        updateAuthUI(false);
        renderAccountsFilter([]);
        console.log('👋 Logged out');
        
        // Switch to demo data
        CONFIG.useRealData = false;
        localStorage.setItem('useRealData', 'false');
        loadDemoData();
        
    } catch (error) {
        console.error('Logout error:', error);
    }
}

/**
 * Make authenticated API request (with session cookie)
 */
async function authenticatedFetch(url, options = {}) {
    const defaultOptions = {
        credentials: 'include',  // CRITICAL: Include session cookie
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...(options.headers || {})
        }
    };
    
    try {
        const response = await fetch(url, mergedOptions);
        
        // Check for authentication errors
        if (response.status === 401) {
            const data = await response.json();
            
            if (data.login_required) {
                console.error('🔒 Session expired or not authenticated');
                isAuthenticated = false;
                updateAuthUI(false);
                showLoginModal();
                return null;
            }
        }
        
        if (response.status === 429) {
            console.error('⏱️ Rate limit exceeded');
            showError('Too many requests. Please wait a minute.');
            return null;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('API request failed:', error);
        showError(`Request failed: ${error.message}`);
        return null;
    }
}

/**
 * Update UI based on auth status
 */
function updateAuthUI(authenticated, username = '') {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userDisplay = document.getElementById('userDisplay');
    const useRealDataCheckbox = document.getElementById('useRealData');
    
    if (authenticated) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'block';
        if (userDisplay) {
            userDisplay.textContent = `👤 ${username}`;
            userDisplay.style.display = 'block';
        }
        if (useRealDataCheckbox) {
            useRealDataCheckbox.disabled = false;
        }
    } else {
        if (loginBtn) loginBtn.style.display = 'block';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (userDisplay) userDisplay.style.display = 'none';
        if (useRealDataCheckbox) {
            useRealDataCheckbox.disabled = true;
            useRealDataCheckbox.checked = false;
        }
        CONFIG.useRealData = false;
        localStorage.setItem('useRealData', 'false');
    }
}

// ============================================
// ACCOUNT FILTERING
// ============================================

async function loadAccounts() {
    if (!isAuthenticated) {
        accountsList = [];
        renderAccountsFilter([]);
        return;
    }
    
    const response = await authenticatedFetch(`${CONFIG.apiEndpoint}/accounts`);
    if (response && response.success) {
        accountsList = response.data || [];
        renderAccountsFilter(accountsList);
    } else {
        accountsList = [];
        renderAccountsFilter([]);
    }
}

function persistSelectedAccounts() {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(Array.from(selectedAccountIds)));
}

function renderAccountsFilter(accounts) {
    const container = document.getElementById('accountsFilter');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!isAuthenticated) {
        const info = document.createElement('p');
        info.className = 'setting-help';
        info.textContent = 'Login required to load accounts.';
        container.appendChild(info);
        return;
    }
    
    if (!accounts.length) {
        const info = document.createElement('p');
        info.className = 'setting-help';
        info.textContent = 'No accounts found.';
        container.appendChild(info);
        return;
    }
    
    if (selectedAccountIds.size === 0) {
        accounts.forEach(account => selectedAccountIds.add(String(account.id)));
        persistSelectedAccounts();
    }
    
    const actions = document.createElement('div');
    actions.className = 'accounts-actions';
    
    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.textContent = 'Select all';
    selectAllBtn.addEventListener('click', () => {
        selectedAccountIds = new Set(accounts.map(a => String(a.id)));
        persistSelectedAccounts();
        renderAccountsFilter(accounts);
    });
    
    actions.appendChild(selectAllBtn);
    container.appendChild(actions);
    
    accounts.forEach(account => {
        const label = document.createElement('label');
        label.className = 'account-option';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedAccountIds.has(String(account.id));
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                selectedAccountIds.add(String(account.id));
            } else {
                selectedAccountIds.delete(String(account.id));
            }
            persistSelectedAccounts();
        });
        
        const text = document.createElement('span');
        text.textContent = `${account.description} (${account.balance?.currency || 'EUR'})`;
        
        label.appendChild(checkbox);
        label.appendChild(text);
        container.appendChild(label);
    });
}

/**
 * Show login modal
 */
function showLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('loginUsername')?.focus();
    }
}

/**
 * Hide login modal
 */
function hideLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.remove('active');
        // Clear password field for security
        const passwordField = document.getElementById('loginPassword');
        if (passwordField) passwordField.value = '';
    }
}

/**
 * Handle login form submission
 */
async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('loginUsername')?.value;
    const password = document.getElementById('loginPassword')?.value;
    
    if (!username || !password) {
        showError('Please enter username and password');
        return;
    }
    
    const loginButton = document.getElementById('loginSubmit');
    if (loginButton) {
        loginButton.disabled = true;
        loginButton.textContent = 'Logging in...';
    }
    
    const success = await login(username, password);
    
    if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = 'Login';
    }
    
    if (!success) {
        // Error already shown by login()
    }
}

// ============================================
// ERROR NOTIFICATIONS
// ============================================

function showError(message) {
    const notification = document.createElement('div');
    notification.className = 'error-notification';
    notification.innerHTML = `
        <i class="fas fa-exclamation-circle"></i>
        <span>${message}</span>
    `;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(239, 68, 68, 0.95);
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Bunq Dashboard Initializing (Session Auth)...');
    
    // Initialize particles
    if (CONFIG.enableParticles) {
        initializeParticles();
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Check authentication status
    const authenticated = await checkAuthStatus();
    
    // Load initial data
    if (CONFIG.useRealData && authenticated) {
        await loadRealData();
    } else {
        loadDemoData();
    }
    
    // Auto-refresh if enabled
    if (CONFIG.refreshInterval > 0) {
        startAutoRefresh();
    }
});

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    // Login/Logout
    document.getElementById('loginBtn')?.addEventListener('click', showLoginModal);
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    document.getElementById('closeLogin')?.addEventListener('click', hideLoginModal);
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    
    // Refresh button
    document.getElementById('refreshBtn')?.addEventListener('click', refreshData);
    
    // Theme toggle
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
    
    // Settings
    document.getElementById('settingsBtn')?.addEventListener('click', openSettings);
    document.getElementById('closeSettings')?.addEventListener('click', closeSettings);
    document.getElementById('saveSettings')?.addEventListener('click', saveSettings);
    
    // Time range
    document.getElementById('timeRange')?.addEventListener('change', (e) => {
        CONFIG.timeRange = e.target.value === 'all' ? 9999 : parseInt(e.target.value);
        refreshData();
    });
    
    // Real data toggle
    document.getElementById('useRealData')?.addEventListener('change', async (e) => {
        CONFIG.useRealData = e.target.checked;
        localStorage.setItem('useRealData', CONFIG.useRealData);
        
        if (CONFIG.useRealData && !isAuthenticated) {
            showLoginModal();
            e.target.checked = false;
            CONFIG.useRealData = false;
        } else {
            await refreshData();
        }
    });
    
    // Animation controls
    document.getElementById('play3D')?.addEventListener('click', play3DAnimation);
    document.getElementById('playRace')?.addEventListener('click', playRacingAnimation);
    document.getElementById('raceSlider')?.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10);
        updateRacingChart(value);
    });
}

// ============================================
// DATA LOADING
// ============================================

async function loadRealData() {
    if (!isAuthenticated) {
        console.warn('⚠️ Not authenticated - cannot load real data');
        showLoginModal();
        return;
    }
    
    showLoading();
    
    try {
        console.log('📡 Fetching real data from Bunq API...');
        
        const pageSize = 500;
        const maxPages = 20;
        let page = 1;
        let all = [];
        let total = null;
        let lastResponse = null;
        
        const accountParam = buildAccountFilterParam();
        const excludeParam = `&exclude_internal=${CONFIG.excludeInternalTransfers}`;
        
        while (page <= maxPages) {
            const url = `${CONFIG.apiEndpoint}/transactions?days=${CONFIG.timeRange}&page=${page}&page_size=${pageSize}${accountParam}${excludeParam}`;
            const response = await authenticatedFetch(url);
            lastResponse = response;
            
            if (!response || !response.success) {
                console.error('❌ Failed to load real data');
                break;
            }
            
            if (total === null) total = response.count;
            all = all.concat(response.data || []);
            
            if (!response.data || response.data.length < pageSize || all.length >= response.count) {
                break;
            }
            
            page += 1;
        }
        
        if (all.length) {
            transactionsData = all.map(t => ({
                ...t,
                date: new Date(t.date),
                color: getCategoryColor(t.category)
            }));
            
            console.log(`✅ Loaded ${transactionsData.length} real transactions`);
            processAndRenderData(transactionsData);
        } else if (all.length === 0 && total === 0) {
            console.warn('⚠️ No transactions found');
            transactionsData = [];
            processAndRenderData([]);
        } else if (lastResponse === null) {
            // Session expired - modal already shown
            loadDemoData();
        }
        
    } catch (error) {
        console.error('❌ Error loading real data:', error);
        loadDemoData();
    } finally {
        hideLoading();
        updateLastUpdateTime();
    }
}

function loadDemoData() {
    showLoading();
    
    console.log('📊 Generating demo data...');
    
    setTimeout(() => {
        transactionsData = generateDemoTransactions(CONFIG.timeRange);
        processAndRenderData(transactionsData);
        hideLoading();
        updateLastUpdateTime();
    }, 1500);
}

function getCategoryColor(category) {
    const colors = {
        'Boodschappen': '#3b82f6',
        'Horeca': '#8b5cf6',
        'Vervoer': '#ec4899',
        'Wonen': '#ef4444',
        'Utilities': '#f59e0b',
        'Shopping': '#10b981',
        'Entertainment': '#06b6d4',
        'Zorg': '#6366f1',
        'Salaris': '#22c55e',
        'Internal Transfer': '#94a3b8',
        'Overig': '#6b7280'
    };
    return colors[category] || '#6b7280';
}

function generateDemoTransactions(days) {
    // ... Keep existing demo transaction generation code ...
    // (Same as before - no changes needed)
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
// DATA PROCESSING & RENDERING
// ============================================

function processAndRenderData(data) {
    console.log(`📊 Processing ${data.length} transactions...`);
    
    const filtered = applyClientFilters(data);
    const normalized = normalizeTransactions(filtered);
    const kpis = calculateKPIs(normalized);
    renderKPIs(kpis, normalized);

    renderCashflowChart(normalized);
    renderSankeyChart(normalized);
    renderSunburstChart(normalized);
    renderTimeTravelChart(normalized);
    renderHeatmapChart(normalized);
    renderMerchantsChart(normalized);
    renderRidgePlot(normalized);
    renderRacingChart(normalized);
    renderInsights(normalized, kpis);
    
    console.log('✅ All visualizations rendered!');
}

function buildAccountFilterParam() {
    if (!accountsList.length) return '';
    if (selectedAccountIds.size === 0 || selectedAccountIds.size === accountsList.length) {
        return '';
    }
    const ids = Array.from(selectedAccountIds).join(',');
    return `&account_ids=${encodeURIComponent(ids)}`;
}

function applyClientFilters(data) {
    let filtered = [...data];
    if (CONFIG.excludeInternalTransfers) {
        filtered = filtered.filter(t => !t.is_internal_transfer);
    }
    if (accountsList.length && selectedAccountIds.size > 0 && selectedAccountIds.size < accountsList.length) {
        const allowed = new Set(Array.from(selectedAccountIds).map(String));
        filtered = filtered.filter(t => allowed.has(String(t.account_id)));
    }
    return filtered;
}

function normalizeTransactions(data) {
    return data.map(t => ({
        ...t,
        date: t.date instanceof Date ? t.date : new Date(t.date),
        merchant: t.merchant || t.counterparty || t.description || 'Unknown',
        amount: Number(t.amount) || 0,
        category: t.category || 'Overig'
    }));
}

function calculateKPIs(data) {
    const income = data.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const expenses = Math.abs(data.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));
    const netSavings = income - expenses;
    const savingsRate = income > 0 ? (netSavings / income * 100) : 0;
    
    return { income, expenses, netSavings, savingsRate };
}

function formatCurrency(value) {
    return new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0
    }).format(value);
}

function formatPercent(value) {
    return `${value.toFixed(1)}%`;
}

function renderKPIs(kpis, data) {
    const totalIncome = document.getElementById('totalIncome');
    const totalExpenses = document.getElementById('totalExpenses');
    const netSavings = document.getElementById('netSavings');
    const savingsRate = document.getElementById('savingsRate');
    const incomeTrend = document.getElementById('incomeTrend');
    const expensesTrend = document.getElementById('expensesTrend');
    const savingsTrend = document.getElementById('savingsTrend');
    
    if (totalIncome) totalIncome.textContent = formatCurrency(kpis.income);
    if (totalExpenses) totalExpenses.textContent = formatCurrency(kpis.expenses);
    if (netSavings) netSavings.textContent = formatCurrency(kpis.netSavings);
    if (savingsRate) savingsRate.textContent = formatPercent(kpis.savingsRate);
    
    // Update savings ring
    const circle = document.getElementById('savingsCircle');
    if (circle) {
        const radius = 25;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference * (1 - Math.min(Math.max(kpis.savingsRate, 0), 100) / 100);
        circle.style.strokeDasharray = `${circumference} ${circumference}`;
        circle.style.strokeDashoffset = `${offset}`;
    }
    
    // Sparklines
    const daily = buildDailyTotals(data);
    const incomeSeries = daily.map(d => d.income);
    const expenseSeries = daily.map(d => d.expenses);
    const savingsSeries = daily.map(d => d.net);
    const mid = Math.floor(daily.length / 2);
    const calcChange = (series) => {
        const prior = series.slice(0, mid).reduce((sum, v) => sum + v, 0);
        const recent = series.slice(mid).reduce((sum, v) => sum + v, 0);
        return prior > 0 ? ((recent - prior) / prior) * 100 : 0;
    };
    const incomeChange = calcChange(incomeSeries);
    const expenseChange = calcChange(expenseSeries);
    const savingsChange = calcChange(savingsSeries);
    
    if (incomeTrend) {
        incomeTrend.textContent = `${incomeChange.toFixed(1)}%`;
        incomeTrend.parentElement?.classList.toggle('positive', incomeChange >= 0);
        incomeTrend.parentElement?.classList.toggle('negative', incomeChange < 0);
    }
    if (expensesTrend) {
        expensesTrend.textContent = `${expenseChange.toFixed(1)}%`;
        expensesTrend.parentElement?.classList.toggle('positive', expenseChange <= 0);
        expensesTrend.parentElement?.classList.toggle('negative', expenseChange > 0);
    }
    if (savingsTrend) {
        savingsTrend.textContent = `${savingsChange.toFixed(1)}%`;
        savingsTrend.parentElement?.classList.toggle('positive', savingsChange >= 0);
        savingsTrend.parentElement?.classList.toggle('negative', savingsChange < 0);
    }
    
    renderSparkline('incomeSparkline', incomeSeries, '#22c55e');
    renderSparkline('expensesSparkline', expenseSeries, '#ef4444');
    renderSparkline('savingsSparkline', savingsSeries, '#8b5cf6');
}

function renderSparkline(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    if (chartRegistry.chartjs[canvasId]) {
        chartRegistry.chartjs[canvasId].destroy();
    }
    
    chartRegistry.chartjs[canvasId] = new Chart(canvas, {
        type: 'line',
        data: {
            labels: data.map((_, i) => i),
            datasets: [{
                data,
                borderColor: color,
                backgroundColor: 'rgba(0,0,0,0)',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.4
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

function buildDailyTotals(data) {
    if (!data.length) return [];
    
    const dayMap = new Map();
    data.forEach(t => {
        const key = t.date.toISOString().slice(0, 10);
        if (!dayMap.has(key)) {
            dayMap.set(key, { date: new Date(key), income: 0, expenses: 0, net: 0 });
        }
        const entry = dayMap.get(key);
        if (t.amount >= 0) entry.income += t.amount;
        else entry.expenses += Math.abs(t.amount);
        entry.net += t.amount;
    });
    
    const dates = Array.from(dayMap.values()).map(d => d.date);
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    const series = [];
    for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        series.push(dayMap.get(key) || { date: new Date(d), income: 0, expenses: 0, net: 0 });
    }
    
    return series;
}

function renderCashflowChart(data) {
    const container = document.getElementById('cashflowChart');
    if (!container) return;
    
    const daily = buildDailyTotals(data);
    const x = daily.map(d => d.date);
    const net = daily.map(d => d.net);
    const income = daily.map(d => d.income);
    const expenses = daily.map(d => d.expenses);
    
    const traces = [
        {
            x,
            y: net,
            type: 'scatter',
            mode: 'lines',
            name: 'Net',
            line: { color: '#8b5cf6', width: 3 },
            fill: 'tozeroy',
            fillcolor: 'rgba(139, 92, 246, 0.15)'
        },
        {
            x,
            y: income,
            type: 'scatter',
            mode: 'lines',
            name: 'Income',
            line: { color: '#22c55e', width: 2 }
        },
        {
            x,
            y: expenses.map(v => -v),
            type: 'scatter',
            mode: 'lines',
            name: 'Expenses',
            line: { color: '#ef4444', width: 2 }
        }
    ];
    
    const layout = {
        margin: { t: 20, r: 20, l: 40, b: 40 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' },
        xaxis: { showgrid: false },
        yaxis: { zeroline: true, gridcolor: 'rgba(255,255,255,0.05)' },
        legend: { orientation: 'h', y: -0.2 }
    };
    
    Plotly.react(container, traces, layout, { displayModeBar: false, responsive: true });
}

function renderSankeyChart(data) {
    const container = document.getElementById('sankeyChart');
    if (!container) return;
    
    const categories = {};
    data.forEach(t => {
        const amount = t.amount;
        if (!categories[t.category]) {
            categories[t.category] = { income: 0, expenses: 0 };
        }
        if (amount >= 0) categories[t.category].income += amount;
        else categories[t.category].expenses += Math.abs(amount);
    });
    
    const categoryNames = Object.keys(categories);
    const nodes = ['Income', 'Expenses', ...categoryNames];
    const source = [];
    const target = [];
    const value = [];
    const colors = [];
    
    categoryNames.forEach((cat, idx) => {
        const nodeIndex = idx + 2;
        if (categories[cat].income > 0) {
            source.push(0);
            target.push(nodeIndex);
            value.push(categories[cat].income);
            colors.push('rgba(34,197,94,0.6)');
        }
        if (categories[cat].expenses > 0) {
            source.push(nodeIndex);
            target.push(1);
            value.push(categories[cat].expenses);
            colors.push('rgba(239,68,68,0.6)');
        }
    });
    
    const trace = {
        type: 'sankey',
        node: {
            label: nodes,
            pad: 15,
            thickness: 18,
            color: ['#22c55e', '#ef4444', ...categoryNames.map(getCategoryColor)]
        },
        link: {
            source,
            target,
            value,
            color: colors
        }
    };
    
    const layout = {
        margin: { t: 20, r: 20, l: 20, b: 20 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' }
    };
    
    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
}

function renderSunburstChart(data) {
    const container = document.getElementById('sunburstChart');
    if (!container) return;
    
    const categoryTotals = {};
    const merchantTotals = {};
    
    data.forEach(t => {
        const amount = t.amount;
        const category = t.category;
        const merchant = t.merchant || 'Unknown';
        if (!categoryTotals[category]) categoryTotals[category] = 0;
        if (!merchantTotals[category]) merchantTotals[category] = {};
        
        if (amount < 0) {
            categoryTotals[category] += Math.abs(amount);
            merchantTotals[category][merchant] = (merchantTotals[category][merchant] || 0) + Math.abs(amount);
        } else {
            categoryTotals[category] += amount;
        }
    });
    
    const labels = ['All', 'Income', 'Expenses'];
    const parents = ['', 'All', 'All'];
    const values = [0, 0, 0];
    
    Object.entries(categoryTotals).forEach(([cat, total]) => {
        const isIncome = data.some(t => t.category === cat && t.amount > 0);
        labels.push(cat);
        parents.push(isIncome ? 'Income' : 'Expenses');
        values.push(total);
        if (isIncome) values[1] += total;
        else values[2] += total;
    });
    values[0] = values[1] + values[2];
    
    Object.entries(merchantTotals).forEach(([cat, merchants]) => {
        const topMerchants = Object.entries(merchants)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6);
        topMerchants.forEach(([merchant, total]) => {
            labels.push(merchant);
            parents.push(cat);
            values.push(total);
        });
    });
    
    const trace = {
        type: 'sunburst',
        labels,
        parents,
        values,
        branchvalues: 'total',
        maxdepth: 3,
        insidetextorientation: 'radial'
    };
    
    const layout = {
        margin: { t: 20, r: 10, l: 10, b: 10 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' }
    };
    
    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
}

function renderTimeTravelChart(data) {
    const container = document.getElementById('timeTravelChart');
    if (!container) return;
    
    const sorted = [...data].sort((a, b) => a.date - b.date);
    let cumulative = 0;
    const x = [];
    const y = [];
    const z = [];
    
    sorted.forEach(t => {
        cumulative += t.amount;
        x.push(t.date);
        y.push(cumulative);
        z.push(t.amount);
    });
    
    const trace = {
        type: 'scatter3d',
        mode: 'lines+markers',
        x,
        y,
        z,
        line: { color: '#8b5cf6', width: 4 },
        marker: {
            size: 3,
            color: z,
            colorscale: 'Viridis',
            opacity: 0.8
        }
    };
    
    const layout = {
        margin: { t: 0, r: 0, l: 0, b: 0 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        scene: {
            xaxis: { title: 'Date', showgrid: false },
            yaxis: { title: 'Cumulative', showgrid: false },
            zaxis: { title: 'Amount', showgrid: false }
        },
        font: { color: '#cbd5f5' }
    };
    
    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
}

function renderHeatmapChart(data) {
    const container = document.getElementById('heatmapChart');
    if (!container) return;
    
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    data.forEach(t => {
        if (t.amount >= 0) return;
        const date = t.date;
        const day = (date.getDay() + 6) % 7; // Monday=0
        const hour = date.getHours();
        grid[day][hour] += Math.abs(t.amount);
    });
    
    const trace = {
        z: grid,
        x: Array.from({ length: 24 }, (_, i) => i),
        y: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        type: 'heatmap',
        colorscale: 'YlOrRd'
    };
    
    const layout = {
        margin: { t: 20, r: 10, l: 40, b: 30 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' }
    };
    
    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
}

function renderMerchantsChart(data) {
    const container = document.getElementById('merchantsChart');
    if (!container) return;
    
    const totals = {};
    data.forEach(t => {
        if (t.amount >= 0) return;
        const merchant = t.merchant || 'Unknown';
        totals[merchant] = (totals[merchant] || 0) + Math.abs(t.amount);
    });
    
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map(([name]) => name);
    const values = sorted.map(([, value]) => value);
    
    const trace = {
        type: 'bar',
        x: values,
        y: labels,
        orientation: 'h',
        marker: {
            color: '#8b5cf6'
        }
    };
    
    const layout = {
        margin: { t: 10, r: 10, l: 100, b: 30 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' },
        xaxis: { gridcolor: 'rgba(255,255,255,0.05)' },
        yaxis: { gridcolor: 'rgba(255,255,255,0.05)' }
    };
    
    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
}

function renderRidgePlot(data) {
    const canvas = document.getElementById('ridgePlotCanvas');
    if (!canvas) return;
    
    const categories = {};
    data.forEach(t => {
        if (t.amount >= 0) return;
        const cat = t.category;
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(Math.abs(t.amount));
    });
    
    const topCategories = Object.entries(categories)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 4);
    
    const maxValue = Math.max(
        100,
        ...topCategories.flatMap(([, values]) => values)
    );
    const bins = 12;
    const binSize = maxValue / bins;
    const labels = Array.from({ length: bins }, (_, i) => Math.round((i + 1) * binSize));
    
    const datasets = topCategories.map(([cat, values], idx) => {
        const counts = Array(bins).fill(0);
        values.forEach(v => {
            const bin = Math.min(bins - 1, Math.floor(v / binSize));
            counts[bin] += 1;
        });
        return {
            label: cat,
            data: counts,
            borderColor: getCategoryColor(cat),
            backgroundColor: 'rgba(0,0,0,0)',
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0
        };
    });
    
    if (chartRegistry.chartjs.ridgePlot) {
        chartRegistry.chartjs.ridgePlot.destroy();
    }
    
    chartRegistry.chartjs.ridgePlot = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}

function buildMonthlyCategoryTotals(data) {
    const byMonth = {};
    data.forEach(t => {
        if (t.amount >= 0) return;
        const month = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
        if (!byMonth[month]) byMonth[month] = {};
        byMonth[month][t.category] = (byMonth[month][t.category] || 0) + Math.abs(t.amount);
    });
    
    const months = Object.keys(byMonth).sort();
    const categories = new Set();
    months.forEach(m => Object.keys(byMonth[m]).forEach(c => categories.add(c)));
    
    return { months, categories: Array.from(categories), byMonth };
}

function updateRacingChart(monthIndex) {
    if (!racingData || !racingData.months.length) return;
    const month = racingData.months[monthIndex];
    const totals = racingData.byMonth[month] || {};
    const items = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const labels = items.map(([cat]) => cat);
    const values = items.map(([, value]) => value);
    
    const container = document.getElementById('racingChart');
    if (!container) return;
    
    const trace = {
        type: 'bar',
        x: values,
        y: labels,
        orientation: 'h',
        marker: {
            color: labels.map(getCategoryColor)
        }
    };
    
    const layout = {
        margin: { t: 20, r: 20, l: 80, b: 30 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' },
        xaxis: { gridcolor: 'rgba(255,255,255,0.05)' },
        yaxis: { gridcolor: 'rgba(255,255,255,0.05)' }
    };
    
    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
    
    const raceMonth = document.getElementById('raceMonth');
    if (raceMonth) raceMonth.textContent = month;
}

function renderRacingChart(data) {
    const slider = document.getElementById('raceSlider');
    racingData = buildMonthlyCategoryTotals(data);
    if (!racingData.months.length) return;
    
    if (slider) {
        slider.max = racingData.months.length - 1;
        slider.value = racingData.months.length - 1;
    }
    
    updateRacingChart(racingData.months.length - 1);
}

function renderInsights(data, kpis) {
    const biggestCategory = document.getElementById('biggestCategory');
    const avgDaily = document.getElementById('avgDaily');
    const expensiveDay = document.getElementById('expensiveDay');
    const trendInsight = document.getElementById('trendInsight');
    
    const categoryTotals = {};
    data.forEach(t => {
        if (t.amount >= 0) return;
        categoryTotals[t.category] = (categoryTotals[t.category] || 0) + Math.abs(t.amount);
    });
    const biggest = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
    if (biggestCategory) {
        biggestCategory.textContent = biggest ? `${biggest[0]} (${formatCurrency(biggest[1])})` : 'N/A';
    }
    
    const daily = buildDailyTotals(data);
    const avg = daily.length ? daily.reduce((sum, d) => sum + d.expenses, 0) / daily.length : 0;
    if (avgDaily) avgDaily.textContent = formatCurrency(avg);
    
    const expensive = [...daily].sort((a, b) => b.expenses - a.expenses)[0];
    if (expensiveDay) {
        expensiveDay.textContent = expensive ? `${expensive.date.toLocaleDateString('nl-NL')} (${formatCurrency(expensive.expenses)})` : 'N/A';
    }
    
    const mid = Math.floor(daily.length / 2);
    const recent = daily.slice(mid).reduce((sum, d) => sum + d.expenses, 0);
    const prior = daily.slice(0, mid).reduce((sum, d) => sum + d.expenses, 0);
    const change = prior > 0 ? ((recent - prior) / prior) * 100 : 0;
    if (trendInsight) {
        const direction = change <= 0 ? 'down' : 'up';
        trendInsight.textContent = `Spending trend is ${direction} (${change.toFixed(1)}%)`;
    }
}

// ============================================
// UI FUNCTIONS
// ============================================

function showLoading() {
    document.getElementById('loading-screen')?.classList.remove('hidden');
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.style.display = 'none';
}

function hideLoading() {
    document.getElementById('loading-screen')?.classList.add('hidden');
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.style.display = 'block';
}

async function refreshData() {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.classList.add('loading');
    
    if (CONFIG.useRealData && isAuthenticated) {
        await loadRealData();
    } else {
        loadDemoData();
    }
    
    setTimeout(() => {
        if (btn) btn.classList.remove('loading');
    }, 1500);
}

function updateLastUpdateTime() {
    const now = new Date();
    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
        lastUpdate.textContent = `Last updated: ${now.toLocaleTimeString('nl-NL')}`;
    }
}

function startAutoRefresh() {
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    if (CONFIG.refreshInterval > 0) {
        refreshIntervalId = setInterval(() => {
            refreshData();
        }, CONFIG.refreshInterval * 60 * 1000);
    }
}

// Settings functions
function openSettings() {
    document.getElementById('apiEndpoint').value = CONFIG.apiEndpoint;
    document.getElementById('refreshInterval').value = CONFIG.refreshInterval;
    document.getElementById('enableAnimations').checked = CONFIG.enableAnimations;
    document.getElementById('enableParticles').checked = CONFIG.enableParticles;
    document.getElementById('useRealData').checked = CONFIG.useRealData;
    document.getElementById('excludeInternalTransfers').checked = CONFIG.excludeInternalTransfers;
    renderAccountsFilter(accountsList);
    
    document.getElementById('settingsModal')?.classList.add('active');
}

function closeSettings() {
    document.getElementById('settingsModal')?.classList.remove('active');
}

function saveSettings() {
    CONFIG.apiEndpoint = document.getElementById('apiEndpoint').value;
    CONFIG.refreshInterval = parseInt(document.getElementById('refreshInterval').value);
    CONFIG.enableAnimations = document.getElementById('enableAnimations').checked;
    CONFIG.enableParticles = document.getElementById('enableParticles').checked;
    CONFIG.excludeInternalTransfers = document.getElementById('excludeInternalTransfers').checked;
    
    localStorage.setItem('apiEndpoint', CONFIG.apiEndpoint);
    localStorage.setItem('refreshInterval', CONFIG.refreshInterval);
    localStorage.setItem('enableAnimations', CONFIG.enableAnimations);
    localStorage.setItem('enableParticles', CONFIG.enableParticles);
    localStorage.setItem('excludeInternalTransfers', CONFIG.excludeInternalTransfers);
    
    closeSettings();
    
    if (CONFIG.enableParticles) {
        initializeParticles();
    } else if (window.pJSDom && window.pJSDom.length > 0) {
        window.pJSDom[0].pJS.fn.vendors.destroypJS();
        window.pJSDom = [];
    }
    
    console.log('✅ Settings saved');
    refreshData();
}

function toggleTheme() {
    const body = document.body;
    const toggle = document.getElementById('themeToggle');
    const icon = toggle?.querySelector('i');
    const isLight = body.classList.contains('light-theme');
    
    if (isLight) {
        body.classList.remove('light-theme');
        body.classList.add('dark-theme');
        if (icon) icon.className = 'fas fa-moon';
    } else {
        body.classList.remove('dark-theme');
        body.classList.add('light-theme');
        if (icon) icon.className = 'fas fa-sun';
    }
}

function initializeParticles() {
    if (!window.particlesJS) return;
    if (window.pJSDom && window.pJSDom.length > 0) return;
    
    particlesJS('particles-js', {
        particles: {
            number: { value: 60, density: { enable: true, value_area: 800 } },
            color: { value: '#667eea' },
            shape: { type: 'circle' },
            opacity: { value: 0.3 },
            size: { value: 3, random: true },
            line_linked: { enable: true, distance: 150, color: '#667eea', opacity: 0.2, width: 1 },
            move: { enable: true, speed: 1.2, direction: 'none', out_mode: 'out' }
        },
        interactivity: {
            detect_on: 'canvas',
            events: { onhover: { enable: true, mode: 'repulse' } },
            modes: { repulse: { distance: 80 } }
        },
        retina_detect: true
    });
}

function play3DAnimation() {
    const container = document.getElementById('timeTravelChart');
    if (!container) return;
    
    const button = document.getElementById('play3D');
    if (timeTravelSpinInterval) {
        clearInterval(timeTravelSpinInterval);
        timeTravelSpinInterval = null;
        button?.classList.remove('active');
        return;
    }
    
    let angle = 0;
    button?.classList.add('active');
    timeTravelSpinInterval = setInterval(() => {
        angle += 0.03;
        Plotly.relayout(container, {
            'scene.camera.eye': {
                x: 1.6 * Math.cos(angle),
                y: 1.6 * Math.sin(angle),
                z: 0.6
            }
        });
    }, 50);
}

function playRacingAnimation() {
    const slider = document.getElementById('raceSlider');
    const button = document.getElementById('playRace');
    if (!slider || !racingData) return;
    
    if (racingPlayInterval) {
        clearInterval(racingPlayInterval);
        racingPlayInterval = null;
        button?.classList.remove('active');
        return;
    }
    
    button?.classList.add('active');
    racingPlayInterval = setInterval(() => {
        let current = parseInt(slider.value, 10);
        if (current >= parseInt(slider.max, 10)) {
            clearInterval(racingPlayInterval);
            racingPlayInterval = null;
            button?.classList.remove('active');
            return;
        }
        slider.value = current + 1;
        updateRacingChart(current + 1);
    }, 700);
}

console.log('✅ Bunq Dashboard Ready (Session Auth - No localStorage credentials)!');
