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


@pytest.mark.parametrize('description, counterparty, expected', [
    ('Rente', 'Bank', 'Rente'),                          # outgoing interest (regression: was Wonen)
    ('Debetrente maart', '', 'Rente'),
    ('Interest charge', '', 'Rente'),
    ('Hypotheekrente', 'Hypotheek Bank', 'Wonen'),       # mortgage interest stays housing
    ('Rent march', 'Landlord Ltd', 'Wonen'),             # whole-word 'rent' still matches
    ('Parenting magazine', 'Uitgeverij', 'Overig'),      # 'rent' inside another word does not
])
def test_rent_vs_rente(ap, description, counterparty, expected):
    assert ap.categorize_transaction(description, counterparty, amount=-25) == expected


def test_incoming_rules_only_apply_to_positive_amounts(ap):
    assert ap.categorize_transaction('Refund order 123', 'Werkgever BV', amount=-100) == 'Overig'


def test_handles_missing_text_and_bad_amount(ap):
    assert ap.categorize_transaction(None, None) == 'Overig'
    # Unparseable amount is treated as 0, so incoming-only rules (Refund/Rente) don't apply.
    assert ap.categorize_transaction('Refund order 123', '', amount='not-a-number') == 'Overig'


@pytest.mark.parametrize('description, counterparty', [
    # Keywords must match whole words: these used to hit 'bar', 'ns', 'ov', 'bus',
    # 'gas', 'interest', 'shop', 'action', 'hema', 'coop', 'aldi' and 'dirk'.
    ('Bart de Vries', 'Bart de Vries'),
    ('Kapper Barbershop', ''),
    ('Terugbetaling lens', 'Pieter'),
    ('Factuur 12 nov 2025', ''),
    ('Abonnement', 'Bunq Business'),
    ('Las Vegas trip', ''),
    ('Pinterest ads', ''),
    ('Workshop fotografie', ''),
    ('Payment transaction fee', ''),
    ('Thema avond', ''),
    ('Cooper', ''),
    ('Rinaldi', ''),
    ('Tikkie', 'Dirk Jansen'),
    ('Burgerzaken', ''),
])
def test_keywords_do_not_match_inside_other_words(ap, description, counterparty):
    assert ap.categorize_transaction(description, counterparty, amount=-20) == 'Overig'


@pytest.mark.parametrize('description, counterparty, expected', [
    ('Disney Plus', 'Disney', 'Abonnementen'),          # not the Plus supermarket
    ('PLUS Tiel', '', 'Boodschappen'),
    ('Training', 'Basic-Fit', 'Sport'),                  # not 'train' -> Vervoer
    ('Gastouderbureau', '', 'Kinderopvang'),             # not 'gas' -> Utilities
    ('Kinderopvang maart', '', 'Kinderopvang'),
    ('Ticket', 'KLM', 'Reizen'),
    ('Reservering', 'Booking.com', 'Reizen'),
    ('Aankoop', 'Gamma', 'Shopping'),
    ('Autohuur', 'Sixt', 'Vervoer'),                     # not 'huur' -> Wonen
    ('Premie zorgverzekering', '', 'Verzekering'),
    ('Aankoop', 'Kruidvat', 'Zorg'),                     # same as drugstore MCC 5912
    ('Café de Zwaan', '', 'Horeca'),                     # accents are ignored
    ('Pathe Arena', '', 'Entertainment'),
    ('Terugbetaling', 'Dirk van den Broek', 'Boodschappen'),
])
def test_specific_rules_win(ap, description, counterparty, expected):
    assert ap.categorize_transaction(description, counterparty, amount=-20) == expected


@pytest.mark.parametrize('mcc, expected', [
    ('4112', 'Vervoer'), ('7523', 'Vervoer'), ('5983', 'Vervoer'), ('4511', 'Reizen'), ('3050', 'Reizen'),
    ('7011', 'Reizen'), ('5200', 'Shopping'), ('5310', 'Shopping'), ('5691', 'Shopping'), ('8043', 'Zorg'),
    ('8062', 'Zorg'), ('7997', 'Sport'), ('8351', 'Kinderopvang'),
])
def test_added_mcc_codes(ap, mcc, expected):
    assert ap.categorize_transaction('x', 'y', merchant_category_code=mcc, amount=-10) == expected


@pytest.mark.parametrize('description, counterparty, mcc, expected', [
    ('Tikkie pizza', 'Jan', None, 'Refund'),                      # money back for a shared dinner
    ('Albert Heijn', '', '5411', 'Refund'),                       # card reversal
    ('Jaarafrekening', 'Eneco', None, 'Refund'),
    ('Toeslag', 'Belastingdienst', None, 'Belastingen'),          # allowances stay tax
    ('Huurtoeslag', 'Belastingdienst', None, 'Belastingen'),
    ('Declaratie', 'Zilveren Kruis', None, 'Verzekering'),
    ('Terugbetaling', 'Wagenaar', None, 'Refund'),
    ('Voor de boodschappen', 'Wagenaar', None, 'Overig'),         # 'wage' is a whole word only
])
def test_incoming_money(ap, description, counterparty, mcc, expected):
    assert ap.categorize_transaction(description, counterparty, merchant_category_code=mcc, amount=25) == expected


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


@pytest.mark.parametrize('description, expected', [
    ('Shared household', 'checking'),     # 'share' only as a whole word
    ('Stockholm reis', 'checking'),       # 'stock' only as a whole word
    ('Share account', 'investment'),
    ('Beleggingen', 'investment'),
    ('Crypto wallet', 'investment'),
    ('Vakantie sparen', 'savings'),
])
def test_account_name_hints_match_whole_words(ap, description, expected):
    assert ap.classify_account_type(MonetaryAccountBank(description=description)) == expected
