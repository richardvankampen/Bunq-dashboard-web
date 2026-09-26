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
const RACING_ANIMATION_FPS = 2;
const DETAIL_TRANSACTIONS_PAGE_SIZE = 200;
const DETAIL_TRANSACTIONS_DEFAULT_SORT = 'date_desc';
const detailTransactionsState = {
    rows: [],
    filteredRows: [],
    renderedCount: 0,
    query: '',
    sortKey: DETAIL_TRANSACTIONS_DEFAULT_SORT
};
const detailModalState = {
    rowActionMap: null,
    transactionsCollapsed: false
};

function isOwnBunqAccount(account) {
    const className = String(account?.account_class || '').toLowerCase();
    if (!className) return true;
    // Keep Bunq external-savings as own Bunq accounts, but exclude linked external accounts (e.g. Triodos).
    if (className.includes('monetaryaccountexternal') && !className.includes('externalsavings')) {
        return false;
    }
    return true;
}

// The user's own linked external accounts (e.g. Triodos): not Bunq-internal, but transfers
// with them are neither income nor spending.
function getOwnExternalAccountSets() {
    const external = (accountsList || []).filter((account) => !isOwnBunqAccount(account));
    const ids = new Set(external.map((account) => String(account?.id || '').trim()).filter(Boolean));
    const ibans = new Set();
    external.forEach((account) => {
        (Array.isArray(account?.ibans) ? account.ibans : []).forEach((iban) => {
            const normalized = normalizeIbanForMatch(iban);
            if (normalized) ibans.add(normalized);
        });
    });
    return { ids, ibans };
}

function isOwnExternalTransfer(transaction, externalSets) {
    const { ids, ibans } = externalSets || getOwnExternalAccountSets();
    if (!ids.size && !ibans.size) return false;
    if (ids.has(String(transaction?.account_id ?? ''))) return false;   // mutations on that account itself
    const counterpartyId = transaction?.counterparty_account_id != null ? String(transaction.counterparty_account_id).trim() : '';
    if (counterpartyId && ids.has(counterpartyId)) return true;
    const iban = normalizeIbanForMatch(transaction?.counterparty_iban);
    return Boolean(iban) && ibans.has(iban);
}

function getOwnBunqAccountIdentitySets() {
    const ownAccounts = (accountsList || []).filter((account) => isOwnBunqAccount(account));
    const ownIds = new Set(
        ownAccounts
            .map((account) => String(account?.id || '').trim())
            .filter(Boolean)
    );
    const ownIbans = new Set();
    const ownNames = new Set();
    ownAccounts.forEach((account) => {
        const baseName = normalizePartyNameForMatch(account?.description || account?.display_name || '');
        if (baseName.length >= 4) {
            ownNames.add(baseName);
        }

        const ibans = Array.isArray(account?.ibans) ? account.ibans : [];
        ibans.forEach((iban) => {
            const normalized = normalizeIbanForMatch(iban);
            if (normalized) {
                ownIbans.add(normalized);
            }
        });
    });
    return { ownIds, ownIbans, ownNames };
}

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
        loginButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
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
    const startupWatchdog = setTimeout(() => {
        if (isLoading) {
            console.error('❌ Startup watchdog triggered: loading screen still active');
            hideLoading();
            showError('Dashboard startup duurde te lang. Ververs de pagina of controleer backend logs.');
        }
    }, 45000);

    try {
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
    } catch (error) {
        console.error('❌ Fatal startup error:', error);
        hideLoading();
        showError(`Dashboard startup error: ${error.message || error}`);
    } finally {
        clearTimeout(startupWatchdog);
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
    document.getElementById('balanceDetailTransactionsMore')?.addEventListener('click', () => {
        renderMoreDetailTransactions();
    });
    document.getElementById('balanceDetailTransactionsSearch')?.addEventListener('input', (event) => {
        detailTransactionsState.query = String(event?.target?.value || '').trim();
        updateDetailTransactionsView({ reset: true });
    });
    document.getElementById('balanceDetailTransactionsSort')?.addEventListener('change', (event) => {
        detailTransactionsState.sortKey = String(event?.target?.value || DETAIL_TRANSACTIONS_DEFAULT_SORT);
        updateDetailTransactionsView({ reset: true });
    });
    document.getElementById('balanceDetailTransactionsToggle')?.addEventListener('click', () => {
        setDetailTransactionsCollapsed(!detailModalState.transactionsCollapsed);
    });
    document.getElementById('balanceDetailList')?.addEventListener('click', (event) => {
        const rawTarget = event.target;
        const startEl = rawTarget && typeof rawTarget.closest === 'function'
            ? rawTarget
            : rawTarget?.parentElement;
        const target = startEl && typeof startEl.closest === 'function'
            ? startEl.closest('[data-row-action-key]')
            : null;
        if (!target || !detailModalState.rowActionMap) return;
        const actionKey = String(target.getAttribute('data-row-action-key') || '');
        const handler = detailModalState.rowActionMap[actionKey];
        if (typeof handler === 'function') {
            handler();
        }
    });
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

    syncInsightCardTooltips();
    setupInsightHoverTooltips();

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

function syncInsightCardTooltips() {
    document.querySelectorAll('.insight-card').forEach((card) => {
        const dataTooltip = String(card.getAttribute('data-tooltip') || '').trim();
        const cardTooltip = String(card.getAttribute('title') || '').trim();
        const heading = card.querySelector('h4');
        const headingTooltip = heading ? String(heading.getAttribute('title') || '').trim() : '';
        const tooltip = dataTooltip || cardTooltip || headingTooltip;
        if (!tooltip) {
            card.removeAttribute('data-tooltip');
            card.removeAttribute('title');
            if (heading) heading.removeAttribute('title');
            return;
        }
        card.setAttribute('data-tooltip', tooltip);
        if (!card.hasAttribute('aria-label')) {
            card.setAttribute('aria-label', tooltip);
        }
        // Remove native browser tooltips so only the custom tooltip is shown.
        card.removeAttribute('title');
        if (heading) heading.removeAttribute('title');
    });
}

const insightHoverTooltipState = {
    element: null,
    activeCard: null,
    listenersBound: false,
    lastPointer: null
};

function ensureInsightHoverTooltipElement() {
    if (insightHoverTooltipState.element) return insightHoverTooltipState.element;
    const tooltip = document.createElement('div');
    tooltip.id = 'insightHoverTooltip';
    tooltip.className = 'insight-hover-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('data-visible', 'false');
    tooltip.setAttribute('data-placement', 'top');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    insightHoverTooltipState.element = tooltip;
    return tooltip;
}

function positionInsightHoverTooltip(card, pointer = null) {
    const tooltip = ensureInsightHoverTooltipElement();
    const rect = card.getBoundingClientRect();
    const viewportPadding = 8;
    const tooltipMargin = 12;
    const cursorOffsetX = 14;
    const cursorOffsetY = 16;
    const maxWidth = Math.max(220, Math.min(360, window.innerWidth - 2 * viewportPadding));
    tooltip.style.maxWidth = `${maxWidth}px`;

    const tooltipWidth = tooltip.offsetWidth || Math.min(maxWidth, 320);
    const tooltipHeight = tooltip.offsetHeight || 48;

    const hasPointer = pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y);
    let left;
    let top;
    let placement;
    if (hasPointer) {
        left = pointer.x + cursorOffsetX;
        top = pointer.y + cursorOffsetY;
        placement = 'bottom';
        if (top + tooltipHeight > window.innerHeight - viewportPadding) {
            top = pointer.y - tooltipHeight - tooltipMargin;
            placement = 'top';
        }
    } else {
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        top = rect.top - tooltipHeight - tooltipMargin;
        placement = 'top';
        if (top < viewportPadding) {
            top = rect.bottom + tooltipMargin;
            placement = 'bottom';
        }
    }

    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tooltipWidth - viewportPadding));
    top = Math.max(viewportPadding, Math.min(top, window.innerHeight - tooltipHeight - viewportPadding));

    const anchorX = hasPointer ? pointer.x : (rect.left + rect.width / 2);
    const arrowOffset = Math.max(14, Math.min(tooltipWidth - 14, anchorX - left));
    tooltip.style.setProperty('--tooltip-arrow-x', `${Math.round(arrowOffset)}px`);
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.setAttribute('data-placement', placement);
}

function showInsightHoverTooltip(card, pointer = null) {
    const tooltipText = String(card.getAttribute('data-tooltip') || '').trim();
    if (!tooltipText) return;

    const tooltip = ensureInsightHoverTooltipElement();
    tooltip.textContent = tooltipText;
    tooltip.hidden = false;
    tooltip.setAttribute('data-visible', 'true');
    insightHoverTooltipState.activeCard = card;
    insightHoverTooltipState.lastPointer = pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)
        ? pointer
        : null;
    card.setAttribute('aria-describedby', 'insightHoverTooltip');
    positionInsightHoverTooltip(card, insightHoverTooltipState.lastPointer);
}

function hideInsightHoverTooltip(card = null) {
    const tooltip = insightHoverTooltipState.element;
    if (!tooltip) return;
    if (card && insightHoverTooltipState.activeCard && card !== insightHoverTooltipState.activeCard) return;

    if (insightHoverTooltipState.activeCard) {
        insightHoverTooltipState.activeCard.removeAttribute('aria-describedby');
    }
    insightHoverTooltipState.activeCard = null;
    insightHoverTooltipState.lastPointer = null;
    tooltip.setAttribute('data-visible', 'false');
    tooltip.hidden = true;
}

function setupInsightHoverTooltips() {
    const cards = Array.from(document.querySelectorAll('.insight-card'));
    if (!cards.length) return;

    document.body.classList.add('js-insight-tooltips');

    cards.forEach((card) => {
        if (card.dataset.tooltipBound === '1') return;
        card.dataset.tooltipBound = '1';

        card.addEventListener('mouseenter', (event) => {
            showInsightHoverTooltip(card, { x: event.clientX, y: event.clientY });
        });
        card.addEventListener('mousemove', (event) => {
            if (insightHoverTooltipState.activeCard === card) {
                insightHoverTooltipState.lastPointer = { x: event.clientX, y: event.clientY };
                positionInsightHoverTooltip(card, insightHoverTooltipState.lastPointer);
            }
        });
        card.addEventListener('mouseleave', () => hideInsightHoverTooltip(card));
        card.addEventListener('focusin', () => showInsightHoverTooltip(card, null));
        card.addEventListener('focusout', () => hideInsightHoverTooltip(card));
        card.addEventListener('blur', () => hideInsightHoverTooltip(card));
    });

    if (!insightHoverTooltipState.listenersBound) {
        window.addEventListener('scroll', () => {
            if (insightHoverTooltipState.activeCard) {
                positionInsightHoverTooltip(
                    insightHoverTooltipState.activeCard,
                    insightHoverTooltipState.lastPointer
                );
            }
        }, true);
        window.addEventListener('resize', () => {
            if (insightHoverTooltipState.activeCard) {
                positionInsightHoverTooltip(
                    insightHoverTooltipState.activeCard,
                    insightHoverTooltipState.lastPointer
                );
            }
        });
        insightHoverTooltipState.listenersBound = true;
    }
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
                    filename: `${plot.id}-${toDateKey(new Date())}`,
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
        // Safety cap to prevent unbounded API loops on unexpected backend responses.
        const hardPageCap = 200;
        let page = 1;
        let all = [];
        let total = null;
        let lastResponse = null;
        let loadError = '';
        let truncatedBySafetyCap = false;
        let backendTruncated = false;
        let backendMissingEurCount = 0;
        const truncatedAccounts = new Map();
        
        const accountParam = buildAccountFilterParam();
        const excludeParam = '&exclude_internal=false';
        
        while (page <= hardPageCap) {
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

            if (response.truncated) {
                backendTruncated = true;
                (response.truncated_accounts || []).forEach((item) => {
                    const key = String(item?.account_id ?? '');
                    if (!key || truncatedAccounts.has(key)) return;
                    truncatedAccounts.set(key, item);
                });
            }
            const missingEur = Number(response.amount_eur_missing_count || 0);
            if (Number.isFinite(missingEur) && missingEur > backendMissingEurCount) {
                backendMissingEurCount = missingEur;
            }
            
            if (total === null) total = response.count;
            all = all.concat(response.data || []);
            
            if (!response.data || response.data.length < pageSize || all.length >= response.count) {
                break;
            }
            
            page += 1;
        }

        if (!loadError && total !== null && all.length < total && page > hardPageCap) {
            truncatedBySafetyCap = true;
        }
        
        if (all.length) {
            if (truncatedBySafetyCap) {
                console.warn(`⚠️ Transaction dataset truncated at ${all.length}/${total} rows (hardPageCap=${hardPageCap})`);
                showError(`Result set capped at ${all.length} transactions. Narrow the period or account filter for complete data.`);
            }
            if (backendTruncated) {
                const names = Array.from(truncatedAccounts.values())
                    .map((item) => item?.account_name)
                    .filter(Boolean)
                    .slice(0, 3);
                const label = names.length ? ` (${names.join(', ')}${truncatedAccounts.size > 3 ? ', ...' : ''})` : '';
                showError(`Backend transaction window reached for one or more accounts${label}. Consider lower 'days' or higher BUNQ_PAYMENT_MAX_PAGES.`);
            }
            if (backendMissingEurCount > 0) {
                showError(`${backendMissingEurCount} transactie(s) in vreemde valuta hebben geen omrekening naar EUR en tellen niet mee in totalen en grafieken; inkomsten en uitgaven zijn daardoor mogelijk te laag.`);
            }
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
        try {
            dataQualitySummary = null;
            latestDataQualitySummary = null;
            transactionsData = generateDemoTransactions(CONFIG.timeRange);
            processAndRenderData(transactionsData);
        } catch (error) {
            console.error('❌ Error loading demo data:', error);
            showError(`Demo data error: ${error.message || error}`);
        } finally {
            hideLoading();
            updateLastUpdateTime();
        }
    }, 1500);
}

