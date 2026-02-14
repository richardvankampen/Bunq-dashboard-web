// ============================================
// BUNQ FINANCIAL DASHBOARD - SESSION AUTH
// No credentials stored in localStorage!
// ============================================

// Global Configuration
const DEFAULT_API_ENDPOINT = `${window.location.origin}/api`;
const ACCOUNT_STORAGE_KEY = 'selectedAccountIds';
const DEFAULT_NAS_WORKDIR = '/volume1/docker/bunq-dashboard';
const ADMIN_MAINTENANCE_OPTIONS_KEY = 'adminMaintenanceOptions';
const DEFAULT_ADMIN_MAINTENANCE_OPTIONS = {
    auto_target_ip: false,
    deactivate_others: false,
    refresh_key: false,
    force_recreate: true,
    clear_runtime_cache: true,
    load_status_after: true
};
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
let balanceMetrics = null;
let balanceHistoryData = null;
let adminStatusData = null;
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

function loadAdminMaintenanceOptions() {
    try {
        const stored = JSON.parse(localStorage.getItem(ADMIN_MAINTENANCE_OPTIONS_KEY) || '{}');
        return {
            ...DEFAULT_ADMIN_MAINTENANCE_OPTIONS,
            ...(stored && typeof stored === 'object' ? stored : {})
        };
    } catch (error) {
        console.warn('Failed to parse admin maintenance options from storage');
        return { ...DEFAULT_ADMIN_MAINTENANCE_OPTIONS };
    }
}

function saveAdminMaintenanceOptions(options) {
    localStorage.setItem(ADMIN_MAINTENANCE_OPTIONS_KEY, JSON.stringify(options));
}

function getAdminMaintenanceOptionsFromUI() {
    return {
        auto_target_ip: document.getElementById('adminOptionAutoTargetIp')?.checked ?? DEFAULT_ADMIN_MAINTENANCE_OPTIONS.auto_target_ip,
        deactivate_others: document.getElementById('adminDeactivateOtherIps')?.checked ?? DEFAULT_ADMIN_MAINTENANCE_OPTIONS.deactivate_others,
        refresh_key: document.getElementById('adminOptionRefreshKey')?.checked ?? DEFAULT_ADMIN_MAINTENANCE_OPTIONS.refresh_key,
        force_recreate: document.getElementById('adminOptionForceRecreate')?.checked ?? DEFAULT_ADMIN_MAINTENANCE_OPTIONS.force_recreate,
        clear_runtime_cache: document.getElementById('adminOptionClearRuntimeCache')?.checked ?? DEFAULT_ADMIN_MAINTENANCE_OPTIONS.clear_runtime_cache,
        load_status_after: document.getElementById('adminOptionLoadStatusAfter')?.checked ?? DEFAULT_ADMIN_MAINTENANCE_OPTIONS.load_status_after
    };
}

function applyAdminMaintenanceOptionsToUI() {
    const options = loadAdminMaintenanceOptions();
    const optionAutoTargetIp = document.getElementById('adminOptionAutoTargetIp');
    const optionRefreshKey = document.getElementById('adminOptionRefreshKey');
    const optionForceRecreate = document.getElementById('adminOptionForceRecreate');
    const optionClearRuntimeCache = document.getElementById('adminOptionClearRuntimeCache');
    const optionLoadStatusAfter = document.getElementById('adminOptionLoadStatusAfter');
    const optionDeactivateOthers = document.getElementById('adminDeactivateOtherIps');
    const whitelistIpInput = document.getElementById('adminWhitelistIp');

    if (optionAutoTargetIp) optionAutoTargetIp.checked = Boolean(options.auto_target_ip);
    if (optionRefreshKey) optionRefreshKey.checked = Boolean(options.refresh_key);
    if (optionForceRecreate) optionForceRecreate.checked = Boolean(options.force_recreate);
    if (optionClearRuntimeCache) optionClearRuntimeCache.checked = Boolean(options.clear_runtime_cache);
    if (optionLoadStatusAfter) optionLoadStatusAfter.checked = Boolean(options.load_status_after);
    if (optionDeactivateOthers) optionDeactivateOthers.checked = Boolean(options.deactivate_others);

    if (whitelistIpInput) {
        whitelistIpInput.disabled = Boolean(options.auto_target_ip);
        whitelistIpInput.placeholder = options.auto_target_ip
            ? 'IPv4 (auto: huidige egress IP)'
            : 'IPv4 (bijv. 8.8.8.8)';
    }
}

function handleAdminMaintenanceOptionChange() {
    const options = getAdminMaintenanceOptionsFromUI();
    saveAdminMaintenanceOptions(options);
    applyAdminMaintenanceOptionsToUI();
}

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
        balanceHistoryData = null;
        renderAccountsFilter([]);
        return;
    }
    
    const response = await authenticatedFetch(`${CONFIG.apiEndpoint}/accounts`);
    if (response && response.success) {
        accountsList = response.data || [];
        renderAccountsFilter(accountsList);
        await loadBalanceHistory(CONFIG.timeRange);
    } else {
        accountsList = [];
        balanceHistoryData = null;
        renderAccountsFilter([]);
    }
}

async function loadBalanceHistory(days = CONFIG.timeRange) {
    if (!isAuthenticated) {
        balanceHistoryData = null;
        return null;
    }

    try {
        const response = await fetch(`${CONFIG.apiEndpoint}/history/balances?days=${days}`, {
            credentials: 'include'
        });
        if (!response.ok) {
            balanceHistoryData = null;
            return null;
        }
        const payload = await response.json();
        if (payload && payload.success && payload.data) {
            balanceHistoryData = payload.data;
            return balanceHistoryData;
        }
    } catch (error) {
        console.warn('Unable to load balance history:', error);
    }

    balanceHistoryData = null;
    return null;
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

    applyVisualPreferences();

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
    document.getElementById('closeBalanceDetail')?.addEventListener('click', closeBalanceDetail);
    document.getElementById('adminLoadStatus')?.addEventListener('click', loadAdminStatus);
    document.getElementById('adminCheckEgressIp')?.addEventListener('click', checkAdminEgressIp);
    document.getElementById('adminSetWhitelistIp')?.addEventListener('click', setBunqWhitelistIp);
    document.getElementById('adminReinitBunq')?.addEventListener('click', reinitializeBunqContext);
    document.getElementById('adminRunMaintenance')?.addEventListener('click', runBundledAdminMaintenance);
    document.getElementById('adminShowInstallUpdateCmd')?.addEventListener('click', () => {
        renderAdminTerminalPanel('installUpdate');
    });
    document.getElementById('adminShowRestartCmd')?.addEventListener('click', () => {
        renderAdminTerminalPanel('restartValidate');
    });
    document.getElementById('adminOptionAutoTargetIp')?.addEventListener('change', handleAdminMaintenanceOptionChange);
    document.getElementById('adminOptionRefreshKey')?.addEventListener('change', handleAdminMaintenanceOptionChange);
    document.getElementById('adminOptionForceRecreate')?.addEventListener('change', handleAdminMaintenanceOptionChange);
    document.getElementById('adminOptionClearRuntimeCache')?.addEventListener('change', handleAdminMaintenanceOptionChange);
    document.getElementById('adminOptionLoadStatusAfter')?.addEventListener('change', handleAdminMaintenanceOptionChange);
    document.getElementById('adminDeactivateOtherIps')?.addEventListener('change', handleAdminMaintenanceOptionChange);
    document.getElementById('adminWhitelistIp')?.addEventListener('input', () => {
        const ipInputEl = document.getElementById('adminWhitelistIp');
        const autoTargetEl = document.getElementById('adminOptionAutoTargetIp');
        if (ipInputEl && autoTargetEl && ipInputEl.value.trim()) {
            autoTargetEl.checked = false;
            handleAdminMaintenanceOptionChange();
        }
    });
    document.getElementById('adminTerminalPanel')?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-copy-command]');
        if (!button) return;
        const command = button.getAttribute('data-copy-command') || '';
        if (!command) return;
        try {
            await copyTextToClipboard(command);
            renderAdminStatusPanel(adminStatusData, 'Command copied to clipboard.', false);
        } catch (error) {
            renderAdminStatusPanel(adminStatusData, 'Copy failed. Select command manually.', true);
        }
    });
    
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

    document.querySelectorAll('.clickable-kpi').forEach((card) => {
        card.addEventListener('click', () => {
            const accountType = card.getAttribute('data-account-type');
            if (accountType) {
                showBalanceDetail(accountType);
            }
        });
    });

    document.querySelectorAll('.clickable-kpi-detail').forEach((card) => {
        card.addEventListener('click', (event) => {
            if (event.target.closest('button')) return;
            const detailType = card.getAttribute('data-kpi-detail');
            if (detailType) {
                showTransactionDetail(detailType);
            }
        });
    });

    document.querySelectorAll('.action-btn[data-viz-detail]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const detailType = button.getAttribute('data-viz-detail');
            if (detailType) {
                showTransactionDetail(detailType);
            }
        });
    });

    document.querySelectorAll('.clickable-insight[data-insight-detail]').forEach((card) => {
        card.addEventListener('click', (event) => {
            if (event.target.closest('button')) return;
            const detailType = card.getAttribute('data-insight-detail');
            if (detailType) {
                showTransactionDetail(detailType);
            }
        });
    });

    document.getElementById('moneyFlowCard')?.addEventListener('click', (event) => {
        if (event.target.closest('.action-btn')) return;
        showTransactionDetail('money-flow');
    });

    document.getElementById('balanceDetailModal')?.addEventListener('click', (event) => {
        if (event.target.id === 'balanceDetailModal') {
            closeBalanceDetail();
        }
    });

    // Card actions (fullscreen)
    setupCardActionButtons();

    // Keep charts responsive when viewport size changes
    window.addEventListener('resize', () => {
        resizeAllCharts();
    });
}

