"""Unit tests for pure parsing/normalisation helpers in api_proxy.py."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest


# --- env helpers -------------------------------------------------------------

@pytest.mark.parametrize('raw, expected', [
    ('1', True), ('true', True), ('YES', True), (' on ', True),
    ('0', False), ('false', False), ('no', False), ('off', False), ('garbage', False),
])
def test_get_bool_env(ap, monkeypatch, raw, expected):
    monkeypatch.setenv('TEST_BOOL_FLAG', raw)
    assert ap.get_bool_env('TEST_BOOL_FLAG', default=not expected) is expected


def test_get_bool_env_uses_default_when_unset_or_empty(ap, monkeypatch):
    monkeypatch.delenv('TEST_BOOL_FLAG', raising=False)
    assert ap.get_bool_env('TEST_BOOL_FLAG', default=True) is True
    monkeypatch.setenv('TEST_BOOL_FLAG', '')
    assert ap.get_bool_env('TEST_BOOL_FLAG', default=True) is True


def test_get_int_env(ap, monkeypatch):
    monkeypatch.setenv('TEST_INT_VALUE', '42')
    assert ap.get_int_env('TEST_INT_VALUE', 7) == 42
    monkeypatch.setenv('TEST_INT_VALUE', 'not-a-number')
    assert ap.get_int_env('TEST_INT_VALUE', 7) == 7
    monkeypatch.delenv('TEST_INT_VALUE')
    assert ap.get_int_env('TEST_INT_VALUE', 7) == 7


def test_get_config_prefers_env_then_default(ap, monkeypatch):
    monkeypatch.setenv('TEST_CONFIG_KEY', 'from-env')
    assert ap.get_config('TEST_CONFIG_KEY', 'fallback', 'nonexistent_secret_for_tests') == 'from-env'
    monkeypatch.delenv('TEST_CONFIG_KEY')
    assert ap.get_config('TEST_CONFIG_KEY', 'fallback', 'nonexistent_secret_for_tests') == 'fallback'


# --- get_obj_field -----------------------------------------------------------

def test_get_obj_field_reads_dicts_and_objects(ap):
    assert ap.get_obj_field({'a': None, 'b': 2}, 'a', 'b') == 2
    assert ap.get_obj_field(SimpleNamespace(a=None, b=3), 'a', 'b') == 3
    assert ap.get_obj_field({'a': 1}, 'missing', default='d') == 'd'
    assert ap.get_obj_field(None, 'a', default='d') == 'd'


def test_get_obj_field_keeps_falsy_non_none_values(ap):
    assert ap.get_obj_field({'a': 0, 'b': 5}, 'a', 'b') == 0
    assert ap.get_obj_field({'a': '', 'b': 'x'}, 'a', 'b') == ''


# --- numeric parsing ---------------------------------------------------------

@pytest.mark.parametrize('value, expected', [
    (5, 5.0), (2.5, 2.5), ('12.34', 12.34), (' -3.5 ', -3.5), ('12,34', 12.34),
    (None, 0.0), ('', 0.0), ('abc', 0.0), ({'x': 1}, 0.0),
])
def test_safe_float(ap, value, expected):
    assert ap.safe_float(value) == pytest.approx(expected)


def test_safe_float_custom_default(ap):
    assert ap.safe_float('bad', default=-1.0) == -1.0


def test_parse_monetary_value(ap):
    assert ap.parse_monetary_value({'value': '-10.50', 'currency': 'USD'}) == (-10.5, 'USD')
    assert ap.parse_monetary_value(SimpleNamespace(value='3', currency=None)) == (3.0, 'EUR')
    assert ap.parse_monetary_value(None, default_currency='ZAR') == (0.0, 'ZAR')


@pytest.mark.parametrize('value, expected', [
    (None, 90), ('abc', 90), (0, 90), (-5, 90), ('30', 30), (10**9, 3650),
])
def test_clamp_days(ap, value, expected):
    assert ap.clamp_days(value) == expected


@pytest.mark.parametrize('value, default, expected', [
    (None, True, True), ('yes', False, True), ('0', True, False), ('nope', True, False),
])
def test_parse_bool(ap, value, default, expected):
    assert ap.parse_bool(value, default=default) is expected


# --- pagination --------------------------------------------------------------

@pytest.mark.parametrize('query, expected', [
    ('', (500, 0, 1, 'desc')),
    ('?page=3&page_size=10', (10, 20, 3, 'desc')),
    ('?page=-4&page_size=0', (1, 0, 1, 'desc')),
    ('?page_size=999999', (2000, 0, 1, 'desc')),
    ('?page=abc&page_size=xyz', (500, 0, 1, 'desc')),
    ('?limit=25&offset=50', (25, 50, 3, 'desc')),
    ('?limit=-1&offset=-10', (1, 0, 1, 'desc')),
    ('?sort=ASC', (500, 0, 1, 'asc')),
    ('?sort=sideways', (500, 0, 1, 'desc')),
])
def test_parse_pagination(ap, query, expected):
    with ap.app.test_request_context('/api/transactions' + query):
        assert ap.parse_pagination() == expected


# --- IBAN / alias parsing ----------------------------------------------------

@pytest.mark.parametrize('value, expected', [
    ('NL91 abna 0417 1643 00', 'NL91ABNA0417164300'),
    ('NL91ABNA0417164300', 'NL91ABNA0417164300'),
    ('NL91ABNA', None),                  # too short
    ('1234567890123456', None),          # no country code
    ('NLXXABNA0417164300', None),        # no check digits
    (None, None), ('', None),
])
def test_normalize_iban(ap, value, expected):
    assert ap.normalize_iban(value) == expected


def test_extract_alias_iban_from_typed_alias(ap):
    alias = {'type': 'IBAN', 'value': 'nl91 abna 0417 1643 00'}
    assert ap.extract_alias_iban(alias) == 'NL91ABNA0417164300'


def test_extract_alias_iban_from_nested_pointer(ap):
    alias = SimpleNamespace(label_monetary_account=SimpleNamespace(iban='DE89370400440532013000'))
    assert ap.extract_alias_iban(alias) == 'DE89370400440532013000'


def test_extract_alias_iban_none_when_absent(ap):
    assert ap.extract_alias_iban(None) is None
    assert ap.extract_alias_iban({'type': 'EMAIL', 'value': 'me@example.com'}) is None


def test_extract_alias_account_id_from_nested_alias(ap):
    alias = {'label_monetary_account': {'monetary_account_id': 1234}}
    assert ap.extract_alias_account_id(alias) == '1234'
    assert ap.extract_alias_account_id({'display_name': 'x'}) is None
    assert ap.extract_alias_account_id(None) is None


def test_extract_counterparty_name_prefers_readable_name(ap):
    alias = {'display_name': 'NL91ABNA0417164300', 'label_user': {'display_name': 'Albert Heijn 1234'}}
    assert ap.extract_counterparty_name(alias) == 'Albert Heijn 1234'


def test_extract_counterparty_name_falls_back_to_iban_then_unknown(ap):
    assert ap.extract_counterparty_name({'type': 'IBAN', 'value': 'NL91ABNA0417164300'}) == 'NL91ABNA0417164300'
    assert ap.extract_counterparty_name(None) == 'Unknown'
    assert ap.extract_counterparty_name({}) == 'Unknown'


def test_extract_alias_merchant_category_code(ap):
    alias = {'label_monetary_account': {'merchant_category_code': ' 5411 '}}
    assert ap.extract_alias_merchant_category_code(alias) == '5411'
    assert ap.extract_alias_merchant_category_code({'display_name': 'x'}) is None


@pytest.mark.parametrize('value, expected', [
    ('NL91ABNA0417164300', True),
    ('ABCDEF1234567890', True),
    ('', True),
    ('Albert Heijn', False),
    ('Short-ID', False),
    (None, False),
])
def test_is_opaque_reference_value(ap, value, expected):
    assert ap.is_opaque_reference_value(value) is expected


# --- datetimes / IPs ---------------------------------------------------------

def test_parse_bunq_datetime_normalises_to_utc(ap):
    assert ap.parse_bunq_datetime('2026-03-01 12:34:56.123456') == datetime(2026, 3, 1, 12, 34, 56, 123456, tzinfo=timezone.utc)
    assert ap.parse_bunq_datetime('2026-03-01T12:00:00Z') == datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)
    assert ap.parse_bunq_datetime('2026-03-01T13:00:00+01:00') == datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize('value', [None, '', '   ', 'not a date'])
def test_parse_bunq_datetime_invalid(ap, value):
    assert ap.parse_bunq_datetime(value) is None


def test_validate_ipv4_or_none(ap):
    assert ap.validate_ipv4_or_none(None) is None
    assert ap.validate_ipv4_or_none('  ') is None
    assert ap.validate_ipv4_or_none(' 8.8.8.8 ') == '8.8.8.8'
    assert ap.validate_ipv4_or_none('192.168.1.10') == '192.168.1.10'
    with pytest.raises(ValueError):
        ap.validate_ipv4_or_none('192.168.1.10', require_public=True)
    with pytest.raises(ValueError):
        ap.validate_ipv4_or_none('2001:4860:4860::8888')
    with pytest.raises(ValueError):
        ap.validate_ipv4_or_none('999.1.1.1')


# --- whitelist helpers -------------------------------------------------------

def test_extract_whitelist_ip_entry_variants(ap):
    assert ap.extract_whitelist_ip_entry({'id': 1, 'status': 'active', 'ip': '1.2.3.4'}) == {
        'id': 1, 'ip': '1.2.3.4', 'status': 'ACTIVE'}
    assert ap.extract_whitelist_ip_entry({'id_': 2, 'ip': {'ip': '5.6.7.8'}})['ip'] == '5.6.7.8'
    assert ap.extract_whitelist_ip_entry(SimpleNamespace(id_=3, status=None, ip=SimpleNamespace(ip='9.9.9.9')))['ip'] == '9.9.9.9'


def test_pick_credential_password_profile(ap, monkeypatch):
    monkeypatch.delenv('BUNQ_CREDENTIAL_PASSWORD_IP_ID', raising=False)
    profiles = [
        {'id': 5, 'status': 'ACTIVE'},
        {'id': 9, 'status': 'INACTIVE'},
        {'id': 7, 'status': 'ACTIVE'},
    ]
    # Highest id among ACTIVE profiles wins.
    assert ap.pick_credential_password_profile(profiles)['id'] == 7
    # Explicit preference overrides.
    monkeypatch.setenv('BUNQ_CREDENTIAL_PASSWORD_IP_ID', '9')
    assert ap.pick_credential_password_profile(profiles)['id'] == 9
    assert ap.pick_credential_password_profile([]) is None


# --- rate limiter ------------------------------------------------------------

def test_rate_limiter_general_limit(ap):
    limiter = ap.RateLimiter(max_requests=3, window_seconds=60)
    assert [limiter.is_allowed('1.1.1.1') for _ in range(4)] == [True, True, True, False]
    # Other clients are tracked independently.
    assert limiter.is_allowed('2.2.2.2') is True


def test_rate_limiter_login_limit_is_five(ap):
    limiter = ap.RateLimiter(max_requests=100, window_seconds=60)
    results = [limiter.is_allowed('1.1.1.1', 'login') for _ in range(6)]
    assert results == [True] * 5 + [False]
    # Login attempts don't consume the general budget.
    assert limiter.is_allowed('1.1.1.1') is True


def test_rate_limiter_window_expiry_evicts_client(ap, monkeypatch):
    limiter = ap.RateLimiter(max_requests=1, window_seconds=60)
    now = [1000.0]
    monkeypatch.setattr(ap.time, 'time', lambda: now[0])
    assert limiter.is_allowed('1.1.1.1') is True
    assert limiter.is_allowed('1.1.1.1') is False
    now[0] += 61
    assert limiter.is_allowed('1.1.1.1') is True


def test_rate_limiter_sweep_removes_stale_clients(ap, monkeypatch):
    limiter = ap.RateLimiter(max_requests=5, window_seconds=60)
    limiter._SWEEP_INTERVAL = 3
    now = [1000.0]
    monkeypatch.setattr(ap.time, 'time', lambda: now[0])
    limiter.is_allowed('stale-client')
    now[0] += 120
    limiter.is_allowed('fresh-a')
    limiter.is_allowed('fresh-b')  # 3rd request triggers the sweep
    assert 'stale-client' not in limiter.requests
    assert set(limiter.requests) == {'fresh-a', 'fresh-b'}