function getCategoryColor(category) {
    const colors = {
        'Boodschappen': '#3b82f6',
        'Horeca': '#8b5cf6',
        'Vervoer': '#ec4899',
        'Wonen': '#ef4444',
        'Energie & telecom': '#f59e0b',
        'Abonnementen': '#eab308',
        'Verzekering': '#a855f7',
        'Belastingen': '#f97316',
        'Kinderopvang': '#fb7185',
        'Winkelen': '#10b981',
        'Vrije tijd': '#06b6d4',
        'Sport': '#84cc16',
        'Reizen': '#2dd4bf',
        'Zorg': '#6366f1',
        'Salaris': '#22c55e',
        'Uitkeringen & toeslagen': '#4ade80',
        'Terugbetaling': '#14b8a6',
        'Rente': '#0ea5e9',
        'Interne overboeking': '#94a3b8',
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

// Whole words for short hints ('Shared household' and 'Stockholm' are no investments),
// stems for words that appear inside compounds. Same rule as the backend.
function looksLikeInvestmentAccount(text) {
    return /(^|[^a-z0-9])(stocks?|shares?|etfs?|equity)(?![a-z0-9])/.test(text)
        || ['investment', 'belegging', 'crypto', 'aandelen'].some((stem) => text.includes(stem));
}

function classifyAccountType(account) {
    // The backend classification is authoritative; the rest is a fallback for accounts without it.
    const declaredType = String(account?.account_type || '').toLowerCase();
    if (declaredType === 'savings' || declaredType === 'investment' || declaredType === 'checking') {
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
    if (looksLikeInvestmentAccount(explicitTypeText)) return 'investment';
    if (
        explicitTypeText.includes('checking')
        || explicitTypeText.includes('payment')
        || explicitTypeText.includes('bank')
        || explicitTypeText.includes('card')
        || explicitTypeText.includes('current')
    ) return 'checking';

    const fingerprint = `${description} ${className} ${explicitTypeText}`;
    if (
        fingerprint.includes('savings')
        || fingerprint.includes('savingsaccount')
        || fingerprint.includes('spaar')
        || fingerprint.includes('spaarrekening')
        || fingerprint.includes('spaargeld')
        || fingerprint.includes('sparen')
    ) return 'savings';
    if (looksLikeInvestmentAccount(fingerprint)) return 'investment';

    // Guardrail: plain MonetaryAccountBank is checking unless strong savings/
    // investment hints were detected first.
    if (className.includes('monetaryaccountbank')) {
        return 'checking';
    }

    return 'checking';
}

// Day key in the browser's local time (Dutch time for this dashboard), not UTC:
// a payment at 00:30 belongs to that day, not the previous one.
function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
    return new Date(`${key}T00:00:00`);
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
        .filter((acc) => acc && acc.balance && typeof acc.balance.value !== 'undefined' && isOwnBunqAccount(acc))
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
        'Energie & telecom': { avg: -120, std: 30, freq: 0.033, color: '#f59e0b' },
        'Winkelen': { avg: -65, std: 40, freq: 0.2, color: '#10b981' },
        'Vrije tijd': { avg: -25, std: 15, freq: 0.17, color: '#06b6d4' },
        'Zorg': { avg: -80, std: 30, freq: 0.067, color: '#6366f1' },
        'Salaris': { avg: 2800, std: 100, freq: 0.033, color: '#22c55e' }
    };
    
    const merchants = {
        'Boodschappen': ['Albert Heijn', 'Jumbo', 'Lidl', 'Aldi', 'Plus'],
        'Horeca': ['Starbucks', 'De Kroeg', 'Restaurant Plaza', 'Burger King', 'Dominos'],
        'Vervoer': ['NS', 'Shell', 'Parking Amsterdam', 'Uber', 'Swapfiets'],
        'Wonen': ['Verhuurder B.V.', 'Hypotheek Bank'],
        'Energie & telecom': ['Eneco', 'Ziggo', 'Waternet'],
        'Winkelen': ['Bol.com', 'Zara', 'H&M', 'MediaMarkt', 'Coolblue'],
        'Vrije tijd': ['Pathé', 'Concert Tickets', 'Efteling'],
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
    const savingsTransactions = buildSavingsWidgetTransactions(data);
    const savingsWidgetNet = savingsTransactions.reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0);
    // Balance history needs every mutation, internal transfers and all accounts included.
    balanceMetrics = calculateBalanceMetrics(normalizeTransactions(data), accountsList, balanceHistoryData);
    latestDataQualitySummary = computeDataQualitySummary(normalized, accountsList, dataQualitySummary, data);
    const kpis = calculateKPIs(normalized);
    kpis.savingsWidgetNet = savingsWidgetNet;
    kpis.savingsTransactions = savingsTransactions;
    // Spaarquote only with real income in the selection: interest alone (e.g. only savings
    // accounts selected) would give absurd percentages.
    const incomeExcludingInterest = normalized
        .filter((transaction) => transaction.amount > 0 && !isRefundTransaction(transaction) && transaction.category !== 'Rente')
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    kpis.savingsRate = incomeExcludingInterest >= 1 ? (savingsWidgetNet / kpis.income) * 100 : null;
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

function applyClientFilters(data, options = {}) {
    let filtered = [...data];
    const excludeInternalTransfers = options.excludeInternalTransfers ?? CONFIG.excludeInternalTransfers;
    if (excludeInternalTransfers) {
        // One rule for every tile and chart (see isInternalOwnTransfer).
        const ownIdentity = getOwnBunqAccountIdentitySets();
        const externalSets = getOwnExternalAccountSets();
        // Transfers with own linked external accounts (Triodos) go too: not income, not spending.
        filtered = filtered.filter((transaction) => (
            !isInternalOwnTransfer(transaction, ownIdentity) && !isOwnExternalTransfer(transaction, externalSets)
        ));
    }
    const allowed = getAccountSelection();
    if (allowed) {
        filtered = filtered.filter(t => allowed.has(String(t.account_id)));
    }
    return filtered;
}

// Selected account ids, or null when all accounts are selected.
function getAccountSelection() {
    if (accountsList.length && selectedAccountIds.size > 0 && selectedAccountIds.size < accountsList.length) {
        return new Set(Array.from(selectedAccountIds).map(String));
    }
    return null;
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

// The backend stores a few category keys in English; show Dutch names in the UI.
const CATEGORY_DISPLAY_NAMES = {
    'Internal Transfer': 'Interne overboeking',
    'Refund': 'Terugbetaling',
    'Utilities': 'Energie & telecom',
    'Shopping': 'Winkelen',
    'Entertainment': 'Vrije tijd',
    'Uitkeringen': 'Uitkeringen & toeslagen'
};

function resolveCategoryLabel(transaction) {
    const raw = transaction?.category;
    if (typeof raw === 'string' && raw.trim()) {
        const key = raw.trim();
        return CATEGORY_DISPLAY_NAMES[key] || key;
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
        category: resolveCategoryLabel(t),
        refund_category: t.refund_category ? (CATEGORY_DISPLAY_NAMES[t.refund_category] || t.refund_category) : null
    }));
}

// Money back for a purchase (card reversal, Tikkie for a shared dinner): not income,
// it lowers spending. Same rule as 50/30/20.
function isRefundTransaction(transaction) {
    return (Number(transaction?.amount) || 0) > 0 && transaction?.category === 'Terugbetaling';
}

function calculateKPIs(data) {
    let income = 0;
    let outflows = 0;
    let refunds = 0;
    data.forEach((t) => {
        const amount = Number(t.amount) || 0;
        if (isRefundTransaction(t)) refunds += amount;
        else if (amount > 0) income += amount;
        else outflows += Math.abs(amount);
    });
    const expenses = outflows - refunds;
    const netSavings = income - expenses;
    const savingsRate = income > 0 ? (netSavings / income * 100) : 0;

    return { income, expenses, refunds, netSavings, savingsRate };
}

// Transactions behind the `Sparen` tile and `Spaarrekening mutaties`: savings-account
// mutations (deposits minus withdrawals, incl. transfers from own accounts), excluding
// savings-to-savings moves. Respects the account selection: for a savings account that is
// not selected, transfers between it and the selected accounts count instead (sign flipped:
// -€500 from checking = +€500 saved).
function buildSavingsWidgetTransactions(rawTransactions) {
    const savingsSets = getSavingsAccountSets();
    if (!savingsSets.savingsIds.size) return [];
    const selection = getAccountSelection();
    const scoped = normalizeTransactions(applyClientFilters(Array.isArray(rawTransactions) ? rawTransactions : [], {
        excludeInternalTransfers: false
    }));
    // Moves with the own Triodos account are own money changing place, not saved from income.
    const externalSets = getOwnExternalAccountSets();
    const direct = scoped
        .filter((transaction) => savingsSets.savingsIds.has(String(transaction?.account_id)))
        .filter((transaction) => !isInternalSavingsToSavingsTransfer(transaction, savingsSets))
        .filter((transaction) => !isOwnExternalTransfer(transaction, externalSets));
    const viaTransfers = selection
        ? scoped
            .filter((transaction) => !savingsSets.savingsIds.has(String(transaction?.account_id)))
            .filter((transaction) => {
                const target = resolveSavingsCounterparty(transaction, savingsSets);
                return target !== null && !selection.has(target);
            })
            .map((transaction) => ({ ...transaction, amount: -transaction.amount, savings_via_transfer: true }))
        : [];
    return [...direct, ...viaTransfers];
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

function computeDataQualitySummary(transactions, accounts, serverSummary = null, rawTransactions = null) {
    const tx = Array.isArray(transactions) ? transactions : [];
    const expenseTransactions = tx.filter((transaction) => (transaction.amount || 0) < 0);
    const totalTransactions = tx.length;
    // Internal-transfer share is measured on the unfiltered data: when the setting removes
    // internal transfers, the filtered list would always show 0%.
    const allTransactions = Array.isArray(rawTransactions) ? rawTransactions : tx;
    const ownIdentity = getOwnBunqAccountIdentitySets();
    const internalTransactions = allTransactions.filter((transaction) => isInternalOwnTransfer(transaction, ownIdentity)).length;

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
    const internalShare = safeRatio(internalTransactions, allTransactions.length, 0);
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
    // ~1.3 transactions per day of the selected period (120 for 90 days), capped for long periods.
    const expectedMinTransactions = Math.min(400, Math.max(20, Math.round((Number(CONFIG.timeRange) || 90) * 1.33)));
    if (totalTransactions < expectedMinTransactions) warnings.push('Relatief weinig transacties in deze periode.');
    if ((serverSummary?.metrics?.active_transaction_days ?? 0) > 0) {
        const activeDays = Number(serverSummary.metrics.active_transaction_days) || 0;
        const expectedDays = Math.max(10, Math.floor((Number(serverSummary.days) || 90) * 0.35));
        if (activeDays < expectedDays) warnings.push(`Beperkte dagdekking: ${activeDays} actieve dagen.`);
    }
    if ((mergedCoverage.category_coverage ?? 1) < 0.78) warnings.push('Categorie-dekking op uitgaven is laag.');
    if ((mergedCoverage.category_amount_coverage ?? 1) < 0.84) warnings.push('Hoge uitgaven staan nog in categorie Overig/onbekend.');
    if ((mergedCoverage.merchant_coverage ?? 1) < 0.85) warnings.push('Tegenrekening-dekking op uitgaven is laag.');
    if ((mergedCoverage.merchant_amount_coverage ?? 1) < 0.88) warnings.push('Tegenrekening ontbreekt bij hoge uitgaven.');
    if ((mergedCoverage.amount_eur_coverage ?? 1) < 0.95) warnings.push('Niet alle transacties hebben EUR-waarde in lokale store.');
    if ((mergedCoverage.fx_coverage ?? 1) < 0.95) warnings.push('Niet alle non-EUR rekeningen zijn omgerekend.');
    if ((mergedCoverage.internal_share ?? 0) > 0.5) warnings.push('Meer dan 50% van de transacties lijkt een interne overboeking.');
    if (serverSummary?.metrics?.capture_freshness_hours > 24) warnings.push('Lokale cache is ouder dan 24 uur.');

    const mergedWarnings = Array.from(new Set([
        ...(Array.isArray(serverSummary?.warnings) ? serverSummary.warnings : []),
        ...warnings
    ]));
    const mergedRecommendations = Array.from(new Set([
        ...(Array.isArray(serverSummary?.recommendations) ? serverSummary.recommendations : []),
        ...((mergedCoverage.category_amount_coverage ?? 1) < 0.84
            ? ['Prioriteer categorisatie op tegenrekeningen met de hoogste uitgaven.']
            : []),
        ...((mergedCoverage.merchant_amount_coverage ?? 1) < 0.88
            ? ['Voeg extra tegenrekening-herkenning toe op omschrijving/tegenpartij.']
            : [])
    ]));

    let qualityLabel = 'Aandacht nodig';
    if (score >= 85) qualityLabel = 'Goed';
    else if (score >= 70) qualityLabel = 'Redelijk';

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

// Dutch number format (16,7%); n.v.t. when there is no value.
function formatPercent(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'n.v.t.';
    return `${Number(value).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatRatioPercent(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'n.v.t.';
    return formatPercent(Number(value) * 100);
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
    if (netSavings) netSavings.textContent = formatCurrency(
        Number.isFinite(Number(kpis.savingsWidgetNet)) ? Number(kpis.savingsWidgetNet) : kpis.netSavings
    );
    if (savingsRate) {
        savingsRate.textContent = formatPercent(kpis.savingsRate);
        savingsRate.title = kpis.savingsRate === null
            ? 'Niet te berekenen: geen inkomsten (behalve rente) in de selectie. Selecteer ook je betaalrekening.'
            : 'Sparen als % van de inkomsten in de gekozen periode.';
    }

    // Update savings ring
    const circle = document.getElementById('savingsCircle');
    if (circle) {
        const radius = 25;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference * (1 - Math.min(Math.max(kpis.savingsRate ?? 0, 0), 100) / 100);
        circle.style.strokeDasharray = `${circumference} ${circumference}`;
        circle.style.strokeDashoffset = `${offset}`;
    }
    
    // Sparklines over the whole period; trend per calculateTileTrend.
    const daily = buildDailyTotals(data);
    // `Sparen` shows savings-account mutations, so its trend/sparkline use that same data.
    const savingsDaily = alignDailySeries(buildDailyTotals(kpis.savingsTransactions || []), daily);
    const trends = calculateTileTrends(data, savingsDaily);
    setTrendIndicator(incomeTrend, trends.income, { higherIsBetter: true });
    setTrendIndicator(expensesTrend, trends.expenses, { higherIsBetter: false });
    setTrendIndicator(savingsTrend, trends.savings, { higherIsBetter: true });
    
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
        savingsDaily.map((point) => ({ date: point.date, total: point.net })),
        '#8b5cf6'
    );
}

// Change of the second half vs the first half, in % of the first half.
// null when the first half is ~0 (a percentage would be meaningless).
const TREND_MIN_PERIOD_DAYS = 60;
// Below this comparison base a percentage is meaningless (+5900% on €5): show the € difference.
const TREND_MIN_BASE_EUR = 50;
const TREND_MONTHS_BACK = 3;

function trendMonthLabel(key) {
    return dateFromKey(`${key}-01`).toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' });
}

// Last complete month vs the average of up to 3 complete months before it.
// `months`: [{ monthKey, value }] of complete months, oldest first.
function compareMonthlyValues(months) {
    if (!months || months.length < 2) return null;
    const latest = months[months.length - 1];
    const previous = months.slice(0, -1).slice(-TREND_MONTHS_BACK);
    const baseline = previous.reduce((sum, row) => sum + row.value, 0) / previous.length;
    const delta = latest.value - baseline;
    return {
        change: Math.abs(baseline) > 0.01 ? (delta / Math.abs(baseline)) * 100 : null,
        delta,
        baseline,
        title: `${trendMonthLabel(latest.monthKey)} t.o.v. gemiddelde van ${previous.map((row) => trendMonthLabel(row.monthKey)).join(', ')} (volledige maanden).`
    };
}

// Complete months (inside the period, before the running month) from daily points.
function completeMonthsFromDaily(daily, field) {
    const periodStart = getSelectedPeriodStart();
    const currentKey = monthKeyOf(new Date());
    const byMonth = new Map();
    (daily || []).forEach((point) => {
        const key = monthKeyOf(point.date);
        byMonth.set(key, (byMonth.get(key) || 0) + (Number(point[field]) || 0));
    });
    return Array.from(byMonth.keys())
        .sort()
        .filter((key) => key !== currentKey && dateFromKey(`${key}-01`) >= periodStart)
        .map((monthKey) => ({ monthKey, value: byMonth.get(monthKey) }));
}

/**
 * Tile trends.
 * - Periods of 60+ days: last complete month vs the average of up to 3 earlier complete months.
 *   Income and spending use the same monthly figures as the insights (compareLatestCompleteMonth:
 *   salary-month correction, own transfers left out); savings its own monthly deposits.
 * - Shorter periods: income and savings are monthly, so half-periods would compare one salary
 *   or deposit with none: n.v.t. Spending compares variable spending (no fixed costs) between
 *   the second and the first half of the period.
 */
function calculateTileTrends(data, savingsDaily) {
    const days = Number(CONFIG.timeRange) || 90;
    const unavailable = (title) => ({ change: null, delta: null, baseline: null, title });
    if (days < TREND_MIN_PERIOD_DAYS) {
        const variableDaily = buildDailyTotals((data || []).filter((transaction) => (
            !FIXED_COST_CATEGORIES.has(isRefundTransaction(transaction) ? transaction.refund_category : transaction.category)
        )));
        const series = variableDaily.map((point) => point.expenses);
        const mid = Math.floor(series.length / 2);
        const prior = series.slice(0, mid).reduce((sum, value) => sum + value, 0);
        const recent = series.slice(mid).reduce((sum, value) => sum + value, 0);
        return {
            income: unavailable('Periode te kort voor een trend in maandinkomen (kies 60 dagen of meer).'),
            expenses: {
                change: calculateHalfPeriodChange(series),
                delta: recent - prior,
                baseline: prior,
                title: 'Variabele uitgaven (zonder vaste lasten): tweede helft van de periode t.o.v. de eerste helft.'
            },
            savings: unavailable('Periode te kort voor een trend in maandelijks sparen (kies 60 dagen of meer).')
        };
    }
    const months = summarizeCompleteMonths(data, TREND_MONTHS_BACK + 1);
    const noData = 'Minder dan 2 volledige maanden in de periode.';
    return {
        income: compareMonthlyValues(months.map((row) => ({ monthKey: row.monthKey, value: row.income }))) || unavailable(noData),
        expenses: compareMonthlyValues(months.map((row) => ({ monthKey: row.monthKey, value: row.expenses }))) || unavailable(noData),
        savings: compareMonthlyValues(completeMonthsFromDaily(savingsDaily, 'net')) || unavailable(noData)
    };
}

function setTrendArrow(parent, direction) {
    const icon = parent?.querySelector('i');
    if (!icon) return;
    icon.className = `fas ${direction > 0 ? 'fa-arrow-up' : direction < 0 ? 'fa-arrow-down' : 'fa-arrow-right'}`;
}

function formatSignedPercent(value) {
    return `${value > 0 ? '+' : ''}${formatPercent(value)}`;
}

function formatSignedCurrency(value) {
    return `${value >= 0 ? '+' : '−'}${formatCurrency(Math.abs(value))}`;
}

function calculateHalfPeriodChange(series) {
    if (!Array.isArray(series) || series.length < 2) return null;
    const mid = Math.floor(series.length / 2);
    const prior = series.slice(0, mid).reduce((sum, v) => sum + v, 0);
    const recent = series.slice(mid).reduce((sum, v) => sum + v, 0);
    if (Math.abs(prior) < 0.01) return null;
    return ((recent - prior) / Math.abs(prior)) * 100;
}

// `trend`: { change, delta, baseline, title } from calculateTileTrends. The arrow follows the
// direction, the colour whether that direction is good. Small base: € difference.
function setTrendIndicator(element, trend, { higherIsBetter = true } = {}) {
    if (!element) return;
    const parent = element.parentElement;
    const { change = null, delta = null, baseline = null, title = '' } = trend || {};
    const useEuro = Number.isFinite(delta) && Number.isFinite(baseline) && Math.abs(baseline) < TREND_MIN_BASE_EUR;
    if (!useEuro && (change === null || !Number.isFinite(change))) {
        element.textContent = 'n.v.t.';
        element.title = title || 'Niet te berekenen.';
        parent?.classList.remove('positive', 'negative');
        setTrendArrow(parent, 0);
        return;
    }
    const direction = useEuro ? delta : change;
    element.textContent = useEuro ? formatSignedCurrency(delta) : formatSignedPercent(change);
    element.title = useEuro ? `${title} Verschil in euro: de vergelijkingsbasis is kleiner dan ${formatCurrency(TREND_MIN_BASE_EUR)}.` : title;
    const good = higherIsBetter ? direction >= 0 : direction <= 0;
    parent?.classList.toggle('positive', good);
    parent?.classList.toggle('negative', !good);
    setTrendArrow(parent, Math.abs(direction) < 0.05 ? 0 : direction);
}

// Map a (possibly shorter) daily series onto the date range of `reference`, filling gaps with 0.
function alignDailySeries(series, reference) {
    const byKey = new Map((series || []).map((point) => [toDateKey(point.date), point]));
    return (reference || []).map((point) => {
        const key = toDateKey(point.date);
        return byKey.get(key) || { date: point.date, income: 0, expenses: 0, net: 0 };
    });
}

// Change from the first to the last balance of the period; null when there is no start value.
function calculateSeriesChange(series) {
    if (!series || series.length < 2) return null;
    const first = Number(series[0]) || 0;
    const last = Number(series[series.length - 1]) || 0;
    if (Math.abs(first) < 0.01) return null;
    return ((last - first) / Math.abs(first)) * 100;
}

function setBalanceTrend(element, change, startDate = null) {
    if (!element) return;
    const parent = element.parentElement;
    if (change === null || !Number.isFinite(change)) {
        element.textContent = 'n.v.t.';
        element.title = 'Niet te berekenen: geen saldo aan het begin van de reeks.';
        parent?.classList.remove('positive', 'negative');
        parent?.classList.add('neutral');
        setTrendArrow(parent, 0);
        return;
    }
    element.textContent = formatSignedPercent(change);
    element.title = startDate instanceof Date && !Number.isNaN(startDate.getTime())
        ? `Saldo nu t.o.v. ${startDate.toLocaleDateString('nl-NL')} (begin van de beschikbare saldohistorie in de periode).`
        : 'Saldo nu t.o.v. het begin van de beschikbare saldohistorie.';
    parent?.classList.toggle('positive', change >= 0);
    parent?.classList.toggle('negative', change < 0);
    parent?.classList.remove('neutral');
    setTrendArrow(parent, Math.abs(change) < 0.05 ? 0 : change);
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
        if (checkingEl) checkingEl.textContent = 'n.v.t.';
        if (savingsEl) savingsEl.textContent = 'n.v.t.';
        setBalanceTrend(checkingTrendEl, null);
        setBalanceTrend(savingsTrendEl, null);
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

    setBalanceTrend(checkingTrendEl, checkingChange, checkingPoints[0]?.date);
    setBalanceTrend(savingsTrendEl, savingsChange, savingsPoints[0]?.date);

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
    const accounts = [...(balanceMetrics.grouped[type] || [])]
        .filter((account) => isOwnBunqAccount(account))
        .sort((a, b) => {
        const aName = (a.description || `Account ${a.id}`).toLocaleLowerCase('nl-NL');
        const bName = (b.description || `Account ${b.id}`).toLocaleLowerCase('nl-NL');
        return aName.localeCompare(bName, 'nl-NL');
    });
    const total = accounts.reduce((sum, acc) => sum + (Number(acc.balanceEurValue) || 0), 0);
    const nonEurNote = balanceMetrics.missingFxCount > 0
        ? ` (${balanceMetrics.missingFxCount} non-EUR rekening(en) zonder FX-rate)`
        : '';

    const accountIds = new Set(accounts.map((acc) => String(acc.id)));
    const allTx = getCurrentNormalizedTransactions({ excludeInternalTransfers: false });
    const subset = allTx.filter((tx) => accountIds.has(String(tx.account_id)));
    const transactionRows = buildTransactionTableRows(subset);

    const rows = [];

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
            textposition: 'outside',
            texttemplate: '%{text}',
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
        chart: chartConfig,
        transactionRows,
        transactionsTitle: `Transacties op ${label.toLowerCase()} (${transactionRows.length})`
    });
}

function resetDetailTransactionsState() {
    detailTransactionsState.rows = [];
    detailTransactionsState.filteredRows = [];
    detailTransactionsState.renderedCount = 0;
    detailTransactionsState.query = '';
    detailTransactionsState.sortKey = DETAIL_TRANSACTIONS_DEFAULT_SORT;
}

function getFilteredAndSortedDetailTransactionsRows() {
    const query = String(detailTransactionsState.query || '').trim().toLocaleLowerCase('nl-NL');
    const sortKey = String(detailTransactionsState.sortKey || DETAIL_TRANSACTIONS_DEFAULT_SORT);
    let rows = [...detailTransactionsState.rows];

    if (query) {
        rows = rows.filter((row) => {
            const haystack = [
                row.date,
                row.time,
                row.ownAccount,
                row.counterparty,
                row.counterpartyAccountRef,
                row.description,
                row.category,
                row.amount
            ]
                .map((value) => String(value || '').toLocaleLowerCase('nl-NL'))
                .join(' ');
            return haystack.includes(query);
        });
    }

    rows.sort((a, b) => {
        const aTimestamp = Number(a._timestamp) || 0;
        const bTimestamp = Number(b._timestamp) || 0;
        const aAmount = Number(a._amountValue) || 0;
        const bAmount = Number(b._amountValue) || 0;
        const aAmountAbs = Math.abs(aAmount);
        const bAmountAbs = Math.abs(bAmount);
        const aCounterparty = String(a.counterparty || '');
        const bCounterparty = String(b.counterparty || '');

        switch (sortKey) {
            case 'date_asc':
                return aTimestamp - bTimestamp;
            case 'amount_desc':
                return bAmountAbs - aAmountAbs;
            case 'amount_asc':
                return aAmountAbs - bAmountAbs;
            case 'name_asc':
                return aCounterparty.localeCompare(bCounterparty, 'nl-NL');
            case 'name_desc':
                return bCounterparty.localeCompare(aCounterparty, 'nl-NL');
            case 'date_desc':
            default:
                return bTimestamp - aTimestamp;
        }
    });

    return rows;
}

function updateDetailTransactionsView(options = {}) {
    const { reset = true } = options;
    detailTransactionsState.filteredRows = getFilteredAndSortedDetailTransactionsRows();
    renderMoreDetailTransactions({ reset });
}

function renderMoreDetailTransactions(options = {}) {
    const { reset = false } = options;
    const bodyEl = document.getElementById('balanceDetailTransactionsBody');
    const metaEl = document.getElementById('balanceDetailTransactionsMeta');
    const moreBtnEl = document.getElementById('balanceDetailTransactionsMore');
    if (!bodyEl) return;

    if (reset) {
        bodyEl.innerHTML = '';
        detailTransactionsState.renderedCount = 0;
    }

    const totalAll = detailTransactionsState.rows.length;
    const totalFiltered = detailTransactionsState.filteredRows.length;
    if (totalFiltered <= 0) {
        bodyEl.innerHTML = `<tr><td class="balance-detail-transactions-empty" colspan="6">${
            detailTransactionsState.query ? 'Geen transacties gevonden voor deze zoekopdracht.' : 'Geen individuele transacties beschikbaar.'
        }</td></tr>`;
        if (metaEl) metaEl.textContent = '';
        if (moreBtnEl) {
            moreBtnEl.style.display = 'none';
            moreBtnEl.disabled = true;
        }
        return;
    }

    const start = detailTransactionsState.renderedCount;
    const nextRows = detailTransactionsState.filteredRows.slice(start, start + DETAIL_TRANSACTIONS_PAGE_SIZE);
    if (nextRows.length > 0) {
        const rowsHtml = nextRows.map((row) => `
            <tr>
                <td>${escapeHtml(row.date)}</td>
                <td>${escapeHtml(row.time)}</td>
                <td class="own-account">${escapeHtml(row.ownAccount)}</td>
                <td class="counterparty">
                    <div class="counterparty-main">${escapeHtml(row.counterparty)}</div>
                    ${row.counterpartyAccountRef ? `<div class="counterparty-ref">${escapeHtml(row.counterpartyAccountRef)}</div>` : ''}
                </td>
                <td class="description">${escapeHtml(row.description)}</td>
                <td class="amount ${escapeHtml(row.amountClass)}">${escapeHtml(row.amount)}</td>
            </tr>
        `).join('');
        if (reset) bodyEl.innerHTML = rowsHtml;
        else bodyEl.insertAdjacentHTML('beforeend', rowsHtml);
        detailTransactionsState.renderedCount += nextRows.length;
    }

    if (metaEl) {
        metaEl.textContent = totalFiltered === totalAll
            ? `${detailTransactionsState.renderedCount} van ${totalFiltered} transacties`
            : `${detailTransactionsState.renderedCount} van ${totalFiltered} transacties (gefilterd uit ${totalAll})`;
    }
    if (moreBtnEl) {
        const hasMore = detailTransactionsState.renderedCount < totalFiltered;
        moreBtnEl.style.display = hasMore ? 'inline-flex' : 'none';
        moreBtnEl.disabled = !hasMore;
    }
}

function closeBalanceDetail() {
    const modal = document.getElementById('balanceDetailModal');
    const bodyEl = document.getElementById('balanceDetailTransactionsBody');
    const metaEl = document.getElementById('balanceDetailTransactionsMeta');
    const moreBtnEl = document.getElementById('balanceDetailTransactionsMore');
    const searchEl = document.getElementById('balanceDetailTransactionsSearch');
    const sortEl = document.getElementById('balanceDetailTransactionsSort');

    detailModalState.rowActionMap = null;
    detailModalState.transactionsCollapsed = false;
    resetDetailTransactionsState();
    if (bodyEl) bodyEl.innerHTML = '';
    if (metaEl) metaEl.textContent = '';
    if (moreBtnEl) {
        moreBtnEl.style.display = 'none';
        moreBtnEl.disabled = true;
    }
    if (searchEl) {
        searchEl.value = '';
        searchEl.disabled = true;
    }
    if (sortEl) {
        sortEl.value = DETAIL_TRANSACTIONS_DEFAULT_SORT;
        sortEl.disabled = true;
    }
    if (modal) modal.classList.remove('active');
}

function setDetailTransactionsCollapsed(collapsed) {
    const controlsEl = document.querySelector('#balanceDetailTransactionsSection .balance-detail-transactions-controls');
    const tableWrapEl = document.querySelector('#balanceDetailTransactionsSection .balance-detail-transactions-table-wrap');
    const footerEl = document.querySelector('#balanceDetailTransactionsSection .balance-detail-transactions-footer');
    const toggleBtnEl = document.getElementById('balanceDetailTransactionsToggle');

    detailModalState.transactionsCollapsed = Boolean(collapsed);
    const display = detailModalState.transactionsCollapsed ? 'none' : '';
    if (controlsEl) controlsEl.style.display = display;
    if (tableWrapEl) tableWrapEl.style.display = display;
    if (footerEl) footerEl.style.display = display;
    if (toggleBtnEl) {
        toggleBtnEl.textContent = detailModalState.transactionsCollapsed
            ? 'Toon transacties'
            : 'Verberg transacties';
    }
}

function openDetailModal({
    title,
    summary,
    rows,
    chart,
    transactionRows = null,
    transactionsTitle = '',
    rowActionMap = null,
    transactionsCollapsedByDefault = false,
    listClassName = ''
}) {
    const titleEl = document.getElementById('balanceDetailTitle');
    const summaryEl = document.getElementById('balanceDetailSummary');
    const listEl = document.getElementById('balanceDetailList');
    const chartEl = document.getElementById('balanceDetailChart');
    const transactionsSectionEl = document.getElementById('balanceDetailTransactionsSection');
    const transactionsTitleEl = document.getElementById('balanceDetailTransactionsTitle');
    const transactionsMetaEl = document.getElementById('balanceDetailTransactionsMeta');
    const transactionsMoreEl = document.getElementById('balanceDetailTransactionsMore');
    const transactionsSearchEl = document.getElementById('balanceDetailTransactionsSearch');
    const transactionsSortEl = document.getElementById('balanceDetailTransactionsSort');
    const transactionsToggleEl = document.getElementById('balanceDetailTransactionsToggle');
    const modalEl = document.getElementById('balanceDetailModal');
    if (!titleEl || !summaryEl || !listEl || !chartEl || !modalEl) return;

    const previousListClasses = String(listEl.dataset.extraClasses || '')
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
    previousListClasses.forEach((className) => listEl.classList.remove(className));
    const nextListClasses = String(listClassName || '')
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((className) => className !== 'balance-detail-list');
    nextListClasses.forEach((className) => listEl.classList.add(className));
    listEl.dataset.extraClasses = nextListClasses.join(' ');

    titleEl.innerHTML = title || '<i class="fas fa-chart-bar"></i> Detail';
    summaryEl.textContent = summary || '';
    const detailRows = Array.isArray(rows) ? rows : [];
    detailModalState.rowActionMap = rowActionMap && typeof rowActionMap === 'object' ? rowActionMap : null;
    if (detailRows.length > 0) {
        listEl.innerHTML = detailRows.map((row) => {
            const actionKey = String(row?.actionKey || '');
            const isAction = Boolean(detailModalState.rowActionMap && actionKey && detailModalState.rowActionMap[actionKey]);
            if (isAction) {
                return `
                    <button type="button" class="balance-detail-row balance-detail-row-action" data-row-action-key="${escapeHtml(actionKey)}">
                        <span class="balance-detail-row-name">${escapeHtml(row.label)}</span>
                        <span class="balance-detail-row-value">${escapeHtml(row.value)}</span>
                    </button>
                `;
            }
            return `
                <div class="balance-detail-row">
                    <span class="balance-detail-row-name">${escapeHtml(row.label)}</span>
                    <span class="balance-detail-row-value">${escapeHtml(row.value)}</span>
                </div>
            `;
        }).join('');
        listEl.style.display = 'grid';
    } else {
        listEl.innerHTML = '';
        listEl.style.display = 'none';
    }

    if (chart && window.Plotly) {
        const traces = Array.isArray(chart.trace) ? chart.trace : [chart.trace];
        Plotly.react(chartEl, traces, chart.layout, { displayModeBar: false, responsive: true });
        chartEl.style.display = 'block';
    } else if (window.Plotly) {
        Plotly.purge(chartEl);
        chartEl.style.display = 'none';
    }

    if (transactionsSectionEl && transactionsTitleEl && Array.isArray(transactionRows) && transactionRows.length > 0) {
        transactionsTitleEl.textContent = transactionsTitle || `Individuele transacties (${transactionRows.length})`;
        detailTransactionsState.rows = transactionRows;
        detailTransactionsState.query = '';
        detailTransactionsState.sortKey = DETAIL_TRANSACTIONS_DEFAULT_SORT;
        detailTransactionsState.renderedCount = 0;
        if (transactionsSearchEl) {
            transactionsSearchEl.disabled = false;
            transactionsSearchEl.value = '';
        }
        if (transactionsSortEl) {
            transactionsSortEl.disabled = false;
            transactionsSortEl.value = DETAIL_TRANSACTIONS_DEFAULT_SORT;
        }
        if (transactionsToggleEl) {
            transactionsToggleEl.style.display = 'inline-flex';
        }
        updateDetailTransactionsView({ reset: true });
        setDetailTransactionsCollapsed(Boolean(transactionsCollapsedByDefault));
        transactionsSectionEl.style.display = 'block';
    } else if (transactionsSectionEl) {
        resetDetailTransactionsState();
        detailModalState.rowActionMap = null;
        detailModalState.transactionsCollapsed = false;
        if (transactionsTitleEl) transactionsTitleEl.textContent = 'Individuele transacties';
        if (transactionsMetaEl) transactionsMetaEl.textContent = '';
        if (transactionsMoreEl) {
            transactionsMoreEl.style.display = 'none';
            transactionsMoreEl.disabled = true;
        }
        if (transactionsSearchEl) {
            transactionsSearchEl.disabled = true;
            transactionsSearchEl.value = '';
        }
        if (transactionsSortEl) {
            transactionsSortEl.disabled = true;
            transactionsSortEl.value = DETAIL_TRANSACTIONS_DEFAULT_SORT;
        }
        if (transactionsToggleEl) {
            transactionsToggleEl.style.display = 'none';
            transactionsToggleEl.textContent = 'Toon transacties';
        }
        transactionsSectionEl.style.display = 'none';
    }

    modalEl.classList.add('active');
}

function getCurrentNormalizedTransactions(options = {}) {
    if (!Array.isArray(transactionsData)) return [];
    const filtered = applyClientFilters(transactionsData, options);
    return normalizeTransactions(filtered);
}

function buildTransactionTableRows(transactions, options = {}) {
    const { limit = 0 } = options;
    let ordered = [...transactions].sort((a, b) => b.date - a.date);
    if (Number.isFinite(limit) && limit > 0) {
        ordered = ordered.slice(0, limit);
    }
    const accountById = new Map((accountsList || []).map((account) => [String(account.id), account]));

    return ordered.map((transaction) => {
        const txDate = transaction?.date instanceof Date ? transaction.date : new Date(transaction?.date);
        const hasValidDate = txDate instanceof Date && !Number.isNaN(txDate.getTime());
        const counterparty = resolveMerchantLabel(transaction);
        const account = accountById.get(String(transaction?.account_id));
        const ownAccount = (
            String(transaction?.account_name || '').trim()
            || String(account?.description || account?.display_name || '').trim()
            || (transaction?.account_id != null ? `Rekening ${transaction.account_id}` : '-')
        );
        const description = (
            typeof transaction?.description === 'string' && transaction.description.trim()
                ? transaction.description.trim()
                : '-'
        );
        const counterpartyAccountRef = (
            typeof transaction?.counterparty_iban === 'string' && transaction.counterparty_iban.trim()
                ? transaction.counterparty_iban.trim()
                : (
                    transaction?.counterparty_account_id != null
                        ? `ID ${String(transaction.counterparty_account_id).trim()}`
                        : ''
                )
        );
        const category = resolveCategoryLabel(transaction);
        const amountValue = Number(transaction.amount) || 0;
        return {
            date: hasValidDate ? txDate.toLocaleDateString('nl-NL') : '-',
            time: hasValidDate
                ? txDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
                : '-',
            ownAccount,
            counterparty,
            counterpartyAccountRef,
            description,
            category,
            amount: formatCurrency(amountValue),
            amountClass: amountValue >= 0 ? 'positive' : 'negative',
            _timestamp: hasValidDate ? txDate.getTime() : 0,
            _amountValue: amountValue
        };
    });
}

function buildDailySeries(transactions, pickValue) {
    const perDay = new Map();
    transactions.forEach((transaction) => {
        const key = toDateKey(transaction.date);
        perDay.set(key, (perDay.get(key) || 0) + pickValue(transaction));
    });
    return Array.from(perDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({ date: dateFromKey(date), value }));
}

function normalizePartyNameForMatch(value) {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('nl-NL')
        .replace(/\s+/g, ' ');
}

function normalizeIbanForMatch(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
}

function isOwnAccountNameMatch(value, ownNames) {
    const normalized = normalizePartyNameForMatch(value);
    if (!normalized || ownNames.size <= 0) return false;
    return ownNames.has(normalized);
}

// Transfer between own Bunq accounts: backend flag, own account id/IBAN as counterparty,
// or a counterparty named like one of the own accounts. Applied to all tiles and charts
// when "exclude internal transfers" is on (applyClientFilters), and to none when it is off.
function isInternalOwnTransfer(transaction, ownIdentity) {
    const { ownIds, ownIbans, ownNames } = ownIdentity || {};
    if (transaction?.is_internal_transfer) return true;

    if (ownIds && ownIds.size > 0) {
        const sourceAccountId = transaction?.account_id != null
            ? String(transaction.account_id).trim()
            : '';
        const counterpartyAccountId = transaction?.counterparty_account_id != null
            ? String(transaction.counterparty_account_id).trim()
            : '';
        if (
            counterpartyAccountId
            && ownIds.has(counterpartyAccountId)
            && (!sourceAccountId || counterpartyAccountId !== sourceAccountId)
        ) {
            return true;
        }
    }

    if (ownIbans && ownIbans.size > 0) {
        const counterpartyIban = normalizeIbanForMatch(transaction?.counterparty_iban);
        if (counterpartyIban && ownIbans.has(counterpartyIban)) {
            return true;
        }
    }

    if (ownNames && ownNames.size > 0) {
        if (isOwnAccountNameMatch(transaction?.counterparty_account_name, ownNames)) return true;
        if (isOwnAccountNameMatch(transaction?.counterparty, ownNames)) return true;
        if (isOwnAccountNameMatch(transaction?.merchant, ownNames)) return true;
        if (isOwnAccountNameMatch(transaction?.category, ownNames)) return true;
    }

    return false;
}

function getSavingsAccountSets() {
    const savingsAccounts = (accountsList || []).filter((account) => classifyAccountType(account) === 'savings');
    const savingsIds = new Set(savingsAccounts.map((account) => String(account.id)));
    const idByIban = new Map();
    const idByName = new Map();
    savingsAccounts.forEach((account) => {
        const id = String(account.id);
        (Array.isArray(account?.ibans) ? account.ibans : []).forEach((iban) => {
            const normalized = normalizeIbanForMatch(iban);
            if (normalized) idByIban.set(normalized, id);
        });
        const name = normalizePartyNameForMatch(account?.description || account?.display_name || '');
        if (name.length >= 4) idByName.set(name, id);
    });
    return { savingsIds, idByIban, idByName };
}

// The savings account on the other side of a transfer (id, IBAN or account name), or null.
function resolveSavingsCounterparty(transaction, savingsSets) {
    const { savingsIds, idByIban, idByName } = savingsSets;
    const counterpartyId = transaction?.counterparty_account_id != null ? String(transaction.counterparty_account_id).trim() : '';
    if (counterpartyId && savingsIds.has(counterpartyId)) return counterpartyId;
    const iban = normalizeIbanForMatch(transaction?.counterparty_iban);
    if (iban && idByIban.has(iban)) return idByIban.get(iban);
    for (const value of [transaction?.counterparty_account_name, transaction?.counterparty, transaction?.merchant]) {
        const name = normalizePartyNameForMatch(value);
        if (name && idByName.has(name)) return idByName.get(name);
    }
    return null;
}

// Move between two savings accounts: no money saved or spent. Recognised like other own
// transfers (id, IBAN, name), not only by the backend's internal flag.
function isInternalSavingsToSavingsTransfer(transaction, savingsSets) {
    if (!savingsSets.savingsIds.has(String(transaction?.account_id || ''))) return false;
    const target = resolveSavingsCounterparty(transaction, savingsSets);
    return target !== null && target !== String(transaction.account_id);
}

function showTransactionDetail(detailType) {
    let transactions = getCurrentNormalizedTransactions();
    if (detailType === 'savings-transfers') {
        // Same transactions as the `Sparen` tile.
        transactions = buildSavingsWidgetTransactions(transactionsData || []);
    }

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
        // Refunds are not income: they show (negative) under spending.
        const subset = transactions.filter((transaction) => (isIncome
            ? transaction.amount > 0 && !isRefundTransaction(transaction)
            : transaction.amount < 0 || isRefundTransaction(transaction)));
        const total = subset.reduce((sum, transaction) => sum + (isIncome ? transaction.amount : -transaction.amount), 0);
        const daily = buildDailySeries(subset, (transaction) => isIncome ? transaction.amount : -transaction.amount);
        const transactionRows = buildTransactionTableRows(subset);
        // Income: regular (salary, benefits, interest, recurring payers) vs one-off.
        let incomeRows = [];
        if (isIncome) {
            const recurringSources = detectRecurringIncomeSources(transactionsData ? normalizeTransactions(transactionsData) : subset);
            const regular = subset.filter((transaction) => isRegularIncome(transaction, recurringSources));
            const oneOff = subset.filter((transaction) => !isRegularIncome(transaction, recurringSources));
            const sum = (list) => list.reduce((acc, transaction) => acc + transaction.amount, 0);
            incomeRows = [
                { label: 'Vast / terugkerend (salaris, uitkeringen, rente, vaste betalers)', value: formatCurrency(sum(regular)) },
                { label: 'Incidenteel', value: formatCurrency(sum(oneOff)) },
                ...oneOff
                    .slice()
                    .sort((x, y) => y.amount - x.amount)
                    .slice(0, 5)
                    .map((transaction) => ({
                        label: `Incidenteel · ${transaction.date.toLocaleDateString('nl-NL')} · ${resolveMerchantLabel(transaction)} (${transaction.category})`,
                        value: formatCurrency(transaction.amount)
                    }))
            ];
        }
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
            summary: `${subset.length} transacties · totaal ${formatCurrency(total)}`
                + (isIncome ? ' · terugbetalingen en overboekingen tussen eigen rekeningen (ook Triodos) tellen niet als inkomen' : ''),
            rows: incomeRows,
            chart: { trace, layout },
            transactionRows,
            transactionsTitle: `Individuele ${isIncome ? 'inkomsten' : 'uitgaven'} (${transactionRows.length})`
        });
        return;
    }

    if (detailType === 'savings-transfers') {
        const subset = transactions;
        const deposits = subset.filter((transaction) => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
        const withdrawals = Math.abs(subset.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + transaction.amount, 0));
        const daily = buildDailySeries(subset, (transaction) => transaction.amount);
        const transactionRows = buildTransactionTableRows(subset);

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
            rows: [],
            chart: { trace, layout },
            transactionRows,
            transactionsTitle: `Individuele spaarrekening-mutaties (${transactionRows.length})`
        });
        return;
    }

    if (detailType === 'needs-vs-wants') {
        const summary = summarizeNeedsVsWants(transactions);
        const total = summary.essentialTotal + summary.discretionaryTotal;
        if (total <= 0.01) {
            openDetailModal({
                title: '<i class="fas fa-scale-balanced"></i> Noodzaak vs wens',
                summary: 'Geen uitgaven gevonden in de geselecteerde periode.',
                rows: [{ label: 'Geen uitgaven om te analyseren.', value: '' }],
                chart: null
            });
            return;
        }
        const expenseTransactions = transactions.filter((transaction) => (transaction.amount || 0) < 0);
        const transactionRows = buildTransactionTableRows(expenseTransactions);

        const topEssential = Object.entries(summary.essentialByCategory)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4);
        const topDiscretionary = Object.entries(summary.discretionaryByCategory)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4);

        const rows = [
            {
                label: 'Noodzakelijk totaal',
                value: `${formatCurrency(summary.essentialTotal)} (${formatPercent(((summary.essentialTotal / total) * 100))})`
            },
            ...topEssential.map(([category, amount]) => ({
                label: `Noodzakelijk · ${category}`,
                value: formatCurrency(amount)
            })),
            {
                label: 'Vrij besteedbaar totaal',
                value: `${formatCurrency(summary.discretionaryTotal)} (${formatPercent(((summary.discretionaryTotal / total) * 100))})`
            },
            ...(summary.refunds > 0.004 ? [{
                label: 'Terugbetalingen (al afgetrokken van de totalen)',
                value: formatCurrency(summary.refunds)
            }] : []),
            ...topDiscretionary.map(([category, amount]) => ({
                label: `Vrij besteedbaar · ${category}`,
                value: formatCurrency(amount)
            }))
        ];

        const trace = {
            type: 'pie',
            labels: ['Noodzakelijk', 'Vrij besteedbaar'],
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
            title: '<i class="fas fa-scale-balanced"></i> Noodzaak vs wens',
            summary: `Totaal uitgaven: ${formatCurrency(total)}`,
            rows,
            chart: { trace, layout },
            transactionRows,
            transactionsTitle: `Individuele uitgaven (${transactionRows.length})`
        });
        return;
    }

    if (detailType === 'merchant-concentration') {
        const expenseTransactions = transactions.filter((transaction) => (transaction.amount || 0) < 0 || isRefundTransaction(transaction));
        const transactionRows = buildTransactionTableRows(expenseTransactions);

        const rows = netSpendingByMerchant(transactions).map((row) => ({ merchant: row.label, amount: row.amount }));

        if (!rows.length) {
            openDetailModal({
                title: '<i class="fas fa-store"></i> Aandeel top-tegenrekening',
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
            text: chartRows.map((row) => `${formatPercent(((row.amount / totalExpenses) * 100))}`),
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
            title: '<i class="fas fa-store"></i> Aandeel top-tegenrekening',
            summary: `Top merchant: ${top.merchant} (${formatPercent(topShare)} van uitgaven)`,
            rows: rows.slice(0, 20).map((row) => ({
                label: row.merchant,
                value: `${formatCurrency(row.amount)} (${formatPercent(((row.amount / totalExpenses) * 100))})`
            })),
            chart: { trace, layout },
            transactionRows,
            transactionsTitle: `Individuele uitgaven (${transactionRows.length})`
        });
        return;
    }

    if (detailType === 'expense-momentum') {
        // Latest complete month vs the average of up to 3 complete months before it (as the tile trends).
        const months = summarizeCompleteMonths(transactions, TREND_MONTHS_BACK + 1);
        if (months.length < 2) {
            openDetailModal({
                title: '<i class="fas fa-chart-line"></i> Uitgavenmomentum',
                summary: 'Minder dan 2 volledige maanden in de geselecteerde periode.',
                rows: [{ label: 'Kies een langere periode om maanden te vergelijken.', value: '' }],
                chart: null
            });
            return;
        }
        const latestMonth = months[months.length - 1];
        const previousMonths = months.slice(0, -1);
        const latestTransactions = transactionsInMonths(transactions, [latestMonth.monthKey]);
        const recentExpenseTransactions = latestTransactions.filter((transaction) => (transaction.amount || 0) < 0);
        const transactionRows = buildTransactionTableRows(recentExpenseTransactions);
        const recentByCategory = buildExpenseByCategory(latestTransactions);
        const priorByCategory = Object.fromEntries(
            Object.entries(buildExpenseByCategory(transactionsInMonths(transactions, previousMonths.map((row) => row.monthKey))))
                .map(([category, total]) => [category, total / previousMonths.length])
        );
        const previousLabel = previousMonths.length === 1
            ? previousMonths[0].monthLabel
            : `gem. ${previousMonths.map((row) => row.monthLabel).join(' + ')}`;
        const categories = new Set([...Object.keys(recentByCategory), ...Object.keys(priorByCategory)]);

        const rows = Array.from(categories)
            .map((category) => {
                const recent = recentByCategory[category] || 0;
                const prior = priorByCategory[category] || 0;
                const delta = recent - prior;
                const deltaPct = prior > 0 ? (delta / prior) * 100 : null;
                return { category, recent, prior, delta, deltaPct };
            })
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

        if (!rows.length) {
            openDetailModal({
                title: '<i class="fas fa-chart-line"></i> Uitgavenmomentum',
                summary: 'Onvoldoende uitgaven voor momentum-analyse.',
                rows: [{ label: 'Geen categorie data.', value: '' }],
                chart: null
            });
            return;
        }

        const recentTotal = rows.reduce((sum, row) => sum + row.recent, 0);
        const priorTotal = rows.reduce((sum, row) => sum + row.prior, 0);
        const totalChangePct = priorTotal > 0 ? ((recentTotal - priorTotal) / priorTotal) * 100 : null;
        const formatPct = (value) => (value === null ? 'n.v.t.' : `${formatPercent(value)}`);

        const chartRows = [...rows]
            .sort((a, b) => (b.recent + b.prior) - (a.recent + a.prior))
            .slice(0, 8);

        const traces = [
            {
                type: 'bar',
                name: previousLabel,
                x: chartRows.map((row) => row.category),
                y: chartRows.map((row) => row.prior),
                marker: { color: 'rgba(148,163,184,0.8)' }
            },
            {
                type: 'bar',
                name: latestMonth.monthLabel,
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
            title: `<i class="fas fa-chart-line"></i> Uitgavenmomentum (${latestMonth.monthLabel} vs ${previousLabel})`,
            summary: `Totaal: ${formatCurrency(recentTotal)} vs ${formatCurrency(priorTotal)} (${formatPct(totalChangePct)}). Alleen volledige maanden; terugbetalingen niet meegeteld.`,
            rows: rows.slice(0, 20).map((row) => ({
                label: row.category,
                value: `${formatCurrency(row.recent)} vs ${formatCurrency(row.prior)} (Δ ${formatCurrency(row.delta)}, ${formatPct(row.deltaPct)})`
            })),
            chart: { trace: traces, layout },
            transactionRows,
            transactionsTitle: `Individuele uitgaven ${latestMonth.monthLabel} (${transactionRows.length})`
        });
        return;
    }

    if (detailType === 'cashflow') {
        const totals = calculateKPIs(transactions);
        const { traces, layout } = buildCashflowFigure(transactions);
        const transactionRows = buildTransactionTableRows(transactions);
        openDetailModal({
            title: '<i class="fas fa-chart-line"></i> Cashflow (tijdslijn)',
            summary: `${transactions.length} transacties · inkomsten ${formatCurrency(totals.income)} · uitgaven ${formatCurrency(totals.expenses)}`
                + (totals.refunds > 0.004 ? ` (na ${formatCurrency(totals.refunds)} terugbetalingen)` : '')
                + ` · netto ${formatCurrency(totals.netSavings)}`,
            rows: [],
            chart: { trace: traces, layout },
            transactionRows,
            transactionsTitle: `Alle bij- en afschrijvingen (${transactionRows.length})`
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
        const transactionRowsAll = buildTransactionTableRows(transactions);
        const rowActionMap = {
            __all__: () => {
                detailTransactionsState.rows = transactionRowsAll;
                detailTransactionsState.query = '';
                detailTransactionsState.sortKey = DETAIL_TRANSACTIONS_DEFAULT_SORT;
                const titleEl = document.getElementById('balanceDetailTransactionsTitle');
                if (titleEl) titleEl.textContent = `Transacties (${transactionRowsAll.length})`;
                const searchEl = document.getElementById('balanceDetailTransactionsSearch');
                if (searchEl) searchEl.value = '';
                const sortEl = document.getElementById('balanceDetailTransactionsSort');
                if (sortEl) sortEl.value = DETAIL_TRANSACTIONS_DEFAULT_SORT;
                updateDetailTransactionsView({ reset: true });
                setDetailTransactionsCollapsed(false);
            }
        };
        rows.forEach((row) => {
            const key = `cat:${row.category}`;
            rowActionMap[key] = () => {
                const scoped = transactionRowsAll.filter((tx) => String(tx.category || '') === String(row.category || ''));
                detailTransactionsState.rows = scoped;
                detailTransactionsState.query = '';
                detailTransactionsState.sortKey = DETAIL_TRANSACTIONS_DEFAULT_SORT;
                const titleEl = document.getElementById('balanceDetailTransactionsTitle');
                if (titleEl) titleEl.textContent = `Transacties categorie: ${row.category} (${scoped.length})`;
                const searchEl = document.getElementById('balanceDetailTransactionsSearch');
                if (searchEl) searchEl.value = '';
                const sortEl = document.getElementById('balanceDetailTransactionsSort');
                if (sortEl) sortEl.value = DETAIL_TRANSACTIONS_DEFAULT_SORT;
                updateDetailTransactionsView({ reset: true });
                setDetailTransactionsCollapsed(false);
            };
        });

        const trace = {
            type: 'bar',
            x: rows.map((row) => row.category),
            y: rows.map((row) => row.net),
            marker: { color: rows.map((row) => row.net >= 0 ? '#22c55e' : '#ef4444') },
            hovertemplate: '%{x}<br>Netto: %{y:.2f} EUR<extra></extra>'
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
            title: '<i class="fas fa-project-diagram"></i> Geldstromen detail',
            summary: `Categorieën: ${rows.length}`,
            rows: [
                {
                    label: 'Alle transacties in de periode',
                    value: `${transactionRowsAll.length} transacties`,
                    actionKey: '__all__'
                },
                ...rows.map((row) => ({
                    label: `${row.category} · In ${formatCurrency(row.income)} · Uit ${formatCurrency(row.expense)}`,
                    value: `Netto ${formatCurrency(row.net)}`,
                    actionKey: `cat:${row.category}`
                }))
            ],
            chart: { trace, layout },
            transactionRows: transactionRowsAll,
            transactionsTitle: `Transacties (${transactionRowsAll.length})`,
            rowActionMap,
            transactionsCollapsedByDefault: true
        });
        return;
    }

    if (detailType === 'budget-coach') {
        const monthly = summarizeMonthlyBudgetDiscipline(transactions, 12);
        if (!monthly.length) {
            openDetailModal({
                title: '<i class="fas fa-scale-balanced"></i> Budgetdiscipline (50/30/20)',
                summary: 'Onvoldoende data voor maandelijkse budgetanalyse.',
                rows: [{ label: 'Geen complete maandinkomsten gevonden.', value: '' }],
                chart: null
            });
            return;
        }

        const labels = monthly.map((row) => row.monthLabel);
        // Averages over complete months; the running month only counts when it's all there is.
        const completeMonths = monthly.filter((row) => !row.isCurrent);
        const avgBase = completeMonths.length ? completeMonths : monthly;
        const avgEssentials = avgBase.reduce((sum, row) => sum + row.essentialsPct, 0) / avgBase.length;
        const avgDiscretionary = avgBase.reduce((sum, row) => sum + row.discretionaryPct, 0) / avgBase.length;
        const avgSavings = avgBase.reduce((sum, row) => sum + row.savingsPct, 0) / avgBase.length;
        const latest = latestCompleteBudgetMonth(monthly);
        const baseDiscretionary = avgBase.reduce((sum, row) => sum + row.discretionary, 0);
        const baseUncategorized = avgBase.reduce((sum, row) => sum + row.uncategorized, 0);
        const uncategorizedNote = baseUncategorized > 0.004
            ? ` Ongecategoriseerde uitgaven (Overig) tellen als vrij besteedbaar: ${formatCurrency(baseUncategorized / avgBase.length)} per maand (${((baseUncategorized / Math.max(baseDiscretionary, 0.01)) * 100).toFixed(0)}% van vrij besteedbaar).`
            : '';

        const traces = [
            {
                type: 'bar',
                name: 'Noodzakelijk',
                x: labels,
                y: monthly.map((row) => row.essentials),
                marker: { color: 'rgba(59,130,246,0.82)' },
                hovertemplate: '%{x}<br>Noodzakelijk: %{y:.2f} EUR<extra></extra>'
            },
            {
                type: 'bar',
                name: 'Vrij besteedbaar',
                x: labels,
                y: monthly.map((row) => row.discretionary),
                marker: { color: 'rgba(245,158,11,0.82)' },
                hovertemplate: '%{x}<br>Vrij besteedbaar: %{y:.2f} EUR<extra></extra>'
            },
            {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Inkomen',
                x: labels,
                y: monthly.map((row) => row.income),
                line: { color: '#22c55e', width: 2.5 },
                marker: { size: 6 },
                hovertemplate: '%{x}<br>Inkomen: %{y:.2f} EUR<extra></extra>'
            },
            {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Overgehouden',
                x: labels,
                y: monthly.map((row) => row.netSavings),
                line: { color: '#38bdf8', width: 2.5, dash: 'dot' },
                marker: { size: 6 },
                hovertemplate: '%{x}<br>Overgehouden: %{y:.2f} EUR<extra></extra>'
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
            title: '<i class="fas fa-scale-balanced"></i> Budgetdiscipline (50/30/20)',
            summary: `Gemiddeld${completeMonths.length ? ' (volledige maanden)' : ''}: noodzakelijk ${formatPercent(avgEssentials)} (doel 50%), vrij besteedbaar ${formatPercent(avgDiscretionary)} (doel 30%), overgehouden ${formatPercent(avgSavings)} (doel 20%). ${latest.isCurrent ? 'Lopende maand' : `Laatste volledige maand (${latest.monthLabel})`} overgehouden: ${formatPercent(latest.savingsPct)}. Overgehouden = inkomen min uitgaven, ook wat op de betaalrekening blijft staan (de tegel Sparen telt alleen stortingen op spaarrekeningen). Terugbetalingen verlagen de uitgaven van hun soort (noodzakelijk of vrij), overboekingen tussen eigen rekeningen tellen niet mee.${uncategorizedNote}`,
            rows: monthly.slice().reverse().map((row) => ({
                label: `${row.monthLabel} · In ${formatCurrency(row.income)} · Noodzakelijk ${formatCurrency(row.essentials)} (${formatPercent(row.essentialsPct)}) · Vrij ${formatCurrency(row.discretionary)} (${formatPercent(row.discretionaryPct)})`
                    + (row.uncategorized > 0.004 ? `, waarvan ongecategoriseerd ${formatCurrency(row.uncategorized)}` : '')
                    + (row.refunds > 0.004 ? ` · na ${formatCurrency(row.refunds)} terugbetalingen` : ''),
                value: `Netto ${formatCurrency(row.netSavings)} (${formatPercent(row.savingsPct)})`
            })),
            chart: { trace: traces, layout }
        });
        return;
    }

    if (detailType === 'action-plan') {
        const localKpis = calculateKPIs(transactions);
        const dailyBurn = computeDailyBurn(transactions);
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
                yaxis: { automargin: true, tickangle: 0 }
            }
        } : null;

        openDetailModal({
            title: '<i class="fas fa-list-check"></i> Actieplan (prioriteit)',
            summary: actions.length
                ? `Topprioriteiten op basis van huidige periode (${actions.length} acties, hoogste confidence ${Math.round((Number(actions[0].confidence) || 0.75) * 100)}%).`
                : 'Geen acties beschikbaar.',
            rows: actions.map((action) => ({
                label: `P${action.priority} · ${action.title}`,
                value: `${action.summary}${(Number(action.impact) || 0) > 0.01 ? ` · Impact ${formatCurrency(action.impact)}` : ''} · Confidence ${Math.round((Number(action.confidence) || 0.75) * 100)}%${action.playbook ? ` · Actie: ${action.playbook}` : ''}`
            })),
            chart,
            listClassName: 'balance-detail-list-stacked'
        });
        return;
    }

    if (detailType === 'recurring-costs') {
        const recurring = summarizeRecurringCosts(transactions, 20);
        if (!recurring.rows.length) {
            openDetailModal({
                title: '<i class="fas fa-repeat"></i> Terugkerende kosten',
                summary: 'Onvoldoende terugkerende uitgaven gevonden in de geselecteerde periode.',
                rows: [{ label: 'Geen vaste maandelijkse posten gevonden (±1 betaling per maand, stabiel bedrag).', value: '' }],
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
            title: '<i class="fas fa-repeat"></i> Terugkerende kosten',
            summary: `${recurring.rows.length} vaste maandelijkse posten · geschatte maandlast ${formatCurrency(monthlyTotal)}. Alleen tegenrekeningen met ±1 betaling per maand en een stabiel bedrag.`,
            rows: recurring.rows.map((row) => ({
                label: `${row.merchant} (${row.category}) · ${row.monthsPresent}/${recurring.months} maanden`,
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
                title: '<i class="fas fa-shield-halved"></i> Datakwaliteit',
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
            { label: 'Tegenrekening-dekking', value: Number(coverage.merchant_coverage) || 0 },
            { label: 'Categorie-dekking (bedrag)', value: Number(coverage.category_amount_coverage) || 0 },
            { label: 'Tegenrekening-dekking (bedrag)', value: Number(coverage.merchant_amount_coverage) || 0 },
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
            { label: 'Kwaliteitsscore', value: `${quality.score}/100 (${quality.qualityLabel})` },
            { label: 'Transacties (periode)', value: String(metrics.total_transactions ?? 0) },
            { label: 'Actieve transactiedagen', value: String(metrics.active_transaction_days ?? 0) },
            { label: 'Dataspan (dagen)', value: String(metrics.dataset_span_days ?? 0) },
            { label: 'Uitgaven met categorie', value: `${metrics.categorized_expenses ?? 0}/${metrics.expense_transactions ?? 0} (${formatRatioPercent(coverage.category_coverage)})` },
            { label: 'Uitgavenvolume met categorie', value: `${formatCurrency(metrics.categorized_expense_amount ?? 0)} / ${formatCurrency(metrics.expense_amount_total ?? 0)} (${formatRatioPercent(coverage.category_amount_coverage)})` },
            { label: 'Uitgaven met tegenrekening', value: `${metrics.merchant_named_expenses ?? 0}/${metrics.expense_transactions ?? 0} (${formatRatioPercent(coverage.merchant_coverage)})` },
            { label: 'Uitgavenvolume met tegenrekening', value: `${formatCurrency(metrics.merchant_named_expense_amount ?? 0)} / ${formatCurrency(metrics.expense_amount_total ?? 0)} (${formatRatioPercent(coverage.merchant_amount_coverage)})` },
            { label: 'EUR-dekking', value: formatRatioPercent(coverage.amount_eur_coverage) },
            { label: 'FX-dekking (non-EUR)', value: formatRatioPercent(coverage.fx_coverage) },
            { label: 'Aandeel interne overboekingen', value: formatRatioPercent(coverage.internal_share) },
            { label: 'Laatst bijgewerkt', value: metrics.latest_capture_at ? new Date(metrics.latest_capture_at).toLocaleString('nl-NL') : 'n.v.t.' }
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
            title: '<i class="fas fa-shield-halved"></i> Datakwaliteit',
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

// One point per calendar day from the start of the selected period up to today (empty
// days = 0), so charts and trends cover the period, not just the days with data.
// Refunds lower that day's spending instead of counting as income.
function buildDailyTotals(data, { periodStart = getSelectedPeriodStart() } = {}) {
    const dayMap = new Map();
    let minTime = periodStart.getTime();
    let maxTime = Date.now();
    data.forEach(t => {
        if (!(t.date instanceof Date) || Number.isNaN(t.date.getTime())) return;
        const key = toDateKey(t.date);
        if (!dayMap.has(key)) {
            dayMap.set(key, { date: dateFromKey(key), income: 0, expenses: 0, net: 0 });
        }
        const entry = dayMap.get(key);
        const amount = Number(t.amount) || 0;
        if (isRefundTransaction(t)) entry.expenses -= amount;
        else if (amount >= 0) entry.income += amount;
        else entry.expenses += Math.abs(amount);
        entry.net += amount;
        minTime = Math.min(minTime, t.date.getTime());
        maxTime = Math.max(maxTime, t.date.getTime());
    });

    const series = [];
    const end = dateFromKey(toDateKey(new Date(maxTime)));
    for (let d = dateFromKey(toDateKey(new Date(minTime))); d <= end; d.setDate(d.getDate() + 1)) {
        const key = toDateKey(d);
        series.push(dayMap.get(key) || { date: dateFromKey(key), income: 0, expenses: 0, net: 0 });
    }
    return series;
}

// Bars per day up to ~3 months, per week (from Monday) up to a year, per month beyond.
function cashflowBucketSize(dayCount) {
    if (dayCount <= 92) return 'day';
    if (dayCount <= 366) return 'week';
    return 'month';
}

function cashflowBucketStart(date, size) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (size === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (size === 'month') start.setDate(1);
    return start;
}

// Axis ranges for two y-axes whose zero lines sit at the same height (bars left, cumulative right).
function alignedZeroRanges(leftValues, rightValues) {
    const extent = (values) => {
        const finite = values.filter(Number.isFinite);
        return [Math.min(0, ...finite), Math.max(0, ...finite)];
    };
    const left = extent(leftValues);
    const right = extent(rightValues);
    const negativeShare = ([lo, hi]) => (hi - lo > 0 ? -lo / (hi - lo) : 0);
    const share = Math.max(negativeShare(left), negativeShare(right));
    const fit = ([lo, hi]) => {
        if (share >= 0.999) return [Math.min(lo, -1) * 1.08, 0];
        if (share <= 0.001) return [0, Math.max(hi, 1) * 1.08];
        const top = Math.max(hi, -lo * (1 - share) / share, 1);
        return [-top * share / (1 - share) * 1.08, top * 1.08];
    };
    return { left: fit(left), right: fit(right) };
}

// Cashflow figure for the tile and its detail popup: income/spending bars per day, week or
// month, and the cumulative net over the period (right axis).
function buildCashflowFigure(transactions) {
    const daily = buildDailyTotals(transactions);
    const size = cashflowBucketSize(daily.length);
    const buckets = [];
    let running = 0;
    daily.forEach((point) => {
        const start = cashflowBucketStart(point.date, size);
        let bucket = buckets[buckets.length - 1];
        if (!bucket || bucket.start.getTime() !== start.getTime()) {
            bucket = { start, income: 0, expenses: 0, cumulative: 0 };
            buckets.push(bucket);
        }
        bucket.income += point.income;
        bucket.expenses += point.expenses;
        running += point.net;
        bucket.cumulative = running;
    });

    const unit = { day: 'Dag', week: 'Week van', month: 'Maand' }[size];
    const dateFormat = size === 'month' ? '%m-%Y' : '%d-%m-%Y';
    const x = buckets.map((bucket) => bucket.start);
    const traces = [
        {
            x,
            y: buckets.map((bucket) => bucket.income),
            type: 'bar',
            name: 'Inkomsten',
            marker: { color: 'rgba(34,197,94,0.65)' },
            hovertemplate: `${unit} %{x|${dateFormat}}<br>Inkomsten: %{y:.2f} EUR<extra></extra>`
        },
        {
            x,
            y: buckets.map((bucket) => -bucket.expenses),
            type: 'bar',
            name: 'Uitgaven',
            marker: { color: 'rgba(239,68,68,0.65)' },
            hovertemplate: `${unit} %{x|${dateFormat}}<br>Uitgaven (na terugbetalingen): %{customdata:.2f} EUR<extra></extra>`,
            customdata: buckets.map((bucket) => bucket.expenses)
        },
        {
            x,
            y: buckets.map((bucket) => bucket.cumulative),
            type: 'scatter',
            mode: 'lines',
            name: 'Netto cumulatief',
            yaxis: 'y2',
            line: { color: '#8b5cf6', width: 3, shape: size === 'day' ? 'linear' : 'hv' },
            hovertemplate: `t/m ${unit.toLowerCase()} %{x|${dateFormat}}<br>Netto sinds begin periode: %{y:.2f} EUR<extra></extra>`
        }
    ];
    const ranges = alignedZeroRanges(
        [...buckets.map((bucket) => bucket.income), ...buckets.map((bucket) => -bucket.expenses)],
        buckets.map((bucket) => bucket.cumulative)
    );
    const layout = {
        barmode: 'relative',
        margin: { t: 20, r: 50, l: 50, b: 40 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' },
        xaxis: { showgrid: false },
        yaxis: { title: `Per ${{ day: 'dag', week: 'week', month: 'maand' }[size]}`, range: ranges.left, zeroline: true, gridcolor: 'rgba(255,255,255,0.05)' },
        yaxis2: { title: 'Cumulatief', range: ranges.right, overlaying: 'y', side: 'right', zeroline: false, showgrid: false },
        legend: { orientation: 'h', y: -0.2 }
    };
    return { traces, layout, size };
}

function renderCashflowChart(data) {
    const container = document.getElementById('cashflowChart');
    if (!container) return;
    const { traces, layout } = buildCashflowFigure(data);
    Plotly.react(container, traces, layout, { displayModeBar: false, responsive: true });
}

function renderSankeyChart(data) {
    const container = document.getElementById('sankeyChart');
    if (!container) return;
    setSankeySummary(container, '');

    const incomeByCategory = {};
    const essentialByCategory = {};
    const discretionaryByCategory = {};
    let totalIncome = 0;
    let totalEssentials = 0;
    let totalDiscretionary = 0;
    let refundEssentials = 0;
    let refundDiscretionary = 0;

    excludeOwnTransfersForBudget(data).forEach((transaction) => {
        const category = transaction.category || 'Overig';
        if (isRefundTransaction(transaction)) {
            if (refundBudgetBucket(transaction) === 'essentials') refundEssentials += Number(transaction.amount) || 0;
            else refundDiscretionary += Number(transaction.amount) || 0;
            return;
        }
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

    // Refunds are money back on purchases: they flow straight into the bucket of that purchase
    // instead of counting as income. Only a surplus beyond all spending is income.
    const netBuckets = applyBudgetRefunds(totalEssentials, totalDiscretionary, refundEssentials, refundDiscretionary);
    const refundsToEssentials = totalEssentials - netBuckets.essentials;
    const refundsToDiscretionary = totalDiscretionary - netBuckets.discretionary;
    const refundsUsed = refundsToEssentials + refundsToDiscretionary;
    const refundSurplus = refundEssentials + refundDiscretionary - refundsUsed;
    if (refundSurplus > 0.004) {
        incomeByCategory.Terugbetaling = (incomeByCategory.Terugbetaling || 0) + refundSurplus;
        totalIncome += refundSurplus;
    }
    const totalExpenses = netBuckets.essentials + netBuckets.discretionary;
    if (totalIncome <= 0.01 && totalEssentials + totalDiscretionary <= 0.01) {
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
    const topEssential = selectTopWithRemainder(Object.entries(essentialByCategory), 7, 'Overig noodzakelijk', 0.06);
    const topDiscretionary = selectTopWithRemainder(Object.entries(discretionaryByCategory), 7, 'Overig vrij besteedbaar', 0.06);

    const SANKEY_TOTAL_IN = 'Totaal in';
    const SANKEY_ESSENTIALS = 'Noodzakelijk';
    const SANKEY_DISCRETIONARY = 'Vrij besteedbaar';
    const SANKEY_SAVED = 'Overgehouden';
    const SANKEY_BUFFER = 'Uit buffer';
    const SANKEY_REFUNDS = 'Terugbetalingen';
    const labels = [
        ...topIncome.map(([name]) => `In: ${name}`),
        SANKEY_TOTAL_IN,
        SANKEY_ESSENTIALS,
        SANKEY_DISCRETIONARY,
        ...topEssential.map(([name]) => `Nodig: ${name}`),
        ...topDiscretionary.map(([name]) => `Vrij: ${name}`)
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

    if (netBuckets.essentials > 0.01) {
        source.push(cashInIndex);
        target.push(essentialsIndex);
        value.push(netBuckets.essentials);
        colors.push('rgba(59,130,246,0.42)');
        linkSharePct.push(totalIncome > 0 ? (netBuckets.essentials / totalIncome) * 100 : 0);
    }

    if (netBuckets.discretionary > 0.01) {
        source.push(cashInIndex);
        target.push(discretionaryIndex);
        value.push(netBuckets.discretionary);
        colors.push('rgba(245,158,11,0.42)');
        linkSharePct.push(totalIncome > 0 ? (netBuckets.discretionary / totalIncome) * 100 : 0);
    }
    if (refundsUsed > 0.01) {
        labels.push(SANKEY_REFUNDS);
        const refundsIndex = labels.length - 1;
        [[essentialsIndex, refundsToEssentials], [discretionaryIndex, refundsToDiscretionary]].forEach(([targetIndex, amount]) => {
            if (amount <= 0.01) return;
            source.push(refundsIndex);
            target.push(targetIndex);
            value.push(amount);
            colors.push('rgba(20,184,166,0.45)');
            linkSharePct.push((amount / refundsUsed) * 100);
        });
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
        labels.push(SANKEY_SAVED);
        source.push(cashInIndex);
        target.push(labels.length - 1);
        value.push(net);
        colors.push('rgba(56,189,248,0.45)');
        linkSharePct.push(totalIncome > 0 ? (net / totalIncome) * 100 : 0);
    } else if (net < 0) {
        labels.push(SANKEY_BUFFER);
        source.push(labels.length - 1);
        target.push(cashInIndex);
        value.push(Math.abs(net));
        colors.push('rgba(251,191,36,0.45)');
        linkSharePct.push(totalIncome > 0 ? (Math.abs(net) / totalIncome) * 100 : 0);
    }

    setSankeySummary(
        container,
        `In ${formatCurrency(totalIncome)} · Uit ${formatCurrency(totalExpenses)}`
            + (refundsUsed > 0.004 ? ` (na ${formatCurrency(refundsUsed)} terugbetalingen)` : '')
            + ` · Netto ${formatCurrency(net)}`
    );

    const trace = {
        type: 'sankey',
        arrangement: 'snap',
        node: {
            label: labels,
            pad: 15,
            thickness: 18,
            color: labels.map((label) => {
                if (label === SANKEY_TOTAL_IN) return '#22c55e';
                if (label === SANKEY_SAVED) return '#38bdf8';
                if (label === SANKEY_BUFFER) return '#f59e0b';
                if (label === SANKEY_REFUNDS) return '#14b8a6';
                if (label === SANKEY_ESSENTIALS) return '#3b82f6';
                if (label === SANKEY_DISCRETIONARY) return '#f59e0b';
                if (label.startsWith('Nodig:')) return '#60a5fa';
                if (label.startsWith('Vrij:')) return '#fbbf24';
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
        font: { color: '#cbd5f5' }
    };

    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
}

function setSankeySummary(container, text) {
    const cardBody = container?.closest('.card-body');
    if (!cardBody) return;

    let summary = cardBody.querySelector('.sankey-summary');
    if (!summary) {
        summary = document.createElement('div');
        summary.className = 'sankey-summary';
        summary.setAttribute('aria-live', 'polite');
        cardBody.insertBefore(summary, container);
    }

    const normalizedText = String(text || '').trim();
    summary.textContent = normalizedText;
    summary.hidden = normalizedText.length === 0;
}

function renderSunburstChart(data) {
    const container = document.getElementById('sunburstChart');
    if (!container) return;

    const widgetData = data || [];

    const incomeByCategory = new Map();
    const expenseByCategory = new Map();
    const merchantByCategory = new Map();

    // Refunds are not income: they lower the spending category of their purchase.
    const refundsByCategory = new Map();
    widgetData.forEach((transaction) => {
        const category = transaction.category || 'Overig';
        const merchant = resolveMerchantLabel(transaction);
        if (isRefundTransaction(transaction)) {
            const target = transaction.refund_category || 'Overig';
            refundsByCategory.set(target, (refundsByCategory.get(target) || 0) + transaction.amount);
            return;
        }
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
    // Net refunds per category; merchants scale along so the ring still adds up.
    refundsByCategory.forEach((refund, category) => {
        const gross = expenseByCategory.get(category);
        if (!gross) return;
        const net = Math.max(0, gross - refund);
        const factor = net / gross;
        if (net <= 0.004) {
            expenseByCategory.delete(category);
            merchantByCategory.delete(category);
            return;
        }
        expenseByCategory.set(category, net);
        const merchantMap = merchantByCategory.get(category);
        merchantMap?.forEach((amount, merchant) => merchantMap.set(merchant, amount * factor));
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

    pushNode('root', 'Alles', '', totalIncome + totalExpenses, '#334155');
    pushNode('income', 'Inkomsten', 'root', totalIncome, '#22c55e');
    pushNode('expenses', 'Uitgaven', 'root', totalExpenses, '#ef4444');

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
        hovertemplate: '%{label}<br>%{value:.2f} EUR<br>%{percentParent:.1%} van bovenliggend<extra></extra>'
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

    const monthly = summarizeMonthlyBudgetDiscipline(data, 12, { includeNoIncomeMonths: true });
    if (!monthly.some((row) => row.essentialsPct !== null)) {
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
    const minPct = Math.min(-20, ...savings.filter((value) => value !== null).map((value) => Number(value) || 0));
    // Up to the highest value: a month with low income can spend well over 100% of it.
    const maxPct = Math.max(100, ...[...essentials, ...discretionary, ...savings]
        .filter((value) => value !== null)
        .map((value) => Number(value) || 0));
    const latest = latestCompleteBudgetMonth(monthly);
    const noIncomeMonths = monthly.filter((row) => row.essentialsPct === null).map((row) => row.monthLabel);
    const statusText = `${latest.isCurrent ? 'Lopende maand' : `Laatste volledige maand (${latest.monthLabel})`}: `
        + `noodzakelijk ${formatPercent(latest.essentialsPct)} (doel 50%), vrij besteedbaar ${formatPercent(latest.discretionaryPct)} (doel 30%), `
        + `overgehouden ${formatPercent(latest.savingsPct)} (doel 20%).`
        + (noIncomeMonths.length ? ` Geen inkomen in: ${noIncomeMonths.join(', ')}.` : '');

    const traces = [
        {
            type: 'scatter',
            mode: 'lines+markers',
            name: 'Noodzakelijk %',
            x: labels,
            y: essentials,
            line: { color: '#3b82f6', width: 3 },
            marker: { size: 7 },
            hovertemplate: '%{x}<br>Noodzakelijk: %{y:.1f}%<extra></extra>'
        },
        {
            type: 'scatter',
            mode: 'lines+markers',
            name: 'Vrij besteedbaar %',
            x: labels,
            y: discretionary,
            customdata: monthly.map((row) => row.uncategorized),
            line: { color: '#f59e0b', width: 3 },
            marker: { size: 7 },
            hovertemplate: '%{x}<br>Vrij besteedbaar: %{y:.1f}%<br>waarvan ongecategoriseerd (Overig): %{customdata:.2f} EUR<extra></extra>'
        },
        {
            type: 'scatter',
            mode: 'lines+markers',
            name: 'Overgehouden %',
            x: labels,
            y: savings,
            line: { color: '#22c55e', width: 3 },
            marker: { size: 7 },
            hovertemplate: '%{x}<br>Overgehouden: %{y:.1f}%<extra></extra>'
        },
        {
            type: 'scatter',
            mode: 'lines',
            name: 'Doel noodzakelijk (50%)',
            x: labels,
            y: labels.map(() => 50),
            line: { color: 'rgba(59,130,246,0.65)', width: 1.8, dash: 'dot' },
            hoverinfo: 'skip'
        },
        {
            type: 'scatter',
            mode: 'lines',
            name: 'Doel vrij besteedbaar (30%)',
            x: labels,
            y: labels.map(() => 30),
            line: { color: 'rgba(245,158,11,0.65)', width: 1.8, dash: 'dot' },
            hoverinfo: 'skip'
        },
        {
            type: 'scatter',
            mode: 'lines',
            name: 'Doel overhouden (20%)',
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
            range: [Math.floor(minPct / 10) * 10, Math.ceil(maxPct / 10) * 10]
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

    // Variable spending only: direct debits for fixed costs (rent, insurance, energy) are booked
    // in nightly batches and would make the night look like the biggest spending moment.
    data.forEach((transaction) => {
        if ((transaction.amount || 0) >= 0) return;
        if (FIXED_COST_CATEGORIES.has(transaction.category)) return;
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
        hovertemplate: '%{y} · %{x}<br>Variabele uitgaven: %{z:.2f} EUR<extra></extra>'
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

    const widgetData = data || [];

    // Net of refunds, grouped per shop (merchantGroupLabel).
    const sorted = netSpendingByMerchant(widgetData)
        .filter((row) => row.label && row.label !== 'Onbekend')
        .slice(0, 12)
        .map((row) => [row.label, row.amount]);
    const labels = sorted.map(([name]) => name);
    const values = sorted.map(([, value]) => value);
    
    const trace = {
        type: 'bar',
        x: values,
        y: labels,
        orientation: 'h',
        marker: {
            color: '#8b5cf6'
        },
        hovertemplate: '%{y}<br>%{x:.2f} EUR<extra></extra>'
    };
    
    const layout = {
        margin: { t: 10, r: 10, l: 100, b: 30 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' },
        xaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickprefix: '€' },
        yaxis: { gridcolor: 'rgba(255,255,255,0.05)', automargin: true }
    };
    
    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
}

// Amount buckets for the spending-spread chart; widths grow with the amount so one large
// payment (e.g. rent) doesn't squeeze all other payments into the first bucket.
const SPREAD_BUCKETS = [
    { min: 0, max: 5, label: '€0–5' },
    { min: 5, max: 10, label: '€5–10' },
    { min: 10, max: 25, label: '€10–25' },
    { min: 25, max: 50, label: '€25–50' },
    { min: 50, max: 100, label: '€50–100' },
    { min: 100, max: 250, label: '€100–250' },
    { min: 250, max: 500, label: '€250–500' },
    { min: 500, max: 1000, label: '€500–1000' },
    { min: 1000, max: Infinity, label: '€1000+' }
];

// Per category: share of its payments in each amount bucket (sums to 100% per category).
function buildSpendingSpread(data, maxCategories = 4) {
    const amountsByCategory = {};
    (data || []).forEach((transaction) => {
        if ((transaction.amount || 0) >= 0) return;
        const category = transaction.category || 'Overig';
        if (!amountsByCategory[category]) amountsByCategory[category] = [];
        amountsByCategory[category].push(Math.abs(transaction.amount));
    });

    // Categories with the most money spent (not the most payments).
    return Object.entries(amountsByCategory)
        .map(([category, amounts]) => ({
            category,
            amounts,
            total: amounts.reduce((sum, value) => sum + value, 0)
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, maxCategories)
        .map(({ category, amounts, total }) => {
            const counts = SPREAD_BUCKETS.map(() => 0);
            amounts.forEach((amount) => {
                const index = SPREAD_BUCKETS.findIndex((bucket) => amount >= bucket.min && amount < bucket.max);
                counts[index >= 0 ? index : SPREAD_BUCKETS.length - 1] += 1;
            });
            return {
                category,
                total,
                count: amounts.length,
                counts,
                shares: counts.map((count) => (amounts.length ? (count / amounts.length) * 100 : 0))
            };
        });
}

function renderRidgePlot(data) {
    const canvas = document.getElementById('ridgePlotCanvas');
    if (!canvas) return;

    const spread = buildSpendingSpread(data, 4);
    const datasets = spread.map((row) => ({
        label: `${row.category} (${row.count})`,
        data: row.shares,
        counts: row.counts,
        borderColor: getCategoryColor(row.category),
        backgroundColor: 'rgba(0,0,0,0)',
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 2
    }));

    if (chartRegistry.chartjs.ridgePlot) {
        chartRegistry.chartjs.ridgePlot.destroy();
    }

    chartRegistry.chartjs.ridgePlot = new Chart(canvas, {
        type: 'line',
        data: { labels: SPREAD_BUCKETS.map((bucket) => bucket.label), datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const count = context.dataset.counts?.[context.dataIndex] ?? 0;
                            return `${context.dataset.label}: ${formatPercent(context.parsed.y)} (${count} betalingen)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Bedrag per betaling' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y: {
                    title: { display: true, text: '% van betalingen in categorie' },
                    beginAtZero: true,
                    ticks: { callback: (value) => `${value}%` },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                }
            }
        }
    });
}

