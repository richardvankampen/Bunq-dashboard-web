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
    // Minimum 60 seconds to stay well within Bunq API rate limits (30 req/min).
    // Values below 60 will be silently raised to 60 at runtime.
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
const DEFAULT_FETCH_TIMEOUT_MS = 30000;
let isLoading = false;
let isAuthenticated = false;
let accountsList = [];
let balanceMetrics = null;
let balanceHistoryData = null;
let dataQualitySummary = null;
let latestDataQualitySummary = null;
let adminStatusData = null;
let selectedAccountIds = new Set();
const chartRegistry = {
    chartjs: {},
    plotly: {}
};
let racingData = null;
let racingPlayInterval = null;

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

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Check if user is authenticated (has valid session)
 */
async function checkAuthStatus() {
    try {
        const response = await fetchWithTimeout(`${CONFIG.apiEndpoint}/auth/status`, {
            credentials: 'include'  // CRITICAL: Include session cookie
        }, 12000);
        
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
 * Re-check auth whenever the user returns to this tab.
 * The server-side session may have expired while the tab was in the background.
 */
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isAuthenticated) {
        checkAuthStatus().then((stillAuthenticated) => {
            if (!stillAuthenticated && isAuthenticated) {
                // Session expired while away - show login modal.
                isAuthenticated = false;
                updateAuthUI(false);
                showLoginModal();
            }
        }).catch(() => {});
    }
});

/**
 * Login user with username and password
 */
