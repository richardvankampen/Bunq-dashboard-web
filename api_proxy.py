#!/usr/bin/env python3
"""
Bunq Dashboard API Proxy - Secure Edition v3.0
Flask backend with SESSION-BASED authentication
READ-ONLY Bunq API access for maximum security
SECURED with session cookies and rate limiting
"""

from flask import Flask, jsonify, request, Response, session, make_response
from flask_cors import CORS
from functools import wraps
from bunq.sdk.context.api_context import ApiContext
from bunq.sdk.context.bunq_context import BunqContext
from bunq.sdk.model.generated import endpoint
from datetime import datetime, timedelta
import os
import json
import requests
import logging
import hashlib
import time
import secrets
from collections import defaultdict

# ============================================
# LOGGING CONFIGURATION
# ============================================

logging.basicConfig(
    level=os.getenv('LOG_LEVEL', 'INFO'),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/bunq_api.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# ============================================
# FLASK APP INITIALIZATION
# ============================================

app = Flask(__name__)

# Session configuration - CRITICAL for security
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', secrets.token_hex(32))
app.config['SESSION_COOKIE_HTTPONLY'] = True  # Prevents JavaScript access
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'  # HTTPS only
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF protection
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)  # Session expires after 24h

# Log session configuration
logger.info(f"🔐 Session cookie secure: {app.config['SESSION_COOKIE_SECURE']}")
logger.info(f"⏱️  Session lifetime: 24 hours")

