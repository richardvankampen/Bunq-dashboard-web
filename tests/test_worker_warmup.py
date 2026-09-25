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


def test_gunicorn_hook_starts_warmup(ap, monkeypatch):
    started = []
    monkeypatch.setattr(ap, 'start_background_bunq_init', lambda: started.append(True))
    path = os.path.join(REPO_ROOT, 'scripts', 'gunicorn_conf.py')
    spec = importlib.util.spec_from_file_location('gunicorn_conf', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.post_worker_init(worker=None)
    assert started == [True]
