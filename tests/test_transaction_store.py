"""
Tests for the transaction store: incremental sync, reads from the store,
and the monthly reconcile against Bunq (new / changed / deleted / too old).

Bunq is faked at the endpoint level, so the real pagination
(_list_payments_paginated with older_id / stop_at_id / start_older_id) runs.
"""
from datetime import datetime, timedelta, timezone

import pytest

from conftest import TEST_PASSWORD, TEST_USERNAME, join_background_threads

NOW = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
ACCOUNT = {'id': 1, 'description': 'Hoofdrekening'}


class FakeEndpoint:
    def __init__(self, bunq, source):
        self.bunq = bunq
        self.source = source

    def list(self, monetary_account_id=None, params=None):
        params = params or {}
        self.bunq.page_calls += 1
        if (str(monetary_account_id), self.source) in self.bunq.failing:
            raise RuntimeError('bunq unavailable')
        items = sorted(
            self.bunq.items.get((str(monetary_account_id), self.source), {}).values(),
            key=lambda item: item['id'],
            reverse=True,
        )
        older_id = params.get('older_id')
        if older_id is not None:
            items = [item for item in items if item['id'] < older_id]
        return [dict(item) for item in items[:params.get('count', 200)]]


class FakeBunq:
    """In-memory Bunq: (account_id, source) -> {payment_id: payment dict}."""

    def __init__(self, ap):
        self.ap = ap
        self.items = {}
        self.fetches = []
        self.failing = set()
        self.page_calls = 0
        self.page_size = 3

    def add(self, pid, days_ago, amount=-10.0, description=None, account_id=1, source='payment'):
        created = (NOW - timedelta(days=days_ago)).strftime('%Y-%m-%d %H:%M:%S.%f')
        self.items.setdefault((str(account_id), source), {})[pid] = {
            'id': pid,
            'created': created,
            'amount': {'value': f'{amount:.2f}', 'currency': 'EUR'},
            'description': description or f'Payment {pid}',
            'counterparty_alias': {'display_name': f'Shop {pid}'},
        }

    def remove(self, pid, account_id=1, source='payment'):
        del self.items[(str(account_id), source)][pid]

    def fetch(self, source, account_id, cutoff_date=None, stop_at_id=None, start_older_id=None, max_pages=None):
        self.fetches.append({
            'source': source, 'cutoff_date': cutoff_date,
            'stop_at_id': stop_at_id, 'start_older_id': start_older_id,
        })
        endpoint = FakeEndpoint(self, source)
        collected, meta, _, _ = self.ap._list_payments_paginated(
            account_id, cutoff_date, True, None, None,
            self.page_size, max_pages or 50,
            lambda: [('fake', endpoint)], source, 'missing endpoint',
            stop_at_id=stop_at_id, start_older_id=start_older_id,
        )
        return collected, meta

    def payment_fetches(self):
        return [call for call in self.fetches if call['source'] == 'payment']


@pytest.fixture
def store(ap, monkeypatch, tmp_path):
    monkeypatch.setattr(ap, 'DATA_DB_ENABLED', True)
    monkeypatch.setattr(ap, 'DATA_DB_PATH', str(tmp_path / 'config' / 'dashboard_data.db'))
    monkeypatch.setattr(ap, 'SYNC_MIN_INTERVAL_SECONDS', 0)
    ap.init_data_store()
    bunq = FakeBunq(ap)

    def fake_fetch(source, account_id, return_meta=True, **kwargs):
        return bunq.fetch(source, account_id, **kwargs)

    monkeypatch.setattr(ap, '_fetch_source_payments', fake_fetch)
    yield bunq
    # Background sync threads must finish before monkeypatch restores the real DB path.
    join_background_threads()


def _sync(ap, days, now=NOW, account=ACCOUNT):
    cutoff = now - timedelta(days=days)
    connection = ap.get_data_db_connection()
    try:
        return ap.sync_account_source(connection, account, 'payment', set(), set(), cutoff, now=now)
    finally:
        connection.close()


def _read_ids(ap, days, now=NOW):
    return sorted(tx['id'] for tx in ap.read_stored_transactions([1], now - timedelta(days=days)))


def _reconcile(ap, now=NOW):
    connection = ap.get_data_db_connection()
    try:
        return ap.reconcile_account_source(connection, ACCOUNT, 'payment', set(), set(), now=now)
    finally:
        connection.close()


def _row(ap, pid):
    connection = ap.get_data_db_connection()
    try:
        return connection.execute(
            "SELECT * FROM bunq_transactions WHERE bunq_id = ?", (str(pid),)
        ).fetchone()
    finally:
        connection.close()


