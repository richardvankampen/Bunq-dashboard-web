#!/usr/bin/env python3
"""
Bunq Dashboard API Proxy - Secure Edition v3.0
Flask backend with SESSION-BASED authentication
READ-ONLY Bunq API access for maximum security
SECURED with session cookies and rate limiting
"""

from flask import Flask, jsonify, request, Response, session, make_response, send_from_directory, abort
from flask_cors import CORS
from flask_caching import Cache
from functools import wraps
from bunq.sdk.context.api_context import ApiContext
from bunq.sdk.context.api_environment_type import ApiEnvironmentType
from bunq.sdk.context.bunq_context import BunqContext
from bunq.sdk.model.generated import endpoint
from datetime import datetime, timedelta, timezone
import os
import json
import requests
import logging
import hashlib
import time
import secrets
import uuid
import importlib
import pkgutil
import inspect
from collections import defaultdict

# ============================================
# LOGGING CONFIGURATION
# ============================================

APP_DIR = os.path.abspath(os.path.dirname(__file__))
LOG_DIR = os.path.join(APP_DIR, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=os.getenv('LOG_LEVEL', 'INFO'),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, 'bunq_api.log')),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

def get_int_env(name, default):
    value = os.getenv(name)
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning(f"⚠️ Invalid {name}='{value}', using default {default}")
        return default

_MONETARY_ACCOUNT_ENDPOINT = None

def resolve_monetary_account_endpoint():
    """Resolve the monetary account endpoint class across bunq-sdk variants."""
    global _MONETARY_ACCOUNT_ENDPOINT

    if _MONETARY_ACCOUNT_ENDPOINT is not None:
        return _MONETARY_ACCOUNT_ENDPOINT

    def _has_zero_required_positional_args(callable_obj):
        try:
            signature = inspect.signature(callable_obj)
        except (TypeError, ValueError):
            return False

        for parameter in signature.parameters.values():
            if parameter.kind not in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
                continue
            if parameter.default is inspect.Parameter.empty:
                return False
        return True

    def _is_monetary_list_endpoint(name, candidate):
        if candidate is None:
            return False
        if not callable(getattr(candidate, 'list', None)):
            return False
        normalized = name.lower().replace('_', '')
        if not normalized.startswith('monetaryaccount'):
            return False
        return _has_zero_required_positional_args(candidate.list)

    direct_candidates = ('MonetaryAccountBank', 'MonetaryAccount')
    for name in direct_candidates:
        candidate = getattr(endpoint, name, None)
        if _is_monetary_list_endpoint(name, candidate):
            _MONETARY_ACCOUNT_ENDPOINT = candidate
            logger.info(f"Using bunq endpoint class: {name}")
            return _MONETARY_ACCOUNT_ENDPOINT

    # Some sdk variants export differently named endpoint classes directly on `endpoint`.
    for attr_name in dir(endpoint):
        candidate = getattr(endpoint, attr_name, None)
        if _is_monetary_list_endpoint(attr_name, candidate):
            _MONETARY_ACCOUNT_ENDPOINT = candidate
            logger.info(f"Using bunq endpoint class: {attr_name}")
            return _MONETARY_ACCOUNT_ENDPOINT

    endpoint_path = getattr(endpoint, '__path__', None)
    if endpoint_path:
        base_module = endpoint.__name__
        for module_info in pkgutil.iter_modules(endpoint_path):
            module_name = module_info.name
            normalized_module = module_name.lower().replace('_', '')
            if not normalized_module.startswith('monetaryaccount'):
                continue
            try:
                module = importlib.import_module(f"{base_module}.{module_name}")
            except Exception:
                continue
            for class_name in dir(module):
                candidate = getattr(module, class_name, None)
                if _is_monetary_list_endpoint(class_name, candidate):
                    _MONETARY_ACCOUNT_ENDPOINT = candidate
                    logger.info(f"Using bunq endpoint class: {module_name}.{class_name}")
                    return _MONETARY_ACCOUNT_ENDPOINT

    raise RuntimeError('bunq-sdk missing monetary account endpoint')

def list_monetary_accounts():
    """Return monetary accounts with bunq-sdk compatibility across versions."""
    account_endpoint = resolve_monetary_account_endpoint()
    return account_endpoint.list().value