// Cumulative net spending per category per day: a refund lowers its purchase category on the
// day it comes in.
function buildDailyCategoryTotals(data) {
    const expenses = spendingEntries(data).filter((entry) => (
        entry.transaction.date instanceof Date
        && !Number.isNaN(entry.transaction.date.getTime())
    ));
    if (!expenses.length) {
        return { frames: [], categories: [], byFrame: {} };
    }

    const byDayDelta = {};
    const categories = new Set();
    let minDate = null;
    let maxDate = null;

    expenses.forEach((entry) => {
        const dateKey = toDateKey(entry.transaction.date);
        const category = entry.category;
        const amount = entry.amount;
        if (!byDayDelta[dateKey]) byDayDelta[dateKey] = {};
        byDayDelta[dateKey][category] = (byDayDelta[dateKey][category] || 0) + amount;
        categories.add(category);

        const dayStart = new Date(`${dateKey}T00:00:00`);
        if (!minDate || dayStart < minDate) minDate = dayStart;
        if (!maxDate || dayStart > maxDate) maxDate = dayStart;
    });

    const frames = [];
    const byFrame = {};
    const runningTotals = {};
    for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
        const frameKey = toDateKey(d);
        const deltas = byDayDelta[frameKey] || {};
        Object.entries(deltas).forEach(([category, value]) => {
            runningTotals[category] = (runningTotals[category] || 0) + value;
        });
        frames.push(frameKey);
        byFrame[frameKey] = { ...runningTotals };
    }

    return { frames, categories: Array.from(categories), byFrame };
}