# --- incremental sync --------------------------------------------------------

def test_initial_sync_stores_period_and_reads_from_store(ap, store):
    for pid, days_ago in [(10, 100), (11, 60), (12, 20), (13, 10), (14, 1)]:
        store.add(pid, days_ago)
    result = _sync(ap, days=30)
    assert result['inserted'] >= 3
    assert _read_ids(ap, 30) == [12, 13, 14]
    tx = ap.read_stored_transactions([1], NOW - timedelta(days=30))[0]
    assert {'id', 'date', 'amount', 'description', 'source', 'category'} <= set(tx)


def test_second_sync_only_fetches_newer_pages(ap, store):
    for pid, days_ago in [(10, 20), (11, 10), (12, 5)]:
        store.add(pid, days_ago)
    _sync(ap, days=30)
    store.add(13, 0)
    store.fetches.clear()
    result = _sync(ap, days=30)
    assert [call['stop_at_id'] for call in store.payment_fetches()] == [12]
    assert result['inserted'] == 1
    assert _read_ids(ap, 30) == [10, 11, 12, 13]


def test_sync_is_skipped_within_min_interval(ap, store, monkeypatch):
    store.add(10, 5)
    _sync(ap, days=30)
    monkeypatch.setattr(ap, 'SYNC_MIN_INTERVAL_SECONDS', 60)
    store.fetches.clear()
    result = _sync(ap, days=30, now=NOW + timedelta(seconds=30))
    assert result['skipped'] is True
    assert store.fetches == []


def test_longer_period_backfills_once(ap, store):
    for pid, days_ago in [(10, 200), (11, 150), (12, 100), (13, 80), (14, 40), (15, 20), (16, 10), (17, 5)]:
        store.add(pid, days_ago)
    _sync(ap, days=30)
    store.fetches.clear()
    _sync(ap, days=120)
    backfills = [call for call in store.payment_fetches() if call['start_older_id'] is not None]
    assert len(backfills) == 1
    assert 12 in _read_ids(ap, 120)
    # Now covered: a repeat only checks for newer pages.
    store.fetches.clear()
    _sync(ap, days=120)
    assert all(call['start_older_id'] is None for call in store.payment_fetches())


def test_history_complete_stops_backfill(ap, store):
    store.add(10, 5)
    store.add(11, 2)
    _sync(ap, days=30)  # short page: Bunq has no older data
    store.fetches.clear()
    _sync(ap, days=3650)
    assert all(call['start_older_id'] is None for call in store.payment_fetches())


def test_sync_updates_changed_transactions(ap, store):
    store.add(10, 5, description='old text')
    _sync(ap, days=30)
    store.add(10, 5, description='new text')
    result = _sync(ap, days=30)
    assert result['updated'] == 1
    assert ap.read_stored_transactions([1], NOW - timedelta(days=30))[0]['description'] == 'new text'


def test_fx_fields_do_not_count_as_changes(ap):
    tx = {'id': 1, 'amount': -5.0, 'amount_eur': None, 'fx_rate_to_eur': None, 'fx_converted': False}
    filled = dict(tx, amount_eur=-4.5, fx_rate_to_eur=0.9, fx_converted=True)
    assert ap.transaction_content_hash(tx) == ap.transaction_content_hash(filled)
    assert ap.transaction_content_hash(tx) != ap.transaction_content_hash(dict(tx, amount=-6.0))


# --- monthly reconcile -------------------------------------------------------

def test_reconcile_applies_new_changed_and_deleted(ap, store):
    for pid, days_ago in [(10, 50), (11, 40), (12, 30), (13, 20), (14, 10)]:
        store.add(pid, days_ago)
    _sync(ap, days=60)
    store.add(12, 30, description='corrected by bunq')  # changed
    store.remove(13)                                     # deleted at bunq
    store.add(15, 1)                                     # new
    result = _reconcile(ap)
    assert result['inserted'] == 1
    assert result['updated'] == 1
    assert result['deleted'] == 1
    assert result['deleted_ids'] == ['13']
    assert _read_ids(ap, 60) == [10, 11, 12, 14, 15]
    assert _row(ap, 13)['deleted_at'] is not None  # kept in the database, hidden from reads
    stored = {tx['id']: tx for tx in ap.read_stored_transactions([1], NOW - timedelta(days=60))}
    assert stored[12]['description'] == 'corrected by bunq'


def test_reconcile_keeps_transactions_too_old_for_bunq(ap, store):
    for pid, days_ago in [(10, 400), (11, 300), (12, 30), (13, 20), (14, 10)]:
        store.add(pid, days_ago)
    _sync(ap, days=500)
    # Bunq no longer serves the two oldest transactions.
    store.remove(10)
    store.remove(11)
    result = _reconcile(ap)
    assert result['deleted'] == 0
    assert result['kept_too_old'] == 2
    assert _read_ids(ap, 500) == [10, 11, 12, 13, 14]


