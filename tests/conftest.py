"""
Shared pytest setup for api_proxy.py.

api_proxy.py does work at import time (API key lookup, SQLite init, Flask config),
so the environment is pinned here *before* the module is imported:
- no Vaultwarden / Bunq network calls (USE_VAULTWARDEN=false, empty BUNQ_API_KEY,
  BUNQ_INIT_AUTO_ATTEMPT=false)
- no local data store (DATA_DB_ENABLED=false)
- deterministic auth credentials and session secret
"""
import os
import sys

import pytest

TEST_USERNAME = 'testuser'
TEST_PASSWORD = 'test-password-123'

_TEST_ENV = {
    'USE_VAULTWARDEN': 'false',
    'BUNQ_API_KEY': '',
    'BUNQ_INIT_AUTO_ATTEMPT': 'false',
    'AUTO_SET_BUNQ_WHITELIST_IP': 'false',
    'DATA_DB_ENABLED': 'false',
    'CACHE_ENABLED': 'false',
    'FX_ENABLED': 'false',
    'BASIC_AUTH_USERNAME': TEST_USERNAME,
    'BASIC_AUTH_PASSWORD': TEST_PASSWORD,
    'FLASK_SECRET_KEY': 'test-secret-key',
    'SESSION_COOKIE_SECURE': 'false',
    'ALLOWED_ORIGINS': 'http://localhost:5000',
    'DEFAULT_PAGE_SIZE': '500',
    'MAX_PAGE_SIZE': '2000',
    'MAX_DAYS': '3650',
    'LOG_LEVEL': 'WARNING',
}
os.environ.update(_TEST_ENV)

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import api_proxy  # noqa: E402


@pytest.fixture
def ap():
    return api_proxy


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """The rate limiter is module-global; clear it so tests don't hit 429s."""
    api_proxy.rate_limiter.requests.clear()
    api_proxy.rate_limiter.login_attempts.clear()
    yield


@pytest.fixture
def client():
    api_proxy.app.config['TESTING'] = True
    with api_proxy.app.test_client() as test_client:
        yield test_client


@pytest.fixture
def auth_client(client):
    response = client.post('/api/auth/login', json={'username': TEST_USERNAME, 'password': TEST_PASSWORD})
    assert response.status_code == 200
    return client