function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
}

async function requestElementFullscreen(element) {
    if (element.requestFullscreen) {
        await element.requestFullscreen();
        return;
    }
    if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
        return;
    }
    if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
    }
}

async function exitBrowserFullscreen() {
    if (document.exitFullscreen) {
        await document.exitFullscreen();
        return;
    }
    if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
        return;
    }
    if (document.msExitFullscreen) {
        document.msExitFullscreen();
    }
}

async function toggleCardFullscreen(card) {
    const fullscreenElement = getFullscreenElement();
    if (fullscreenElement === card) {
        await exitBrowserFullscreen();
        return;
    }
    if (fullscreenElement) {
        await exitBrowserFullscreen();
    }
    await requestElementFullscreen(card);
}

function updateFullscreenButtonState() {
    const fullscreenElement = getFullscreenElement();
    const buttons = document.querySelectorAll('.action-btn[title="Fullscreen"], .action-btn[title="Exit Fullscreen"]');

    buttons.forEach((button) => {
        const card = button.closest('.viz-card');
        const icon = button.querySelector('i');
        const isActive = Boolean(fullscreenElement && card && fullscreenElement === card);

        button.classList.toggle('is-active', isActive);
        button.title = isActive ? 'Exit Fullscreen' : 'Fullscreen';

        if (icon) {
            icon.classList.toggle('fa-expand', !isActive);
            icon.classList.toggle('fa-compress', isActive);
        }
    });

    setTimeout(resizeAllCharts, 150);
}

function setupCardActionButtons() {
    const fullscreenButtons = document.querySelectorAll('.action-btn[title="Fullscreen"]');
    fullscreenButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            const card = button.closest('.viz-card');
            if (!card) return;
            try {
                await toggleCardFullscreen(card);
            } catch (error) {
                console.error('Fullscreen failed:', error);
            }
        });
    });

    const downloadButtons = document.querySelectorAll('.action-btn[title="Download"]');
    downloadButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            const card = button.closest('.viz-card');
            if (!card || !window.Plotly) return;
            const plot = card.querySelector('#cashflowChart, #sankeyChart, #sunburstChart, #timeTravelChart, #heatmapChart, #merchantsChart, #racingChart');
            if (!plot) return;
            try {
                await window.Plotly.downloadImage(plot, {
                    format: 'png',
                    filename: `${plot.id}-${new Date().toISOString().slice(0, 10)}`,
                    width: 1600,
                    height: 900,
                    scale: 1.5
                });
            } catch (error) {
                console.error('Download failed:', error);
            }
        });
    });

    document.addEventListener('fullscreenchange', updateFullscreenButtonState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButtonState);
    document.addEventListener('MSFullscreenChange', updateFullscreenButtonState);
}