def test_reconcile_fetch_error_changes_nothing(ap, store):
    for pid, days_ago in [(10, 20), (11, 10)]:
        store.add(pid, days_ago)
    _sync(ap, days=30)
    store.failing.add(('1', 'payment'))
    with pytest.raises(RuntimeError):
        _reconcile(ap)
    assert _read_ids(ap, 30) == [10, 11]


def test_deleted_transaction_is_restored_when_bunq_returns_it(ap, store):
    for pid, days_ago in [(10, 20), (11, 10), (12, 5)]:
        store.add(pid, days_ago)
    _sync(ap, days=30)
    store.remove(11)
    _reconcile(ap)
    assert _read_ids(ap, 30) == [10, 12]
    store.add(11, 10)
    result = _reconcile(ap)
    assert result['restored'] == 1
    assert _read_ids(ap, 30) == [10, 11, 12]


def test_reconcile_deletes_oldest_stored_when_bunq_serves_older_data(ap, store):
    # Bunq has data older than what's stored (only the last 30 days were synced),
    # so a missing stored transaction at the old edge was really deleted.
    for pid, days_ago in [(8, 150), (9, 120), (10, 100), (11, 90), (12, 80), (13, 25), (14, 10), (15, 5)]:
        store.add(pid, days_ago)
    _sync(ap, days=30)  # page size 3: stores 10..15, Bunq still has 8 and 9
    assert _read_ids(ap, 3650) == [10, 11, 12, 13, 14, 15]
    store.remove(10)    # the oldest stored transaction
    result = _reconcile(ap)
    assert result['stop_reason'] == 'cutoff_reached'
    assert result['deleted_ids'] == ['10']
    assert 10 not in _read_ids(ap, 3650)


def test_reconcile_keeps_oldest_when_bunq_history_ends(ap, store):
    # Bunq's history ends at the oldest returned transaction: an older stored
    # transaction that disappeared can't be told apart from "too old", so it is kept.
    for pid, days_ago in [(10, 20), (11, 10)]:
        store.add(pid, days_ago)
    _sync(ap, days=30)
    store.remove(10)
    result = _reconcile(ap)
    assert result['deleted'] == 0
    assert result['kept_too_old'] == 1
    assert _read_ids(ap, 30) == [10, 11]


def test_run_full_reconcile_records_run(ap, store, monkeypatch):
    for pid, days_ago in [(10, 20), (11, 10)]:
        store.add(pid, days_ago)
    _sync(ap, days=30)
    store.remove(11)
    monkeypatch.setattr(ap, 'ensure_bunq_initialized', lambda **kw: True)
    monkeypatch.setattr(ap, 'list_monetary_accounts', lambda: [ACCOUNT])
    result = ap.run_full_reconcile(trigger='manual')
    assert result['status'] == 'success'
    assert result['deleted'] == 1
    runs = ap.get_reconcile_status()['recent_runs']
    assert runs[0]['status'] == 'success' and runs[0]['deleted'] == 1


def test_run_full_reconcile_partial_on_payment_errors(ap, store, monkeypatch):
    store.add(10, 5)
    _sync(ap, days=30)
    store.failing.add(('1', 'payment'))
    monkeypatch.setattr(ap, 'ensure_bunq_initialized', lambda **kw: True)
    monkeypatch.setattr(ap, 'list_monetary_accounts', lambda: [ACCOUNT])
    result = ap.run_full_reconcile(trigger='manual')
    assert result['status'] == 'partial'
    assert _read_ids(ap, 30) == [10]


# --- schedule ----------------------------------------------------------------

def _local(year, month, day, hour, minute=0):
    from zoneinfo import ZoneInfo
    return datetime(year, month, day, hour, minute, tzinfo=ZoneInfo('Europe/Amsterdam'))


@pytest.mark.parametrize('now_local, last_success, expected', [
    (_local(2026, 10, 1, 3, 5), None, True),           # 1st, 03:05: due
    (_local(2026, 10, 1, 2, 59), None, False),         # before the window
    (_local(2026, 10, 1, 6, 0), None, False),          # after the 3h window
    (_local(2026, 10, 1, 3, 5), '2026-10', False),     # already done this month
    (_local(2026, 10, 2, 4, 0), '2026-09', True),      # missed night: catch up next night
    (_local(2026, 10, 15, 14, 0), '2026-09', False),   # daytime never runs
])
def test_is_reconcile_due(ap, now_local, last_success, expected):
    assert ap.is_reconcile_due(now_local, last_success, None) is expected