function updateRacingChart(frameIndex) {
    if (!racingData || !racingData.frames.length) return;
    const frameKey = racingData.frames[frameIndex];
    const totals = racingData.byFrame[frameKey] || {};
    const items = Object.entries(totals).filter(([, value]) => value > 0.004).sort((a, b) => b[1] - a[1]).slice(0, 12);
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
        },
        hovertemplate: '%{y}<br>%{x:.2f} EUR<extra></extra>'
    };
    
    const layout = {
        margin: { t: 20, r: 20, l: 80, b: 30 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#cbd5f5' },
        xaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickprefix: '€' },
        yaxis: { gridcolor: 'rgba(255,255,255,0.05)', automargin: true }
    };
    
    Plotly.react(container, [trace], layout, { displayModeBar: false, responsive: true });
    
    const raceMonth = document.getElementById('raceMonth');
    if (raceMonth) {
        const frameDate = new Date(`${frameKey}T00:00:00`);
        raceMonth.textContent = frameDate.toLocaleDateString('nl-NL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
}

function renderRacingChart(data) {
    const slider = document.getElementById('raceSlider');
    racingData = buildDailyCategoryTotals(data);
    if (!racingData.frames.length) return;
    
    if (slider) {
        slider.max = racingData.frames.length - 1;
        slider.value = racingData.frames.length - 1;
    }
    
    updateRacingChart(racingData.frames.length - 1);
}

const ESSENTIAL_CATEGORIES = new Set([
    'Boodschappen',
    'Wonen',
    'Energie & telecom',
    'Kinderopvang',
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

function getSelectedPeriodStart() {
    const days = Number(CONFIG.timeRange) || 90;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days);
    return start;
}

/**
 * Monthly 50/30/20 figures (percentages of that month's income).
 * - Months that only partly fall inside the selected period are left out (a 90-day
 *   window starts mid-month, so its first month would miss income or spending).
 * - The running month is kept but flagged `isCurrent` (incomplete).
 * - Refunds are not income: they lower that month's discretionary spending.
 * - Months without income: left out by default; with includeNoIncomeMonths they are kept
 *   with null percentages (shown as gaps).
 */
// Budget views (50/30/20, Noodzaak vs wens, Geldstromen) never count transfers between own
// accounts: they are neither income nor spending, whatever the internal-transfer setting.
function excludeOwnTransfersForBudget(transactions) {
    const ownIdentity = getOwnBunqAccountIdentitySets();
    const externalSets = getOwnExternalAccountSets();
    return (transactions || []).filter((transaction) => (
        !isInternalOwnTransfer(transaction, ownIdentity) && !isOwnExternalTransfer(transaction, externalSets)
    ));
}

// Regular income: salary, benefits and interest, plus any counterparty that paid at least
// €250 in 3+ months within ±25% of its median monthly amount, e.g. an employer whose
// description is just "Periode 9".
const REGULAR_INCOME_CATEGORIES = new Set(['Salaris', 'Uitkeringen & toeslagen', 'Rente']);

function incomeSourceKey(transaction) {
    return normalizeIbanForMatch(transaction?.counterparty_iban)
        || normalizePartyNameForMatch(transaction?.counterparty || transaction?.merchant);
}

function detectRecurringIncomeSources(transactions) {
    const monthly = new Map();
    (transactions || []).forEach((transaction) => {
        if (!isValidTransactionDate(transaction) || transaction.amount <= 0 || isRefundTransaction(transaction)) return;
        const key = incomeSourceKey(transaction);
        if (!key) return;
        if (!monthly.has(key)) monthly.set(key, new Map());
        const months = monthly.get(key);
        const month = monthKeyOf(transaction.date);
        months.set(month, (months.get(month) || 0) + transaction.amount);
    });
    const sources = new Set();
    monthly.forEach((months, key) => {
        const amounts = Array.from(months.values()).filter((amount) => amount >= 250).sort((x, y) => x - y);
        if (amounts.length < 3) return;
        // Median-based, so one month with a shifted (double) salary doesn't disqualify the payer.
        const median = amounts[Math.floor(amounts.length / 2)];
        const stable = amounts.filter((amount) => Math.abs(amount - median) <= median * 0.25);
        if (stable.length >= 3) sources.add(key);
    });
    return sources;
}

function isRegularIncome(transaction, recurringSources) {
    if (transaction.amount <= 0 || isRefundTransaction(transaction)) return false;
    return REGULAR_INCOME_CATEGORIES.has(transaction.category)
        || (recurringSources || new Set()).has(incomeSourceKey(transaction));
}

// Bucket a refund lowers: that of the purchase it belongs to (backend `refund_category`),
// discretionary when unknown.
function refundBudgetBucket(transaction) {
    return transaction?.refund_category && isEssentialCategory(transaction.refund_category) ? 'essentials' : 'discretionary';
}

// Subtract refunds from their buckets; what a bucket can't absorb comes off the other one.
function applyBudgetRefunds(essentials, discretionary, refundEssentials, refundDiscretionary) {
    let e = essentials - refundEssentials;
    let d = discretionary - refundDiscretionary;
    if (e < 0) { d += e; e = 0; }
    if (d < 0) { e = Math.max(0, e + d); d = 0; }
    return { essentials: e, discretionary: d };
}

// Month a salary payment counts for. A salary that lands just across a month boundary (paid
// on the 30th instead of the 1st because of a weekend) would give one month two salaries
// and the next none: when a month has 2+ salary payments and the neighbouring month none,
// the payment within 7 days of that boundary moves to the neighbouring month.
function assignSalaryMonths(transactions) {
    const override = new Map();
    const recurringSources = detectRecurringIncomeSources(transactions);
    const salaries = (transactions || []).filter((transaction) => (
        isValidTransactionDate(transaction) && transaction.amount > 0
        && (transaction.category === 'Salaris'
            || (transaction.category !== 'Rente' && !isRefundTransaction(transaction)
                && recurringSources.has(incomeSourceKey(transaction))))
    ));
    if (!salaries.length) return override;
    const monthsWithData = new Set((transactions || []).filter(isValidTransactionDate).map((transaction) => monthKeyOf(transaction.date)));
    const currentKey = monthKeyOf(new Date());
    const byMonth = new Map();
    salaries.forEach((transaction) => {
        const key = monthKeyOf(transaction.date);
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key).push(transaction);
    });
    const shiftKey = (key, delta) => {
        const [year, month] = key.split('-').map(Number);
        return monthKeyOf(new Date(year, month - 1 + delta, 1));
    };
    Array.from(byMonth.keys()).sort().forEach((key) => {
        const list = (byMonth.get(key) || []).sort((x, y) => x.date - y.date);
        if (list.length < 2) return;
        const next = shiftKey(key, 1);
        const prev = shiftKey(key, -1);
        const last = list[list.length - 1];
        const daysInMonth = new Date(last.date.getFullYear(), last.date.getMonth() + 1, 0).getDate();
        if (!(byMonth.get(next) || []).length && next <= currentKey && monthsWithData.has(next)
            && daysInMonth - last.date.getDate() < 7) {
            list.pop();
            byMonth.set(next, [last]);
            override.set(last, next);
            return;
        }
        const first = list[0];
        if (!(byMonth.get(prev) || []).length && monthsWithData.has(prev) && first.date.getDate() <= 7) {
            list.shift();
            byMonth.set(prev, [first]);
            override.set(first, prev);
        }
    });
    return override;
}

/**
 * Monthly 50/30/20 figures (percentages of that month's income).
 * - Transfers between own accounts are left out (excludeOwnTransfersForBudget).
 * - Months that only partly fall inside the selected period are left out (a 90-day
 *   window starts mid-month, so its first month would miss income or spending).
 * - The running month is kept but flagged `isCurrent` (incomplete).
 * - Refunds are not income: they lower the bucket of the purchase they belong to.
 * - A salary just across a month boundary counts for the month it belongs to (assignSalaryMonths).
 * - Months without income: left out by default; with includeNoIncomeMonths they are kept
 *   with null percentages (shown as gaps).
 */
function summarizeMonthlyBudgetDiscipline(transactions, maxMonths = 12, options = {}) {
    const { includeNoIncomeMonths = false, periodStart = getSelectedPeriodStart() } = options;
    const budgetTransactions = excludeOwnTransfersForBudget(transactions);
    const salaryMonths = assignSalaryMonths(budgetTransactions);
    const byMonth = new Map();
    budgetTransactions.forEach((transaction) => {
        if (!isValidTransactionDate(transaction)) return;
        const monthKey = salaryMonths.get(transaction) || monthKeyOf(transaction.date);
        if (!byMonth.has(monthKey)) {
            byMonth.set(monthKey, {
                monthKey,
                income: 0,
                essentials: 0,
                discretionary: 0,
                uncategorized: 0,
                refundEssentials: 0,
                refundDiscretionary: 0
            });
        }
        const bucket = byMonth.get(monthKey);
        const amount = Number(transaction.amount) || 0;
        if (amount >= 0) {
            if (isRefundTransaction(transaction)) {
                if (refundBudgetBucket(transaction) === 'essentials') bucket.refundEssentials += amount;
                else bucket.refundDiscretionary += amount;
                return;
            }
            bucket.income += amount;
            return;
        }
        if (isEssentialCategory(transaction.category)) {
            bucket.essentials += Math.abs(amount);
        } else {
            bucket.discretionary += Math.abs(amount);
            if ((transaction.category || 'Overig') === 'Overig') bucket.uncategorized += Math.abs(amount);
        }
    });

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return Array.from(byMonth.values())
        .filter((row) => {
            // Keep only months that start inside the selected period.
            const monthStart = new Date(`${row.monthKey}-01T00:00:00`);
            return !(periodStart instanceof Date) || monthStart >= periodStart;
        })
        .map((row) => {
            const refunds = row.refundEssentials + row.refundDiscretionary;
            return { ...row, ...applyBudgetRefunds(row.essentials, row.discretionary, row.refundEssentials, row.refundDiscretionary), refunds };
        })
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        .filter((row) => includeNoIncomeMonths || row.income > 0.01)
        .slice(-maxMonths)
        .map((row) => {
            const netSavings = row.income - row.essentials - row.discretionary;
            const denominator = row.income > 0.01 ? row.income : null;
            const isCurrent = row.monthKey === currentMonthKey;
            const baseLabel = new Date(`${row.monthKey}-01T00:00:00`).toLocaleDateString('nl-NL', {
                month: 'short',
                year: '2-digit'
            });
            return {
                ...row,
                isCurrent,
                monthLabel: isCurrent ? `${baseLabel} (lopend)` : baseLabel,
                netSavings,
                essentialsPct: denominator ? (row.essentials / denominator) * 100 : null,
                discretionaryPct: denominator ? (row.discretionary / denominator) * 100 : null,
                savingsPct: denominator ? (netSavings / denominator) * 100 : null
            };
        });
}

// Latest complete month with income; falls back to the running month when that's all there is.
function latestCompleteBudgetMonth(monthly) {
    const withIncome = (monthly || []).filter((row) => row.essentialsPct !== null);
    const complete = withIncome.filter((row) => !row.isCurrent);
    return complete[complete.length - 1] || withIncome[withIncome.length - 1] || null;
}

// ---- Insight helpers --------------------------------------------------------
// Insights work on complete calendar months where they compare periods or estimate
// monthly amounts: salary and rent are monthly, so rolling 30-day windows can hold 0 or 2
// of them and give false jumps.

const AVG_DAYS_PER_MONTH = 30.44;
// Never suggested as "cut this" in the action plan (not changeable short-term).
// They still count in totals and in the 50/30/20 figures.
const NON_ACTIONABLE_CATEGORIES = new Set(['Wonen', 'Belastingen']);
// Fixed costs: left out of the spending-volatility measure.
const FIXED_COST_CATEGORIES = new Set(['Wonen', 'Verzekering', 'Belastingen', 'Energie & telecom', 'Abonnementen', 'Kinderopvang']);

function monthKeyOf(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isValidTransactionDate(transaction) {
    return transaction?.date instanceof Date && !Number.isNaN(transaction.date.getTime());
}

// Complete calendar months inside the selected period (no partial first month, no running
// month), including months without income. expenses = spending after refunds.
function summarizeCompleteMonths(transactions, maxMonths = 6) {
    return summarizeMonthlyBudgetDiscipline(transactions, 24, { includeNoIncomeMonths: true })
        .filter((row) => !row.isCurrent)
        .slice(-maxMonths)
        .map((row) => {
            const expenses = row.essentials + row.discretionary;
            return { ...row, expenses, net: row.income - expenses };
        });
}

function transactionsInMonths(transactions, monthKeys) {
    const keys = new Set(monthKeys);
    return (transactions || []).filter((transaction) => (
        isValidTransactionDate(transaction) && keys.has(monthKeyOf(transaction.date))
    ));
}

// Latest complete month vs the average of up to `compareMonths` complete months before it.
// Same basis as the tile trends (calculateTileTrends): up to 3 earlier complete months.
function compareLatestCompleteMonth(transactions, pick, compareMonths = TREND_MONTHS_BACK) {
    const months = summarizeCompleteMonths(transactions, compareMonths + 1);
    if (months.length < 2) return null;
    const latest = months[months.length - 1];
    const previous = months.slice(0, -1);
    const baseline = previous.reduce((sum, row) => sum + pick(row), 0) / previous.length;
    const current = pick(latest);
    return {
        latest,
        previous,
        current,
        baseline,
        delta: current - baseline,
        changePct: Math.abs(baseline) > 0.01 ? ((current - baseline) / Math.abs(baseline)) * 100 : null,
        previousLabel: previous.length === 1
            ? previous[0].monthLabel
            : `gem. ${previous.map((row) => row.monthLabel).join(' + ')}`
    };
}

// Days of data in the selected period: from the later of period start and first
// transaction, up to now.
function periodDaysCovered(transactions) {
    const dates = (transactions || []).filter(isValidTransactionDate).map((transaction) => transaction.date.getTime());
    const periodStart = getSelectedPeriodStart().getTime();
    const start = dates.length ? Math.max(periodStart, Math.min(...dates)) : periodStart;
    return Math.max(1, (Date.now() - start) / (24 * 60 * 60 * 1000));
}

// Average monthly net (income - spending): complete months when available, else the period so far.
function estimateMonthlyNet(transactions) {
    const months = summarizeCompleteMonths(transactions, 3);
    if (months.length) {
        return {
            monthlyNet: months.reduce((sum, row) => sum + row.net, 0) / months.length,
            months: months.length,
            basis: `${months.length} volledige ${months.length === 1 ? 'maand' : 'maanden'}`
        };
    }
    const net = (transactions || []).reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0);
    return {
        monthlyNet: (net / periodDaysCovered(transactions)) * AVG_DAYS_PER_MONTH,
        months: 0,
        basis: 'periode tot nu toe'
    };
}

// Average net outflow per calendar day (0 when money comes in on balance).
function computeDailyBurn(transactions) {
    return Math.max(-estimateMonthlyNet(transactions).monthlyNet, 0) / AVG_DAYS_PER_MONTH;
}

// Result for the running month: what happened so far plus what, in recent complete months,
// still came in and went out after today's day of the month (salary, rent, ...).
function projectCurrentMonthNet(transactions, now = new Date()) {
    const currentKey = monthKeyOf(now);
    const monthToDate = (transactions || [])
        .filter((transaction) => isValidTransactionDate(transaction) && monthKeyOf(transaction.date) === currentKey)
        .reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0);
    const day = now.getDate();
    const months = summarizeCompleteMonths(transactions, 3);
    if (months.length) {
        const restByMonth = months.map((row) => transactionsInMonths(transactions, [row.monthKey])
            .filter((transaction) => transaction.date.getDate() > day)
            .reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0));
        const rest = restByMonth.reduce((sum, value) => sum + value, 0) / restByMonth.length;
        return { projected: monthToDate + rest, monthToDate, rest, basis: `${months.length} volledige ${months.length === 1 ? 'maand' : 'maanden'}` };
    }
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const hasMonthData = (transactions || []).some((transaction) => (
        isValidTransactionDate(transaction) && monthKeyOf(transaction.date) === currentKey
    ));
    if (!hasMonthData) return null;
    const rest = (monthToDate / day) * (daysInMonth - day);
    return { projected: monthToDate + rest, monthToDate, rest, basis: 'lineair (nog geen volledige maand)' };
}