# CORS Configuration - WITH CREDENTIALS SUPPORT
ALLOWED_ORIGINS = os.getenv('ALLOWED_ORIGINS', 'http://localhost:8000').split(',')
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
    expected_password = os.getenv('BASIC_AUTH_PASSWORD', '')
    
    # If no password set, deny all access
    if not expected_password:
        logger.error("❌ No BASIC_AUTH_PASSWORD set in environment!")
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
        logger.info("📝 Vaultwarden disabled, using environment variable")
        api_key = os.getenv('BUNQ_API_KEY', '')
        if api_key:
            logger.info("✅ API key loaded from environment")
        return api_key
    
    logger.info("🔐 Retrieving API key from Vaultwarden vault...")
    
    vault_url = os.getenv('VAULTWARDEN_URL', 'http://vaultwarden:80')
    client_id = os.getenv('VAULTWARDEN_CLIENT_ID')
    client_secret = os.getenv('VAULTWARDEN_CLIENT_SECRET')
    item_name = os.getenv('VAULTWARDEN_ITEM_NAME', 'Bunq API Key')
    
    if not client_id or not client_secret:
        logger.error("❌ Vaultwarden credentials missing in environment!")
        return None
    
    try:
        # Step 1: Authenticate
        logger.info("🔑 Authenticating with Vaultwarden...")
        token_url = f"{vault_url}/identity/connect/token"
        token_data = {
            'grant_type': 'client_credentials',
            'scope': 'api',
            'client_id': client_id,
            'client_secret': client_secret
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
ENVIRONMENT = os.getenv('BUNQ_ENVIRONMENT', 'PRODUCTION')

# Validate configuration
if not API_KEY:
    logger.error("❌ No valid API key found!")

if not os.getenv('BASIC_AUTH_PASSWORD'):
    logger.error("⚠️⚠️⚠️ WARNING: No BASIC_AUTH_PASSWORD set!")
    logger.error("⚠️ Authentication is NOT configured!")

if not os.getenv('FLASK_SECRET_KEY'):
    logger.warning("⚠️ Using auto-generated FLASK_SECRET_KEY - sessions will reset on restart!")
    logger.warning("⚠️ Set FLASK_SECRET_KEY in .env for persistent sessions")

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
            api_context = ApiContext.create(
                environment_type=ENVIRONMENT,
                api_key=API_KEY,
                device_description="Bunq Dashboard (READ-ONLY)"
            )
            api_context.save(CONFIG_FILE)
            logger.info("✅ Bunq API context created and saved")
        else:
            logger.info("🔄 Restoring existing Bunq API context...")
            api_context = ApiContext.restore(CONFIG_FILE)
            logger.info("✅ Bunq API context restored")
        
        BunqContext.load_api_context(api_context)
        logger.info("✅ Bunq API initialized successfully")
        logger.info(f"   Environment: {ENVIRONMENT}")
        logger.info(f"   Access Level: READ-ONLY")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize Bunq API: {e}")
        return False

# ============================================
# API ENDPOINTS (PROTECTED)
# ============================================

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
        'auth_configured': bool(os.getenv('BASIC_AUTH_PASSWORD'))
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
        logger.info(f"📊 Fetching accounts for {session.get('username')}")
        accounts = endpoint.MonetaryAccountBank.list().value
        
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
        return jsonify({
            'success': True,
            'data': accounts_data,
            'count': len(accounts_data)
        })
        
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
        days = int(request.args.get('days', 90))
        
        logger.info(f"📊 Fetching transactions (last {days} days) for {session.get('username')}")
        
        if not account_id:
            accounts = endpoint.MonetaryAccountBank.list().value
            all_transactions = []
            
            for account in accounts:
                transactions = get_account_transactions(account.id_, days)
                for trans in transactions:
                    trans['account_id'] = account.id_
                    trans['account_name'] = account.description
                all_transactions.extend(transactions)
            
            logger.info(f"✅ Retrieved {len(all_transactions)} transactions")
            return jsonify({
                'success': True,
                'data': all_transactions,
                'count': len(all_transactions)
            })
        else:
            transactions = get_account_transactions(account_id, days)
            return jsonify({
                'success': True,
                'data': transactions,
                'count': len(transactions)
            })
            
    except Exception as e:
        logger.error(f"❌ Error fetching transactions: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def get_account_transactions(account_id, days=90):
    """Get transactions for specific account"""
    payments = endpoint.Payment.list(monetary_account_id=account_id).value
    cutoff_date = datetime.now() - timedelta(days=days)
    transactions = []
    
    for payment in payments:
        created = datetime.fromisoformat(payment.created.replace('Z', '+00:00'))
        
        if created < cutoff_date:
            continue
        
        category = categorize_transaction(payment.description, payment.counterparty_alias)
        
        transactions.append({
            'id': payment.id_,
            'date': created.isoformat(),
            'amount': float(payment.amount.value),
            'currency': payment.amount.currency,
            'description': payment.description,
            'counterparty': payment.counterparty_alias.display_name if payment.counterparty_alias else 'Unknown',
            'merchant': payment.merchant_reference if hasattr(payment, 'merchant_reference') else None,
            'category': category,
            'type': payment.type_
        })
    
    return transactions

def categorize_transaction(description, counterparty):
    """Simple rule-based categorization"""
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
        days = int(request.args.get('days', 90))
        accounts = endpoint.MonetaryAccountBank.list().value
        all_transactions = []
        
        for account in accounts:
            transactions = get_account_transactions(account.id_, days)
            all_transactions.extend(transactions)
        
        income = sum(t['amount'] for t in all_transactions if t['amount'] > 0)
        expenses = abs(sum(t['amount'] for t in all_transactions if t['amount'] < 0))
        net_savings = income - expenses
        savings_rate = (net_savings / income * 100) if income > 0 else 0
        
        category_totals = {}
        for t in all_transactions:
            if t['amount'] < 0:
                cat = t['category']
                category_totals[cat] = category_totals.get(cat, 0) + abs(t['amount'])
        
        return jsonify({
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
        })
        
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
    print(f"📡 Environment: {ENVIRONMENT}")
    print(f"🔒 CORS Origins: {ALLOWED_ORIGINS}")
    print(f"🔐 Authentication: {'ENABLED ✅' if os.getenv('BASIC_AUTH_PASSWORD') else 'DISABLED ⚠️'}")
    print(f"🍪 Session-based auth with secure cookies")
    print(f"⏱️  Rate Limiting: 30 req/min (general), 5 req/min (login)")
    print(f"🔑 Secret key: {'Set ✅' if os.getenv('FLASK_SECRET_KEY') else 'Auto-generated ⚠️'}")
    
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