def test_is_reconcile_due_waits_before_retry(ap):
    now_local = _local(2026, 10, 1, 4, 0)
    recent = (now_local - timedelta(minutes=30)).astimezone(timezone.utc).isoformat()
    older = (now_local - timedelta(hours=2)).astimezone(timezone.utc).isoformat()
    assert ap.is_reconcile_due(now_local, None, recent) is False
    assert ap.is_reconcile_due(now_local, None, older) is True


def test_scheduled_reconcile_runs_once_per_month(ap, store, monkeypatch):
    runs = []
    monkeypatch.setattr(ap, 'run_full_reconcile', lambda trigger: runs.append(trigger) or {'status': 'success'})
    now_local = _local(2026, 10, 1, 3, 10)
    assert ap.try_run_scheduled_reconcile(now_local)['status'] == 'success'
    assert ap.try_run_scheduled_reconcile(now_local + timedelta(hours=2)) is None
    assert runs == ['schedule']
    assert ap._app_state_get('reconcile_last_success_month') == '2026-10'


def test_scheduled_reconcile_skips_when_lock_is_held(ap, store, monkeypatch):
    runs = []
    monkeypatch.setattr(ap, 'run_full_reconcile', lambda trigger: runs.append(trigger) or {'status': 'success'})
    with ap._reconcile_file_lock() as acquired:
        assert acquired is True
        # A second process can't take the lock (flock is per open file description).
        with ap._reconcile_file_lock() as second:
            assert second is False
            assert ap.try_run_scheduled_reconcile(_local(2026, 10, 1, 3, 10)) is None
    assert runs == []


def test_failed_scheduled_reconcile_is_retried_later(ap, store, monkeypatch):
    monkeypatch.setattr(ap, 'run_full_reconcile', lambda trigger: {'status': 'failed'})
    now_local = _local(2026, 10, 1, 3, 10)
    assert ap.try_run_scheduled_reconcile(now_local)['status'] == 'failed'
    assert ap._app_state_get('reconcile_last_success_month') is None
    # Retry only after RECONCILE_RETRY_SECONDS; the real clock is used for the attempt time,
    # so check the stored attempt blocks an immediate retry.
    attempt = ap._app_state_get('reconcile_last_attempt_at')
    assert ap.is_reconcile_due(ap._reconcile_local_now(), None, attempt) is False


# --- API ---------------------------------------------------------------------

@pytest.fixture
def live_api(ap, store, monkeypatch, client):
    monkeypatch.setattr(ap, 'API_KEY', 'k' * 64)
    monkeypatch.setattr(ap, '_BUNQ_CONTEXT_INITIALIZED', True)
    monkeypatch.setattr(ap, 'list_monetary_accounts', lambda: [ACCOUNT])
    response = client.post('/api/auth/login', json={'username': TEST_USERNAME, 'password': TEST_PASSWORD})
    assert response.status_code == 200
    return client


def test_transactions_endpoint_serves_from_store(ap, store, live_api, monkeypatch):
    today = datetime.now(timezone.utc)
    for pid, days_ago in [(10, 20), (11, 10), (12, 5)]:
        store.items.setdefault(('1', 'payment'), {})[pid] = {
            'id': pid,
            'created': (today - timedelta(days=days_ago)).strftime('%Y-%m-%d %H:%M:%S.%f'),
            'amount': {'value': '-10.00', 'currency': 'EUR'},
            'description': f'Payment {pid}',
        }
    monkeypatch.setattr(ap, 'SYNC_MIN_INTERVAL_SECONDS', 60)
    page1 = live_api.get('/api/transactions?days=30&page=1&page_size=2&cache=false').get_json()
    assert page1['success'] is True and page1['count'] == 3
    calls_after_page1 = store.page_calls
    page2 = live_api.get('/api/transactions?days=30&page=2&page_size=2&cache=false').get_json()
    assert len(page2['data']) == 1
    # Page 2 is served from the store without going back to Bunq.
    assert store.page_calls == calls_after_page1


def test_statistics_endpoint_uses_store(ap, store, live_api):
    today = datetime.now(timezone.utc)
    store.items.setdefault(('1', 'payment'), {})[10] = {
        'id': 10,
        'created': (today - timedelta(days=3)).strftime('%Y-%m-%d %H:%M:%S.%f'),
        'amount': {'value': '-25.00', 'currency': 'EUR'},
        'description': 'Albert Heijn',
    }
    body = live_api.get('/api/statistics?days=30&cache=false').get_json()
    assert body['success'] is True
    assert body['data']['expenses'] == pytest.approx(25.0)


