"""Tests for own-account detection and cross-account internal-transfer reconciliation."""
from types import SimpleNamespace


class MonetaryAccountBank(SimpleNamespace):
    pass


class MonetaryAccountSavings(SimpleNamespace):
    pass


class MonetaryAccountExternal(SimpleNamespace):
    """Linked external bank account (e.g. Triodos) — must NOT count as internal."""


class MonetaryAccountExternalSavings(SimpleNamespace):
    """Bunq external-savings account — DOES count as internal."""


def _iban_alias(iban):
    return [{'type': 'IBAN', 'value': iban}]


def test_is_own_bunq_account_excludes_linked_external_accounts(ap):
    assert ap.is_own_bunq_account(MonetaryAccountBank(id=1)) is True
    assert ap.is_own_bunq_account(MonetaryAccountSavings(id=2)) is True
    assert ap.is_own_bunq_account(MonetaryAccountExternalSavings(id=3)) is True
    assert ap.is_own_bunq_account(MonetaryAccountExternal(id=4)) is False
    # _raw_type overrides the Python class name.
    assert ap.is_own_bunq_account({'id': 5, '_raw_type': 'MonetaryAccountExternal'}) is False


def test_extract_own_account_ids_and_ibans(ap):
    accounts = [
        MonetaryAccountBank(id_=1, alias=_iban_alias('NL91BUNQ0000000001')),
        MonetaryAccountSavings(id_=2, alias=_iban_alias('NL91BUNQ0000000002')),
        MonetaryAccountExternal(id_=3, alias=_iban_alias('NL91TRIO0000000003')),
    ]
    assert ap.extract_own_account_ids(accounts) == {'1', '2'}
    assert ap.extract_own_ibans(accounts) == {'NL91BUNQ0000000001', 'NL91BUNQ0000000002'}


def test_extract_account_ibans_accepts_single_alias(ap):
    account = {'alias': {'type': 'IBAN', 'value': 'NL91BUNQ0000000001'}}
    assert ap.extract_account_ibans(account) == {'NL91BUNQ0000000001'}
    assert ap.extract_account_ibans(None) == set()


def _tx(tx_id, account_id, amount, date='2026-03-01T10:15:30', currency='EUR', **extra):
    tx = {
        'id': tx_id,
        'account_id': account_id,
        'amount': amount,
        'currency': currency,
        'date': date,
        'category': 'Overig',
        'is_internal_transfer': False,
    }
    tx.update(extra)
    return tx


def test_reconcile_marks_opposite_legs_on_different_own_accounts(ap):
    transactions = [
        _tx(100, '1', -50.0),
        _tx(100, '2', 50.0, date='2026-03-01T10:15:59'),  # same minute
        _tx(200, '1', -20.0),
    ]
    assert ap.reconcile_internal_transfers(transactions, {'1', '2'}) == 2
    assert transactions[0]['is_internal_transfer'] is True
    assert transactions[1]['is_internal_transfer'] is True
    assert transactions[0]['category'] == transactions[1]['category'] == 'Internal Transfer'
    assert transactions[2]['is_internal_transfer'] is False


def test_reconcile_requires_same_minute(ap):
    transactions = [
        _tx(100, '1', -50.0, date='2026-03-01T10:15:30'),
        _tx(100, '2', 50.0, date='2026-03-01T10:16:30'),
    ]
    assert ap.reconcile_internal_transfers(transactions, {'1', '2'}) == 0


def test_reconcile_requires_same_amount_and_currency(ap):
    different_amount = [_tx(100, '1', -50.0), _tx(100, '2', 49.99)]
    different_currency = [_tx(100, '1', -50.0), _tx(100, '2', 50.0, currency='ZAR')]
    assert ap.reconcile_internal_transfers(different_amount, {'1', '2'}) == 0
    assert ap.reconcile_internal_transfers(different_currency, {'1', '2'}) == 0


def test_reconcile_requires_opposite_signs_and_distinct_accounts(ap):
    same_sign = [_tx(100, '1', -50.0), _tx(100, '2', -50.0)]
    same_account = [_tx(100, '1', -50.0), _tx(100, '1', 50.0)]
    assert ap.reconcile_internal_transfers(same_sign, {'1', '2'}) == 0
    assert ap.reconcile_internal_transfers(same_account, {'1', '2'}) == 0


def test_reconcile_ignores_non_own_accounts(ap):
    transactions = [_tx(100, '1', -50.0), _tx(100, '99', 50.0)]
    assert ap.reconcile_internal_transfers(transactions, {'1', '2'}) == 0
    assert transactions[0]['is_internal_transfer'] is False


def test_reconcile_skips_already_flagged_and_undated(ap):
    transactions = [
        _tx(100, '1', -50.0, is_internal_transfer=True),
        _tx(100, '2', 50.0),
        _tx(300, '1', -5.0, date=None),
        _tx(300, '2', 5.0, date=None),
    ]
    assert ap.reconcile_internal_transfers(transactions, {'1', '2'}) == 0


def test_reconcile_empty_inputs(ap):
    assert ap.reconcile_internal_transfers([], {'1'}) == 0
    assert ap.reconcile_internal_transfers([_tx(1, '1', -1.0)], set()) == 0
    assert ap.reconcile_internal_transfers([_tx(1, '1', -1.0)], None) == 0