# ============================================
# SECRET HELPERS (Docker Swarm secrets)
# ============================================

def read_secret(name):
    path = f"/run/secrets/{name}"
    try:
        with open(path, "r", encoding="utf-8") as file:
            return file.read().strip()
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.warning(f"⚠️ Failed to read secret '{name}': {exc}")
        return None

def get_config(key, default=None, secret_name=None):
    if secret_name:
        secret_value = read_secret(secret_name)
        if secret_value:
            return secret_value
    env_value = os.getenv(key)
    if env_value is not None and env_value != "":
        return env_value
    return default

def has_config(key, secret_name=None):
    if secret_name and read_secret(secret_name):
        return True
    return bool(os.getenv(key))

def get_vaultwarden_device_identifier():
    env_value = os.getenv('VAULTWARDEN_DEVICE_IDENTIFIER')
    if env_value:
        return env_value.strip()

    device_id_path = os.path.join('config', 'vaultwarden_device_id')
    try:
        with open(device_id_path, "r", encoding="utf-8") as file:
            stored = file.read().strip()
            if stored:
                return stored
    except FileNotFoundError:
        pass
    except Exception as exc:
        logger.warning(f"⚠️ Failed to read Vaultwarden device identifier: {exc}")

    new_id = str(uuid.uuid4())
    try:
        os.makedirs(os.path.dirname(device_id_path), exist_ok=True)
        with open(device_id_path, "w", encoding="utf-8") as file:
            file.write(new_id)
    except Exception as exc:
        logger.warning(f"⚠️ Failed to persist Vaultwarden device identifier: {exc}")
    return new_id

# ============================================
# FLASK APP INITIALIZATION
# ============================================

app = Flask(__name__)
STATIC_DIR = APP_DIR
STATIC_FILES = {'index.html', 'styles.css', 'app.js'}

# Simple in-memory cache (per process)
CACHE_ENABLED = os.getenv('CACHE_ENABLED', 'true').lower() == 'true'
CACHE_TTL_SECONDS = get_int_env('CACHE_TTL_SECONDS', 60)
DEFAULT_PAGE_SIZE = get_int_env('DEFAULT_PAGE_SIZE', 500)
MAX_PAGE_SIZE = get_int_env('MAX_PAGE_SIZE', 2000)
MAX_DAYS = get_int_env('MAX_DAYS', 3650)

cache = Cache(app, config={
    'CACHE_TYPE': 'SimpleCache',
    'CACHE_DEFAULT_TIMEOUT': CACHE_TTL_SECONDS
})

# Session configuration - CRITICAL for security
app.config['SECRET_KEY'] = get_config('FLASK_SECRET_KEY', secrets.token_hex(32), 'flask_secret_key')
app.config['SESSION_COOKIE_HTTPONLY'] = True  # Prevents JavaScript access
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'  # HTTPS only
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF protection
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)  # Session expires after 24h

# Log session configuration
logger.info(f"🔐 Session cookie secure: {app.config['SESSION_COOKIE_SECURE']}")
logger.info(f"⏱️  Session lifetime: 24 hours")

# CORS Configuration - WITH CREDENTIALS SUPPORT
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv('ALLOWED_ORIGINS', 'http://localhost:5000').split(',')
    if origin.strip()
]
logger.info(f"🔒 CORS allowed origins: {ALLOWED_ORIGINS}")

CORS(app, 
     origins=ALLOWED_ORIGINS, 
     supports_credentials=True,  # CRITICAL: Allow cookies
     allow_headers=['Content-Type', 'Authorization'],
     expose_headers=['Content-Type'])

# ============================================
# SECURITY: SESSION-BASED AUTHENTICATION
# ============================================

def check_credentials(username, password):
    """
    Verify username and password against environment variables.
    Uses constant-time comparison to prevent timing attacks.
    """
    expected_username = os.getenv('BASIC_AUTH_USERNAME', 'admin')
    expected_password = get_config('BASIC_AUTH_PASSWORD', '', 'basic_auth_password')
    
    # If no password set, deny all access
    if not expected_password:
        logger.error("❌ No BASIC_AUTH_PASSWORD set (env or secret)!")
        return False
    
    # Constant-time comparison to prevent timing attacks
    username_match = secrets.compare_digest(username, expected_username)
    password_match = secrets.compare_digest(password, expected_password)
    
    return username_match and password_match

