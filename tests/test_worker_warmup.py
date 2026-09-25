"""Tests for the per-worker Bunq warm-up started from the Gunicorn hook."""
import importlib.util
import os

from conftest import REPO_ROOT


def test_warmup_disabled_when_auto_attempt_off(ap, monkeypatch):
    calls = []
    monkeypatch.setattr(ap, 'BUNQ_INIT_AUTO_ATTEMPT', False)
    monkeypatch.setattr(ap, 'ensure_bunq_initialized', lambda **kw: calls.append(kw))
    assert ap.start_background_bunq_init() is None
    assert calls == []
    assert ap._BUNQ_WARMUP_DONE.is_set()


def test_warmup_runs_lazy_init_in_background(ap, monkeypatch):
    calls = []
    monkeypatch.setattr(ap, 'BUNQ_INIT_AUTO_ATTEMPT', True)
    monkeypatch.setattr(ap, 'ensure_bunq_initialized', lambda **kw: calls.append(kw) or True)
    thread = ap.start_background_bunq_init()
    thread.join(timeout=5)
    assert calls == [{'force': False, 'refresh_key': False, 'run_auto_whitelist': False}]
    assert ap._BUNQ_WARMUP_DONE.is_set()


def test_warmup_releases_waiters_when_init_raises(ap, monkeypatch):
    def boom(**kw):
        raise RuntimeError('bunq down')

    monkeypatch.setattr(ap, 'BUNQ_INIT_AUTO_ATTEMPT', True)
    monkeypatch.setattr(ap, 'ensure_bunq_initialized', boom)
    ap.start_background_bunq_init().join(timeout=5)
    assert ap._BUNQ_WARMUP_DONE.is_set()


def test_api_requests_wait_for_warmup(ap, client, monkeypatch):
    waits = []

    class FakeEvent:
        def wait(self, timeout=None):
            waits.append(timeout)
            return True

    monkeypatch.setattr(ap, 'BUNQ_INIT_AUTO_ATTEMPT', True)
    monkeypatch.setattr(ap, '_BUNQ_WARMUP_DONE', FakeEvent())
    monkeypatch.setattr(ap, 'ensure_bunq_initialized', lambda **kw: False)
    client.get('/api/accounts')
    assert waits == [ap.BUNQ_WARMUP_WAIT_SECONDS]
    # Probes never wait.
    client.get('/api/health')
    client.get('/api/live')
    assert len(waits) == 1


def _load_gunicorn_conf():
    path = os.path.join(REPO_ROOT, 'scripts', 'gunicorn_conf.py')
    spec = importlib.util.spec_from_file_location('gunicorn_conf', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _FakeServer:
    def __init__(self):
        self.warnings = []
        self.log = self

    def warning(self, message):
        self.warnings.append(message)


def test_gunicorn_hook_starts_warmup(ap, monkeypatch):
    started = []
    monkeypatch.setattr(ap, 'start_background_bunq_init', lambda: started.append(True))
    _load_gunicorn_conf().post_worker_init(worker=None)
    assert started == [True]


def test_gunicorn_on_starting_runs_preboot_and_never_raises(ap, monkeypatch):
    calls = []
    monkeypatch.setattr(ap, 'run_preboot_init', lambda: calls.append(True))
    conf = _load_gunicorn_conf()
    conf.on_starting(_FakeServer())
    assert calls == [True]

    def boom():
        raise RuntimeError('vault down')

    monkeypatch.setattr(ap, 'run_preboot_init', boom)
    server = _FakeServer()
    conf.on_starting(server)
    assert server.warnings and 'vault down' in server.warnings[0]


def test_gunicorn_post_fork_resets_state(ap, monkeypatch):
    calls = []
    monkeypatch.setattr(ap, 'reset_bunq_state_after_fork', lambda: calls.append(True))
    _load_gunicorn_conf().post_fork(server=None, worker=None)
    assert calls == [True]


# --- preboot + fork state ----------------------------------------------------

def test_preboot_reuses_imported_key_and_runs_whitelist(ap, monkeypatch):
    calls = []
    monkeypatch.delenv('BUNQ_PREBOOT_INIT', raising=False)
    monkeypatch.setattr(ap, 'init_bunq', lambda **kw: calls.append(kw) or True)
    assert ap.run_preboot_init() is True
    # refresh_key=False: the key fetched at import is reused (no second Vaultwarden fetch).
    assert calls == [{'force_recreate': False, 'refresh_key': False, 'run_auto_whitelist': True}]


def test_preboot_can_be_disabled(ap, monkeypatch):
    calls = []
    monkeypatch.setenv('BUNQ_PREBOOT_INIT', 'false')
    monkeypatch.setattr(ap, 'init_bunq', lambda **kw: calls.append(kw))
    assert ap.run_preboot_init() is None
    assert calls == []


def test_reset_after_fork_clears_inherited_state_but_keeps_key(ap, monkeypatch):
    monkeypatch.setattr(ap, 'API_KEY', 'k' * 64)
    monkeypatch.setattr(ap, '_BUNQ_CONTEXT_INITIALIZED', True)
    monkeypatch.setattr(ap, '_BUNQ_INIT_LAST_ATTEMPT_TS', 12345.0)
    monkeypatch.setattr(ap, '_BUNQ_INIT_LAST_ERROR', 'old error')
    old_lock = ap._BUNQ_INIT_LOCK
    monkeypatch.setattr(ap, '_BUNQ_INIT_LOCK', old_lock)
    ap.reset_bunq_state_after_fork()
    assert ap._BUNQ_CONTEXT_INITIALIZED is False
    assert ap._BUNQ_INIT_LAST_ATTEMPT_TS == 0.0
    assert ap._BUNQ_INIT_LAST_ERROR is None
    assert ap._BUNQ_INIT_LOCK is not old_lock
    assert ap.API_KEY == 'k' * 64