async function login(username, password) {
    try {
        const response = await fetchWithTimeout(`${CONFIG.apiEndpoint}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',  // CRITICAL: Allow setting cookies
            body: JSON.stringify({ username, password })
        }, 15000);
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            console.log('✅ Login successful');
            isAuthenticated = true;
            updateAuthUI(true, data.username);
            hideLoginModal();
            await loadAccounts();
            
            // After a successful login always switch to real data and load it.
            // The user just authenticated — showing demo data at this point would be confusing.
            CONFIG.useRealData = true;
            localStorage.setItem('useRealData', 'true');
            const useRealDataCheckbox = document.getElementById('useRealData');
            if (useRealDataCheckbox) useRealDataCheckbox.checked = true;
            await loadRealData();
            
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
        await fetchWithTimeout(`${CONFIG.apiEndpoint}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        }, 12000);
        
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
        const response = await fetchWithTimeout(url, mergedOptions);
        
        // Read the response body once so we can inspect it for both auth errors
        // and general HTTP errors without double-consuming the stream.
        let responseBody = null;
        let parseError = false;
        if (response.status !== 204) {
            try {
                responseBody = await response.json();
            } catch (_) {
                parseError = true;
            }
        }

        // Check for authentication errors
        if (response.status === 401) {
            if (responseBody && responseBody.login_required) {
                console.error('🔒 Session expired or not authenticated');
                isAuthenticated = false;
                updateAuthUI(false);
                showLoginModal();
                return null;
            }
            // Bunq-specific session expiry (not a user session issue): surface as a
            // retriable error so the dashboard can show a message and auto-retry.
            if (responseBody && responseBody.bunq_unauthorized) {
                console.warn('⚠️ Bunq API session token rejected — context will auto-recover on retry');
                return {
                    success: false,
                    error: responseBody.error || 'Bunq API session expired. Please refresh.',
                    bunq_unauthorized: true,
                    http_status: 401
                };
            }
        }
        
        if (response.status === 429) {
            console.error('⏱️ Rate limit exceeded');
            showError('Too many requests. Please wait a minute.');
            return null;
        }
        
        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}`;
            if (responseBody && typeof responseBody === 'object') {
                const backendError = (responseBody.error || responseBody.message || '').toString().trim();
                if (backendError) errorMessage = backendError;
            } else if (parseError) {
                // Body wasn't JSON — try to get raw text if we haven't already consumed it.
                // (In this branch the body parse already failed so responseBody is null.)
                errorMessage = `HTTP ${response.status}`;
            }

            // Always return an explicit failure object with success=false so
            // callers can uniformly test `!response || !response.success`.
            return {
                success: false,
                error: errorMessage,
                http_status: response.status,
                data: responseBody?.data || null
            };
        }

        return responseBody;
        
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
        const payload = await authenticatedFetch(`${CONFIG.apiEndpoint}/history/balances?days=${days}`);
        if (!payload || !payload.success || !payload.data) {
            balanceHistoryData = null;
            return null;
        }
        balanceHistoryData = payload.data;
        return balanceHistoryData;
    } catch (error) {
        console.warn('Unable to load balance history:', error);
    }

    balanceHistoryData = null;
    return null;
}

async function loadDataQuality(days = CONFIG.timeRange) {
    if (!isAuthenticated) {
        dataQualitySummary = null;
        return null;
    }

    try {
        const payload = await authenticatedFetch(`${CONFIG.apiEndpoint}/admin/data-quality?days=${days}`);
        if (!payload || !payload.success || !payload.data) {
            dataQualitySummary = null;
            return null;
        }
        dataQualitySummary = payload.data;
        return dataQualitySummary;
    } catch (error) {
        console.warn('Unable to load data quality summary:', error);
    }

    dataQualitySummary = null;
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
        // Backend MAX_DAYS is 3650; use that as the upper bound for 'all'.
        CONFIG.timeRange = e.target.value === 'all' ? 3650 : parseInt(e.target.value);
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
        
        // The backend fetches transactions from the Bunq SDK using cursor-based
        // pagination (older_id) internally — one backend call can cover many SDK
        // pages. We use offset-based page params here to page through the
        // backend's aggregated result set efficiently.
        const pageSize = 500;
        const maxPages = 20;
        let page = 1;
        let all = [];
        let total = null;
        let lastResponse = null;
        let loadError = '';
        
        const accountParam = buildAccountFilterParam();
        const excludeParam = `&exclude_internal=${CONFIG.excludeInternalTransfers}`;
        
        while (page <= maxPages) {
            const url = `${CONFIG.apiEndpoint}/transactions?days=${CONFIG.timeRange}&page=${page}&page_size=${pageSize}${accountParam}${excludeParam}`;
            const response = await authenticatedFetch(url);
            lastResponse = response;
            
            if (!response || !response.success) {
                console.error('❌ Failed to load real data');
                loadError = response?.error || 'Unable to load transactions.';
                // If the Bunq API session was rejected, surface a clear retry hint.
                if (response?.bunq_unauthorized) {
                    loadError = 'Bunq API session token expired. The server will auto-recover — please try refreshing in a moment.';
                }
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
            await loadDataQuality(CONFIG.timeRange);
            processAndRenderData(transactionsData);
        } else if (all.length === 0 && total === 0) {
            console.warn('⚠️ No transactions found');
            transactionsData = [];
            await loadDataQuality(CONFIG.timeRange);
            processAndRenderData([]);
        } else if (lastResponse === null) {
            // Session expired - modal already shown
            loadDemoData();
        } else if (loadError) {
            showError(`Kon data niet laden: ${loadError}`);
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
        dataQualitySummary = null;
        latestDataQualitySummary = null;
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
        'Abonnementen': '#eab308',
        'Verzekering': '#a855f7',
        'Belastingen': '#f97316',
        'Shopping': '#10b981',
        'Entertainment': '#06b6d4',
        'Zorg': '#6366f1',
        'Salaris': '#22c55e',
        'Refund': '#14b8a6',
        'Rente': '#0ea5e9',
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

    const className = String(account?.account_class || '').toLowerCase();
    const explicitTypeText = `${account?.account_type || ''} ${account?.monetary_account_type || ''}`.toLowerCase();
    const description = String(account?.description || '').toLowerCase();

    if (className.includes('monetaryaccountsavings') || className.includes('externalsavings')) {
        return 'savings';
    }
    if (className.includes('monetaryaccountinvestment')) {
        return 'investment';
    }

    if (
        explicitTypeText.includes('saving')
        || explicitTypeText.includes('savings')
        || explicitTypeText.includes('spaar')
    ) return 'savings';
    if (
        explicitTypeText.includes('investment')
        || explicitTypeText.includes('stock')
        || explicitTypeText.includes('share')
        || explicitTypeText.includes('crypto')
        || explicitTypeText.includes('belegging')
    ) return 'investment';
    if (
        explicitTypeText.includes('checking')
        || explicitTypeText.includes('payment')
        || explicitTypeText.includes('bank')
        || explicitTypeText.includes('card')
        || explicitTypeText.includes('current')
    ) return 'checking';

    // Guardrail: plain MonetaryAccountBank is checking unless explicit type fields say otherwise.
    if (className.includes('monetaryaccountbank')) {
        return 'checking';
    }

    const fingerprint = `${description} ${className} ${explicitTypeText}`;
    if (
        fingerprint.includes('savings')
        || fingerprint.includes('spaar')
        || fingerprint.includes('spaarrekening')
        || fingerprint.includes('sparen')
    ) return 'savings';
    if (
        fingerprint.includes('investment')
        || fingerprint.includes('crypto')
        || fingerprint.includes('belegging')
        || fingerprint.includes('stock')
        || fingerprint.includes('share')
        || fingerprint.includes('etf')
    ) return 'investment';
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
    latestDataQualitySummary = computeDataQualitySummary(normalized, accountsList, dataQualitySummary);
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
    renderInsights(normalized, kpis, latestDataQualitySummary);
    
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
    const isOpaqueMerchantValue = (value) => {
        const text = String(value || '').trim();
        if (!text) return true;

        const compact = text.replace(/\s+/g, '');
        const ibanLike = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i.test(compact);
        if (ibanLike) return true;

        const opaqueCode = /^[A-Z0-9._:-]{12,}$/i.test(compact) && !/\s/.test(text);
        if (opaqueCode) return true;

        return false;
    };

    const preferred = [
        transaction?.merchant,
        transaction?.counterparty,
        transaction?.description
    ];

    const readable = preferred.find((value) => (
        typeof value === 'string'
        && value.trim().length > 0
        && !isOpaqueMerchantValue(value)
    ));
    if (readable) return readable.trim();

    const fallback = preferred.find((value) => typeof value === 'string' && value.trim().length > 0);
    if (!fallback) return 'Onbekend';
    return fallback.trim();
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
        amount: (() => {
            const nativeAmount = Number(t.amount);
            const amountEur = Number(t.amount_eur);
            const currency = String(t.currency || 'EUR').toUpperCase();
            if (Number.isFinite(amountEur)) {
                return amountEur;
            }
            // Avoid mixing raw non-EUR values into EUR-based charts/KPIs.
            if (currency !== 'EUR') {
                return 0;
            }
            return Number.isFinite(nativeAmount) ? nativeAmount : 0;
        })(),
        amount_native: Number.isFinite(Number(t.amount)) ? Number(t.amount) : 0,
        amount_eur: Number.isFinite(Number(t.amount_eur))
            ? Number(t.amount_eur)
            : (String(t.currency || 'EUR').toUpperCase() === 'EUR' ? Number(t.amount) || 0 : null),
        amount_conversion_missing: String(t.currency || 'EUR').toUpperCase() !== 'EUR'
            && !Number.isFinite(Number(t.amount_eur)),
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

function safeRatio(numerator, denominator, fallback = null) {
    const n = Number(numerator);
    const d = Number(denominator);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
        return fallback;
    }
    return n / d;
}

function isUnknownMerchantLabel(value) {
    const label = String(value || '').trim().toLowerCase();
    if (!label) return true;
    if (label === 'onbekend' || label === 'unknown') return true;
    const compact = label.replace(/\s+/g, '');
    if (/^[a-z]{2}\d{2}[a-z0-9]{10,30}$/i.test(compact)) return true; // IBAN-like
    if (/^[a-z0-9._:-]{12,}$/i.test(compact) && !/\s/.test(label)) return true; // opaque token-like
    return false;
}

function computeDataQualitySummary(transactions, accounts, serverSummary = null) {
    const tx = Array.isArray(transactions) ? transactions : [];
    const expenseTransactions = tx.filter((transaction) => (transaction.amount || 0) < 0);
    const totalTransactions = tx.length;
    const internalTransactions = tx.filter((transaction) => Boolean(transaction.is_internal_transfer)).length;

    const categorizedExpenses = expenseTransactions.filter((transaction) => {
        const category = String(transaction.category || '').trim().toLowerCase();
        return Boolean(category) && !['overig', 'unknown', 'onbekend'].includes(category);
    }).length;

    const merchantNamedExpenses = expenseTransactions.filter((transaction) => {
        const merchant = resolveMerchantLabel(transaction);
        return !isUnknownMerchantLabel(merchant);
    }).length;

    const validAccounts = (accounts || []).filter((account) => account && account.balance);
    const nonEurAccounts = validAccounts.filter((account) => (
        String(account?.balance?.currency || 'EUR').toUpperCase() !== 'EUR'
    ));
    const nonEurConvertedAccounts = nonEurAccounts.filter((account) => {
        const converted = Number(account?.balance_eur?.value);
        return Number.isFinite(converted);
    });

    const categoryCoverage = safeRatio(categorizedExpenses, expenseTransactions.length, null);
    const merchantCoverage = safeRatio(merchantNamedExpenses, expenseTransactions.length, null);
    const internalShare = safeRatio(internalTransactions, totalTransactions, 0);
    const fxCoverage = nonEurAccounts.length
        ? safeRatio(nonEurConvertedAccounts.length, nonEurAccounts.length, null)
        : 1;

    const serverCoverage = serverSummary?.coverage || {};
    const mergedCoverage = {
        category_coverage: categoryCoverage ?? serverCoverage.category_coverage,
        merchant_coverage: merchantCoverage ?? serverCoverage.merchant_coverage,
        category_amount_coverage: serverCoverage.category_amount_coverage ?? categoryCoverage,
        merchant_amount_coverage: serverCoverage.merchant_amount_coverage ?? merchantCoverage,
        amount_eur_coverage: serverCoverage.amount_eur_coverage ?? 1,
        fx_coverage: serverCoverage.fx_coverage ?? fxCoverage,
        internal_share: internalShare ?? serverCoverage.internal_share
    };

    const categoryComponent = mergedCoverage.category_coverage ?? 0;
    const merchantComponent = mergedCoverage.merchant_coverage ?? 0;
    const categoryAmountComponent = mergedCoverage.category_amount_coverage ?? categoryComponent;
    const merchantAmountComponent = mergedCoverage.merchant_amount_coverage ?? merchantComponent;
    const amountComponent = mergedCoverage.amount_eur_coverage ?? 0;
    const fxComponent = mergedCoverage.fx_coverage ?? 0;

    const score = Math.round(
        100 * (
            0.25 * categoryComponent +
            0.20 * merchantComponent +
            0.20 * categoryAmountComponent +
            0.15 * merchantAmountComponent +
            0.10 * amountComponent +
            0.10 * fxComponent
        )
    );

    const warnings = [];
    if (totalTransactions < 120) warnings.push('Relatief weinig transacties in deze periode.');
    if ((serverSummary?.metrics?.active_transaction_days ?? 0) > 0) {
        const activeDays = Number(serverSummary.metrics.active_transaction_days) || 0;
        const expectedDays = Math.max(10, Math.floor((Number(serverSummary.days) || 90) * 0.35));
        if (activeDays < expectedDays) warnings.push(`Beperkte dagdekking: ${activeDays} actieve dagen.`);
    }
    if ((mergedCoverage.category_coverage ?? 1) < 0.78) warnings.push('Categorie-dekking op uitgaven is laag.');
    if ((mergedCoverage.category_amount_coverage ?? 1) < 0.84) warnings.push('Hoge uitgaven staan nog in categorie Overig/onbekend.');
    if ((mergedCoverage.merchant_coverage ?? 1) < 0.85) warnings.push('Merchant-dekking op uitgaven is laag.');
    if ((mergedCoverage.merchant_amount_coverage ?? 1) < 0.88) warnings.push('Merchant-attributie mist op hoge uitgavenbedragen.');
    if ((mergedCoverage.amount_eur_coverage ?? 1) < 0.95) warnings.push('Niet alle transacties hebben EUR-waarde in lokale store.');
    if ((mergedCoverage.fx_coverage ?? 1) < 0.95) warnings.push('Niet alle non-EUR rekeningen zijn omgerekend.');
    if ((mergedCoverage.internal_share ?? 0) > 0.5) warnings.push('Meer dan 50% lijkt internal transfer.');
    if (serverSummary?.metrics?.capture_freshness_hours > 24) warnings.push('Lokale cache is ouder dan 24 uur.');

    const mergedWarnings = Array.from(new Set([
        ...(Array.isArray(serverSummary?.warnings) ? serverSummary.warnings : []),
        ...warnings
    ]));
    const mergedRecommendations = Array.from(new Set([
        ...(Array.isArray(serverSummary?.recommendations) ? serverSummary.recommendations : []),
        ...((mergedCoverage.category_amount_coverage ?? 1) < 0.84
            ? ['Prioriteer categorisatie op merchants met hoogste uitgavenimpact.']
            : []),
        ...((mergedCoverage.merchant_amount_coverage ?? 1) < 0.88
            ? ['Voeg extra merchant-fallbacks toe op description/counterparty.']
            : [])
    ]));

    let qualityLabel = 'Needs attention';
    if (score >= 85) qualityLabel = 'Good';
    else if (score >= 70) qualityLabel = 'Fair';

    return {
        score: Math.max(0, Math.min(100, score)),
        qualityLabel,
        metrics: {
            total_transactions: totalTransactions,
            expense_transactions: expenseTransactions.length,
            internal_transactions: internalTransactions,
            active_transaction_days: Number(serverSummary?.metrics?.active_transaction_days) || 0,
            dataset_span_days: Number(serverSummary?.metrics?.dataset_span_days) || 0,
            categorized_expenses: categorizedExpenses,
            merchant_named_expenses: merchantNamedExpenses,
            expense_amount_total: Number(serverSummary?.metrics?.expense_amount_total) || 0,
            categorized_expense_amount: Number(serverSummary?.metrics?.categorized_expense_amount) || 0,
            merchant_named_expense_amount: Number(serverSummary?.metrics?.merchant_named_expense_amount) || 0,
            total_accounts: validAccounts.length,
            non_eur_accounts: nonEurAccounts.length,
            non_eur_converted_accounts: nonEurConvertedAccounts.length,
            latest_capture_at: serverSummary?.metrics?.latest_capture_at ?? null,
            capture_freshness_hours: serverSummary?.metrics?.capture_freshness_hours ?? null
        },
        coverage: mergedCoverage,
        warnings: mergedWarnings,
        recommendations: mergedRecommendations,
        source: serverSummary ? 'server+client' : 'client-only'
    };
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

function formatRatioPercent(value) {
    if (!Number.isFinite(Number(value))) return 'N/A';
    return `${(Number(value) * 100).toFixed(1)}%`;
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

    if (detailType === 'budget-coach') {
        const monthly = summarizeMonthlyBudgetDiscipline(transactions, 12);
        if (!monthly.length) {
            openDetailModal({
                title: '<i class="fas fa-scale-balanced"></i> Budget discipline detail',
                summary: 'Onvoldoende data voor maandelijkse budgetanalyse.',
                rows: [{ label: 'Geen complete maandinkomsten gevonden.', value: '' }],
                chart: null
            });
            return;
        }

        const labels = monthly.map((row) => row.monthLabel);
        const avgEssentials = monthly.reduce((sum, row) => sum + row.essentialsPct, 0) / monthly.length;
        const avgDiscretionary = monthly.reduce((sum, row) => sum + row.discretionaryPct, 0) / monthly.length;
        const avgSavings = monthly.reduce((sum, row) => sum + row.savingsPct, 0) / monthly.length;
        const latest = monthly[monthly.length - 1];

        const traces = [
            {
                type: 'bar',
                name: 'Essentials',
                x: labels,
                y: monthly.map((row) => row.essentials),
                marker: { color: 'rgba(59,130,246,0.82)' },
                hovertemplate: '%{x}<br>Essentials: %{y:.2f} EUR<extra></extra>'
            },
            {
                type: 'bar',
                name: 'Discretionary',
                x: labels,
                y: monthly.map((row) => row.discretionary),
                marker: { color: 'rgba(245,158,11,0.82)' },
                hovertemplate: '%{x}<br>Discretionary: %{y:.2f} EUR<extra></extra>'
            },
            {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Income',
                x: labels,
                y: monthly.map((row) => row.income),
                line: { color: '#22c55e', width: 2.5 },
                marker: { size: 6 },
                hovertemplate: '%{x}<br>Income: %{y:.2f} EUR<extra></extra>'
            },
            {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Net savings',
                x: labels,
                y: monthly.map((row) => row.netSavings),
                line: { color: '#38bdf8', width: 2.5, dash: 'dot' },
                marker: { size: 6 },
                hovertemplate: '%{x}<br>Net savings: %{y:.2f} EUR<extra></extra>'
            }
        ];
        const layout = {
            barmode: 'stack',
            margin: { t: 10, r: 20, l: 52, b: 48 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            xaxis: { tickangle: -20 },
            yaxis: { gridcolor: 'rgba(255,255,255,0.08)', title: 'EUR' },
            legend: { orientation: 'h', y: -0.2 }
        };

        openDetailModal({
            title: '<i class="fas fa-scale-balanced"></i> Budget discipline detail',
            summary: `Gemiddeld: essentials ${avgEssentials.toFixed(1)}% (target 50%), discretionary ${avgDiscretionary.toFixed(1)}% (target 30%), savings ${avgSavings.toFixed(1)}% (target 20%). Laatste maand savings: ${latest.savingsPct.toFixed(1)}%.`,
            rows: monthly.slice().reverse().map((row) => ({
                label: `${row.monthLabel} · In ${formatCurrency(row.income)} · Need ${formatCurrency(row.essentials)} (${row.essentialsPct.toFixed(1)}%) · Want ${formatCurrency(row.discretionary)} (${row.discretionaryPct.toFixed(1)}%)`,
                value: `Net ${formatCurrency(row.netSavings)} (${row.savingsPct.toFixed(1)}%)`
            })),
            chart: { trace: traces, layout }
        });
        return;
    }

    if (detailType === 'action-plan') {
        const localKpis = calculateKPIs(transactions);
        const windows = splitRollingWindows(transactions, 30);
        const recentExpenses = windows.recent
            .filter((transaction) => transaction.amount < 0)
            .reduce((sum, transaction) => sum + Math.abs(transaction.amount || 0), 0);
        const recentIncome = windows.recent
            .filter((transaction) => transaction.amount > 0)
            .reduce((sum, transaction) => sum + (transaction.amount || 0), 0);
        const observedRecentDays = Math.max(new Set(windows.recent.map((transaction) => toDateKey(transaction.date))).size, 1);
        const dailyBurn = Math.max((recentExpenses - recentIncome) / observedRecentDays, 0);
        const liquidBalance = balanceMetrics
            ? (Number(balanceMetrics.totals.checking) || 0) + (Number(balanceMetrics.totals.savings) || 0)
            : null;
        const actions = buildActionPlan(transactions, localKpis, liquidBalance, dailyBurn);

        const chartRows = actions
            .filter((action) => (Number(action.impact) || 0) > 0.01)
            .slice(0, 8);
        const chart = chartRows.length ? {
            trace: {
                type: 'bar',
                orientation: 'h',
                x: chartRows.map((action) => Number(action.impact) || 0).reverse(),
                y: chartRows.map((action) => action.title).reverse(),
                marker: {
                    color: chartRows.map((action) => (
                        action.priority === 1 ? 'rgba(239,68,68,0.82)' :
                        action.priority === 2 ? 'rgba(245,158,11,0.82)' :
                        'rgba(59,130,246,0.82)'
                    )).reverse()
                },
                hovertemplate: '%{y}<br>Potentieel effect: %{x:.2f} EUR<extra></extra>'
            },
            layout: {
                margin: { t: 10, r: 20, l: 180, b: 30 },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: '#cbd5f5' },
                xaxis: { gridcolor: 'rgba(255,255,255,0.08)', title: 'EUR potentieel' },
                yaxis: { automargin: true }
            }
        } : null;

        openDetailModal({
            title: '<i class="fas fa-list-check"></i> Action plan (prioriteit)',
            summary: actions.length
                ? `Topprioriteiten op basis van huidige periode (${actions.length} acties, hoogste confidence ${Math.round((Number(actions[0].confidence) || 0.75) * 100)}%).`
                : 'Geen acties beschikbaar.',
            rows: actions.map((action) => ({
                label: `P${action.priority} · ${action.title}`,
                value: `${action.summary}${(Number(action.impact) || 0) > 0.01 ? ` · Impact ${formatCurrency(action.impact)}` : ''} · Confidence ${Math.round((Number(action.confidence) || 0.75) * 100)}%${action.playbook ? ` · Actie: ${action.playbook}` : ''}`
            })),
            chart
        });
        return;
    }

    if (detailType === 'recurring-costs') {
        const recurring = summarizeRecurringCosts(transactions, 20);
        if (!recurring.rows.length) {
            openDetailModal({
                title: '<i class="fas fa-repeat"></i> Recurring costs',
                summary: 'Onvoldoende terugkerende uitgaven gevonden in de geselecteerde periode.',
                rows: [{ label: 'Geen terugkerende merchant-patronen gevonden.', value: '' }],
                chart: null
            });
            return;
        }

        const chartRows = recurring.rows.slice(0, 12).reverse();
        const trace = {
            type: 'bar',
            orientation: 'h',
            x: chartRows.map((row) => row.avgMonthly),
            y: chartRows.map((row) => row.merchant),
            marker: { color: 'rgba(168,85,247,0.82)' },
            text: chartRows.map((row) => `${row.monthsPresent} mnd`),
            textposition: 'outside',
            hovertemplate: '%{y}<br>Gem. per maand: %{x:.2f} EUR<extra></extra>'
        };
        const layout = {
            margin: { t: 10, r: 44, l: 180, b: 30 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            xaxis: { gridcolor: 'rgba(255,255,255,0.08)', title: 'Gemiddelde maandlast (EUR)' },
            yaxis: { automargin: true }
        };

        const monthlyTotal = recurring.rows.reduce((sum, row) => sum + row.avgMonthly, 0);
        openDetailModal({
            title: '<i class="fas fa-repeat"></i> Recurring costs',
            summary: `${recurring.rows.length} terugkerende merchants · geschatte maandlast ${formatCurrency(monthlyTotal)}.`,
            rows: recurring.rows.map((row) => ({
                label: `${row.merchant} · ${row.monthsPresent}/${recurring.months} maanden`,
                value: `${formatCurrency(row.avgMonthly)}/mnd (stabiliteit ${(Math.max(0, 1 - row.stability) * 100).toFixed(0)}%)`
            })),
            chart: { trace, layout }
        });
        return;
    }

    if (detailType === 'data-quality') {
        const quality = latestDataQualitySummary;
        if (!quality || !quality.metrics) {
            openDetailModal({
                title: '<i class="fas fa-shield-halved"></i> Data quality',
                summary: 'Nog geen kwaliteitsmeting beschikbaar.',
                rows: [{ label: 'Laad eerst real data om kwaliteitsmetingen te berekenen.', value: '' }],
                chart: null
            });
            return;
        }

        const coverage = quality.coverage || {};
        const metrics = quality.metrics || {};
        const componentRows = [
            { label: 'Categorie-dekking', value: Number(coverage.category_coverage) || 0 },
            { label: 'Merchant-dekking', value: Number(coverage.merchant_coverage) || 0 },
            { label: 'Categorie-dekking (bedrag)', value: Number(coverage.category_amount_coverage) || 0 },
            { label: 'Merchant-dekking (bedrag)', value: Number(coverage.merchant_amount_coverage) || 0 },
            { label: 'EUR-dekking', value: Number(coverage.amount_eur_coverage) || 0 },
            { label: 'FX-dekking', value: Number(coverage.fx_coverage) || 0 }
        ];

        const chart = {
            trace: {
                type: 'bar',
                x: componentRows.map((row) => row.label),
                y: componentRows.map((row) => row.value * 100),
                marker: {
                    color: componentRows.map((row) => (
                        row.value >= 0.85 ? '#22c55e' :
                        row.value >= 0.7 ? '#f59e0b' :
                        '#ef4444'
                    ))
                },
                hovertemplate: '%{x}<br>%{y:.1f}%<extra></extra>'
            },
            layout: {
                margin: { t: 10, r: 20, l: 44, b: 64 },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: '#cbd5f5' },
                xaxis: { tickangle: -20 },
                yaxis: {
                    title: 'Dekking (%)',
                    range: [0, 100],
                    gridcolor: 'rgba(255,255,255,0.08)'
                }
            }
        };

        const rows = [
            { label: 'Quality score', value: `${quality.score}/100 (${quality.qualityLabel})` },
            { label: 'Transacties (periode)', value: String(metrics.total_transactions ?? 0) },
            { label: 'Actieve transactiedagen', value: String(metrics.active_transaction_days ?? 0) },
            { label: 'Dataspan (dagen)', value: String(metrics.dataset_span_days ?? 0) },
            { label: 'Uitgaven met categorie', value: `${metrics.categorized_expenses ?? 0}/${metrics.expense_transactions ?? 0} (${formatRatioPercent(coverage.category_coverage)})` },
            { label: 'Uitgavenvolume met categorie', value: `${formatCurrency(metrics.categorized_expense_amount ?? 0)} / ${formatCurrency(metrics.expense_amount_total ?? 0)} (${formatRatioPercent(coverage.category_amount_coverage)})` },
            { label: 'Uitgaven met merchant', value: `${metrics.merchant_named_expenses ?? 0}/${metrics.expense_transactions ?? 0} (${formatRatioPercent(coverage.merchant_coverage)})` },
            { label: 'Uitgavenvolume met merchant', value: `${formatCurrency(metrics.merchant_named_expense_amount ?? 0)} / ${formatCurrency(metrics.expense_amount_total ?? 0)} (${formatRatioPercent(coverage.merchant_amount_coverage)})` },
            { label: 'EUR-dekking', value: formatRatioPercent(coverage.amount_eur_coverage) },
            { label: 'FX-dekking (non-EUR)', value: formatRatioPercent(coverage.fx_coverage) },
            { label: 'Internal share', value: formatRatioPercent(coverage.internal_share) },
            { label: 'Laatste cache-capture', value: metrics.latest_capture_at ? String(metrics.latest_capture_at) : 'N/A' }
        ];

        if (Array.isArray(quality.warnings) && quality.warnings.length) {
            quality.warnings.forEach((warning, index) => {
                rows.push({ label: `Waarschuwing ${index + 1}`, value: warning });
            });
        }
        if (Array.isArray(quality.recommendations) && quality.recommendations.length) {
            quality.recommendations.slice(0, 4).forEach((recommendation, index) => {
                rows.push({ label: `Aanbeveling ${index + 1}`, value: recommendation });
            });
        }

        openDetailModal({
            title: '<i class="fas fa-shield-halved"></i> Data quality',
            summary: 'Kwaliteitsscore voor analyses op basis van live transacties en lokale historie.',
            rows,
            chart
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
    const essentialByCategory = {};
    const discretionaryByCategory = {};
    let totalIncome = 0;
    let totalEssentials = 0;
    let totalDiscretionary = 0;

    data.forEach((transaction) => {
        const category = transaction.category || 'Overig';
        if ((transaction.amount || 0) >= 0) {
            const amount = Number(transaction.amount) || 0;
            incomeByCategory[category] = (incomeByCategory[category] || 0) + amount;
            totalIncome += amount;
            return;
        }

        const expense = Math.abs(Number(transaction.amount) || 0);
        if (isEssentialCategory(category)) {
            essentialByCategory[category] = (essentialByCategory[category] || 0) + expense;
            totalEssentials += expense;
            return;
        }
        discretionaryByCategory[category] = (discretionaryByCategory[category] || 0) + expense;
        totalDiscretionary += expense;
    });

    const totalExpenses = totalEssentials + totalDiscretionary;
    if (totalIncome <= 0.01 && totalExpenses <= 0.01) {
        Plotly.react(container, [], {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            annotations: [{
                text: 'Geen geldstromen beschikbaar in deze periode.',
                showarrow: false,
                x: 0.5,
                y: 0.5,
                xref: 'paper',
                yref: 'paper',
                font: { size: 14, color: '#cbd5f5' }
            }]
        }, { displayModeBar: false, responsive: true });
        return;
    }

    const topIncome = selectTopWithRemainder(Object.entries(incomeByCategory), 6, 'Overig inkomen', 0.08);
    const topEssential = selectTopWithRemainder(Object.entries(essentialByCategory), 7, 'Overig essentials', 0.06);
    const topDiscretionary = selectTopWithRemainder(Object.entries(discretionaryByCategory), 7, 'Overig discretionary', 0.06);

    const labels = [
        ...topIncome.map(([name]) => `In: ${name}`),
        'Cash In',
        'Essentials',
        'Discretionary',
        ...topEssential.map(([name]) => `Need: ${name}`),
        ...topDiscretionary.map(([name]) => `Want: ${name}`)
    ];
    const source = [];
    const target = [];
    const value = [];
    const colors = [];
    const linkSharePct = [];

    const cashInIndex = topIncome.length;
    const essentialsIndex = cashInIndex + 1;
    const discretionaryIndex = cashInIndex + 2;
    const needsStartIndex = discretionaryIndex + 1;
    const wantsStartIndex = needsStartIndex + topEssential.length;

    topIncome.forEach(([, amount], idx) => {
        if (amount <= 0) return;
        source.push(idx);
        target.push(cashInIndex);
        value.push(amount);
        colors.push('rgba(34,197,94,0.5)');
        linkSharePct.push(totalIncome > 0 ? (amount / totalIncome) * 100 : 0);
    });

    if (totalEssentials > 0.01) {
        source.push(cashInIndex);
        target.push(essentialsIndex);
        value.push(totalEssentials);
        colors.push('rgba(59,130,246,0.42)');
        linkSharePct.push(totalIncome > 0 ? (totalEssentials / totalIncome) * 100 : 0);
    }

    if (totalDiscretionary > 0.01) {
        source.push(cashInIndex);
        target.push(discretionaryIndex);
        value.push(totalDiscretionary);
        colors.push('rgba(245,158,11,0.42)');
        linkSharePct.push(totalIncome > 0 ? (totalDiscretionary / totalIncome) * 100 : 0);
    }

    topEssential.forEach(([, amount], idx) => {
        if (amount <= 0) return;
        source.push(essentialsIndex);
        target.push(needsStartIndex + idx);
        value.push(amount);
        colors.push('rgba(59,130,246,0.34)');
        linkSharePct.push(totalEssentials > 0 ? (amount / totalEssentials) * 100 : 0);
    });

    topDiscretionary.forEach(([, amount], idx) => {
        if (amount <= 0) return;
        source.push(discretionaryIndex);
        target.push(wantsStartIndex + idx);
        value.push(amount);
        colors.push('rgba(245,158,11,0.34)');
        linkSharePct.push(totalDiscretionary > 0 ? (amount / totalDiscretionary) * 100 : 0);
    });

    const net = totalIncome - totalExpenses;
    if (net > 0) {
        labels.push('Net Saved');
        source.push(cashInIndex);
        target.push(labels.length - 1);
        value.push(net);
        colors.push('rgba(56,189,248,0.45)');
        linkSharePct.push(totalIncome > 0 ? (net / totalIncome) * 100 : 0);
    } else if (net < 0) {
        labels.push('Buffer / Debt');
        source.push(labels.length - 1);
        target.push(cashInIndex);
        value.push(Math.abs(net));
        colors.push('rgba(251,191,36,0.45)');
        linkSharePct.push(totalIncome > 0 ? (Math.abs(net) / totalIncome) * 100 : 0);
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
                if (label === 'Essentials') return '#3b82f6';
                if (label === 'Discretionary') return '#f59e0b';
                if (label.startsWith('Need:')) return '#60a5fa';
                if (label.startsWith('Want:')) return '#fbbf24';
                if (label.startsWith('In:')) return '#22c55e';
                return getCategoryColor(label);
            }),
            line: { color: 'rgba(15,23,42,0.7)', width: 1.2 }
        },
        link: {
            source,
            target,
            value,
            color: colors,
            customdata: linkSharePct,
            hovertemplate: '%{source.label} → %{target.label}<br>%{value:.2f} EUR<br>%{customdata:.1f}% van bron<extra></extra>'
        }
    };

    const layout = {
        margin: { t: 20, r: 20, l: 20, b: 20 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' },
        annotations: [{
            text: `In ${formatCurrency(totalIncome)} · Uit ${formatCurrency(totalExpenses)} · Netto ${formatCurrency(net)}`,
            showarrow: false,
            x: 0,
            y: 1.05,
            xref: 'paper',
            yref: 'paper',
            xanchor: 'left',
            font: { size: 12, color: '#cbd5f5' }
        }]
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

    if (totalIncome <= 0.01 && totalExpenses <= 0.01) {
        Plotly.react(container, [], {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#ffffff' },
            annotations: [{
                text: 'Geen categorie-data beschikbaar in deze periode.',
                showarrow: false,
                x: 0.5,
                y: 0.5,
                xref: 'paper',
                yref: 'paper',
                font: { size: 14, color: '#cbd5f5' }
            }]
        }, { displayModeBar: false, responsive: true });
        return;
    }

    pushNode('root', 'All', '', totalIncome + totalExpenses, '#334155');
    pushNode('income', 'Income', 'root', totalIncome, '#22c55e');
    pushNode('expenses', 'Expenses', 'root', totalExpenses, '#ef4444');

    const incomeEntries = selectTopWithRemainder(
        Array.from(incomeByCategory.entries()),
        9,
        'Overig inkomen',
        0.05
    );
    incomeEntries.forEach(([category, amount]) => {
        pushNode(`income:${category}`, category, 'income', amount, getCategoryColor(category));
    });

    const expenseEntries = selectTopWithRemainder(
        Array.from(expenseByCategory.entries()),
        14,
        'Overig categorieen',
        0.03
    );
    expenseEntries.forEach(([category, amount]) => {
        const categoryId = `expense:${category}`;
        const categoryColor = getCategoryColor(category);
        pushNode(categoryId, category, 'expenses', amount, categoryColor);

        const merchantMap = merchantByCategory.get(category);
        if (!merchantMap || !merchantMap.size) return;

        const merchantEntries = selectTopWithRemainder(
            Array.from(merchantMap.entries()),
            16,
            'Overig winkels',
            0.04
        );
        merchantEntries.forEach(([merchant, merchantAmount]) => {
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
        sort: false,
        maxdepth: 3,
        insidetextorientation: 'radial',
        insidetextfont: { color: '#ffffff' },
        outsidetextfont: { color: '#ffffff' },
        textfont: { color: '#ffffff' },
        marker: {
            colors,
            line: {
                color: 'rgba(15, 23, 42, 0.9)',
                width: 2.2
            }
        },
        hovertemplate: '%{label}<br>%{value:.2f} EUR<br>%{percentParent:.1%} van parent<extra></extra>'
    };
    
    const layout = {
        margin: { t: 20, r: 10, l: 10, b: 10 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#ffffff' },
        uniformtext: { minsize: 10, mode: 'hide' }
    };
    
    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
}

function renderTimeTravelChart(data) {
    const container = document.getElementById('timeTravelChart');
    if (!container) return;

    const monthly = summarizeMonthlyBudgetDiscipline(data, 12);
    if (!monthly.length) {
        Plotly.react(container, [], {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#cbd5f5' },
            annotations: [{
                text: 'Onvoldoende data voor budgetdiscipline analyse.',
                showarrow: false,
                x: 0.5,
                y: 0.5,
                xref: 'paper',
                yref: 'paper',
                font: { size: 14, color: '#cbd5f5' }
            }]
        }, { displayModeBar: false, responsive: true });
        return;
    }

    const labels = monthly.map((row) => row.monthLabel);
    const essentials = monthly.map((row) => row.essentialsPct);
    const discretionary = monthly.map((row) => row.discretionaryPct);
    const savings = monthly.map((row) => row.savingsPct);
    const minPct = Math.min(-20, ...savings.map((value) => Number(value) || 0));
    const latest = monthly[monthly.length - 1];
    const statusText = `Laatste maand: essentials ${latest.essentialsPct.toFixed(1)}% (target 50%), discretionary ${latest.discretionaryPct.toFixed(1)}% (target 30%), savings ${latest.savingsPct.toFixed(1)}% (target 20%).`;

    const traces = [
        {
            type: 'scatter',
            mode: 'lines+markers',
            name: 'Essentials %',
            x: labels,
            y: essentials,
            line: { color: '#3b82f6', width: 3 },
            marker: { size: 7 },
            hovertemplate: '%{x}<br>Essentials: %{y:.1f}%<extra></extra>'
        },
        {
            type: 'scatter',
            mode: 'lines+markers',
            name: 'Discretionary %',
            x: labels,
            y: discretionary,
            line: { color: '#f59e0b', width: 3 },
            marker: { size: 7 },
            hovertemplate: '%{x}<br>Discretionary: %{y:.1f}%<extra></extra>'
        },
        {
            type: 'scatter',
            mode: 'lines+markers',
            name: 'Savings %',
            x: labels,
            y: savings,
            line: { color: '#22c55e', width: 3 },
            marker: { size: 7 },
            hovertemplate: '%{x}<br>Savings: %{y:.1f}%<extra></extra>'
        },
        {
            type: 'scatter',
            mode: 'lines',
            name: 'Target essentials (50%)',
            x: labels,
            y: labels.map(() => 50),
            line: { color: 'rgba(59,130,246,0.65)', width: 1.8, dash: 'dot' },
            hoverinfo: 'skip'
        },
        {
            type: 'scatter',
            mode: 'lines',
            name: 'Target discretionary (30%)',
            x: labels,
            y: labels.map(() => 30),
            line: { color: 'rgba(245,158,11,0.65)', width: 1.8, dash: 'dot' },
            hoverinfo: 'skip'
        },
        {
            type: 'scatter',
            mode: 'lines',
            name: 'Target savings (20%)',
            x: labels,
            y: labels.map(() => 20),
            line: { color: 'rgba(34,197,94,0.65)', width: 1.8, dash: 'dot' },
            hoverinfo: 'skip'
        }
    ];

    const layout = {
        margin: { t: 36, r: 20, l: 50, b: 44 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' },
        xaxis: { showgrid: false },
        yaxis: {
            title: '% van maandinkomen',
            gridcolor: 'rgba(255,255,255,0.08)',
            range: [Math.floor(minPct / 10) * 10, 100]
        },
        legend: { orientation: 'h', y: -0.22 },
        annotations: [{
            text: statusText,
            showarrow: false,
            x: 0,
            y: 1.18,
            xref: 'paper',
            yref: 'paper',
            xanchor: 'left',
            align: 'left',
            font: { size: 12, color: '#cbd5f5' }
        }]
    };

    Plotly.react(container, traces, layout, { displayModeBar: false, responsive: true });
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

const ESSENTIAL_CATEGORIES = new Set([
    'Boodschappen',
    'Wonen',
    'Utilities',
    'Verzekering',
    'Belastingen',
    'Vervoer',
    'Zorg'
]);

function isEssentialCategory(category) {
    return ESSENTIAL_CATEGORIES.has(category || 'Overig');
}

function selectTopWithRemainder(entries, limit, otherLabel, minShare = 0) {
    const cleaned = [...entries]
        .map(([label, value]) => [label, Number(value) || 0])
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1]);

    if (!cleaned.length) return [];

    const total = cleaned.reduce((sum, [, value]) => sum + value, 0);
    const top = [];
    let remainder = 0;

    cleaned.forEach(([label, value], index) => {
        const share = total > 0 ? value / total : 0;
        if (index < limit || share >= minShare) {
            top.push([label, value]);
            return;
        }
        remainder += value;
    });

    if (remainder > 0.0001) {
        top.push([otherLabel, remainder]);
    }
    return top;
}

function summarizeMonthlyBudgetDiscipline(transactions, maxMonths = 12) {
    const byMonth = new Map();
    (transactions || []).forEach((transaction) => {
        if (!(transaction.date instanceof Date) || Number.isNaN(transaction.date.getTime())) return;
        const monthKey = `${transaction.date.getFullYear()}-${String(transaction.date.getMonth() + 1).padStart(2, '0')}`;
        if (!byMonth.has(monthKey)) {
            byMonth.set(monthKey, {
                monthKey,
                income: 0,
                essentials: 0,
                discretionary: 0
            });
        }
        const bucket = byMonth.get(monthKey);
        const amount = Number(transaction.amount) || 0;
        if (amount >= 0) {
            bucket.income += amount;
            return;
        }
        if (isEssentialCategory(transaction.category)) {
            bucket.essentials += Math.abs(amount);
        } else {
            bucket.discretionary += Math.abs(amount);
        }
    });

    return Array.from(byMonth.values())
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        .slice(-maxMonths)
        .map((row) => {
            const netSavings = row.income - row.essentials - row.discretionary;
            const denominator = row.income > 0.01 ? row.income : null;
            return {
                ...row,
                monthLabel: new Date(`${row.monthKey}-01T00:00:00`).toLocaleDateString('nl-NL', {
                    month: 'short',
                    year: '2-digit'
                }),
                netSavings,
                essentialsPct: denominator ? (row.essentials / denominator) * 100 : 0,
                discretionaryPct: denominator ? (row.discretionary / denominator) * 100 : 0,
                savingsPct: denominator ? (netSavings / denominator) * 100 : 0
            };
        })
        .filter((row) => row.income > 0.01);
}

function buildExpenseByCategory(transactions) {
    const totals = {};
    (transactions || []).forEach((transaction) => {
        if ((transaction.amount || 0) >= 0) return;
        const category = transaction.category || 'Overig';
        totals[category] = (totals[category] || 0) + Math.abs(transaction.amount || 0);
    });
    return totals;
}

function buildConcreteCostLevers(transactions, options = {}) {
    const windowDays = Number(options.windowDays) || 30;
    const maxCategories = Number(options.maxCategories) || 2;
    const maxMerchants = Number(options.maxMerchants) || 2;
    const minMonthly = Number(options.minMonthly) || 40;

    const windows = splitRollingWindows(transactions || [], windowDays);
    const source = (windows.recent && windows.recent.length) ? windows.recent : (transactions || []);
    const expenses = source.filter((transaction) => (transaction.amount || 0) < 0);
    if (!expenses.length) return [];

    const activeDays = Math.max(
        new Set(expenses.map((transaction) => toDateKey(transaction.date))).size,
        1
    );
    const monthlyScale = 30 / activeDays;

    const categoryTotals = new Map();
    const merchantTotals = new Map();
    let totalWindowExpenses = 0;

    expenses.forEach((transaction) => {
        const amountAbs = Math.abs(Number(transaction.amount) || 0);
        if (!Number.isFinite(amountAbs) || amountAbs <= 0) return;
        totalWindowExpenses += amountAbs;
        const category = transaction.category || 'Overig';
        const merchant = resolveMerchantLabel(transaction);
        categoryTotals.set(category, (categoryTotals.get(category) || 0) + amountAbs);
        merchantTotals.set(merchant, (merchantTotals.get(merchant) || 0) + amountAbs);
    });

    if (totalWindowExpenses <= 0.01) return [];

    const buildLever = (type, label, windowValue) => {
        const share = windowValue / totalWindowExpenses;
        const baselineMonthly = windowValue * monthlyScale;
        const targetCutPct = Math.min(0.22, Math.max(0.08, 0.08 + (share * 0.14)));
        const expectedMonthly = baselineMonthly * targetCutPct;
        return {
            type,
            label,
            share,
            baselineMonthly,
            targetCutPct,
            expectedMonthly
        };
    };

    const categoryLevers = Array.from(categoryTotals.entries())
        .map(([label, value]) => buildLever('category', label, value))
        .filter((lever) => lever.baselineMonthly >= minMonthly)
        .sort((a, b) => b.expectedMonthly - a.expectedMonthly)
        .slice(0, maxCategories);

    const merchantLevers = Array.from(merchantTotals.entries())
        .map(([label, value]) => buildLever('merchant', label, value))
        .filter((lever) => lever.baselineMonthly >= minMonthly)
        .sort((a, b) => b.expectedMonthly - a.expectedMonthly)
        .slice(0, maxMerchants);

    return [...categoryLevers, ...merchantLevers]
        .sort((a, b) => b.expectedMonthly - a.expectedMonthly);
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

function computeDailyExpenseVolatility(transactions) {
    const daily = buildDailyTotals(transactions || []);
    const values = daily.map((day) => Number(day.expenses) || 0);
    if (!values.length) {
        return { mean: 0, std: 0, cv: 0, label: 'N/A' };
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (mean <= 0.01) {
        return { mean, std: 0, cv: 0, label: 'Laag' };
    }
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    const std = Math.sqrt(Math.max(variance, 0));
    const cv = std / mean;
    const label = cv >= 0.9 ? 'Hoog' : (cv >= 0.55 ? 'Middel' : 'Laag');
    return { mean, std, cv, label };
}

function summarizeRecurringCosts(transactions, maxItems = 12) {
    const expenseTransactions = (transactions || []).filter((transaction) => (
        (transaction.amount || 0) < 0
        && transaction.date instanceof Date
        && !Number.isNaN(transaction.date.getTime())
    ));
    if (!expenseTransactions.length) {
        return { months: 0, rows: [] };
    }

    const monthKeys = new Set();
    const merchantByMonth = new Map();
    expenseTransactions.forEach((transaction) => {
        const monthKey = `${transaction.date.getFullYear()}-${String(transaction.date.getMonth() + 1).padStart(2, '0')}`;
        const merchant = resolveMerchantLabel(transaction);
        const amount = Math.abs(Number(transaction.amount) || 0);
        monthKeys.add(monthKey);
        if (!merchantByMonth.has(merchant)) {
            merchantByMonth.set(merchant, new Map());
        }
        const monthMap = merchantByMonth.get(merchant);
        monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + amount);
    });

    const totalMonths = monthKeys.size;
    const minMonths = totalMonths >= 4 ? 3 : 2;
    const rows = [];

    merchantByMonth.forEach((monthMap, merchant) => {
        const monthsPresent = monthMap.size;
        if (monthsPresent < minMonths) return;

        const monthlyValues = Array.from(monthMap.values());
        const avgMonthly = monthlyValues.reduce((sum, value) => sum + value, 0) / monthlyValues.length;
        if (avgMonthly < 7.5) return;

        const variance = monthlyValues.reduce((sum, value) => sum + ((value - avgMonthly) ** 2), 0) / monthlyValues.length;
        const std = Math.sqrt(Math.max(variance, 0));
        const cv = avgMonthly > 0.01 ? std / avgMonthly : 0;
        rows.push({
            merchant,
            monthsPresent,
            avgMonthly,
            totalObserved: monthlyValues.reduce((sum, value) => sum + value, 0),
            stability: cv
        });
    });

    rows.sort((a, b) => b.avgMonthly - a.avgMonthly);
    return {
        months: totalMonths,
        rows: rows.slice(0, maxItems)
    };
}

function buildActionPlan(transactions, kpis, liquidBalance = null, dailyBurn = 0) {
    const actions = [];
    const monthly = summarizeMonthlyBudgetDiscipline(transactions, 6);
    const latest = monthly[monthly.length - 1] || null;
    const baselineMonths = monthly.slice(-3);
    const baseline = baselineMonths.length
        ? baselineMonths.reduce((agg, row) => ({
            income: agg.income + row.income,
            essentials: agg.essentials + row.essentials,
            discretionary: agg.discretionary + row.discretionary,
            netSavings: agg.netSavings + row.netSavings
        }), { income: 0, essentials: 0, discretionary: 0, netSavings: 0 })
        : null;

    const uniqueDays = new Set(
        (transactions || [])
            .filter((transaction) => transaction.date instanceof Date && !Number.isNaN(transaction.date.getTime()))
            .map((transaction) => toDateKey(transaction.date))
    ).size;
    const coverageFactor = Math.min(1, Math.max(0.45, uniqueDays / 75));
    const baselineConfidence = Math.min(1, Math.max(0.55, (baselineMonths.length / 3) * 0.95));

    const pushAction = ({
        priority,
        title,
        summary,
        impact = 0,
        confidence = 0.75,
        reason = 'general',
        playbook = ''
    }) => {
        actions.push({
            priority: Math.max(1, Math.min(3, Number(priority) || 3)),
            title,
            summary,
            impact: Math.max(0, Number(impact) || 0),
            confidence: Math.max(0.4, Math.min(0.98, (Number(confidence) || 0.75) * coverageFactor)),
            reason,
            playbook: String(playbook || '').trim()
        });
    };

    const windows = splitRollingWindows(transactions, 30);
    const recentExpenses = windows.recent
        .filter((transaction) => transaction.amount < 0)
        .reduce((sum, transaction) => sum + Math.abs(transaction.amount || 0), 0);
    const priorExpenses = windows.prior
        .filter((transaction) => transaction.amount < 0)
        .reduce((sum, transaction) => sum + Math.abs(transaction.amount || 0), 0);
    const recentIncome = windows.recent
        .filter((transaction) => transaction.amount > 0)
        .reduce((sum, transaction) => sum + (transaction.amount || 0), 0);
    const priorIncome = windows.prior
        .filter((transaction) => transaction.amount > 0)
        .reduce((sum, transaction) => sum + (transaction.amount || 0), 0);

    const baseImpactFloor = Math.max(25, recentExpenses * 0.015, (kpis.expenses || 0) * 0.012);
    const trendImpactFloor = Math.max(baseImpactFloor, priorExpenses * 0.05);
    const incomeImpactFloor = Math.max(60, priorIncome * 0.05);

    if (baseline && baseline.income > 0.01) {
        const scale = 1 / baselineMonths.length;
        const avgIncome = baseline.income * scale;
        const avgEssentials = baseline.essentials * scale;
        const avgDiscretionary = baseline.discretionary * scale;
        const avgNetSavings = baseline.netSavings * scale;

        const savingsTarget = avgIncome * 0.2;
        const savingsGap = savingsTarget - avgNetSavings;
        if (savingsGap > baseImpactFloor) {
            pushAction({
                priority: 1,
                title: 'Verhoog netto sparen richting 20%',
                summary: `Gemiddeld tekort t.o.v. 20%-target: ${formatCurrency(savingsGap)} per maand.`,
                impact: savingsGap,
                confidence: 0.9 * baselineConfidence,
                reason: 'budget-rule'
            });
        }

        const discretionaryTarget = avgIncome * 0.3;
        const discretionaryGap = avgDiscretionary - discretionaryTarget;
        if (discretionaryGap > baseImpactFloor) {
            pushAction({
                priority: 1,
                title: 'Verlaag discretionary uitgaven',
                summary: `Gemiddeld discretionary ${formatCurrency(avgDiscretionary)} vs target ${formatCurrency(discretionaryTarget)}.`,
                impact: discretionaryGap,
                confidence: 0.88 * baselineConfidence,
                reason: 'budget-rule'
            });
        }

        const essentialTarget = avgIncome * 0.5;
        const essentialGap = avgEssentials - essentialTarget;
        if (essentialGap > Math.max(baseImpactFloor, 35)) {
            pushAction({
                priority: 2,
                title: 'Herzie vaste lasten / essentials',
                summary: `Gemiddeld essentials ${formatCurrency(avgEssentials)} vs target ${formatCurrency(essentialTarget)}.`,
                impact: essentialGap,
                confidence: 0.84 * baselineConfidence,
                reason: 'fixed-cost'
            });
        }

        if (latest && latest.essentialsPct > 62 && latest.discretionaryPct < 28) {
            pushAction({
                priority: 2,
                title: 'Vergroot inkomensruimte naast besparen',
                summary: `Essentials nemen ${latest.essentialsPct.toFixed(1)}% in van inkomen; extra inkomsten hebben nu meer effect dan extra kleine cuts.`,
                impact: Math.max((latest.essentialsPct - 50) * (latest.income / 100), baseImpactFloor * 0.7),
                confidence: 0.76 * baselineConfidence,
                reason: 'income-side'
            });
        }
    }

    if (priorExpenses > 0.01) {
        const increasePct = ((recentExpenses - priorExpenses) / priorExpenses) * 100;
        const expenseDelta = recentExpenses - priorExpenses;
        if (increasePct > 10 && expenseDelta > trendImpactFloor) {
            pushAction({
                priority: 2,
                title: 'Stop uitgavengroei',
                summary: `Uitgaven stegen ${increasePct.toFixed(1)}% in laatste 30 dagen (${formatCurrency(expenseDelta)}).`,
                impact: Math.max(expenseDelta, 0),
                confidence: 0.79,
                reason: 'expense-trend'
            });
        }
    }

    if (priorIncome > 0.01) {
        const incomeDeltaPct = ((recentIncome - priorIncome) / priorIncome) * 100;
        const incomeDelta = priorIncome - recentIncome;
        if (incomeDeltaPct < -12 && incomeDelta > incomeImpactFloor) {
            pushAction({
                priority: 1,
                title: 'Anticipeer op lagere inkomensstroom',
                summary: `Inkomen daalde ${Math.abs(incomeDeltaPct).toFixed(1)}% in laatste 30 dagen (${formatCurrency(incomeDelta)}).`,
                impact: Math.max(incomeDelta * 0.2, 0),
                confidence: 0.83,
                reason: 'income-trend'
            });
        }
    }

    const categoryExpenses = buildExpenseByCategory(transactions);
    const topCategory = Object.entries(categoryExpenses).sort((a, b) => b[1] - a[1])[0];
    if (topCategory && kpis.expenses > 0.01) {
        const topCategoryShare = (topCategory[1] / kpis.expenses) * 100;
        if (topCategoryShare > 38) {
            pushAction({
                priority: 2,
                title: 'Verminder categorie-concentratie',
                summary: `${topCategory[0]} is ${topCategoryShare.toFixed(1)}% van alle uitgaven (${formatCurrency(topCategory[1])}).`,
                impact: topCategory[1] * 0.1,
                confidence: 0.81,
                reason: 'category-concentration'
            });
        }
    }

    const merchantExpenses = {};
    (transactions || []).forEach((transaction) => {
        if ((transaction.amount || 0) >= 0) return;
        const merchant = resolveMerchantLabel(transaction);
        merchantExpenses[merchant] = (merchantExpenses[merchant] || 0) + Math.abs(transaction.amount || 0);
    });
    const topMerchant = Object.entries(merchantExpenses).sort((a, b) => b[1] - a[1])[0];
    if (topMerchant && kpis.expenses > 0.01) {
        const share = (topMerchant[1] / kpis.expenses) * 100;
        if (share > 25) {
            pushAction({
                priority: 3,
                title: 'Verlaag merchant-concentratie',
                summary: `${topMerchant[0]} is ${share.toFixed(1)}% van alle uitgaven (${formatCurrency(topMerchant[1])}).`,
                impact: topMerchant[1] * 0.08,
                confidence: 0.72,
                reason: 'merchant-concentration'
            });
        }
    }

    const recurring = summarizeRecurringCosts(transactions);
    const recurringTop = recurring.rows[0];
    if (recurringTop && recurringTop.avgMonthly > Math.max(40, baseImpactFloor)) {
        pushAction({
            priority: 2,
            title: 'Optimaliseer terugkerende kosten',
            summary: `${recurringTop.merchant} gemiddeld ${formatCurrency(recurringTop.avgMonthly)}/mnd over ${recurringTop.monthsPresent} maanden.`,
            impact: recurringTop.avgMonthly * 0.12,
            confidence: recurringTop.monthsPresent >= 4 ? 0.87 : 0.74,
            reason: 'recurring'
        });
    }
    const recurringMonthlyTotal = recurring.rows.reduce((sum, row) => sum + (row.avgMonthly || 0), 0);
    if (recentExpenses > 0.01) {
        const recurringShare = recurringMonthlyTotal / recentExpenses;
        if (recurringShare > 0.45 && recurringMonthlyTotal > baseImpactFloor * 2) {
            pushAction({
                priority: 1,
                title: 'Verlaag structurele vaste lasten',
                summary: `Terugkerende kosten zijn circa ${(recurringShare * 100).toFixed(1)}% van recente maanduitgaven (${formatCurrency(recurringMonthlyTotal)}).`,
                impact: recurringMonthlyTotal * 0.1,
                confidence: 0.86,
                reason: 'recurring-structure'
            });
        }
    }

    const concreteLevers = buildConcreteCostLevers(transactions, {
        windowDays: 30,
        maxCategories: 2,
        maxMerchants: 2,
        minMonthly: Math.max(35, baseImpactFloor * 0.9)
    });
    concreteLevers.slice(0, 3).forEach((lever) => {
        if (lever.expectedMonthly < baseImpactFloor * 0.6) return;
        if (lever.type === 'category') {
            pushAction({
                priority: lever.share > 0.22 ? 2 : 3,
                title: `Verlaag ${lever.label} uitgaven`,
                summary: `${lever.label} is ${((lever.share || 0) * 100).toFixed(1)}% van recente uitgaven. Richt op ~${(lever.targetCutPct * 100).toFixed(0)}% reductie.`,
                impact: lever.expectedMonthly,
                confidence: 0.82,
                reason: 'lever-category',
                playbook: `Stel budget in op ${formatCurrency(Math.max(0, lever.baselineMonthly - lever.expectedMonthly))}/mnd en monitor weeklimiet op deze categorie.`
            });
            return;
        }
        pushAction({
            priority: lever.share > 0.12 ? 2 : 3,
            title: `Optimaliseer uitgaven bij ${lever.label}`,
            summary: `${lever.label} vertegenwoordigt ${(lever.share * 100).toFixed(1)}% van recente uitgaven. Doel: ~${(lever.targetCutPct * 100).toFixed(0)}% lager.`,
            impact: lever.expectedMonthly,
            confidence: 0.76,
            reason: 'lever-merchant',
            playbook: `Vergelijk alternatief/abonnement en stuur op minstens ${formatCurrency(lever.expectedMonthly)} lagere maandlast.`
        });
    });

    const volatility = computeDailyExpenseVolatility(transactions);
    if (volatility.cv > 0.9 && volatility.mean > 20) {
        pushAction({
            priority: 3,
            title: 'Verminder uitgavenvolatiliteit',
            summary: `Dagelijkse uitgavenvolatiliteit is hoog (${(volatility.cv * 100).toFixed(0)}% van het gemiddelde).`,
            impact: volatility.mean * 0.08,
            confidence: 0.68,
            reason: 'volatility'
        });
    }

    if (liquidBalance !== null && dailyBurn > 0.01) {
        const runwayDays = liquidBalance / dailyBurn;
        if (runwayDays < 60) {
            const targetBuffer = dailyBurn * 90;
            const bufferGap = Math.max(targetBuffer - liquidBalance, 0);
            pushAction({
                priority: 1,
                title: 'Urgent: buffer onder 2 maanden',
                summary: `Runway is ${Math.round(runwayDays)} dagen. Richt op minimaal 90 dagen buffer.`,
                impact: bufferGap,
                confidence: 0.94,
                reason: 'runway'
            });
        }
        else if (runwayDays < 90) {
            const targetBuffer = dailyBurn * 90;
            const bufferGap = Math.max(targetBuffer - liquidBalance, 0);
            pushAction({
                priority: 2,
                title: 'Bouw 3 maanden buffer op',
                summary: `Runway ${Math.round(runwayDays)} dagen. Aanvullende buffer nodig: ${formatCurrency(bufferGap)}.`,
                impact: bufferGap,
                confidence: 0.87,
                reason: 'runway'
            });
        }
    }

    if (latest && latest.income > 0.01 && latest.savingsPct < 0) {
        pushAction({
            priority: 1,
            title: 'Herstel negatieve maandelijkse besparing',
            summary: `Laatste maand is netto negatief (${latest.savingsPct.toFixed(1)}%).`,
            impact: Math.abs(latest.netSavings),
            confidence: 0.9,
            reason: 'negative-savings'
        });
    }

    if (!actions.length) {
        pushAction({
            priority: 3,
            title: 'Huidige koers vasthouden',
            summary: 'Kernratio’s liggen rond target. Monitor maandelijks en optimaliseer op categorie-niveau.',
            impact: 0,
            confidence: 0.72,
            reason: 'steady'
        });
    }

    const dedupedMap = new Map();
    actions.forEach((action) => {
        const existing = dedupedMap.get(action.title);
        if (!existing) {
            dedupedMap.set(action.title, action);
            return;
        }
        if ((action.priority < existing.priority) || (
            action.priority === existing.priority && (
                (action.confidence > existing.confidence)
                || ((action.confidence === existing.confidence) && ((action.impact || 0) > (existing.impact || 0)))
            )
        )) {
            dedupedMap.set(action.title, action);
        }
    });

    return Array.from(dedupedMap.values())
        .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            if ((Number(b.confidence) || 0) !== (Number(a.confidence) || 0)) {
                return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
            }
            return (Number(b.impact) || 0) - (Number(a.impact) || 0);
        })
        .slice(0, 8);
}

function renderInsights(data, kpis, qualitySummary = null) {
    const biggestCategory = document.getElementById('biggestCategory');
    const avgDaily = document.getElementById('avgDaily');
    const spendVolatility = document.getElementById('spendVolatility');
    const expensiveDay = document.getElementById('expensiveDay');
    const trendInsight = document.getElementById('trendInsight');
    const liquidityRunway = document.getElementById('liquidityRunway');
    const needsVsWants = document.getElementById('needsVsWants');
    const budgetRuleFit = document.getElementById('budgetRuleFit');
    const topMerchantShare = document.getElementById('topMerchantShare');
    const recurringCosts = document.getElementById('recurringCosts');
    const nextBestAction = document.getElementById('nextBestAction');
    const projectedMonthNet = document.getElementById('projectedMonthNet');
    const dataQualityScore = document.getElementById('dataQualityScore');

    const expenseByCategory = buildExpenseByCategory(data);
    const biggest = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1])[0];
    if (biggestCategory) {
        biggestCategory.textContent = biggest ? `${biggest[0]} (${formatCurrency(biggest[1])})` : 'N/A';
    }

    const daily = buildDailyTotals(data);
    const avg = daily.length ? daily.reduce((sum, day) => sum + day.expenses, 0) / daily.length : 0;
    if (avgDaily) avgDaily.textContent = formatCurrency(avg);
    const volatility = computeDailyExpenseVolatility(data);
    if (spendVolatility) {
        spendVolatility.textContent = volatility.label === 'N/A'
            ? 'N/A'
            : `${volatility.label} (${(volatility.cv * 100).toFixed(0)}%)`;
    }

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

    const monthlyBudget = summarizeMonthlyBudgetDiscipline(data, 6);
    const latestBudget = monthlyBudget[monthlyBudget.length - 1] || null;
    if (budgetRuleFit) {
        if (!latestBudget) {
            budgetRuleFit.textContent = 'N/A';
        } else {
            budgetRuleFit.textContent = `N ${latestBudget.essentialsPct.toFixed(0)} / W ${latestBudget.discretionaryPct.toFixed(0)} / S ${latestBudget.savingsPct.toFixed(0)}`;
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

    const recurring = summarizeRecurringCosts(data);
    if (recurringCosts) {
        if (!recurring.rows.length) {
            recurringCosts.textContent = 'N/A';
        } else {
            const recurringMonthly = recurring.rows.reduce((sum, row) => sum + row.avgMonthly, 0);
            recurringCosts.textContent = `${formatCurrency(recurringMonthly)}/mnd`;
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

    const actionPlan = buildActionPlan(data, kpis, liquidBalance, dailyBurn);
    if (nextBestAction) {
        const topAction = actionPlan[0];
        if (!topAction) {
            nextBestAction.textContent = 'N/A';
        } else {
            const confidencePct = Math.round((Number(topAction.confidence) || 0.75) * 100);
            nextBestAction.textContent = topAction.impact > 0.01
                ? `P${topAction.priority} · ${topAction.title} (${formatCurrency(topAction.impact)}) · ${confidencePct}%`
                : `P${topAction.priority} · ${topAction.title} · ${confidencePct}%`;
        }
    }

    if (dataQualityScore) {
        if (!qualitySummary || !qualitySummary.metrics || !qualitySummary.metrics.total_transactions) {
            dataQualityScore.textContent = 'N/A';
        } else {
            const warningCount = Array.isArray(qualitySummary.warnings) ? qualitySummary.warnings.length : 0;
            const warningSuffix = warningCount ? ` · ${warningCount} waarschuwing${warningCount > 1 ? 'en' : ''}` : '';
            dataQualityScore.textContent = `${qualitySummary.score}/100 (${qualitySummary.qualityLabel})${warningSuffix}`;
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
        // Enforce a minimum of 1 minute to stay within Bunq's API rate limit (30 req/min).
        // A full data refresh issues several API calls, so anything below 60s is unsafe.
        const intervalMinutes = Math.max(CONFIG.refreshInterval, 1);
        refreshIntervalId = setInterval(() => {
            refreshData();
        }, intervalMinutes * 60 * 1000);
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
            renderAdminStatusPanel(null, response?.error || 'Admin status ophalen mislukt.', true);
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
    const autoTargetEl = document.getElementById('adminOptionAutoTargetIp');
    const deactivateEl = document.getElementById('adminDeactivateOtherIps');
    const suggestedIp = (ipInputEl?.value || '').trim() || (adminStatusData?.egress_ip || '').trim();
    const promptDefault = suggestedIp || '';
    const prompted = window.prompt(
        'Voer het nieuwe publieke IPv4-adres in voor Bunq whitelist.\nLaat leeg om automatisch egress-IP te gebruiken.',
        promptDefault
    );
    if (prompted === null) {
        return;
    }
    let targetIp = (prompted || '').trim();
    const useAutoTarget = targetIp.length === 0;

    if (autoTargetEl) {
        autoTargetEl.checked = useAutoTarget;
    }
    if (ipInputEl) {
        ipInputEl.value = targetIp;
        ipInputEl.disabled = useAutoTarget;
    }

    if (!useAutoTarget) {
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
    const targetLabel = useAutoTarget ? 'current egress IP (auto)' : targetIp;

    const confirmed = window.confirm(
        `Veilige 2-staps update uitvoeren voor "${targetLabel}"?\n` +
        'Stap 1: IP toevoegen/activeren (zonder andere IPs te deactiveren).\n' +
        'Stap 2: na bevestiging andere ACTIVE IPs op INACTIVE zetten.'
    );
    if (!confirmed) return;

    await runAdminAction('adminSetWhitelistIp', '<i class="fas fa-spinner fa-spin"></i> Setting...', async () => {
        const step1Response = await authenticatedFetch(`${CONFIG.apiEndpoint}/admin/bunq/whitelist-ip`, {
            method: 'POST',
            body: JSON.stringify({
                ip: useAutoTarget ? null : targetIp,
                deactivate_others: false,
                refresh_key: true,
                force_recreate: false,
                clear_runtime_cache: false
            })
        });

        if (!step1Response || !step1Response.success) {
            const errorText = step1Response?.error || 'Bunq whitelist update stap 1 mislukt.';
            renderAdminStatusPanel(adminStatusData, errorText, true);
            return;
        }

        const step1Data = step1Response.data || {};
        const resolvedIp = step1Data.target_ip || targetIp || '';
        const step1Actions = step1Data.actions || {};
        const step1Message = `Stap 1 OK voor ${resolvedIp || targetLabel}: ` +
            `created=${(step1Actions.created || []).length}, ` +
            `activated=${(step1Actions.activated || []).length}, ` +
            `deactivated=${(step1Actions.deactivated || []).length}.`;

        const continueStep2 = window.confirm(
            `${step1Message}\n\n` +
            'Klik OK om nu stap 2 uit te voeren: andere ACTIVE IPs op INACTIVE zetten.'
        );

        if (!continueStep2) {
            if (deactivateEl) {
                deactivateEl.checked = false;
            }
            await loadAdminStatus();
            renderAdminStatusPanel(
                adminStatusData,
                `${step1Message} Stap 2 overgeslagen (veilig).`,
                false,
                resolvedIp
            );
            return;
        }

        const step2Response = await authenticatedFetch(`${CONFIG.apiEndpoint}/admin/bunq/whitelist-ip`, {
            method: 'POST',
            body: JSON.stringify({
                ip: resolvedIp || (useAutoTarget ? null : targetIp),
                deactivate_others: true,
                refresh_key: false,
                force_recreate: false,
                clear_runtime_cache: false
            })
        });

        if (!step2Response || !step2Response.success) {
            const errorText = step2Response?.error || 'Bunq whitelist update stap 2 mislukt.';
            renderAdminStatusPanel(adminStatusData, `${step1Message} ${errorText}`, true);
            return;
        }

        const step2Data = step2Response.data || {};
        const actions = step2Data.actions || {};
        const message = `Whitelist veilig bijgewerkt voor ${step2Data.target_ip || resolvedIp || targetLabel}. ` +
            `created=${(actions.created || []).length}, ` +
            `activated=${(actions.activated || []).length}, ` +
            `deactivated=${(actions.deactivated || []).length}.`;

        if (deactivateEl) {
            deactivateEl.checked = true;
        }
        await loadAdminStatus();
        renderAdminStatusPanel(adminStatusData, message, false, step2Data.target_ip || resolvedIp || '');
    });
}

async function reinitializeBunqContext() {
    if (!isAuthenticated) {
        renderAdminStatusPanel(adminStatusData, 'Login required om Bunq context te herinitialiseren.', true);
        return;
    }

    const confirmed = window.confirm(
        'Reinit context only (advanced):\n' +
        '- Recreates Bunq context (installation + device registration)\n' +
        '- Refreshes API key from Vaultwarden/direct secret\n' +
        '- Does NOT update Bunq whitelist IP\n\n' +
        'Continue?'
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
            renderAdminStatusPanel(
                adminStatusData,
                response?.error || 'Bunq context herinitialisatie mislukt.',
                true
            );
            return;
        }

        const egressIp = response?.data?.egress_ip || '';
        await loadAdminStatus();
        renderAdminStatusPanel(
            adminStatusData,
            'Bunq context reinitialized (no whitelist change). If API key or egress IP changed, run "Run full maintenance (recommended)".',
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
        'Run full maintenance now?\n' +
        '- This is the recommended runtime recovery flow.\n' +
        `- Recreate context: ${options.force_recreate ? 'yes' : 'no'}\n` +
        `- Refresh API key: ${options.refresh_key ? 'yes' : 'no'}\n` +
        `- Update whitelist target IP: ${targetLabel}\n` +
        `- Deactivate other whitelist IPs: ${options.deactivate_others ? 'yes' : 'no'}`
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
        const message = `Full maintenance completed${steps ? ` (${steps})` : ''}.`;
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