function resizeAllCharts() {
    const plotlyContainers = [
        'cashflowChart',
        'sankeyChart',
        'sunburstChart',
        'timeTravelChart',
        'heatmapChart',
        'merchantsChart',
        'racingChart'
    ];

    if (window.Plotly?.Plots?.resize) {
        plotlyContainers.forEach((id) => {
            const container = document.getElementById(id);
            if (!container) return;
            try {
                window.Plotly.Plots.resize(container);
            } catch (error) {
                // Safe no-op: ignore containers that have no Plotly instance yet.
            }
        });
    }

    Object.values(chartRegistry.chartjs).forEach((chart) => {
        try {
            chart?.resize();
        } catch (error) {
            // Safe no-op for charts that are not ready yet.
        }
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
        await loadAccounts();
        
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

function hexToRgba(hex, alpha = 1) {
    const clean = String(hex || '').replace('#', '');
    if (clean.length !== 6) return `rgba(107,114,128,${alpha})`;
    const num = Number.parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}

function classifyAccountType(account) {
    const declaredType = String(account?.account_type || '').toLowerCase();
    if (['checking', 'savings', 'investment'].includes(declaredType)) {
        return declaredType;
    }

    const fingerprint = `${account?.description || ''} ${account?.account_class || ''}`.toLowerCase();
    if (
        fingerprint.includes('savings')
        || fingerprint.includes('spaar')
        || fingerprint.includes('reserve')
        || fingerprint.includes('buffer')
        || fingerprint.includes('onvoorzien')
        || fingerprint.includes('emergency')
        || fingerprint.includes('vakantie')
        || fingerprint.includes('doel')
        || fingerprint.includes('goal')
    ) return 'savings';
    if (fingerprint.includes('investment') || fingerprint.includes('crypto') || fingerprint.includes('belegging')) return 'investment';
    return 'checking';
}

function toDateKey(date) {
    return date.toISOString().slice(0, 10);
}

function collectDateRangeKeys(transactions) {
    if (!transactions.length) return [toDateKey(new Date())];
    const keys = new Set();
    transactions.forEach((tx) => {
        if (!(tx.date instanceof Date) || Number.isNaN(tx.date.getTime())) return;
        keys.add(toDateKey(tx.date));
    });
    if (!keys.size) {
        keys.add(toDateKey(new Date()));
    }
    return Array.from(keys).sort();
}

function calculateBalanceMetrics(transactions, accounts, historyData = null) {
    const validAccounts = (accounts || [])
        .filter((acc) => acc && acc.balance && typeof acc.balance.value !== 'undefined')
        .map((acc) => ({
            ...acc,
            id: String(acc.id),
            account_type: classifyAccountType(acc),
            balanceValue: Number(acc.balance.value) || 0,
            balanceCurrency: String(acc.balance.currency || 'EUR').toUpperCase(),
            balanceEurValue: Number.isFinite(Number(acc?.balance_eur?.value))
                ? Number(acc.balance_eur.value)
                : (
                    String(acc?.balance?.currency || 'EUR').toUpperCase() === 'EUR'
                        ? (Number(acc.balance.value) || 0)
                        : null
                )
        }));

    if (!validAccounts.length) {
        return null;
    }

    const grouped = { checking: [], savings: [], investment: [] };
    const totals = { checking: 0, savings: 0, investment: 0 };
    let missingFxCount = 0;

    validAccounts.forEach((acc) => {
        grouped[acc.account_type] = grouped[acc.account_type] || [];
        grouped[acc.account_type].push(acc);
        if (acc.balanceEurValue === null) {
            missingFxCount += 1;
            return;
        }
        totals[acc.account_type] = (totals[acc.account_type] || 0) + acc.balanceEurValue;
    });

    const series = { checking: [], savings: [], investment: [] };

    if (historyData?.series) {
        ['checking', 'savings', 'investment'].forEach((accountType) => {
            const sourceSeries = Array.isArray(historyData.series[accountType])
                ? historyData.series[accountType]
                : [];
            series[accountType] = sourceSeries.map((point) => ({
                date: new Date(`${point.date}T00:00:00`),
                total: Number(point.total) || 0
            }));
        });

        if (historyData.account_breakdown) {
            ['checking', 'savings', 'investment'].forEach((accountType) => {
                const rows = Array.isArray(historyData.account_breakdown[accountType])
                    ? historyData.account_breakdown[accountType]
                    : [];
                grouped[accountType] = rows.map((row) => ({
                    ...row,
                    id: String(row.id),
                    account_type: classifyAccountType(row),
                    balanceValue: Number(row?.balance?.value) || 0,
                    balanceCurrency: String(row?.balance?.currency || 'EUR').toUpperCase(),
                    balanceEurValue: Number.isFinite(Number(row?.balance_eur?.value))
                        ? Number(row.balance_eur.value)
                        : (
                            String(row?.balance?.currency || 'EUR').toUpperCase() === 'EUR'
                                ? (Number(row.balance.value) || 0)
                                : null
                        )
                }));
            });
        }

        if (historyData.latest_totals) {
            ['checking', 'savings', 'investment'].forEach((accountType) => {
                const value = Number(historyData.latest_totals[accountType]);
                const hasBreakdown = (grouped[accountType] || []).length > 0;
                if (Number.isFinite(value) && !hasBreakdown) {
                    totals[accountType] = value;
                }
            });
        }

        if (Number.isFinite(Number(historyData.missing_fx_count))) {
            missingFxCount = Number(historyData.missing_fx_count);
        }
    } else {
        const accountsById = new Map(validAccounts.map((acc) => [String(acc.id), acc]));
        const dateKeys = collectDateRangeKeys(transactions);
        const dailyDelta = {};
        transactions.forEach((tx) => {
            const account = accountsById.get(String(tx.account_id));
            if (!account || account.balanceEurValue === null) return;
            const key = toDateKey(tx.date);
            if (!dailyDelta[key]) {
                dailyDelta[key] = { checking: 0, savings: 0, investment: 0 };
            }
            dailyDelta[key][account.account_type] = (dailyDelta[key][account.account_type] || 0) + (Number(tx.amount) || 0);
        });

        const running = { ...totals };
        for (let i = dateKeys.length - 1; i >= 0; i -= 1) {
            const key = dateKeys[i];
            const pointDate = new Date(`${key}T00:00:00`);

            ['checking', 'savings', 'investment'].forEach((type) => {
                series[type].unshift({ date: pointDate, total: running[type] || 0 });
            });

            const delta = dailyDelta[key];
            if (delta) {
                ['checking', 'savings', 'investment'].forEach((type) => {
                    running[type] = (running[type] || 0) - (delta[type] || 0);
                });
            }
        }
    }

    return {
        totals,
        grouped,
        series,
        missingFxCount
    };
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
    balanceMetrics = calculateBalanceMetrics(normalized, accountsList, balanceHistoryData);
    const kpis = calculateKPIs(normalized);
    renderKPIs(kpis, normalized);
    renderBalanceKPIs(balanceMetrics);

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

function resolveMerchantLabel(transaction) {
    const raw = [
        transaction?.merchant,
        transaction?.counterparty,
        transaction?.description
    ].find((value) => typeof value === 'string' && value.trim().length > 0);
    if (!raw) return 'Onbekend';
    return raw.trim();
}

function resolveCategoryLabel(transaction) {
    const raw = transaction?.category;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim();
    }
    return 'Overig';
}

function normalizeTransactions(data) {
    return data.map(t => ({
        ...t,
        date: t.date instanceof Date ? t.date : new Date(t.date),
        merchant: resolveMerchantLabel(t),
        amount: Number(t.amount) || 0,
        category: resolveCategoryLabel(t)
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
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

function formatCurrencyWithCode(value, currencyCode = 'EUR') {
    const code = String(currencyCode || 'EUR').toUpperCase();
    try {
        return new Intl.NumberFormat('nl-NL', {
            style: 'currency',
            currency: code,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
    } catch (error) {
        return `${Number(value || 0).toFixed(2)} ${code}`;
    }
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
    
    renderMetricMiniChart(
        'incomeSparkline',
        daily.map((point) => ({ date: point.date, total: point.income })),
        '#22c55e'
    );
    renderMetricMiniChart(
        'expensesSparkline',
        daily.map((point) => ({ date: point.date, total: point.expenses })),
        '#ef4444'
    );
    renderMetricMiniChart(
        'savingsSparkline',
        daily.map((point) => ({ date: point.date, total: point.net })),
        '#8b5cf6'
    );
}

function calculateSeriesChange(series) {
    if (!series || series.length < 2) return 0;
    const first = Number(series[0]) || 0;
    const last = Number(series[series.length - 1]) || 0;
    if (Math.abs(first) < 0.0001) return 0;
    return ((last - first) / Math.abs(first)) * 100;
}

function formatShortDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' });
}

function renderMetricMiniChart(canvasId, points, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const sourcePoints = Array.isArray(points) ? points : [];
    let normalizedPoints = sourcePoints;
    if (!normalizedPoints.length) {
        normalizedPoints = [
            { date: new Date(Date.now() - 24 * 60 * 60 * 1000), total: 0 },
            { date: new Date(), total: 0 }
        ];
    } else if (normalizedPoints.length === 1) {
        const only = normalizedPoints[0];
        const anchorDate = only?.date instanceof Date && !Number.isNaN(only.date.getTime())
            ? only.date
            : new Date();
        normalizedPoints = [
            { date: new Date(anchorDate.getTime() - 24 * 60 * 60 * 1000), total: Number(only.total) || 0 },
            { date: anchorDate, total: Number(only.total) || 0 }
        ];
    }
    const labels = normalizedPoints.map((point) => formatShortDate(point.date));
    const values = normalizedPoints.map((point) => Number(point.total) || 0);

    if (chartRegistry.chartjs[canvasId]) {
        chartRegistry.chartjs[canvasId].destroy();
    }

    chartRegistry.chartjs[canvasId] = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: values,
                borderColor: color,
                backgroundColor: hexToRgba(color, 0.12),
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => formatCurrency(context.parsed.y)
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: 4
                    },
                    grid: { display: false }
                },
                y: {
                    display: true,
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: 4,
                        callback: (tickValue) => formatCurrency(Number(tickValue))
                    },
                    grid: { color: 'rgba(148,163,184,0.12)' }
                }
            }
        }
    });
}

function renderBalanceKPIs(metrics) {
    const checkingEl = document.getElementById('checkingBalance');
    const savingsEl = document.getElementById('savingsBalance');
    const checkingTrendEl = document.getElementById('checkingTrend');
    const savingsTrendEl = document.getElementById('savingsBalanceTrend');

    if (!metrics) {
        if (checkingEl) checkingEl.textContent = 'N/A';
        if (savingsEl) savingsEl.textContent = 'N/A';
        if (checkingTrendEl) checkingTrendEl.textContent = 'N/A';
        if (savingsTrendEl) savingsTrendEl.textContent = 'N/A';
        ['checkingSparkline', 'savingsBalanceSparkline'].forEach((chartId) => {
            if (chartRegistry.chartjs[chartId]) {
                chartRegistry.chartjs[chartId].destroy();
                delete chartRegistry.chartjs[chartId];
            }
        });
        return;
    }

    if (checkingEl) checkingEl.textContent = formatCurrency(metrics.totals.checking || 0);
    if (savingsEl) savingsEl.textContent = formatCurrency(metrics.totals.savings || 0);

    const checkingPoints = (metrics.series.checking || []).length
        ? metrics.series.checking
        : [{ date: new Date(), total: Number(metrics.totals.checking || 0) }];
    const savingsPoints = (metrics.series.savings || []).length
        ? metrics.series.savings
        : [{ date: new Date(), total: Number(metrics.totals.savings || 0) }];
    const checkingSeries = checkingPoints.map((p) => p.total);
    const savingsSeries = savingsPoints.map((p) => p.total);

    const checkingChange = calculateSeriesChange(checkingSeries);
    const savingsChange = calculateSeriesChange(savingsSeries);

    if (checkingTrendEl) checkingTrendEl.textContent = `${checkingChange.toFixed(1)}%`;
    if (savingsTrendEl) savingsTrendEl.textContent = `${savingsChange.toFixed(1)}%`;

    renderMetricMiniChart('checkingSparkline', checkingPoints, '#38bdf8');
    renderMetricMiniChart('savingsBalanceSparkline', savingsPoints, '#22c55e');
}

function showBalanceDetail(type) {
    if (!balanceMetrics) return;

    const labels = {
        checking: 'Betaalrekeningen',
        savings: 'Spaarrekeningen',
        investment: 'Beleggingen / Crypto'
    };
    const label = labels[type] || 'Rekeningen';
    const accounts = [...(balanceMetrics.grouped[type] || [])].sort((a, b) => {
        const aName = (a.description || `Account ${a.id}`).toLocaleLowerCase('nl-NL');
        const bName = (b.description || `Account ${b.id}`).toLocaleLowerCase('nl-NL');
        return aName.localeCompare(bName, 'nl-NL');
    });
    const total = accounts.reduce((sum, acc) => sum + (Number(acc.balanceEurValue) || 0), 0);
    const nonEurNote = balanceMetrics.missingFxCount > 0
        ? ` (${balanceMetrics.missingFxCount} non-EUR rekening(en) zonder FX-rate)`
        : '';

    const rows = accounts.length
        ? accounts.map((acc) => ({
            label: acc.description || `Account ${acc.id}`,
            value: acc.balanceEurValue === null
                ? `${formatCurrencyWithCode(acc.balanceValue, acc.balanceCurrency)} (niet omgerekend)`
                : `${formatCurrency(acc.balanceEurValue)}${acc.balanceCurrency !== 'EUR' ? ` (${formatCurrencyWithCode(acc.balanceValue, acc.balanceCurrency)})` : ''}`
        }))
        : [{ label: 'Geen EUR-rekeningen beschikbaar.', value: '' }];

    let chartConfig = null;
    if (accounts.length) {
        const trace = {
            type: 'bar',
            orientation: 'h',
            x: accounts.map((acc) => Number(acc.balanceEurValue) || 0).reverse(),
            y: accounts.map((acc) => acc.description || `Account ${acc.id}`).reverse(),
            marker: {
                color: accounts.map((acc) => (
                    acc.account_type === 'savings' ? '#22c55e' :
                    acc.account_type === 'investment' ? '#f59e0b' :
                    '#38bdf8'
                )).reverse()
            },
            text: accounts.map((acc) => (
                acc.balanceEurValue === null
                    ? `${formatCurrencyWithCode(acc.balanceValue, acc.balanceCurrency)}`
                    : formatCurrency(acc.balanceEurValue)
            )).reverse(),
            textposition: 'auto',
            cliponaxis: false,
            hovertemplate: '%{y}<br>%{x:.2f} EUR<extra></extra>'
        };
        const layout = {
            margin: { t: 10, r: 90, l: 220, b: 34 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            xaxis: { gridcolor: 'rgba(255,255,255,0.08)' },
            yaxis: { automargin: true }
        };
        chartConfig = { trace, layout };
    }

    openDetailModal({
        title: `<i class="fas fa-wallet"></i> ${label} - Verdeling`,
        summary: `Totaal: ${formatCurrency(total)}${nonEurNote}`,
        rows,
        chart: chartConfig
    });
}

function closeBalanceDetail() {
    const modal = document.getElementById('balanceDetailModal');
    if (modal) modal.classList.remove('active');
}

function openDetailModal({ title, summary, rows, chart }) {
    const titleEl = document.getElementById('balanceDetailTitle');
    const summaryEl = document.getElementById('balanceDetailSummary');
    const listEl = document.getElementById('balanceDetailList');
    const chartEl = document.getElementById('balanceDetailChart');
    const modalEl = document.getElementById('balanceDetailModal');
    if (!titleEl || !summaryEl || !listEl || !chartEl || !modalEl) return;

    titleEl.innerHTML = title || '<i class="fas fa-chart-bar"></i> Detail';
    summaryEl.textContent = summary || '';
    listEl.innerHTML = (rows || []).map((row) => `
        <div class="balance-detail-row">
            <span class="balance-detail-row-name">${row.label}</span>
            <span class="balance-detail-row-value">${row.value}</span>
        </div>
    `).join('');

    if (chart && window.Plotly) {
        const traces = Array.isArray(chart.trace) ? chart.trace : [chart.trace];
        Plotly.react(chartEl, traces, chart.layout, { displayModeBar: false, responsive: true });
        chartEl.style.display = 'block';
    } else if (window.Plotly) {
        Plotly.purge(chartEl);
        chartEl.style.display = 'none';
    }

    modalEl.classList.add('active');
}

function getCurrentNormalizedTransactions() {
    if (!Array.isArray(transactionsData)) return [];
    const filtered = applyClientFilters(transactionsData);
    return normalizeTransactions(filtered);
}

function buildTransactionRows(transactions, options = {}) {
    const { limit = 200, includeAccount = true } = options;
    const accountById = new Map((accountsList || []).map((account) => [String(account.id), account]));
    return [...transactions]
        .sort((a, b) => b.date - a.date)
        .slice(0, limit)
        .map((transaction) => {
            const account = accountById.get(String(transaction.account_id));
            const accountLabel = includeAccount
                ? ` · ${account?.description || `Rekening ${transaction.account_id}`}`
                : '';
            const label = `${transaction.date.toLocaleDateString('nl-NL')} · ${resolveMerchantLabel(transaction)}${accountLabel}`;
            return {
                label,
                value: formatCurrency(transaction.amount)
            };
        });
}

function buildDailySeries(transactions, pickValue) {
    const perDay = new Map();
    transactions.forEach((transaction) => {
        const key = transaction.date.toISOString().slice(0, 10);
        perDay.set(key, (perDay.get(key) || 0) + pickValue(transaction));
    });
    return Array.from(perDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({ date: new Date(`${date}T00:00:00`), value }));
}

function showTransactionDetail(detailType) {
    const transactions = getCurrentNormalizedTransactions();

    if (!transactions.length) {
        openDetailModal({
            title: '<i class="fas fa-info-circle"></i> Detail',
            summary: 'Geen data beschikbaar voor de geselecteerde periode.',
            rows: [{ label: 'Geen transacties gevonden.', value: '' }],
            chart: null
        });
        return;
    }

    if (detailType === 'income' || detailType === 'expenses') {
        const isIncome = detailType === 'income';
        const subset = transactions.filter((transaction) => isIncome ? transaction.amount > 0 : transaction.amount < 0);
        const total = subset.reduce((sum, transaction) => sum + (isIncome ? transaction.amount : Math.abs(transaction.amount)), 0);
        const daily = buildDailySeries(subset, (transaction) => isIncome ? transaction.amount : Math.abs(transaction.amount));
        const trace = {
            type: 'scatter',
            mode: 'lines+markers',
            x: daily.map((point) => point.date),
            y: daily.map((point) => point.value),
            line: { color: isIncome ? '#22c55e' : '#ef4444', width: 2 },
            fill: 'tozeroy',
            fillcolor: isIncome ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)',
            hovertemplate: '%{x|%d-%m-%Y}<br>%{y:.2f} EUR<extra></extra>'
        };
        const layout = {
            margin: { t: 10, r: 20, l: 40, b: 30 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            xaxis: { showgrid: false },
            yaxis: { gridcolor: 'rgba(255,255,255,0.08)' }
        };

        openDetailModal({
            title: `<i class="fas ${isIncome ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i> ${isIncome ? 'Inkomsten' : 'Uitgaven'} - geselecteerde periode`,
            summary: `${subset.length} transacties · totaal ${formatCurrency(total)}`,
            rows: buildTransactionRows(subset),
            chart: { trace, layout }
        });
        return;
    }

    if (detailType === 'savings-transfers') {
        const savingsIds = new Set(
            (accountsList || [])
                .filter((account) => classifyAccountType(account) === 'savings')
                .map((account) => String(account.id))
        );
        const subset = transactions.filter((transaction) => savingsIds.has(String(transaction.account_id)));
        const deposits = subset.filter((transaction) => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
        const withdrawals = Math.abs(subset.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + transaction.amount, 0));
        const daily = buildDailySeries(subset, (transaction) => transaction.amount);

        const trace = {
            type: 'bar',
            x: daily.map((point) => point.date),
            y: daily.map((point) => point.value),
            marker: { color: daily.map((point) => point.value >= 0 ? '#22c55e' : '#ef4444') },
            hovertemplate: '%{x|%d-%m-%Y}<br>%{y:.2f} EUR<extra></extra>'
        };
        const layout = {
            margin: { t: 10, r: 20, l: 40, b: 30 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            xaxis: { showgrid: false },
            yaxis: { gridcolor: 'rgba(255,255,255,0.08)' }
        };

        openDetailModal({
            title: '<i class="fas fa-piggy-bank"></i> Spaarrekening mutaties',
            summary: `${subset.length} mutaties · stortingen ${formatCurrency(deposits)} · opnames ${formatCurrency(withdrawals)}`,
            rows: buildTransactionRows(subset),
            chart: { trace, layout }
        });
        return;
    }

    if (detailType === 'needs-vs-wants') {
        const summary = summarizeNeedsVsWants(transactions);
        const total = summary.essentialTotal + summary.discretionaryTotal;
        if (total <= 0.01) {
            openDetailModal({
                title: '<i class="fas fa-scale-balanced"></i> Needs vs Wants',
                summary: 'Geen uitgaven gevonden in de geselecteerde periode.',
                rows: [{ label: 'Geen uitgaven om te analyseren.', value: '' }],
                chart: null
            });
            return;
        }

        const topEssential = Object.entries(summary.essentialByCategory)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4);
        const topDiscretionary = Object.entries(summary.discretionaryByCategory)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4);

        const rows = [
            {
                label: 'Essentials totaal',
                value: `${formatCurrency(summary.essentialTotal)} (${((summary.essentialTotal / total) * 100).toFixed(1)}%)`
            },
            ...topEssential.map(([category, amount]) => ({
                label: `Essentials · ${category}`,
                value: formatCurrency(amount)
            })),
            {
                label: 'Discretionary totaal',
                value: `${formatCurrency(summary.discretionaryTotal)} (${((summary.discretionaryTotal / total) * 100).toFixed(1)}%)`
            },
            ...topDiscretionary.map(([category, amount]) => ({
                label: `Discretionary · ${category}`,
                value: formatCurrency(amount)
            }))
        ];

        const trace = {
            type: 'pie',
            labels: ['Essentials', 'Discretionary'],
            values: [summary.essentialTotal, summary.discretionaryTotal],
            marker: { colors: ['#3b82f6', '#f59e0b'] },
            textinfo: 'label+percent',
            hovertemplate: '%{label}<br>%{value:.2f} EUR<extra></extra>'
        };
        const layout = {
            margin: { t: 10, r: 10, l: 10, b: 10 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            showlegend: false
        };

        openDetailModal({
            title: '<i class="fas fa-scale-balanced"></i> Needs vs Wants',
            summary: `Totaal uitgaven: ${formatCurrency(total)}`,
            rows,
            chart: { trace, layout }
        });
        return;
    }

    if (detailType === 'merchant-concentration') {
        const merchantTotals = new Map();
        transactions.forEach((transaction) => {
            if ((transaction.amount || 0) >= 0) return;
            const merchant = resolveMerchantLabel(transaction);
            merchantTotals.set(merchant, (merchantTotals.get(merchant) || 0) + Math.abs(transaction.amount || 0));
        });

        const rows = Array.from(merchantTotals.entries())
            .map(([merchant, amount]) => ({ merchant, amount }))
            .sort((a, b) => b.amount - a.amount);

        if (!rows.length) {
            openDetailModal({
                title: '<i class="fas fa-store"></i> Merchant concentration',
                summary: 'Geen uitgaven gevonden in de geselecteerde periode.',
                rows: [{ label: 'Geen merchant data.', value: '' }],
                chart: null
            });
            return;
        }

        const totalExpenses = rows.reduce((sum, row) => sum + row.amount, 0);
        const top = rows[0];
        const topShare = totalExpenses > 0 ? (top.amount / totalExpenses) * 100 : 0;

        const chartRows = rows.slice(0, 10).reverse();
        const trace = {
            type: 'bar',
            orientation: 'h',
            x: chartRows.map((row) => row.amount),
            y: chartRows.map((row) => row.merchant),
            marker: { color: '#60a5fa' },
            text: chartRows.map((row) => `${((row.amount / totalExpenses) * 100).toFixed(1)}%`),
            textposition: 'outside',
            hovertemplate: '%{y}<br>%{x:.2f} EUR<extra></extra>'
        };
        const layout = {
            margin: { t: 10, r: 30, l: 160, b: 30 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            xaxis: { gridcolor: 'rgba(255,255,255,0.08)' },
            yaxis: { automargin: true }
        };

        openDetailModal({
            title: '<i class="fas fa-store"></i> Merchant concentration',
            summary: `Top merchant: ${top.merchant} (${topShare.toFixed(1)}% van uitgaven)`,
            rows: rows.slice(0, 20).map((row) => ({
                label: row.merchant,
                value: `${formatCurrency(row.amount)} (${((row.amount / totalExpenses) * 100).toFixed(1)}%)`
            })),
            chart: { trace, layout }
        });
        return;
    }

    if (detailType === 'expense-momentum') {
        const windows = splitRollingWindows(transactions, 30);
        const recentByCategory = buildExpenseByCategory(windows.recent);
        const priorByCategory = buildExpenseByCategory(windows.prior);
        const categories = new Set([...Object.keys(recentByCategory), ...Object.keys(priorByCategory)]);

        const rows = Array.from(categories)
            .map((category) => {
                const recent = recentByCategory[category] || 0;
                const prior = priorByCategory[category] || 0;
                const delta = recent - prior;
                const deltaPct = prior > 0 ? (delta / prior) * 100 : 0;
                return { category, recent, prior, delta, deltaPct };
            })
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

        if (!rows.length) {
            openDetailModal({
                title: '<i class="fas fa-chart-line"></i> Expense momentum',
                summary: 'Onvoldoende uitgaven voor momentum-analyse.',
                rows: [{ label: 'Geen categorie data.', value: '' }],
                chart: null
            });
            return;
        }

        const recentTotal = rows.reduce((sum, row) => sum + row.recent, 0);
        const priorTotal = rows.reduce((sum, row) => sum + row.prior, 0);
        const totalChangePct = priorTotal > 0 ? ((recentTotal - priorTotal) / priorTotal) * 100 : 0;

        const chartRows = [...rows]
            .sort((a, b) => (b.recent + b.prior) - (a.recent + a.prior))
            .slice(0, 8);

        const traces = [
            {
                type: 'bar',
                name: 'Vorige 30d',
                x: chartRows.map((row) => row.category),
                y: chartRows.map((row) => row.prior),
                marker: { color: 'rgba(148,163,184,0.8)' }
            },
            {
                type: 'bar',
                name: 'Laatste 30d',
                x: chartRows.map((row) => row.category),
                y: chartRows.map((row) => row.recent),
                marker: { color: 'rgba(59,130,246,0.85)' }
            }
        ];
        const layout = {
            barmode: 'group',
            margin: { t: 10, r: 20, l: 40, b: 80 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            xaxis: { tickangle: -30 },
            yaxis: { gridcolor: 'rgba(255,255,255,0.08)' }
        };

        openDetailModal({
            title: '<i class="fas fa-chart-line"></i> Expense momentum (30d vs vorige 30d)',
            summary: `Totaal: ${formatCurrency(recentTotal)} vs ${formatCurrency(priorTotal)} (${totalChangePct.toFixed(1)}%)`,
            rows: rows.slice(0, 20).map((row) => ({
                label: row.category,
                value: `${formatCurrency(row.recent)} vs ${formatCurrency(row.prior)} (Δ ${formatCurrency(row.delta)}, ${row.deltaPct.toFixed(1)}%)`
            })),
            chart: { trace: traces, layout }
        });
        return;
    }

    if (detailType === 'money-flow') {
        const flowByCategory = new Map();
        transactions.forEach((transaction) => {
            const category = transaction.category || 'Overig';
            if (!flowByCategory.has(category)) {
                flowByCategory.set(category, { income: 0, expense: 0 });
            }
            const bucket = flowByCategory.get(category);
            if (transaction.amount >= 0) bucket.income += transaction.amount;
            else bucket.expense += Math.abs(transaction.amount);
        });

        const rows = Array.from(flowByCategory.entries())
            .map(([category, values]) => ({
                category,
                income: values.income,
                expense: values.expense,
                net: values.income - values.expense
            }))
            .sort((a, b) => (b.expense + b.income) - (a.expense + a.income));

        const trace = {
            type: 'bar',
            x: rows.map((row) => row.category),
            y: rows.map((row) => row.net),
            marker: { color: rows.map((row) => row.net >= 0 ? '#22c55e' : '#ef4444') },
            hovertemplate: '%{x}<br>Net: %{y:.2f} EUR<extra></extra>'
        };
        const layout = {
            margin: { t: 10, r: 20, l: 40, b: 70 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            xaxis: { tickangle: -30 },
            yaxis: { gridcolor: 'rgba(255,255,255,0.08)' }
        };

        openDetailModal({
            title: '<i class="fas fa-project-diagram"></i> Money Flow detail',
            summary: `Categorieën: ${rows.length}`,
            rows: rows.map((row) => ({
                label: `${row.category} · In ${formatCurrency(row.income)} · Uit ${formatCurrency(row.expense)}`,
                value: `Net ${formatCurrency(row.net)}`
            })),
            chart: { trace, layout }
        });
        return;
    }

    openDetailModal({
        title: '<i class="fas fa-info-circle"></i> Detail',
        summary: 'Geen detailweergave beschikbaar voor dit onderdeel.',
        rows: [{ label: 'Onbekend detailtype.', value: detailType || 'n/a' }],
        chart: null
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

    const incomeByCategory = {};
    const expenseByCategory = {};
    let totalIncome = 0;
    let totalExpenses = 0;

    data.forEach((t) => {
        const category = t.category || 'Overig';
        if (t.amount >= 0) {
            incomeByCategory[category] = (incomeByCategory[category] || 0) + t.amount;
            totalIncome += t.amount;
        } else {
            const amount = Math.abs(t.amount);
            expenseByCategory[category] = (expenseByCategory[category] || 0) + amount;
            totalExpenses += amount;
        }
    });

    const topIncome = Object.entries(incomeByCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
    const topExpenses = Object.entries(expenseByCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7);

    const labels = [...topIncome.map(([name]) => name), 'Cash In', ...topExpenses.map(([name]) => name)];
    const source = [];
    const target = [];
    const value = [];
    const colors = [];

    const cashInIndex = topIncome.length;

    topIncome.forEach(([name, amount], idx) => {
        if (amount <= 0) return;
        source.push(idx);
        target.push(cashInIndex);
        value.push(amount);
        colors.push('rgba(34,197,94,0.5)');
    });

    topExpenses.forEach(([name, amount], idx) => {
        if (amount <= 0) return;
        source.push(cashInIndex);
        target.push(cashInIndex + 1 + idx);
        value.push(amount);
        colors.push('rgba(239,68,68,0.45)');
    });

    const net = totalIncome - totalExpenses;
    if (net > 0) {
        labels.push('Net Saved');
        source.push(cashInIndex);
        target.push(labels.length - 1);
        value.push(net);
        colors.push('rgba(56,189,248,0.45)');
    } else if (net < 0) {
        labels.push('Buffer / Debt');
        source.push(labels.length - 1);
        target.push(cashInIndex);
        value.push(Math.abs(net));
        colors.push('rgba(251,191,36,0.45)');
    }

    const trace = {
        type: 'sankey',
        arrangement: 'snap',
        node: {
            label: labels,
            pad: 15,
            thickness: 18,
            color: labels.map((label) => {
                if (label === 'Cash In') return '#22c55e';
                if (label === 'Net Saved') return '#38bdf8';
                if (label === 'Buffer / Debt') return '#f59e0b';
                return getCategoryColor(label);
            }),
            line: { color: 'rgba(15,23,42,0.7)', width: 1.2 }
        },
        link: {
            source,
            target,
            value,
            color: colors,
            hovertemplate: '%{source.label} → %{target.label}<br>%{value:.2f} EUR<extra></extra>'
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

    const incomeByCategory = new Map();
    const expenseByCategory = new Map();
    const merchantByCategory = new Map();

    data.forEach((transaction) => {
        const category = transaction.category || 'Overig';
        const merchant = resolveMerchantLabel(transaction);
        if (transaction.amount >= 0) {
            incomeByCategory.set(category, (incomeByCategory.get(category) || 0) + transaction.amount);
            return;
        }
        const expense = Math.abs(transaction.amount);
        expenseByCategory.set(category, (expenseByCategory.get(category) || 0) + expense);
        if (!merchantByCategory.has(category)) {
            merchantByCategory.set(category, new Map());
        }
        const merchantMap = merchantByCategory.get(category);
        merchantMap.set(merchant, (merchantMap.get(merchant) || 0) + expense);
    });

    const labels = [];
    const ids = [];
    const parents = [];
    const values = [];
    const colors = [];

    const pushNode = (id, label, parent, value, color) => {
        ids.push(id);
        labels.push(label);
        parents.push(parent);
        values.push(value);
        colors.push(color);
    };

    const totalIncome = Array.from(incomeByCategory.values()).reduce((sum, amount) => sum + amount, 0);
    const totalExpenses = Array.from(expenseByCategory.values()).reduce((sum, amount) => sum + amount, 0);

    pushNode('root', 'All', '', totalIncome + totalExpenses, '#334155');
    pushNode('income', 'Income', 'root', totalIncome, '#22c55e');
    pushNode('expenses', 'Expenses', 'root', totalExpenses, '#ef4444');

    Array.from(incomeByCategory.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([category, amount]) => {
            pushNode(`income:${category}`, category, 'income', amount, getCategoryColor(category));
        });

    Array.from(expenseByCategory.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([category, amount]) => {
            const categoryId = `expense:${category}`;
            const categoryColor = getCategoryColor(category);
            pushNode(categoryId, category, 'expenses', amount, categoryColor);

            const merchants = Array.from((merchantByCategory.get(category) || new Map()).entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 16);
            merchants.forEach(([merchant, merchantAmount]) => {
                pushNode(
                    `${categoryId}:${merchant}`,
                    merchant,
                    categoryId,
                    merchantAmount,
                    hexToRgba(categoryColor, 0.82)
                );
            });
        });

    const trace = {
        type: 'sunburst',
        ids,
        labels,
        parents,
        values,
        branchvalues: 'total',
        maxdepth: 3,
        insidetextorientation: 'radial',
        marker: {
            colors,
            line: {
                color: 'rgba(15, 23, 42, 0.9)',
                width: 2.2
            }
        },
        hovertemplate: '%{label}<br>%{value:.2f} EUR<extra></extra>'
    };
    
    const layout = {
        margin: { t: 20, r: 10, l: 10, b: 10 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' },
        uniformtext: { minsize: 10, mode: 'hide' }
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

    const dayParts = [
        { label: 'Nacht (00-06)', start: 0, end: 6 },
        { label: 'Ochtend (06-12)', start: 6, end: 12 },
        { label: 'Middag (12-18)', start: 12, end: 18 },
        { label: 'Avond (18-24)', start: 18, end: 24 }
    ];
    const weekdays = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
    const grid = Array.from({ length: weekdays.length }, () => Array(dayParts.length).fill(0));

    data.forEach((transaction) => {
        if ((transaction.amount || 0) >= 0) return;
        const date = transaction.date;
        const dayIndex = (date.getDay() + 6) % 7;
        const hour = date.getHours();
        const partIndex = dayParts.findIndex((part) => hour >= part.start && hour < part.end);
        if (partIndex >= 0) {
            grid[dayIndex][partIndex] += Math.abs(transaction.amount || 0);
        }
    });

    const trace = {
        z: grid,
        x: dayParts.map((part) => part.label),
        y: weekdays,
        type: 'heatmap',
        colorscale: 'YlOrRd',
        hovertemplate: '%{y} · %{x}<br>Uitgaven: %{z:.2f} EUR<extra></extra>'
    };

    const layout = {
        margin: { t: 10, r: 10, l: 44, b: 60 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' },
        xaxis: { tickangle: -20 }
    };

    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
}

function renderMerchantsChart(data) {
    const container = document.getElementById('merchantsChart');
    if (!container) return;
    
    const totals = {};
    data.forEach(t => {
        if (t.amount >= 0) return;
        const merchant = resolveMerchantLabel(t);
        totals[merchant] = (totals[merchant] || 0) + Math.abs(t.amount);
    });
    
    const sorted = Object.entries(totals)
        .filter(([merchant]) => merchant && merchant !== 'Onbekend')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);
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
    const items = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 12);
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

const ESSENTIAL_CATEGORIES = new Set(['Boodschappen', 'Wonen', 'Utilities', 'Vervoer', 'Zorg']);

function buildExpenseByCategory(transactions) {
    const totals = {};
    (transactions || []).forEach((transaction) => {
        if ((transaction.amount || 0) >= 0) return;
        const category = transaction.category || 'Overig';
        totals[category] = (totals[category] || 0) + Math.abs(transaction.amount || 0);
    });
    return totals;
}

function splitRollingWindows(transactions, windowDays = 30) {
    const normalized = (transactions || [])
        .filter((transaction) => transaction.date instanceof Date && !Number.isNaN(transaction.date.getTime()))
        .sort((a, b) => a.date - b.date);

    if (!normalized.length) {
        return {
            recent: [],
            prior: [],
            endDate: null,
            recentStart: null,
            priorStart: null
        };
    }

    const endDate = new Date(normalized[normalized.length - 1].date);
    endDate.setHours(23, 59, 59, 999);

    const recentStart = new Date(endDate);
    recentStart.setDate(recentStart.getDate() - (windowDays - 1));
    recentStart.setHours(0, 0, 0, 0);

    const priorStart = new Date(recentStart);
    priorStart.setDate(priorStart.getDate() - windowDays);

    const recent = [];
    const prior = [];

    normalized.forEach((transaction) => {
        if (transaction.date >= recentStart && transaction.date <= endDate) {
            recent.push(transaction);
            return;
        }
        if (transaction.date >= priorStart && transaction.date < recentStart) {
            prior.push(transaction);
        }
    });

    return { recent, prior, endDate, recentStart, priorStart };
}

function summarizeNeedsVsWants(transactions) {
    const summary = {
        essentialTotal: 0,
        discretionaryTotal: 0,
        essentialByCategory: {},
        discretionaryByCategory: {}
    };

    (transactions || []).forEach((transaction) => {
        if ((transaction.amount || 0) >= 0) return;
        const amount = Math.abs(transaction.amount || 0);
        const category = transaction.category || 'Overig';
        if (ESSENTIAL_CATEGORIES.has(category)) {
            summary.essentialTotal += amount;
            summary.essentialByCategory[category] = (summary.essentialByCategory[category] || 0) + amount;
            return;
        }
        summary.discretionaryTotal += amount;
        summary.discretionaryByCategory[category] = (summary.discretionaryByCategory[category] || 0) + amount;
    });

    return summary;
}

function renderInsights(data, kpis) {
    const biggestCategory = document.getElementById('biggestCategory');
    const avgDaily = document.getElementById('avgDaily');
    const expensiveDay = document.getElementById('expensiveDay');
    const trendInsight = document.getElementById('trendInsight');
    const liquidityRunway = document.getElementById('liquidityRunway');
    const needsVsWants = document.getElementById('needsVsWants');
    const topMerchantShare = document.getElementById('topMerchantShare');
    const projectedMonthNet = document.getElementById('projectedMonthNet');

    const expenseByCategory = buildExpenseByCategory(data);
    const biggest = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1])[0];
    if (biggestCategory) {
        biggestCategory.textContent = biggest ? `${biggest[0]} (${formatCurrency(biggest[1])})` : 'N/A';
    }

    const daily = buildDailyTotals(data);
    const avg = daily.length ? daily.reduce((sum, day) => sum + day.expenses, 0) / daily.length : 0;
    if (avgDaily) avgDaily.textContent = formatCurrency(avg);

    const expensive = [...daily].sort((a, b) => b.expenses - a.expenses)[0];
    if (expensiveDay) {
        expensiveDay.textContent = expensive ? `${expensive.date.toLocaleDateString('nl-NL')} (${formatCurrency(expensive.expenses)})` : 'N/A';
    }

    const windows = splitRollingWindows(data, 30);
    const recentExpenses = windows.recent.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    const priorExpenses = windows.prior.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    const recentIncome = windows.recent.filter((transaction) => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
    const recentChange = priorExpenses > 0 ? ((recentExpenses - priorExpenses) / priorExpenses) * 100 : 0;

    if (trendInsight) {
        const direction = recentChange <= 0 ? 'daalt' : 'stijgt';
        const biggestLabel = biggest ? biggest[0] : 'Overig';
        const biggestValue = biggest ? biggest[1] : 0;
        const action = recentChange > 10
            ? `Actie: beperk ${biggestLabel} met ~${formatCurrency(biggestValue * 0.1)}`
            : 'Actie: houd dit niveau vast';
        trendInsight.textContent = `30d uitgaventrend ${direction} (${recentChange.toFixed(1)}%). ${action}.`;
    }

    const liquidBalance = balanceMetrics
        ? (Number(balanceMetrics.totals.checking) || 0) + (Number(balanceMetrics.totals.savings) || 0)
        : null;
    const observedRecentDays = Math.max(new Set(windows.recent.map((transaction) => toDateKey(transaction.date))).size, 1);
    const dailyBurn = Math.max((recentExpenses - recentIncome) / observedRecentDays, 0);

    if (liquidityRunway) {
        if (liquidBalance === null) {
            liquidityRunway.textContent = 'N/A';
        } else if (dailyBurn <= 0.01) {
            liquidityRunway.textContent = '∞ (positieve cashflow)';
        } else {
            const runwayDays = liquidBalance / dailyBurn;
            const runwayMonths = runwayDays / 30;
            liquidityRunway.textContent = `${Math.round(runwayDays)} dagen (${runwayMonths.toFixed(1)} mnd)`;
        }
    }

    const needsSummary = summarizeNeedsVsWants(data);
    const totalNeedsWants = needsSummary.essentialTotal + needsSummary.discretionaryTotal;
    if (needsVsWants) {
        if (totalNeedsWants <= 0.01) {
            needsVsWants.textContent = 'N/A';
        } else {
            const essentialShare = (needsSummary.essentialTotal / totalNeedsWants) * 100;
            needsVsWants.textContent = `${essentialShare.toFixed(1)}% essentials`;
        }
    }

    const merchantExpenses = {};
    data.forEach((transaction) => {
        if ((transaction.amount || 0) >= 0) return;
        const merchant = resolveMerchantLabel(transaction);
        merchantExpenses[merchant] = (merchantExpenses[merchant] || 0) + Math.abs(transaction.amount || 0);
    });
    const merchantsSorted = Object.entries(merchantExpenses).sort((a, b) => b[1] - a[1]);
    if (topMerchantShare) {
        if (!merchantsSorted.length || kpis.expenses <= 0) {
            topMerchantShare.textContent = 'N/A';
        } else {
            const [merchantName, merchantTotal] = merchantsSorted[0];
            const share = (merchantTotal / kpis.expenses) * 100;
            topMerchantShare.textContent = `${merchantName} (${share.toFixed(1)}%)`;
        }
    }

    if (projectedMonthNet) {
        const now = new Date();
        const monthTransactions = data.filter((transaction) => (
            transaction.date.getFullYear() === now.getFullYear()
            && transaction.date.getMonth() === now.getMonth()
        ));
        if (!monthTransactions.length) {
            projectedMonthNet.textContent = 'N/A';
        } else {
            const monthNet = monthTransactions.reduce((sum, transaction) => sum + (transaction.amount || 0), 0);
            const elapsedDays = Math.max(now.getDate(), 1);
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const projected = (monthNet / elapsedDays) * daysInMonth;
            projectedMonthNet.textContent = formatCurrency(projected);
        }
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

function applyVisualPreferences() {
    document.body.classList.toggle('reduce-animations', !CONFIG.enableAnimations);
    document.body.classList.toggle('effects-enhanced', CONFIG.enableParticles);
    document.body.classList.toggle('effects-minimal', !CONFIG.enableParticles);
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
    applyAdminMaintenanceOptionsToUI();
    renderAdminTerminalPanel(null);
    
    document.getElementById('settingsModal')?.classList.add('active');
    if (isAuthenticated) {
        loadAdminStatus();
    } else {
        renderAdminStatusPanel(null, 'Login required om admin onderhoudsacties te gebruiken.', true);
    }
}

function closeSettings() {
    document.getElementById('settingsModal')?.classList.remove('active');
    renderAdminTerminalPanel(null);
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
    applyVisualPreferences();
    
    if (CONFIG.enableParticles) {
        initializeParticles();
    } else if (window.pJSDom && window.pJSDom.length > 0) {
        window.pJSDom[0].pJS.fn.vendors.destroypJS();
        window.pJSDom = [];
    }
    
    console.log('✅ Settings saved');
    refreshData();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function validatePublicIpv4Input(inputValue) {
    const value = String(inputValue || '').trim();
    if (!value) {
        return { valid: false, error: 'IP-adres is leeg.' };
    }

    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
        return { valid: false, error: 'Ongeldig IPv4 formaat. Gebruik bijvoorbeeld 8.8.8.8' };
    }

    const octets = value.split('.').map((item) => Number(item));
    if (octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
        return { valid: false, error: 'Ongeldig IPv4 formaat (octets moeten tussen 0 en 255 liggen).' };
    }

    const [a, b, c] = octets;
    const isPrivateOrReserved =
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) || // CGNAT
        (a === 192 && b === 0 && c === 2) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224;

    if (isPrivateOrReserved) {
        return { valid: false, error: 'Gebruik een publiek extern IPv4-adres (geen lokaal/private range).' };
    }

    return { valid: true, normalized: octets.join('.') };
}

function getTerminalCommandSets() {
    const workdir = DEFAULT_NAS_WORKDIR;
    return {
        installUpdate: {
            title: 'Install/Update via Terminal',
            help: 'Gebruik dit voor veilige host-level update (build/deploy) zonder Docker host-control vanuit de webapp.',
            commands: [
                `cd ${workdir}`,
                `git -c safe.directory=${workdir} pull --ff-only`,
                'sh scripts/install_or_update_synology.sh'
            ]
        },
        restartValidate: {
            title: 'Restart/Validate via Terminal',
            help: 'Gebruik dit voor startup-validatie en image cleanup op de host.',
            commands: [
                `cd ${workdir}`,
                'sh scripts/restart_bunq_service.sh',
                'sudo docker service logs --since 3m bunq_bunq-dashboard | grep -E "Vaultwarden|API key retrieved from vault|No valid API key|whitelist"'
            ]
        }
    };
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(el);
    return copied;
}

function renderAdminTerminalPanel(mode) {
    const panel = document.getElementById('adminTerminalPanel');
    if (!panel) return;

    const sets = getTerminalCommandSets();
    const selected = sets[mode];
    if (!selected) {
        panel.style.display = 'none';
        panel.innerHTML = '';
        return;
    }

    const rows = selected.commands.map((command, index) => {
        const cmdId = `${mode}-cmd-${index}`;
        return `
            <pre class="admin-terminal-command" id="${cmdId}">${escapeHtml(command)}</pre>
            <div class="admin-terminal-actions">
                <button type="button" class="admin-terminal-copy" data-copy-command="${escapeHtml(command)}">
                    <i class="fas fa-copy"></i> Copy command
                </button>
            </div>
        `;
    }).join('');

    panel.innerHTML = `
        <div class="admin-terminal-title"><i class="fas fa-terminal"></i> ${escapeHtml(selected.title)}</div>
        <p class="admin-terminal-help">${escapeHtml(selected.help)}</p>
        ${rows}
    `;
    panel.style.display = 'grid';
}

function renderAdminStatusPanel(statusData = null, notice = '', isError = false, egressIp = '') {
    const panel = document.getElementById('adminStatusPanel');
    if (!panel) return;

    if (!statusData) {
        const cls = isError ? 'admin-status-error' : '';
        panel.innerHTML = `<p class="setting-help ${cls}">${escapeHtml(notice || 'Nog geen admin status geladen.')}</p>`;
        return;
    }

    const vault = statusData.vaultwarden || {};
    const allowedOrigins = Array.isArray(statusData.allowed_origins)
        ? statusData.allowed_origins.join(', ')
        : '';
    const rows = [
        ['API status', statusData.api_initialized ? 'Initialized' : 'Not initialized', !statusData.api_initialized],
        ['API key source', statusData.api_key_source || '-'],
        ['Vaultwarden enabled', vault.enabled ? 'Yes' : 'No', !vault.enabled],
        ['Vault access method', vault.access_method || '-'],
        ['Bitwarden CLI', vault.bw_cli_installed ? 'Installed' : 'Missing', vault.enabled && vault.access_method === 'cli' && !vault.bw_cli_installed],
        [
            'Vault master password',
            vault.master_password_configured === null ? 'N/A' : (vault.master_password_configured ? 'Present' : 'Missing'),
            vault.enabled && vault.access_method === 'cli' && vault.master_password_configured === false
        ],
        ['Vault token', vault.token_ok ? 'OK' : 'Failed', vault.enabled && !vault.token_ok],
        ['Vault item', vault.item_found ? 'Found' : 'Not found', vault.enabled && !vault.item_found],
        [
            'Vault item password',
            vault.item_has_password ? 'Present' : 'Missing',
            vault.enabled && vault.item_found && !vault.item_has_password
        ],
        [
            'Auto whitelist on init',
            statusData.auto_set_bunq_whitelist_ip ? 'Enabled' : 'Disabled',
            false
        ],
        [
            'Auto deactivate other IPs',
            statusData.auto_set_bunq_whitelist_deactivate_others ? 'Enabled' : 'Disabled',
            false
        ],
        ['Context file', statusData.context_exists ? 'Present' : 'Missing', !statusData.context_exists],
        ['Session cookie secure', statusData.session_cookie_secure ? 'True' : 'False', !statusData.session_cookie_secure],
        ['Allowed origins', allowedOrigins || '-', false],
    ];

    if (egressIp) {
        rows.push(['Egress IP', egressIp, false]);
    }
    if (vault.error) {
        rows.push(['Vaultwarden error', vault.error, true]);
    }
    if (notice) {
        rows.push(['Action', notice, isError]);
    }

    panel.innerHTML = rows.map(([label, value, rowError]) => `
        <div class="admin-status-row">
            <span class="admin-status-label">${escapeHtml(label)}</span>
            <span class="admin-status-value ${rowError ? 'admin-status-error' : ''}">${escapeHtml(value)}</span>
        </div>
    `).join('');
}

async function runAdminAction(buttonId, busyHtml, actionFn) {
    const button = document.getElementById(buttonId);
    const originalHtml = button ? button.innerHTML : '';
    if (button) {
        button.disabled = true;
        button.innerHTML = busyHtml;
    }
    try {
        await actionFn();
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = originalHtml;
        }
    }
}

async function loadAdminStatus() {
    if (!isAuthenticated) {
        renderAdminStatusPanel(null, 'Login required om admin status te laden.', true);
        return;
    }

    await runAdminAction('adminLoadStatus', '<i class="fas fa-spinner fa-spin"></i> Loading...', async () => {
        const response = await authenticatedFetch(`${CONFIG.apiEndpoint}/admin/status`);
        if (!response || !response.success) {
            adminStatusData = null;
            renderAdminStatusPanel(null, 'Admin status ophalen mislukt.', true);
            return;
        }
        adminStatusData = response.data;
        renderAdminStatusPanel(adminStatusData);
    });
}

async function checkAdminEgressIp() {
    if (!isAuthenticated) {
        renderAdminStatusPanel(adminStatusData, 'Login required om egress IP te checken.', true);
        return;
    }

    await runAdminAction('adminCheckEgressIp', '<i class="fas fa-spinner fa-spin"></i> Checking...', async () => {
        const response = await authenticatedFetch(`${CONFIG.apiEndpoint}/admin/egress-ip`);
        if (!response || !response.success) {
            renderAdminStatusPanel(adminStatusData, 'Egress IP bepalen mislukt.', true);
            return;
        }
        const egressIp = response?.data?.egress_ip || '';
        const ipInputEl = document.getElementById('adminWhitelistIp');
        if (ipInputEl && !ipInputEl.value && egressIp) {
            ipInputEl.value = egressIp;
        }
        renderAdminStatusPanel(adminStatusData, `Egress IP resolved: ${egressIp}`, false, egressIp);
    });
}

async function setBunqWhitelistIp() {
    if (!isAuthenticated) {
        renderAdminStatusPanel(adminStatusData, 'Login required om Bunq whitelist IP te zetten.', true);
        return;
    }

    const ipInputEl = document.getElementById('adminWhitelistIp');
    const deactivateEl = document.getElementById('adminDeactivateOtherIps');
    let targetIp = (ipInputEl?.value || '').trim();
    const deactivateOthers = Boolean(deactivateEl?.checked);

    if (targetIp) {
        const ipValidation = validatePublicIpv4Input(targetIp);
        if (!ipValidation.valid) {
            renderAdminStatusPanel(adminStatusData, ipValidation.error, true);
            return;
        }
        targetIp = ipValidation.normalized;
        if (ipInputEl) {
            ipInputEl.value = targetIp;
        }
    }
    const targetLabel = targetIp || 'current egress IP (auto)';

    const confirmed = window.confirm(
        `Set Bunq API whitelist IP to "${targetLabel}"?\n` +
        (deactivateOthers ? 'Andere ACTIVE IPs worden op INACTIVE gezet.' : 'Andere ACTIVE IPs blijven ongewijzigd.')
    );
    if (!confirmed) return;

    await runAdminAction('adminSetWhitelistIp', '<i class="fas fa-spinner fa-spin"></i> Setting...', async () => {
        const response = await authenticatedFetch(`${CONFIG.apiEndpoint}/admin/bunq/whitelist-ip`, {
            method: 'POST',
            body: JSON.stringify({
                ip: targetIp || null,
                deactivate_others: deactivateOthers,
                refresh_key: true,
                force_recreate: false,
                clear_runtime_cache: false
            })
        });

        if (!response || !response.success) {
            const errorText = response?.error || 'Bunq whitelist update mislukt.';
            renderAdminStatusPanel(adminStatusData, errorText, true);
            return;
        }

        const data = response.data || {};
        const actions = data.actions || {};
        const message = `Whitelist set for ${data.target_ip || targetLabel}. ` +
            `created=${(actions.created || []).length}, ` +
            `activated=${(actions.activated || []).length}, ` +
            `deactivated=${(actions.deactivated || []).length}.`;
        await loadAdminStatus();
        renderAdminStatusPanel(adminStatusData, message, false, data.target_ip || '');
    });
}

async function reinitializeBunqContext() {
    if (!isAuthenticated) {
        renderAdminStatusPanel(adminStatusData, 'Login required om Bunq context te herinitialiseren.', true);
        return;
    }

    const confirmed = window.confirm(
        'Dit verwijdert de lokale Bunq context en maakt een nieuwe context (installation + device registration). Doorgaan?'
    );
    if (!confirmed) {
        return;
    }

    await runAdminAction('adminReinitBunq', '<i class="fas fa-spinner fa-spin"></i> Running...', async () => {
        const response = await authenticatedFetch(`${CONFIG.apiEndpoint}/admin/bunq/reinitialize`, {
            method: 'POST',
            body: JSON.stringify({
                force_recreate: true,
                refresh_key: true,
                clear_runtime_cache: true
            })
        });
        if (!response || !response.success) {
            renderAdminStatusPanel(adminStatusData, 'Bunq context herinitialisatie mislukt.', true);
            return;
        }

        const egressIp = response?.data?.egress_ip || '';
        await loadAdminStatus();
        renderAdminStatusPanel(
            adminStatusData,
            'Bunq context opnieuw geïnitialiseerd. Controleer Bunq whitelist met het getoonde egress IP of gebruik "Run maintenance now".',
            false,
            egressIp
        );
    });
}

async function runBundledAdminMaintenance() {
    if (!isAuthenticated) {
        renderAdminStatusPanel(adminStatusData, 'Login required om maintenance uit te voeren.', true);
        return;
    }

    const options = getAdminMaintenanceOptionsFromUI();
    const ipInputEl = document.getElementById('adminWhitelistIp');
    let targetIp = (ipInputEl?.value || '').trim();

    if (!options.auto_target_ip && !targetIp) {
        renderAdminStatusPanel(adminStatusData, 'Vul een IPv4 in of zet "Gebruik automatisch egress IP" aan.', true);
        return;
    }

    if (!options.auto_target_ip) {
        const ipValidation = validatePublicIpv4Input(targetIp);
        if (!ipValidation.valid) {
            renderAdminStatusPanel(adminStatusData, ipValidation.error, true);
            return;
        }
        targetIp = ipValidation.normalized;
        if (ipInputEl) {
            ipInputEl.value = targetIp;
        }
    }
    const targetLabel = options.auto_target_ip ? 'current egress IP (auto)' : targetIp;

    const confirmed = window.confirm(
        'Run admin maintenance now?\n' +
        `- Recreate context: ${options.force_recreate ? 'yes' : 'no'}\n` +
        `- Refresh API key: ${options.refresh_key ? 'yes' : 'no'}\n` +
        `- Set whitelist IP: ${targetLabel}\n` +
        `- Deactivate other IPs: ${options.deactivate_others ? 'yes' : 'no'}`
    );
    if (!confirmed) return;

    await runAdminAction('adminRunMaintenance', '<i class="fas fa-spinner fa-spin"></i> Running...', async () => {
        const response = await authenticatedFetch(`${CONFIG.apiEndpoint}/admin/maintenance/run`, {
            method: 'POST',
            body: JSON.stringify({
                target_ip: targetIp || null,
                auto_target_ip: options.auto_target_ip,
                deactivate_others: options.deactivate_others,
                refresh_key: options.refresh_key,
                force_recreate: options.force_recreate,
                clear_runtime_cache: options.clear_runtime_cache
            })
        });

        if (!response || !response.success) {
            renderAdminStatusPanel(adminStatusData, response?.error || 'Admin maintenance mislukt.', true);
            return;
        }

        const data = response.data || {};
        const steps = Array.isArray(data.steps) ? data.steps.join(', ') : '';
        const message = `Maintenance voltooid${steps ? ` (${steps})` : ''}.`;
        const egressIp = data.egress_ip || data.resolved_target_ip || '';

        if (options.load_status_after) {
            await loadAdminStatus();
        }
        renderAdminStatusPanel(adminStatusData, message, false, egressIp);
    });
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
