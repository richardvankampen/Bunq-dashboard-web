"""Flask route tests: auth/session flow, protected endpoints, static allowlist, probes."""
from datetime import datetime, timedelta, timezone

import pytest

from conftest import TEST_PASSWORD, TEST_USERNAME


# --- check_credentials -------------------------------------------------------

def test_check_credentials(ap):
    assert ap.check_credentials(TEST_USERNAME, TEST_PASSWORD) is True
    assert ap.check_credentials(TEST_USERNAME, 'wrong') is False
    assert ap.check_credentials('someone-else', TEST_PASSWORD) is False


def test_check_credentials_denies_all_without_configured_password(ap, monkeypatch):
    monkeypatch.delenv('BASIC_AUTH_PASSWORD')
    monkeypatch.setattr(ap, 'read_secret', lambda name: None)
    assert ap.check_credentials(TEST_USERNAME, '') is False
    assert ap.check_credentials(TEST_USERNAME, TEST_PASSWORD) is False


# --- login / logout / status -------------------------------------------------

def test_login_success_sets_session(client):
    response = client.post('/api/auth/login', json={'username': TEST_USERNAME, 'password': TEST_PASSWORD})
    assert response.status_code == 200
    body = response.get_json()
    assert body['success'] is True
    assert body['username'] == TEST_USERNAME

    status = client.get('/api/auth/status').get_json()
    assert status['authenticated'] is True
    assert status['username'] == TEST_USERNAME


def test_session_cookie_flags(client):
    response = client.post('/api/auth/login', json={'username': TEST_USERNAME, 'password': TEST_PASSWORD})
    cookie = response.headers.get('Set-Cookie', '')
    assert 'HttpOnly' in cookie
    assert 'SameSite=Lax' in cookie


def test_login_wrong_password(client):
    response = client.post('/api/auth/login', json={'username': TEST_USERNAME, 'password': 'nope'})
    assert response.status_code == 401
    assert response.get_json()['success'] is False
    assert client.get('/api/auth/status').get_json() == {'authenticated': False}


@pytest.mark.parametrize('payload', [{}, {'username': TEST_USERNAME}, {'password': TEST_PASSWORD}])
def test_login_missing_fields(client, payload):
    response = client.post('/api/auth/login', json=payload)
    assert response.status_code == 400


def test_login_is_rate_limited_after_five_attempts(client):
    codes = [
        client.post('/api/auth/login', json={'username': TEST_USERNAME, 'password': 'nope'}).status_code
        for _ in range(6)
    ]
    assert codes == [401] * 5 + [429]


def test_logout_clears_session(auth_client):
    assert auth_client.post('/api/auth/logout').status_code == 200
    assert auth_client.get('/api/auth/status').get_json() == {'authenticated': False}


# --- protected endpoints -----------------------------------------------------

@pytest.mark.parametrize('path', [
    '/api/accounts', '/api/transactions', '/api/statistics', '/api/history/balances',
    '/api/demo-data', '/api/admin/status',
])
def test_protected_endpoints_require_login(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert response.get_json()['login_required'] is True


def test_demo_data_available_after_login(auth_client):
    response = auth_client.get('/api/demo-data')
    assert response.status_code == 200


def test_expired_session_is_rejected_and_cleared(client):
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    with client.session_transaction() as sess:
        sess['authenticated'] = True
        sess['username'] = TEST_USERNAME
        sess['expires_at'] = past
    response = client.get('/api/demo-data')
    assert response.status_code == 401
    assert 'expired' in response.get_json()['error'].lower()
    assert client.get('/api/auth/status').get_json() == {'authenticated': False}


def test_malformed_session_expiry_is_rejected(client):
    with client.session_transaction() as sess:
        sess['authenticated'] = True
        sess['expires_at'] = 'not-a-timestamp'
    response = client.get('/api/demo-data')
    assert response.status_code == 401
    assert 'invalid' in response.get_json()['error'].lower()


# --- static files + probes ---------------------------------------------------

@pytest.mark.parametrize('path', ['/', '/index.html', '/app.js', '/styles.css'])
def test_static_allowlist_served(client, path):
    assert client.get(path).status_code == 200


@pytest.mark.parametrize('path', [
    '/api_proxy.py', '/requirements_web.txt', '/docker-compose.yml', '/.env',
    '/../api_proxy.py', '/scripts/register_bunq_ip.sh', '/config/bunq_production.conf',
])
def test_non_allowlisted_files_are_not_served(client, path):
    assert client.get(path).status_code == 404


def test_liveness_probe(client):
    response = client.get('/api/live')
    assert response.status_code == 200
    assert response.get_json()['status'] == 'alive'


def test_health_ready_in_demo_mode_without_api_key(client, ap, monkeypatch):
    monkeypatch.setattr(ap, 'API_KEY', '')
    monkeypatch.setattr(ap, '_BUNQ_CONTEXT_INITIALIZED', False)
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.get_json()['api_status'] == 'demo_mode'


def test_health_degraded_when_api_key_but_no_context(client, ap, monkeypatch):
    monkeypatch.setattr(ap, 'API_KEY', 'x' * 64)
    monkeypatch.setattr(ap, '_BUNQ_CONTEXT_INITIALIZED', False)
    for path in ('/api/health', '/api/ready'):
        response = client.get(path)
        assert response.status_code == 503
        assert response.get_json()['status'] == 'degraded'


def test_health_ready_when_context_initialized(client, ap, monkeypatch):
    monkeypatch.setattr(ap, 'API_KEY', 'x' * 64)
    monkeypatch.setattr(ap, '_BUNQ_CONTEXT_INITIALIZED', True)
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.get_json()['api_status'] == 'initialized'