def requires_auth(f):
    """
    Decorator for endpoints that require authentication.
    Checks if user has valid session.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        # Check if user is logged in (has valid session)
        if not session.get('authenticated'):
            logger.warning(f"🚫 Unauthorized access attempt from {request.remote_addr}")
            return jsonify({
                'success': False,
                'error': 'Not authenticated. Please login first.',
                'login_required': True
            }), 401
        
        # Optional: Check session expiry
        if session.get('expires_at'):
            if datetime.fromisoformat(session['expires_at']) < datetime.now():
                session.clear()
                logger.info(f"⏱️  Session expired for {request.remote_addr}")
                return jsonify({
                    'success': False,
                    'error': 'Session expired. Please login again.',
                    'login_required': True
                }), 401
        
        return f(*args, **kwargs)
    return decorated

# ============================================
# SECURITY: RATE LIMITING
# ============================================

class RateLimiter:
    """Simple in-memory rate limiter"""
    
    def __init__(self, max_requests=30, window_seconds=60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)
        self.login_attempts = defaultdict(list)  # Separate tracking for login
    
    def is_allowed(self, client_id, endpoint='general'):
        """Check if client is allowed to make request"""
        now = time.time()
        window_start = now - self.window_seconds
        
        # Choose appropriate tracking dict
        tracking = self.login_attempts if endpoint == 'login' else self.requests
        
        # Clean old requests
        tracking[client_id] = [
            req_time for req_time in tracking[client_id]
            if req_time > window_start
        ]
        
        # Different limits for login (stricter)
        max_reqs = 5 if endpoint == 'login' else self.max_requests
        
        # Check limit
        if len(tracking[client_id]) >= max_reqs:
            return False
        
        # Record request
        tracking[client_id].append(now)
        return True

rate_limiter = RateLimiter(max_requests=30, window_seconds=60)

def rate_limit(endpoint='general'):
    """Decorator factory for rate limiting"""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            client_id = request.remote_addr
            
            if not rate_limiter.is_allowed(client_id, endpoint):
                logger.warning(f"🚫 Rate limit exceeded for {client_id} on {endpoint}")
                return jsonify({
                    'success': False,
                    'error': 'Rate limit exceeded. Please try again later.'
                }), 429
            
            return f(*args, **kwargs)
        return decorated
    return decorator

# ============================================
# PERFORMANCE: CACHE + PAGINATION HELPERS
# ============================================

def cache_allowed():
    if not CACHE_ENABLED:
        return False
    cache_param = request.args.get('cache', 'true').lower()
    return cache_param not in ('0', 'false', 'no')

def make_cache_key(prefix):
    user = session.get('username', 'anon')
    args = '&'.join(
        [f"{k}={v}" for k, v in sorted(request.args.items()) if k != 'cache']
    )
    return f"{prefix}:{user}:{args}"

def parse_pagination():
    """Parse pagination parameters from query string."""
    if 'limit' in request.args or 'offset' in request.args:
        limit = min(int(request.args.get('limit', DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE)
        offset = max(int(request.args.get('offset', 0)), 0)
        page = offset // limit + 1 if limit > 0 else 1
    else:
        page = max(int(request.args.get('page', 1)), 1)
        page_size = min(int(request.args.get('page_size', DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE)
        limit = page_size
        offset = (page - 1) * page_size
    
    sort = request.args.get('sort', 'desc').lower()
    if sort not in ('asc', 'desc'):
        sort = 'desc'
    
    return limit, offset, page, sort

def clamp_days(days):
    try:
        days_int = int(days)
    except (TypeError, ValueError):
        return 90
    if days_int <= 0:
        return 90
    return min(days_int, MAX_DAYS)

def parse_bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')

def extract_own_ibans(accounts):
    """Extract own IBANs from Bunq accounts for internal transfer detection."""
    ibans = set()
    for account in accounts:
        aliases = getattr(account, 'alias', None) or []
        for alias in aliases:
            alias_type = getattr(alias, 'type', None)
            alias_value = getattr(alias, 'value', None)
            if alias_type == 'IBAN' and alias_value:
                ibans.add(alias_value)
    return ibans

# ============================================
# AUTHENTICATION ENDPOINTS
# ============================================

@app.route('/api/auth/login', methods=['POST'])
@rate_limit('login')  # Stricter rate limit for login: 5 attempts per minute
def login():
    """
    Login endpoint - creates session on successful authentication
    
    Request body:
    {
        "username": "admin",
        "password": "your_password"
    }
    
    Response:
    {
        "success": true,
        "message": "Login successful",
        "username": "admin",
        "expires_in": 86400
    }
    """
    try:
        data = request.get_json()
        
        if not data or 'username' not in data or 'password' not in data:
            logger.warning(f"🚫 Invalid login request from {request.remote_addr}")
            return jsonify({
                'success': False,
                'error': 'Username and password required'
            }), 400
        
        username = data['username']
        password = data['password']
        
        # Verify credentials
        if check_credentials(username, password):
            # Create session
            session.clear()  # Clear any existing session
            session['authenticated'] = True
            session['username'] = username
            session['login_time'] = datetime.now().isoformat()
            session['expires_at'] = (datetime.now() + timedelta(hours=24)).isoformat()
            session.permanent = True  # Use PERMANENT_SESSION_LIFETIME
            
            logger.info(f"✅ Successful login: {username} from {request.remote_addr}")
            
            response = make_response(jsonify({
                'success': True,
                'message': 'Login successful',
                'username': username,
                'expires_in': 86400  # 24 hours in seconds
            }))
            
            return response, 200
        
        else:
            logger.warning(f"🚫 Failed login attempt: {username} from {request.remote_addr}")
            return jsonify({
                'success': False,
                'error': 'Invalid username or password'
            }), 401
            
    except Exception as e:
        logger.error(f"❌ Login error: {e}")
        return jsonify({
            'success': False,
            'error': 'Login failed'
        }), 500

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """Logout endpoint - destroys session"""
    username = session.get('username', 'unknown')
    session.clear()
    logger.info(f"👋 Logout: {username} from {request.remote_addr}")
    
    return jsonify({
        'success': True,
        'message': 'Logged out successfully'
    }), 200

@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    """Check if user is authenticated and get session info"""
    if session.get('authenticated'):
        return jsonify({
            'authenticated': True,
            'username': session.get('username'),
            'login_time': session.get('login_time'),
            'expires_at': session.get('expires_at')
        }), 200
    else:
        return jsonify({
            'authenticated': False
        }), 200

# ============================================
# VAULTWARDEN SECRET RETRIEVAL
# ============================================

def get_api_key_from_vaultwarden():
    """
    Securely retrieve Bunq API key from Vaultwarden vault.
    
    Returns:
        str: Bunq API key or None if retrieval failed
    """
    
    use_vaultwarden = os.getenv('USE_VAULTWARDEN', 'false').lower() == 'true'
    
    if not use_vaultwarden:
        logger.info("📝 Vaultwarden disabled, using direct API key (env or secret)")
        api_key = get_config('BUNQ_API_KEY', '', 'bunq_api_key')
        if api_key:
            logger.info("✅ API key loaded from env/secret")
        return api_key
    
    logger.info("🔐 Retrieving API key from Vaultwarden vault...")
    
    vault_url = os.getenv('VAULTWARDEN_URL', 'http://vaultwarden:80')
    client_id = get_config('VAULTWARDEN_CLIENT_ID', None, 'vaultwarden_client_id')
    client_secret = get_config('VAULTWARDEN_CLIENT_SECRET', None, 'vaultwarden_client_secret')
    item_name = os.getenv('VAULTWARDEN_ITEM_NAME', 'Bunq API Key')
    
    if not client_id or not client_secret:
        logger.error("❌ Vaultwarden credentials missing (env or secret)!")
        return None
    
    try:
        # Step 1: Authenticate
        logger.info("🔑 Authenticating with Vaultwarden...")
        token_url = f"{vault_url}/identity/connect/token"
        device_identifier = get_vaultwarden_device_identifier()
        device_name = os.getenv('VAULTWARDEN_DEVICE_NAME', 'Bunq Dashboard').strip()
        device_type = os.getenv('VAULTWARDEN_DEVICE_TYPE', '22').strip()
        token_data = {
            'grant_type': 'client_credentials',
            'scope': 'api',
            'client_id': client_id,
            'client_secret': client_secret,
            # Some Vaultwarden/Bitwarden servers require these fields
            'deviceType': device_type,
            'deviceIdentifier': device_identifier,
            'deviceName': device_name
        }
        
        token_response = requests.post(token_url, data=token_data, timeout=10)
        token_response.raise_for_status()
        access_token = token_response.json()['access_token']
        
        logger.info("✅ Vaultwarden authentication successful")
        
        # Step 2: Retrieve vault items
        logger.info(f"🔍 Searching for vault item: '{item_name}'...")
        items_url = f"{vault_url}/api/ciphers"
        headers = {'Authorization': f'Bearer {access_token}'}
        
        items_response = requests.get(items_url, headers=headers, timeout=10)
        items_response.raise_for_status()
        items = items_response.json().get('data', [])
        
        # Step 3: Find API key
        for item in items:
            if item.get('name') == item_name and item.get('type') == 1:
                login_data = item.get('login', {})
                api_key = login_data.get('password')
                
                if api_key:
                    logger.info("✅ API key retrieved from vault")
                    return api_key
                else:
                    logger.error(f"❌ Item '{item_name}' found but password field is empty!")
                    return None
        
        logger.error(f"❌ Item '{item_name}' not found in vault!")
        return None
        
    except Exception as e:
        logger.error(f"❌ Vaultwarden error: {e}")
        return None

# ============================================
# CONFIGURATION
# ============================================

API_KEY = get_api_key_from_vaultwarden()
CONFIG_FILE = 'config/bunq_production.conf'
ENVIRONMENT_LABEL = os.getenv('BUNQ_ENVIRONMENT', 'PRODUCTION').strip().upper()
if ENVIRONMENT_LABEL not in ('PRODUCTION', 'SANDBOX'):
    logger.warning(f"⚠️ Unknown BUNQ_ENVIRONMENT '{ENVIRONMENT_LABEL}', defaulting to PRODUCTION")
    ENVIRONMENT_LABEL = 'PRODUCTION'

ENVIRONMENT_TYPE = ApiEnvironmentType.SANDBOX if ENVIRONMENT_LABEL == 'SANDBOX' else ApiEnvironmentType.PRODUCTION

# Validate configuration
if not API_KEY:
    logger.error("❌ No valid API key found!")

if not has_config('BASIC_AUTH_PASSWORD', 'basic_auth_password'):
    logger.error("⚠️⚠️⚠️ WARNING: No BASIC_AUTH_PASSWORD set!")
    logger.error("⚠️ Authentication is NOT configured!")

if not has_config('FLASK_SECRET_KEY', 'flask_secret_key'):
    logger.warning("⚠️ Using auto-generated FLASK_SECRET_KEY - sessions will reset on restart!")
    logger.warning("⚠️ Set FLASK_SECRET_KEY via Docker secret for persistent sessions")

# ============================================
# BUNQ API INITIALIZATION
# ============================================

def init_bunq():
    """Initialize Bunq API context with READ-ONLY access"""
    if not API_KEY:
        logger.warning("⚠️ No API key available, running in demo mode only")
        return False
    
    try:
        if not os.path.exists(CONFIG_FILE):
            logger.info("🔄 Creating new Bunq API context...")
            # Use positional args for compatibility across bunq-sdk versions
            api_context = ApiContext.create(
                ENVIRONMENT_TYPE,
                API_KEY,
                "Bunq Dashboard (READ-ONLY)"
            )
            api_context.save(CONFIG_FILE)
            logger.info("✅ Bunq API context created and saved")
        else:
            logger.info("🔄 Restoring existing Bunq API context...")
            api_context = ApiContext.restore(CONFIG_FILE)
            logger.info("✅ Bunq API context restored")
        
        BunqContext.load_api_context(api_context)
        logger.info("✅ Bunq API initialized successfully")
        logger.info(f"   Environment: {ENVIRONMENT_LABEL}")
        logger.info(f"   Access Level: READ-ONLY")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize Bunq API: {e}")
        return False

# ============================================
# API ENDPOINTS (PROTECTED)
# ============================================

@app.route('/', methods=['GET'])
def serve_index():
    """Serve the dashboard frontend"""
    return send_from_directory(STATIC_DIR, 'index.html')

@app.route('/<path:filename>', methods=['GET'])
def serve_static(filename):
    """Serve static assets for the dashboard"""
    if filename in STATIC_FILES:
        return send_from_directory(STATIC_DIR, filename)
    return abort(404)

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint - NO AUTH REQUIRED"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'version': '3.0.0-session-auth',
        'api_status': 'initialized' if API_KEY else 'demo_mode',
        'security': {
            'type': 'session-based',
            'rate_limiting': True,
            'https_only': app.config['SESSION_COOKIE_SECURE']
        },
        'auth_configured': has_config('BASIC_AUTH_PASSWORD', 'basic_auth_password')
    })

@app.route('/api/accounts', methods=['GET'])
@requires_auth
@rate_limit('general')
def get_accounts():
    """Get all Bunq accounts (READ-ONLY) - SESSION AUTH REQUIRED"""
    if not API_KEY:
        return jsonify({
            'success': False,
            'error': 'Demo mode - configure API key'
        }), 503
    
    try:
        cache_key = make_cache_key('accounts')
        if cache_allowed():
            cached = cache.get(cache_key)
            if cached:
                return jsonify(cached)
        
        logger.info(f"📊 Fetching accounts for {session.get('username')}")
        accounts = list_monetary_accounts()
        
        accounts_data = []
        for account in accounts:
            accounts_data.append({
                'id': account.id_,
                'description': account.description,
                'balance': {
                    'value': float(account.balance.value),
                    'currency': account.balance.currency
                },
                'status': account.status
            })
        
        logger.info(f"✅ Retrieved {len(accounts_data)} accounts")
        response = {
            'success': True,
            'data': accounts_data,
            'count': len(accounts_data)
        }
        
        if cache_allowed():
            cache.set(cache_key, response, timeout=CACHE_TTL_SECONDS)
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"❌ Error fetching accounts: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/transactions', methods=['GET'])
@requires_auth
@rate_limit('general')
def get_transactions():
    """Get transactions - SESSION AUTH REQUIRED"""
    if not API_KEY:
        return jsonify({
            'success': False,
            'error': 'Demo mode - configure API key'
        }), 503
    
    try:
        account_id = request.args.get('account_id')
        account_ids_param = request.args.get('account_ids')
        days = clamp_days(request.args.get('days', 90))
        limit, offset, page, sort = parse_pagination()
        sort_desc = sort == 'desc'
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        exclude_internal = parse_bool(request.args.get('exclude_internal'), default=False)
        
        cache_key = make_cache_key('transactions')
        if cache_allowed():
            cached = cache.get(cache_key)
            if cached:
                return jsonify(cached)
        
        logger.info(f"📊 Fetching transactions (last {days} days) for {session.get('username')}")
        
        accounts = list_monetary_accounts()
        accounts_by_id = {str(acc.id_): acc for acc in accounts}
        own_ibans = extract_own_ibans(accounts)
        
        target_ids = None
        if account_id:
            target_ids = [str(account_id)]
        elif account_ids_param:
            target_ids = [part.strip() for part in account_ids_param.split(',') if part.strip()]
        
        if target_ids:
            selected_accounts = [accounts_by_id[acc_id] for acc_id in target_ids if acc_id in accounts_by_id]
        else:
            selected_accounts = accounts
        
        all_transactions = []
        for account in selected_accounts:
            transactions = get_account_transactions(
                account.id_,
                cutoff_date,
                sort_desc,
                own_ibans,
                account.description
            )
            all_transactions.extend(transactions)
        
        if exclude_internal:
            all_transactions = [t for t in all_transactions if not t.get('is_internal_transfer')]
        
        all_transactions.sort(key=lambda t: t['date'], reverse=sort_desc)
        total_count = len(all_transactions)
        paged = all_transactions[offset:offset + limit]
        
        logger.info(f"✅ Retrieved {total_count} transactions (page {page})")
        response = {
            'success': True,
            'data': paged,
            'count': total_count,
            'page': page,
            'page_size': limit,
            'sort': sort
        }
        
        if cache_allowed():
            cache.set(cache_key, response, timeout=CACHE_TTL_SECONDS)
        
        return jsonify(response)
            
    except Exception as e:
        logger.error(f"❌ Error fetching transactions: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def get_account_transactions(account_id, cutoff_date=None, sort_desc=True, own_ibans=None, account_name=None):
    """Get transactions for specific account"""
    payments = endpoint.Payment.list(monetary_account_id=account_id).value
    transactions = []
    own_ibans = own_ibans or set()
    
    for payment in payments:
        created = datetime.fromisoformat(payment.created.replace('Z', '+00:00'))
        
        if cutoff_date and created < cutoff_date:
            if sort_desc:
                break
            continue
        
        is_internal_transfer = False
        counterparty_alias = payment.counterparty_alias
        if counterparty_alias:
            alias_type = getattr(counterparty_alias, 'type', None)
            alias_value = getattr(counterparty_alias, 'value', None)
            if alias_type == 'IBAN' and alias_value in own_ibans:
                is_internal_transfer = True
        
        category = categorize_transaction(payment.description, counterparty_alias, is_internal_transfer)
        
        transactions.append({
            'id': payment.id_,
            'date': created.isoformat(),
            'amount': float(payment.amount.value),
            'currency': payment.amount.currency,
            'description': payment.description,
            'counterparty': payment.counterparty_alias.display_name if payment.counterparty_alias else 'Unknown',
            'merchant': payment.merchant_reference if hasattr(payment, 'merchant_reference') else None,
            'category': category,
            'type': payment.type_,
            'account_id': account_id,
            'account_name': account_name,
            'is_internal_transfer': is_internal_transfer
        })
    
    return transactions

def categorize_transaction(description, counterparty, is_internal=False):
    """Simple rule-based categorization"""
    if is_internal:
        return 'Internal Transfer'
    desc_lower = description.lower() if description else ''
    counter_lower = counterparty.display_name.lower() if counterparty and counterparty.display_name else ''
    combined = desc_lower + ' ' + counter_lower
    
    if any(word in combined for word in ['albert heijn', 'ah ', 'jumbo', 'lidl', 'aldi', 'plus', 'supermarkt']):
        return 'Boodschappen'
    elif any(word in combined for word in ['restaurant', 'cafe', 'bar', 'pizza', 'burger', 'starbucks']):
        return 'Horeca'
    elif any(word in combined for word in ['ns ', 'train', 'bus', 'taxi', 'uber', 'parking', 'shell', 'benzine']):
        return 'Vervoer'
    elif any(word in combined for word in ['huur', 'rent', 'hypotheek', 'mortgage']):
        return 'Wonen'
    elif any(word in combined for word in ['eneco', 'energie', 'gas', 'water', 'ziggo', 'kpn', 'telecom']):
        return 'Utilities'
    elif any(word in combined for word in ['bol.com', 'coolblue', 'mediamarkt', 'zara', 'h&m', 'shop']):
        return 'Shopping'
    elif any(word in combined for word in ['netflix', 'spotify', 'youtube', 'cinema', 'pathé', 'concert']):
        return 'Entertainment'
    elif any(word in combined for word in ['apotheek', 'pharmacy', 'dokter', 'doctor', 'tandarts', 'dentist']):
        return 'Zorg'
    elif any(word in combined for word in ['salaris', 'salary', 'loon', 'wage']):
        return 'Salaris'
    else:
        return 'Overig'

@app.route('/api/statistics', methods=['GET'])
@requires_auth
@rate_limit('general')
def get_statistics():
    """Get aggregated statistics - SESSION AUTH REQUIRED"""
    if not API_KEY:
        return jsonify({
            'success': False,
            'error': 'Demo mode - configure API key'
        }), 503
        
    try:
        days = clamp_days(request.args.get('days', 90))
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        exclude_internal = parse_bool(request.args.get('exclude_internal'), default=False)
        
        cache_key = make_cache_key('statistics')
        if cache_allowed():
            cached = cache.get(cache_key)
            if cached:
                return jsonify(cached)
        
        accounts = list_monetary_accounts()
        own_ibans = extract_own_ibans(accounts)
        all_transactions = []
        
        for account in accounts:
            transactions = get_account_transactions(
                account.id_,
                cutoff_date,
                True,
                own_ibans,
                account.description
            )
            all_transactions.extend(transactions)
        
        if exclude_internal:
            all_transactions = [t for t in all_transactions if not t.get('is_internal_transfer')]
        
        income = sum(t['amount'] for t in all_transactions if t['amount'] > 0)
        expenses = abs(sum(t['amount'] for t in all_transactions if t['amount'] < 0))
        net_savings = income - expenses
        savings_rate = (net_savings / income * 100) if income > 0 else 0
        
        category_totals = {}
        for t in all_transactions:
            if t['amount'] < 0:
                cat = t['category']
                category_totals[cat] = category_totals.get(cat, 0) + abs(t['amount'])
        
        response = {
            'success': True,
            'data': {
                'period_days': days,
                'total_transactions': len(all_transactions),
                'income': income,
                'expenses': expenses,
                'net_savings': net_savings,
                'savings_rate': savings_rate,
                'categories': category_totals,
                'avg_daily_expenses': expenses / days if days > 0 else 0
            }
        }
        
        if cache_allowed():
            cache.set(cache_key, response, timeout=CACHE_TTL_SECONDS)
        
        return jsonify(response)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/demo-data', methods=['GET'])
def get_demo_data():
    """Get demo data - NO AUTH for testing"""
    import random
    from datetime import timedelta
    
    days = int(request.args.get('days', 90))
    categories = ['Boodschappen', 'Horeca', 'Vervoer', 'Wonen', 'Shopping', 'Entertainment']
    merchants = {
        'Boodschappen': ['Albert Heijn', 'Jumbo', 'Lidl'],
        'Horeca': ['Starbucks', 'Restaurant Plaza'],
        'Vervoer': ['NS', 'Shell'],
        'Wonen': ['Verhuurder B.V.'],
        'Shopping': ['Bol.com', 'Coolblue'],
        'Entertainment': ['Netflix', 'Spotify']
    }
    
    transactions = []
    for i in range(days * 3):
        category = random.choice(categories)
        merchant = random.choice(merchants[category])
        amount = -random.randint(10, 100) if category != 'Wonen' else -850
        
        transactions.append({
            'id': i,
            'date': (datetime.now() - timedelta(days=random.randint(0, days))).isoformat(),
            'amount': amount,
            'category': category,
            'merchant': merchant,
            'description': f'{category} - {merchant}'
        })
    
    for i in range(days // 30):
        transactions.append({
            'id': len(transactions),
            'date': (datetime.now() - timedelta(days=i * 30)).isoformat(),
            'amount': 2800,
            'category': 'Salaris',
            'merchant': 'Werkgever B.V.',
            'description': 'Salary'
        })
    
    return jsonify({
        'success': True,
        'data': transactions,
        'count': len(transactions),
        'note': 'Demo data - no authentication required'
    })

if __name__ == '__main__':
    print("🚀 Starting Bunq Dashboard API (SESSION-BASED AUTH)...")
    print(f"📡 Environment: {ENVIRONMENT_LABEL}")
    print(f"🔒 CORS Origins: {ALLOWED_ORIGINS}")
    print(f"🔐 Authentication: {'ENABLED ✅' if has_config('BASIC_AUTH_PASSWORD', 'basic_auth_password') else 'DISABLED ⚠️'}")
    print(f"🍪 Session-based auth with secure cookies")
    print(f"⏱️  Rate Limiting: 30 req/min (general), 5 req/min (login)")
    print(f"🔑 Secret key: {'Set ✅' if has_config('FLASK_SECRET_KEY', 'flask_secret_key') else 'Auto-generated ⚠️'}")
    
    if init_bunq():
        print("✅ Bunq API initialized")
    else:
        print("⚠️ Running in demo mode only")
    
    # Production mode
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=False
    )
