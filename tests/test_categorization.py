"""Tests for transaction categorisation and account-type classification."""
from types import SimpleNamespace

import pytest


class MonetaryAccountBank(SimpleNamespace):
    pass


class MonetaryAccountSavings(SimpleNamespace):
    pass


class MonetaryAccountInvestment(SimpleNamespace):
    pass


# --- categorize_transaction --------------------------------------------------

def test_internal_flag_wins(ap):
    assert ap.categorize_transaction('Albert Heijn', 'AH', is_internal=True) == 'Internal Transfer'


@pytest.mark.parametrize('mcc, expected', [
    ('5411', 'Boodschappen'), ('5812', 'Horeca'), ('5541', 'Vervoer'), ('4900', 'Utilities'),
    ('6300', 'Verzekering'), ('9311', 'Belastingen'), ('5912', 'Zorg'), ('7832', 'Entertainment'),
    ('5815', 'Abonnementen'), ('5311', 'Shopping'),
])
def test_mcc_mapping(ap, mcc, expected):
    # MCC takes precedence over (conflicting) text signals.
    assert ap.categorize_transaction('netflix', 'something', merchant_category_code=mcc) == expected


def test_unknown_mcc_falls_through_to_text_rules(ap):
    assert ap.categorize_transaction('Jumbo Utrecht', '', merchant_category_code='0000') == 'Boodschappen'


@pytest.mark.parametrize('description, counterparty, expected', [
    ('Betaling', 'Albert Heijn 1234', 'Boodschappen'),
    ('Thuisbezorgd order', '', 'Horeca'),
    ('NS Groep reizen', '', 'Vervoer'),
    ('Huur maart', 'Verhuurder BV', 'Wonen'),
    ('Premie', 'Zilveren Kruis', 'Verzekering'),
    ('Aanslag', 'Belastingdienst', 'Belastingen'),
    ('Maandbedrag', 'Vodafone', 'Utilities'),
    ('Abonnement', 'Spotify', 'Abonnementen'),
    ('Bestelling', 'bol.com', 'Shopping'),
    ('Ticket', 'Pathé', 'Entertainment'),
    ('Recept', 'Apotheek Centrum', 'Zorg'),
    ('Iets', 'Onbekend Bedrijf', 'Overig'),
])
def test_text_rules(ap, description, counterparty, expected):
    assert ap.categorize_transaction(description, counterparty, amount=-10) == expected


def test_subscriptions_checked_before_entertainment(ap):
    # Regression: netflix/spotify must land in Abonnementen, not Entertainment.
    assert ap.categorize_transaction('Netflix.com', '', amount=-12.99) == 'Abonnementen'


@pytest.mark.parametrize('description, expected', [
    ('Refund order 123', 'Refund'),
    ('Rente Q1', 'Rente'),
    ('Salaris maart', 'Salaris'),
])
def test_incoming_amount_rules(ap, description, expected):
    assert ap.categorize_transaction(description, 'Werkgever BV', amount=100) == expected


def test_incoming_rules_only_apply_to_positive_amounts(ap):
    assert ap.categorize_transaction('Refund order 123', 'Werkgever BV', amount=-100) == 'Overig'


def test_handles_missing_text_and_bad_amount(ap):
    assert ap.categorize_transaction(None, None) == 'Overig'
    # Unparseable amount is treated as 0, so incoming-only rules (Refund/Rente) don't apply.
    assert ap.categorize_transaction('Refund order 123', '', amount='not-a-number') == 'Overig'


# --- classify_account_type ---------------------------------------------------

def test_classify_none_is_checking(ap):
    assert ap.classify_account_type(None) == 'checking'


@pytest.mark.parametrize('account, expected', [
    (MonetaryAccountBank(id=1, description='Hoofdrekening'), 'checking'),
    (MonetaryAccountSavings(id=2, description='Potje'), 'savings'),
    (MonetaryAccountInvestment(id=3, description='Stocks'), 'investment'),
    ({'id': 4, '_raw_type': 'MonetaryAccountExternalSavings'}, 'savings'),
])
def test_classify_by_class_name(ap, account, expected):
    assert ap.classify_account_type(account) == expected


def test_classify_by_savings_model_fields(ap):
    assert ap.classify_account_type(MonetaryAccountBank(id=1, savings_goal={'value': '100'})) == 'savings'


def test_classify_by_description_keywords(ap):
    assert ap.classify_account_type(MonetaryAccountBank(id=1, description='Spaargeld in ZAR')) == 'savings'
    assert ap.classify_account_type({'id': 2, 'description': 'Crypto'}) == 'investment'


def test_classify_explicit_type_fields(ap):
    assert ap.classify_account_type({'id': 1, 'sub_type': 'SAVINGS'}) == 'savings'
    assert ap.classify_account_type({'id': 2, 'monetary_account_profile': {'profile_type': 'PAYMENT'},
                                     'description': 'Spaar'}) == 'checking'
