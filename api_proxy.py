#!/usr/bin/env python3
"""
Bunq Dashboard API Proxy
Flask backend for secure Bunq API integration
Host this on your NAS to keep API keys server-side
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
from bunq.sdk.context.api_context import ApiContext
from bunq.sdk.context.bunq_context import BunqContext
from bunq.sdk.model.generated import endpoint
from datetime import datetime, timedelta
import os
import json

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend access

# Configuration
API_KEY = os.getenv('BUNQ_API_KEY', '')  # Set via environment variable
CONFIG_FILE = 'bunq_production.conf'
ENVIRONMENT = 'PRODUCTION'

# Initialize Bunq Context
def init_bunq():
    """Initialize Bunq API context"""
    if not os.path.exists(CONFIG_FILE) and API_KEY:
        api_context = ApiContext.create(
            environment_type=ENVIRONMENT,
            api_key=API_KEY,
            device_description="NAS Dashboard API"
        )
        api_context.save(CONFIG_FILE)
        print("✅ Bunq API context created")
    elif os.path.exists(CONFIG_FILE):
        api_context = ApiContext.restore(CONFIG_FILE)
        print("✅ Bunq API context restored")
    else:
        print("⚠️ No API key found! Set BUNQ_API_KEY environment variable")
        return False
    
    BunqContext.load_api_context(api_context)
    return True

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'version': '1.0.0'
    })

@app.route('/api/accounts', methods=['GET'])
def get_accounts():
    """Get all Bunq accounts"""
    try:
        accounts = endpoint.MonetaryAccountBank.list().value
        
        account_data = []
        for account in accounts:
            account_data.append({
                'id': account.id_,
                'description': account.description,
                'balance': float(account.balance.value),
                'currency': account.balance.currency,
                'iban': account.alias[0].value if account.alias else None
            })
        
        return jsonify({
            'success': True,
            'data': account_data,
            'count': len(account_data)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    """Get transactions with optional filtering"""
    try:
        # Get query parameters
        account_id = request.args.get('account_id')
        days = int(request.args.get('days', 90))
        
        # Get all accounts if no specific account requested
        if not account_id:
            accounts = endpoint.MonetaryAccountBank.list().value
            all_transactions = []
            
            for account in accounts:
                transactions = get_account_transactions(account.id_, days)
                for trans in transactions:
                    trans['account_id'] = account.id_
                    trans['account_name'] = account.description
                all_transactions.extend(transactions)
            
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
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def get_account_transactions(account_id, days=90):
    """Get transactions for a specific account"""
    payments = endpoint.Payment.list(
        monetary_account_id=account_id
    ).value
    
    cutoff_date = datetime.now() - timedelta(days=days)
    transactions = []
    
    for payment in payments:
        created = datetime.fromisoformat(payment.created.replace('Z', '+00:00'))
        
        if created < cutoff_date:
            continue
        
        # Try to categorize transaction
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
    
    # Simple keyword matching
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
def get_statistics():
    """Get aggregated statistics"""
    try:
        days = int(request.args.get('days', 90))
        
        # Get all transactions
        accounts = endpoint.MonetaryAccountBank.list().value
        all_transactions = []
        
        for account in accounts:
            transactions = get_account_transactions(account.id_, days)
            all_transactions.extend(transactions)
        
        # Calculate statistics
        income = sum(t['amount'] for t in all_transactions if t['amount'] > 0)
        expenses = abs(sum(t['amount'] for t in all_transactions if t['amount'] < 0))
        net_savings = income - expenses
        savings_rate = (net_savings / income * 100) if income > 0 else 0
        
        # Category breakdown
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
    """Get demo data for testing without Bunq API"""
    days = int(request.args.get('days', 90))
    
    # Generate demo transactions (simplified version)
    import random
    from datetime import timedelta
    
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
    for i in range(days * 3):  # ~3 transactions per day
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
    
    # Add some income
    for i in range(days // 30):  # Monthly salary
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
        'note': 'This is demo data'
    })

if __name__ == '__main__':
    print("🚀 Starting Bunq Dashboard API...")
    print(f"📡 Environment: {ENVIRONMENT}")
    
    # Try to initialize Bunq (optional for demo mode)
    if init_bunq():
        print("✅ Bunq API initialized")
    else:
        print("⚠️ Running in demo mode only")
    
    # Run Flask app
    app.run(
        host='0.0.0.0',  # Listen on all interfaces
        port=5000,
        debug=True
    )