// Label used to add up spending per counterparty: card payments often carry a store number
// or city ("Albert Heijn 1234", "ALBERT HEIJN 5678 UTRECHT NLD"), which would split one shop
// into many. Cut at the first later token with 3+ digits; drop a country code and legal form.
function merchantGroupLabel(label) {
    const original = String(label || '').trim();
    const tokens = original.split(/\s+/);
    const cut = tokens.findIndex((token, index) => index > 0 && /\d{3,}/.test(token));
    let text = cut > 0 ? tokens.slice(0, cut).join(' ') : original;
    text = text
        .replace(/\s+(NLD|NL)$/i, '')
        .replace(/[\s,]+(B\.?\s?V\.?|N\.?\s?V\.?)$/i, '')
        .replace(/[\s.,*#-]+$/, '')
        .trim();
    return text || original;
}

function merchantGroupKey(label) {
    return merchantGroupLabel(label).toLocaleLowerCase('nl-NL').replace(/[^\p{L}\p{N}&]+/gu, ' ').trim();
}

// Spending per transaction for the spending views: outflows count positive; a refund counts
// negative against the category (refund_category) and counterparty of its purchase.
function spendingEntries(transactions) {
    const entries = [];
    (transactions || []).forEach((transaction) => {
        const amount = Number(transaction.amount) || 0;
        if (amount < 0) {
            entries.push({ transaction, category: transaction.category || 'Overig', merchant: resolveMerchantLabel(transaction), amount: -amount });
        } else if (isRefundTransaction(transaction)) {
            entries.push({ transaction, category: transaction.refund_category || 'Overig', merchant: resolveMerchantLabel(transaction), amount: -amount });
        }
    });
    return entries;
}

// Net spending per counterparty group: [{ key, label, amount }], largest first, only > 0.
function netSpendingByMerchant(transactions, filterEntry = null) {
    const groups = new Map();
    spendingEntries(transactions).forEach((entry) => {
        if (filterEntry && !filterEntry(entry)) return;
        const key = merchantGroupKey(entry.merchant);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, { key, amount: 0, labels: new Map() });
        const group = groups.get(key);
        group.amount += entry.amount;
        const label = merchantGroupLabel(entry.merchant);
        group.labels.set(label, (group.labels.get(label) || 0) + 1);
    });
    return Array.from(groups.values())
        .filter((group) => group.amount > 0.004)
        .map((group) => ({
            key: group.key,
            label: Array.from(group.labels.entries()).sort((x, y) => y[1] - x[1])[0][0],
            amount: group.amount
        }))
        .sort((x, y) => y.amount - x.amount);
}

// Net spending per category (refunds subtracted from their purchase category).
function buildExpenseByCategory(transactions) {
    const totals = {};
    spendingEntries(transactions).forEach((entry) => {
        totals[entry.category] = (totals[entry.category] || 0) + entry.amount;
    });
    Object.keys(totals).forEach((category) => {
        if (totals[category] <= 0.004) delete totals[category];
    });
    return totals;
}

// Concrete savings levers: actionable categories/counterparties with their average monthly
// spending over the last complete months (or the period so far).
function buildConcreteCostLevers(transactions, options = {}) {
    const maxCategories = Number(options.maxCategories) || 2;
    const maxMerchants = Number(options.maxMerchants) || 2;
    const minMonthly = Number(options.minMonthly) || 40;

    const months = summarizeCompleteMonths(transactions, 3);
    const source = months.length
        ? transactionsInMonths(transactions, months.map((row) => row.monthKey))
        : (transactions || []);
    const monthCount = months.length || (periodDaysCovered(transactions) / AVG_DAYS_PER_MONTH);
    // Net of refunds; counterparties grouped per shop.
    const entries = spendingEntries(source);
    if (!entries.length || monthCount <= 0) return [];

    const categoryTotals = new Map();
    let totalExpenses = 0;
    entries.forEach((entry) => {
        totalExpenses += entry.amount;
        if (NON_ACTIONABLE_CATEGORIES.has(entry.category)) return;
        categoryTotals.set(entry.category, (categoryTotals.get(entry.category) || 0) + entry.amount);
    });
    const merchantTotals = new Map(
        netSpendingByMerchant(source, (entry) => !NON_ACTIONABLE_CATEGORIES.has(entry.category))
            .map((row) => [row.label, row.amount])
    );

    if (totalExpenses <= 0.01) return [];

    const buildLever = (type, label, value) => {
        const share = value / totalExpenses;
        const baselineMonthly = value / monthCount;
        const targetCutPct = Math.min(0.22, Math.max(0.08, 0.08 + (share * 0.14)));
        const expectedMonthly = baselineMonthly * targetCutPct;
        return { type, label, share, baselineMonthly, targetCutPct, expectedMonthly };
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

// Essential vs discretionary spending over the period; own transfers left out, refunds
// lower the bucket of their purchase (totals; the per-category lists are gross).
function summarizeNeedsVsWants(transactions) {
    const summary = {
        essentialTotal: 0,
        discretionaryTotal: 0,
        refunds: 0,
        essentialByCategory: {},
        discretionaryByCategory: {}
    };
    let refundEssentials = 0;
    let refundDiscretionary = 0;

    excludeOwnTransfersForBudget(transactions).forEach((transaction) => {
        if (isRefundTransaction(transaction)) {
            if (refundBudgetBucket(transaction) === 'essentials') refundEssentials += transaction.amount;
            else refundDiscretionary += transaction.amount;
            return;
        }
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

    const net = applyBudgetRefunds(summary.essentialTotal, summary.discretionaryTotal, refundEssentials, refundDiscretionary);
    summary.essentialTotal = net.essentials;
    summary.discretionaryTotal = net.discretionary;
    summary.refunds = refundEssentials + refundDiscretionary;
    return summary;
}

// How much weekly *variable* spending (excl. fixed costs) varies: coefficient of variation
// over complete weeks (Mon–Sun) in the selected period. Daily figures would always look
// volatile because of rent day.
function computeWeeklySpendingVolatility(transactions) {
    const valid = (transactions || []).filter(isValidTransactionDate);
    if (!valid.length) return { mean: 0, std: 0, cv: 0, weeks: 0, label: 'n.v.t.' };

    const firstDate = new Date(Math.min(...valid.map((transaction) => transaction.date.getTime())));
    const start = new Date(Math.max(getSelectedPeriodStart().getTime(), firstDate.getTime()));
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + ((8 - start.getDay()) % 7));   // first Monday on/after start
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() - ((end.getDay() + 6) % 7));        // Monday of the running week

    const weekTotals = [];
    for (let weekStart = new Date(start); weekStart < end; weekStart.setDate(weekStart.getDate() + 7)) {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        if (weekEnd > end) break;
        weekTotals.push(valid
            .filter((transaction) => (
                (transaction.amount || 0) < 0
                && !FIXED_COST_CATEGORIES.has(transaction.category)
                && transaction.date >= weekStart
                && transaction.date < weekEnd
            ))
            .reduce((sum, transaction) => sum + Math.abs(transaction.amount || 0), 0));
    }

    if (weekTotals.length < 3) return { mean: 0, std: 0, cv: 0, weeks: weekTotals.length, label: 'n.v.t.' };
    const mean = weekTotals.reduce((sum, value) => sum + value, 0) / weekTotals.length;
    if (mean <= 0.01) return { mean, std: 0, cv: 0, weeks: weekTotals.length, label: 'Laag' };
    const variance = weekTotals.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / weekTotals.length;
    const std = Math.sqrt(Math.max(variance, 0));
    const cv = std / mean;
    const label = cv >= 0.6 ? 'Hoog' : (cv >= 0.3 ? 'Middel' : 'Laag');
    return { mean, std, cv, weeks: weekTotals.length, label };
}

// Fixed monthly items: a counterparty paid in most months, about once a month (at most 2
// payments), with a stable monthly amount. Excludes supermarkets and restaurants, which
// recur but aren't fixed costs.
function summarizeRecurringCosts(transactions, maxItems = 12) {
    const expenseTransactions = (transactions || []).filter((transaction) => (
        (transaction.amount || 0) < 0 && isValidTransactionDate(transaction)
    ));
    if (!expenseTransactions.length) {
        return { months: 0, rows: [] };
    }

    const monthKeys = new Set();
    const merchantByMonth = new Map();
    const merchantCategories = new Map();
    expenseTransactions.forEach((transaction) => {
        const monthKey = monthKeyOf(transaction.date);
        const merchant = merchantGroupLabel(resolveMerchantLabel(transaction));
        const amount = Math.abs(Number(transaction.amount) || 0);
        monthKeys.add(monthKey);
        if (!merchantByMonth.has(merchant)) {
            merchantByMonth.set(merchant, new Map());
            merchantCategories.set(merchant, new Map());
        }
        const monthMap = merchantByMonth.get(merchant);
        const entry = monthMap.get(monthKey) || { total: 0, count: 0 };
        entry.total += amount;
        entry.count += 1;
        monthMap.set(monthKey, entry);
        const categories = merchantCategories.get(merchant);
        const category = transaction.category || 'Overig';
        categories.set(category, (categories.get(category) || 0) + amount);
    });

    const totalMonths = monthKeys.size;
    const minMonths = totalMonths >= 4 ? 3 : 2;
    const rows = [];

    merchantByMonth.forEach((monthMap, merchant) => {
        const monthsPresent = monthMap.size;
        if (monthsPresent < minMonths) return;

        const entries = Array.from(monthMap.values());
        const paymentsPerMonth = entries.reduce((sum, entry) => sum + entry.count, 0) / monthsPresent;
        if (paymentsPerMonth > 2) return;

        const monthlyValues = entries.map((entry) => entry.total);
        const avgMonthly = monthlyValues.reduce((sum, value) => sum + value, 0) / monthlyValues.length;
        if (avgMonthly < 7.5) return;

        const variance = monthlyValues.reduce((sum, value) => sum + ((value - avgMonthly) ** 2), 0) / monthlyValues.length;
        const std = Math.sqrt(Math.max(variance, 0));
        const cv = avgMonthly > 0.01 ? std / avgMonthly : 0;
        if (cv > 0.35) return;

        const category = Array.from(merchantCategories.get(merchant).entries())
            .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Overig';
        rows.push({
            merchant,
            category,
            monthsPresent,
            paymentsPerMonth,
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
    const monthlyAll = summarizeMonthlyBudgetDiscipline(transactions, 6);
    // Use complete months when available; the running month is only partly done.
    const completeMonths = monthlyAll.filter((row) => !row.isCurrent);
    const monthly = completeMonths.length ? completeMonths : monthlyAll;
    const latest = latestCompleteBudgetMonth(monthlyAll);
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

    // Month-based comparisons (see summarizeCompleteMonths): latest complete month vs before.
    const expenseCompare = compareLatestCompleteMonth(transactions, (row) => row.expenses);
    const incomeCompare = compareLatestCompleteMonth(transactions, (row) => row.income);
    const monthlyBase = summarizeCompleteMonths(transactions, 3);
    const avgMonthlyExpenses = monthlyBase.length
        ? monthlyBase.reduce((sum, row) => sum + row.expenses, 0) / monthlyBase.length
        : ((kpis.expenses || 0) / periodDaysCovered(transactions)) * AVG_DAYS_PER_MONTH;

    const baseImpactFloor = Math.max(25, avgMonthlyExpenses * 0.015, (kpis.expenses || 0) * 0.012);
    const trendImpactFloor = Math.max(baseImpactFloor, (expenseCompare?.baseline || 0) * 0.05);
    const incomeImpactFloor = Math.max(60, (incomeCompare?.baseline || 0) * 0.05);

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
                title: 'Houd netto 20% van je inkomen over',
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
                title: 'Verlaag vrij besteedbare uitgaven',
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
                title: 'Herzie vaste lasten',
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
                summary: `Noodzakelijke uitgaven nemen ${formatPercent(latest.essentialsPct)} in van inkomen; extra inkomsten hebben nu meer effect dan extra kleine cuts.`,
                impact: Math.max((latest.essentialsPct - 50) * (latest.income / 100), baseImpactFloor * 0.7),
                confidence: 0.76 * baselineConfidence,
                reason: 'income-side'
            });
        }
    }

    if (expenseCompare && expenseCompare.changePct !== null) {
        const increasePct = expenseCompare.changePct;
        const expenseDelta = expenseCompare.delta;
        if (increasePct > 10 && expenseDelta > trendImpactFloor) {
            pushAction({
                priority: 2,
                title: 'Stop uitgavengroei',
                summary: `Uitgaven in ${expenseCompare.latest.monthLabel} ${formatPercent(increasePct)} hoger dan ${expenseCompare.previousLabel} (${formatCurrency(expenseDelta)}).`,
                impact: Math.max(expenseDelta, 0),
                confidence: 0.79,
                reason: 'expense-trend'
            });
        }
    }

    if (incomeCompare && incomeCompare.changePct !== null) {
        const incomeDeltaPct = incomeCompare.changePct;
        const incomeDelta = -incomeCompare.delta;
        if (incomeDeltaPct < -12 && incomeDelta > incomeImpactFloor) {
            pushAction({
                priority: 1,
                title: 'Anticipeer op lagere inkomensstroom',
                summary: `Inkomen in ${incomeCompare.latest.monthLabel} ${formatPercent(Math.abs(incomeDeltaPct))} lager dan ${incomeCompare.previousLabel} (${formatCurrency(incomeDelta)}).`,
                impact: Math.max(incomeDelta * 0.2, 0),
                confidence: 0.83,
                reason: 'income-trend'
            });
        }
    }

    // Concentration / cut suggestions skip housing and taxes (not actionable short-term).
    const actionableTransactions = (transactions || []).filter((transaction) => (
        !NON_ACTIONABLE_CATEGORIES.has(transaction.category)
    ));
    const categoryExpenses = buildExpenseByCategory(actionableTransactions);
    const topCategory = Object.entries(categoryExpenses).sort((a, b) => b[1] - a[1])[0];
    if (topCategory && kpis.expenses > 0.01) {
        const topCategoryShare = (topCategory[1] / kpis.expenses) * 100;
        if (topCategoryShare > 38) {
            pushAction({
                priority: 2,
                title: 'Verminder categorie-concentratie',
                summary: `${topCategory[0]} is ${formatPercent(topCategoryShare)} van alle uitgaven (${formatCurrency(topCategory[1])}).`,
                impact: topCategory[1] * 0.1,
                confidence: 0.81,
                reason: 'category-concentration'
            });
        }
    }

    const topMerchantRow = netSpendingByMerchant(actionableTransactions)[0];
    const topMerchant = topMerchantRow ? [topMerchantRow.label, topMerchantRow.amount] : null;
    if (topMerchant && kpis.expenses > 0.01) {
        const share = (topMerchant[1] / kpis.expenses) * 100;
        if (share > 25) {
            pushAction({
                priority: 3,
                title: 'Verlaag afhankelijkheid van één tegenrekening',
                summary: `${topMerchant[0]} is ${formatPercent(share)} van alle uitgaven (${formatCurrency(topMerchant[1])}).`,
                impact: topMerchant[1] * 0.08,
                confidence: 0.72,
                reason: 'merchant-concentration'
            });
        }
    }

    const recurring = summarizeRecurringCosts(transactions);
    const actionableRecurring = recurring.rows.filter((row) => !NON_ACTIONABLE_CATEGORIES.has(row.category));
    const recurringTop = actionableRecurring[0];
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
    const recurringMonthlyTotal = actionableRecurring.reduce((sum, row) => sum + (row.avgMonthly || 0), 0);
    if (avgMonthlyExpenses > 0.01) {
        const recurringShare = recurringMonthlyTotal / avgMonthlyExpenses;
        if (recurringShare > 0.45 && recurringMonthlyTotal > baseImpactFloor * 2) {
            pushAction({
                priority: 1,
                title: 'Verlaag structurele vaste lasten',
                summary: `Terugkerende kosten (excl. wonen/belastingen) zijn circa ${formatPercent((recurringShare * 100))} van de gemiddelde maanduitgaven (${formatCurrency(recurringMonthlyTotal)}).`,
                impact: recurringMonthlyTotal * 0.1,
                confidence: 0.86,
                reason: 'recurring-structure'
            });
        }
    }

    const concreteLevers = buildConcreteCostLevers(transactions, {
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
                summary: `${lever.label} is ${formatPercent(((lever.share || 0) * 100))} van de uitgaven (gem. ${formatCurrency(lever.baselineMonthly)}/mnd). Richt op ~${(lever.targetCutPct * 100).toFixed(0)}% reductie.`,
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
            summary: `${lever.label} vertegenwoordigt ${formatPercent((lever.share * 100))} van de uitgaven (gem. ${formatCurrency(lever.baselineMonthly)}/mnd). Doel: ~${(lever.targetCutPct * 100).toFixed(0)}% lager.`,
            impact: lever.expectedMonthly,
            confidence: 0.76,
            reason: 'lever-merchant',
            playbook: `Vergelijk alternatief/abonnement en stuur op minstens ${formatCurrency(lever.expectedMonthly)} lagere maandlast.`
        });
    });

    const volatility = computeWeeklySpendingVolatility(transactions);
    if (volatility.label === 'Hoog' && volatility.mean > 50) {
        pushAction({
            priority: 3,
            title: 'Verminder uitgavenvolatiliteit',
            summary: `Variabele uitgaven per week schommelen sterk (${(volatility.cv * 100).toFixed(0)}% van het gemiddelde van ${formatCurrency(volatility.mean)}/week).`,
            impact: volatility.std * 0.25 * (AVG_DAYS_PER_MONTH / 7),
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
            summary: `Laatste maand is netto negatief (${formatPercent(latest.savingsPct)}).`,
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

    const NA = 'n.v.t.';
    const expenseByCategory = buildExpenseByCategory(data);
    const biggest = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1])[0];
    if (biggestCategory) {
        biggestCategory.textContent = biggest ? `${biggest[0]} (${formatCurrency(biggest[1])})` : NA;
    }

    // Per calendar day over the selected period (from the first transaction if later).
    const totalExpenses = calculateKPIs(data).expenses;
    if (avgDaily) avgDaily.textContent = data.length ? formatCurrency(totalExpenses / periodDaysCovered(data)) : NA;

    const volatility = computeWeeklySpendingVolatility(data);
    if (spendVolatility) {
        spendVolatility.textContent = volatility.label === NA
            ? NA
            : `${volatility.label} (${(volatility.cv * 100).toFixed(0)}%)`;
    }

    const daily = buildDailyTotals(data);
    const expensive = [...daily].sort((a, b) => b.expenses - a.expenses)[0];
    if (expensiveDay) {
        expensiveDay.textContent = expensive ? `${expensive.date.toLocaleDateString('nl-NL')} (${formatCurrency(expensive.expenses)})` : NA;
    }

    // Latest complete month vs the complete month(s) before it.
    const expenseCompare = compareLatestCompleteMonth(data, (row) => row.expenses);
    if (trendInsight) {
        if (!expenseCompare || expenseCompare.changePct === null) {
            trendInsight.textContent = `${NA} (minder dan 2 volledige maanden in de periode)`;
        } else {
            const change = expenseCompare.changePct;
            const direction = change <= 0 ? 'lager' : 'hoger';
            const latestSpend = buildExpenseByCategory(
                transactionsInMonths(data, [expenseCompare.latest.monthKey])
                    .filter((transaction) => !NON_ACTIONABLE_CATEGORIES.has(transaction.category))
            );
            const biggestActionable = Object.entries(latestSpend).sort((a, b) => b[1] - a[1])[0];
            const action = change > 10 && biggestActionable
                ? `Actie: beperk ${biggestActionable[0]} met ~${formatCurrency(biggestActionable[1] * 0.1)}/mnd`
                : 'Actie: houd dit niveau vast';
            trendInsight.textContent = `Uitgaven ${expenseCompare.latest.monthLabel} ${formatPercent(Math.abs(change))} ${direction} dan ${expenseCompare.previousLabel}. ${action}.`;
        }
    }

    const liquidBalance = balanceMetrics
        ? (Number(balanceMetrics.totals.checking) || 0) + (Number(balanceMetrics.totals.savings) || 0)
        : null;
    const dailyBurn = computeDailyBurn(data);

    if (liquidityRunway) {
        if (liquidBalance === null) {
            liquidityRunway.textContent = NA;
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
            needsVsWants.textContent = NA;
        } else {
            const essentialShare = (needsSummary.essentialTotal / totalNeedsWants) * 100;
            needsVsWants.textContent = `${formatPercent(essentialShare)} noodzakelijk`;
        }
    }

    const monthlyBudget = summarizeMonthlyBudgetDiscipline(data, 6);
    const latestBudget = latestCompleteBudgetMonth(monthlyBudget);
    if (budgetRuleFit) {
        if (!latestBudget) {
            budgetRuleFit.textContent = NA;
        } else {
            budgetRuleFit.textContent = `N ${latestBudget.essentialsPct.toFixed(0)} / V ${latestBudget.discretionaryPct.toFixed(0)} / O ${latestBudget.savingsPct.toFixed(0)}`;
            budgetRuleFit.title = `Noodzakelijk / vrij besteedbaar / overgehouden in % van het inkomen, ${latestBudget.monthLabel}.`;
        }
    }

    const merchantsSorted = netSpendingByMerchant(data).map((row) => [row.label, row.amount]);
    if (topMerchantShare) {
        if (!merchantsSorted.length || kpis.expenses <= 0) {
            topMerchantShare.textContent = NA;
        } else {
            const [merchantName, merchantTotal] = merchantsSorted[0];
            const share = (merchantTotal / kpis.expenses) * 100;
            topMerchantShare.textContent = `${merchantName} (${formatPercent(share)})`;
        }
    }

    const recurring = summarizeRecurringCosts(data);
    if (recurringCosts) {
        if (!recurring.rows.length) {
            recurringCosts.textContent = NA;
        } else {
            const recurringMonthly = recurring.rows.reduce((sum, row) => sum + row.avgMonthly, 0);
            recurringCosts.textContent = `${formatCurrency(recurringMonthly)}/mnd`;
        }
    }

    if (projectedMonthNet) {
        const projection = projectCurrentMonthNet(data);
        if (!projection) {
            projectedMonthNet.textContent = NA;
        } else {
            projectedMonthNet.textContent = formatCurrency(projection.projected);
            projectedMonthNet.title = `Tot nu toe ${formatCurrency(projection.monthToDate)}, verwacht rest van de maand ${formatCurrency(projection.rest)} (basis: ${projection.basis}).`;
        }
    }

    const actionPlan = buildActionPlan(data, kpis, liquidBalance, dailyBurn);
    if (nextBestAction) {
        const topAction = actionPlan[0];
        if (!topAction) {
            nextBestAction.textContent = NA;
        } else {
            const confidencePct = Math.round((Number(topAction.confidence) || 0.75) * 100);
            nextBestAction.textContent = topAction.impact > 0.01
                ? `P${topAction.priority} · ${topAction.title} (${formatCurrency(topAction.impact)}) · ${confidencePct}%`
                : `P${topAction.priority} · ${topAction.title} · ${confidencePct}%`;
        }
    }

    if (dataQualityScore) {
        if (!qualitySummary || !qualitySummary.metrics || !qualitySummary.metrics.total_transactions) {
            dataQualityScore.textContent = NA;
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
    isLoading = true;
    document.getElementById('loading-screen')?.classList.remove('hidden');
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.style.display = 'none';
}

function hideLoading() {
    isLoading = false;
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
    } else {
        destroyParticles();
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

    const container = document.getElementById('particles-js');
    if (!container) return;

    // If particles.js thinks an instance exists but the canvas is gone, reset stale state.
    const hasCanvas = Boolean(container.querySelector('canvas'));
    if (window.pJSDom && window.pJSDom.length > 0 && hasCanvas) return;
    if (window.pJSDom && window.pJSDom.length > 0 && !hasCanvas) {
        window.pJSDom = [];
    }

    // Ensure the container starts clean before creating a new instance.
    container.innerHTML = '';
    
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

    document.body.classList.add('particles-active');
}

function destroyParticles() {
    const container = document.getElementById('particles-js');

    if (window.pJSDom && window.pJSDom.length > 0) {
        window.pJSDom.forEach((instance) => {
            try {
                instance?.pJS?.fn?.vendors?.destroypJS?.();
            } catch (error) {
                console.warn('Particles destroy warning:', error);
            }
        });
        window.pJSDom = [];
    }

    if (container) {
        container.innerHTML = '';
    }

    document.body.classList.remove('particles-active');
}

function playRacingAnimation() {
    const slider = document.getElementById('raceSlider');
    const button = document.getElementById('playRace');
    if (!slider || !racingData || !racingData.frames || racingData.frames.length <= 0) return;
    
    if (racingPlayInterval) {
        clearInterval(racingPlayInterval);
        racingPlayInterval = null;
        button?.classList.remove('active');
        return;
    }

    let current = parseInt(slider.value, 10);
    const maxFrame = parseInt(slider.max, 10);
    if (current >= maxFrame) {
        current = 0;
        slider.value = '0';
        updateRacingChart(0);
    }
    
    button?.classList.add('active');
    racingPlayInterval = setInterval(() => {
        const currentFrame = parseInt(slider.value, 10);
        if (currentFrame >= maxFrame) {
            clearInterval(racingPlayInterval);
            racingPlayInterval = null;
            button?.classList.remove('active');
            return;
        }
        slider.value = String(currentFrame + 1);
        updateRacingChart(currentFrame + 1);
    }, Math.round(1000 / RACING_ANIMATION_FPS));
}

console.log('✅ Bunq Dashboard Ready (Session Auth - No localStorage credentials)!');