def test_admin_reconcile_endpoints(ap, store, live_api, monkeypatch):
    started = []
    monkeypatch.setattr(ap, 'run_reconcile_exclusive', lambda trigger: started.append(trigger) or {'status': 'success'})
    response = live_api.post('/api/admin/reconcile')
    assert response.status_code == 202
    status = live_api.get('/api/admin/reconcile').get_json()
    assert status['success'] is True
    assert status['data']['schedule']['hour'] == 3


def test_data_quality_summary_reads_store_and_skips_deleted(ap, store):
    today = datetime.now(timezone.utc)
    for pid, days_ago in [(10, 20), (11, 10), (12, 5)]:
        store.add(pid, days_ago)
    _sync(ap, days=30, now=today)
    store.remove(12)
    _reconcile(ap, now=today)
    summary = ap.build_data_quality_summary(days=90)
    assert summary['error'] is None
    assert summary['metrics']['total_transactions'] == 2
    assert summary['metrics']['latest_capture_at'] is not None


# --- speed: background sync, account cache, card backoff -----------------------

def test_covered_period_is_served_without_waiting_for_bunq(ap, store, monkeypatch):
    for pid, days_ago in [(10, 20), (11, 10)]:
        store.add(pid, days_ago)
    _sync(ap, days=30)
    blocking_calls = []
    real_sync = ap.sync_transactions
    monkeypatch.setattr(ap, 'sync_transactions', lambda *args: blocking_calls.append(args) or real_sync(*args))
    started = []
    monkeypatch.setattr(ap, '_start_background_sync', lambda *args: started.append(True))
    transactions, _, _ = ap.load_transactions([ACCOUNT], set(), set(), NOW - timedelta(days=30))
    assert sorted(tx['id'] for tx in transactions) == [10, 11]
    assert blocking_calls == []      # no waiting on Bunq
    assert started == [True]         # new transactions are checked in the background


def test_uncovered_period_waits_for_fetch(ap, store):
    for pid, days_ago in [(10, 100), (11, 80), (12, 60), (13, 20), (14, 10), (15, 5)]:
        store.add(pid, days_ago)
    _sync(ap, days=30)
    assert ap.store_covers_period([ACCOUNT], NOW - timedelta(days=30)) is True
    assert ap.store_covers_period([ACCOUNT], NOW - timedelta(days=90)) is False
    transactions, _, _ = ap.load_transactions([ACCOUNT], set(), set(), NOW - timedelta(days=90))
    assert {12, 13, 14, 15} <= {tx['id'] for tx in transactions}


def test_background_sync_stores_new_transactions(ap, store):
    store.add(10, 5)
    _sync(ap, days=30)
    store.add(11, 0)
    thread = ap._start_background_sync([ACCOUNT], set(), set(), NOW - timedelta(days=30))
    thread.join(timeout=10)
    assert _read_ids(ap, 30) == [10, 11]


def test_card_payment_failure_is_backed_off(ap, store):
    store.add(10, 5)
    store.failing.add(('1', 'card_payment'))
    ap.sync_transactions([ACCOUNT], set(), set(), NOW - timedelta(days=30))
    card_calls = [call for call in store.fetches if call['source'] == 'card_payment']
    assert len(card_calls) == 1
    ap.sync_transactions([ACCOUNT], set(), set(), NOW - timedelta(days=30))
    card_calls = [call for call in store.fetches if call['source'] == 'card_payment']
    assert len(card_calls) == 1  # not retried within the backoff period


def test_account_list_is_reused_then_refreshed_in_background(ap, monkeypatch):
    calls = []
    monkeypatch.setattr(ap, 'list_monetary_accounts', lambda: calls.append(True) or [dict(ACCOUNT, n=len(calls))])
    clock = [1000.0]
    monkeypatch.setattr(ap.time, 'time', lambda: clock[0])
    first = ap.get_monetary_accounts()
    assert ap.get_monetary_accounts() is first and len(calls) == 1       # fresh: reused
    clock[0] += ap.ACCOUNTS_CACHE_SECONDS + 1
    assert ap.get_monetary_accounts() is first                          # stale: served immediately...
    ap._ACCOUNTS_BACKGROUND_THREAD.join(timeout=5)
    assert len(calls) == 2                                              # ...and refreshed in the background
    assert ap.get_monetary_accounts()[0]['n'] == 2                     # refreshed list is used
    clock[0] += ap.ACCOUNTS_STALE_SECONDS + 1
    ap.get_monetary_accounts()                                          # too old: fetched while waiting
    assert len(calls) == 3
