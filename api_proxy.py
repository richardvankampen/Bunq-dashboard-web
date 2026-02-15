#!/usr/bin/env python3
"""
Bunq Dashboard API Proxy - Secure Edition v3.0
Flask backend with SESSION-BASED authentication
READ-ONLY Bunq API access for maximum security
SECURED with session cookies and rate limiting
"""

from flask import Flask, jsonify, request, Response, session, make_response, send_from_directory, abort
from flask_cors import CORS
from flask_caching import Cache
from functools import wraps
from bunq.sdk.context.api_context import ApiContext
from bunq.sdk.context.api_environment_type import ApiEnvironmentType
from bunq.sdk.context.bunq_context import BunqContext
from bunq.sdk.model.generated import endpoint
from datetime import datetime, timedelta, timezone
import os
import json
import requests
import logging
import hashlib
import time
import sqlite3
import secrets
import uuid
import importlib
import pkgutil
import inspect
import re
import ipaddress
import shutil
import subprocess
import threading
from collections import defaultdict

# ============================================
# LOGGING CONFIGURATION
# ============================================

APP_DIR = os.path.abspath(os.path.dirname(__file__))
LOG_DIR = os.path.join(APP_DIR, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=os.getenv('LOG_LEVEL', 'INFO'),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, 'bunq_api.log')),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

def get_int_env(name, default):
    value = os.getenv(name)
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning(f"⚠️ Invalid {name}='{value}', using default {default}")
        return default

def get_bool_env(name, default=False):
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')

_MONETARY_ACCOUNT_ENDPOINT = None
_PAYMENT_ENDPOINT = None
_PAYMENT_LIST_MODE = None
_CREDENTIAL_PASSWORD_ENDPOINT = None
_CREDENTIAL_PASSWORD_LIST_MODE = None
_CREDENTIAL_PASSWORD_IP_ENDPOINT = None
_CREDENTIAL_PASSWORD_IP_LIST_MODE = None
_CREDENTIAL_PASSWORD_IP_CREATE_MODE = None
_CREDENTIAL_PASSWORD_IP_UPDATE_MODE = None
_FX_RUNTIME_CACHE = {}
_VAULTWARDEN_CLI_LOCK = threading.Lock()

def get_obj_field(obj, *field_names, default=None):
    """Read first non-empty field from objects or dictionaries."""
    if obj is None:
        return default

    for field_name in field_names:
        value = None
        if isinstance(obj, dict):
            value = obj.get(field_name)
        else:
            value = getattr(obj, field_name, None)
        if value is not None:
            return value
    return default

def _has_zero_required_positional_args(callable_obj):
    try:
        signature = inspect.signature(callable_obj)
    except (TypeError, ValueError):
        return False

    for parameter in signature.parameters.values():
        if parameter.kind not in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
            continue
        if parameter.default is inspect.Parameter.empty:
            return False
    return True

def _is_monetary_list_endpoint(name, candidate):
    if candidate is None:
        return False
    if not callable(getattr(candidate, 'list', None)):
        return False
    normalized = name.lower().replace('_', '')
    if not normalized.startswith('monetaryaccount'):
        return False
    return _has_zero_required_positional_args(candidate.list)

def discover_monetary_account_endpoints():
    """Discover monetary-account endpoints ordered by preference."""
    direct_candidates = (
        'MonetaryAccountBank',
        'MonetaryAccountSavings',
        'MonetaryAccountInvestment',
        'MonetaryAccount',
    )
    discovered = []
    seen = set()

    def add_candidate(display_name, candidate_name, candidate_obj):
        if not _is_monetary_list_endpoint(candidate_name, candidate_obj):
            return
        candidate_id = id(candidate_obj)
        if candidate_id in seen:
            return
        seen.add(candidate_id)
        discovered.append((display_name, candidate_obj))

    # Prefer official direct names first.
    for name in direct_candidates:
        add_candidate(name, name, getattr(endpoint, name, None))

    # Then scan root endpoint exports.
    for attr_name in dir(endpoint):
        if attr_name in direct_candidates:
            continue
        add_candidate(attr_name, attr_name, getattr(endpoint, attr_name, None))

    # Finally scan endpoint submodules for sdk variants that don't re-export at root.
    endpoint_path = getattr(endpoint, '__path__', None)
    if endpoint_path:
        base_module = endpoint.__name__
        for module_info in pkgutil.iter_modules(endpoint_path):
            module_name = module_info.name
            normalized_module = module_name.lower().replace('_', '')
            if not normalized_module.startswith('monetaryaccount'):
                continue
            try:
                module = importlib.import_module(f"{base_module}.{module_name}")
            except Exception:
                continue

            # Prefer direct names in each module first.
            for class_name in direct_candidates:
                add_candidate(
                    f"{module_name}.{class_name}",
                    class_name,
                    getattr(module, class_name, None),
                )
            for class_name in dir(module):
                if class_name in direct_candidates:
                    continue
                add_candidate(
                    f"{module_name}.{class_name}",
                    class_name,
                    getattr(module, class_name, None),
                )

    return discovered

def list_monetary_accounts():
    """Return monetary accounts with bunq-sdk compatibility across versions."""
    global _MONETARY_ACCOUNT_ENDPOINT

    candidates = []
    if _MONETARY_ACCOUNT_ENDPOINT is not None:
        candidates.append(("cached", _MONETARY_ACCOUNT_ENDPOINT))

    for name, candidate in discover_monetary_account_endpoints():
        if _MONETARY_ACCOUNT_ENDPOINT is not None and candidate is _MONETARY_ACCOUNT_ENDPOINT:
            continue
        candidates.append((name, candidate))

    if not candidates:
        raise RuntimeError('bunq-sdk missing monetary account endpoint')

    merged_accounts = []
    seen_account_ids = set()
    last_exc = None
    for name, account_endpoint in candidates:
        try:
            result = account_endpoint.list()
            accounts = getattr(result, 'value', result)
            if accounts is None:
                accounts = []

            accounts_added = 0
            for account in accounts:
                account_id = get_obj_field(account, 'id_', 'id')
                dedupe_key = account_id if account_id is not None else f"obj:{id(account)}"
                if dedupe_key in seen_account_ids:
                    continue
                seen_account_ids.add(dedupe_key)
                merged_accounts.append(account)
                accounts_added += 1

            if _MONETARY_ACCOUNT_ENDPOINT is None:
                _MONETARY_ACCOUNT_ENDPOINT = account_endpoint
            logger.info(f"Using bunq endpoint class: {name} (+{accounts_added} accounts)")
        except Exception as exc:
            last_exc = exc
            logger.warning(f"⚠️ Bunq endpoint {name} failed: {exc}")

    if merged_accounts:
        return merged_accounts

    raise RuntimeError(f"bunq-sdk monetary account list failed: {last_exc}")

def discover_account_type_hints():
    """
    Build account-type hints from endpoint names when available.
    Useful for SDK variants where savings products are represented as bank accounts.
    """
    hints = {}
    for name, account_endpoint in discover_monetary_account_endpoints():
        normalized = str(name or '').lower().replace('_', '').replace('-', '').replace('.', '')
        hinted_type = None
        if 'savings' in normalized:
            hinted_type = 'savings'
        elif any(token in normalized for token in ('investment', 'stock', 'crypto')):
            hinted_type = 'investment'

        if hinted_type is None:
            continue

        try:
            result = account_endpoint.list()
            accounts = getattr(result, 'value', result)
            if accounts is None:
                continue
            for account in accounts:
                account_id = get_obj_field(account, 'id_', 'id')
                if account_id is None:
                    continue
                key = str(account_id)
                if hints.get(key) == 'savings':
                    continue
                hints[key] = hinted_type
        except Exception as exc:
            logger.warning(f"⚠️ Account type hint endpoint {name} failed: {exc}")

    return hints

def _is_payment_list_endpoint(name, candidate):
    if candidate is None:
        return False
    if not callable(getattr(candidate, 'list', None)):
        return False
    normalized = name.lower().replace('_', '')
    if 'payment' not in normalized:
        return False
    # Support SDK variants such as MonetaryAccountBankPayment(ApiObject)
    # while still avoiding unrelated payment-like endpoints.
    if not (normalized.startswith('payment') or normalized.startswith('monetaryaccount')):
        return False
    if any(blocked in normalized for blocked in ('attachment', 'batch', 'draft', 'request', 'schedule')):
        return False
    return True

def discover_payment_endpoints():
    """Discover payment endpoints ordered by preference."""
    direct_candidates = (
        'Payment',
        'PaymentApiObject',
        'MonetaryAccountPayment',
        'MonetaryAccountPaymentApiObject',
        'MonetaryAccountBankPayment',
        'MonetaryAccountBankPaymentApiObject',
    )
    discovered = []
    seen = set()

    def add_candidate(display_name, candidate_name, candidate_obj):
        if not _is_payment_list_endpoint(candidate_name, candidate_obj):
            return
        candidate_id = id(candidate_obj)
        if candidate_id in seen:
            return
        seen.add(candidate_id)
        discovered.append((display_name, candidate_obj))

    for name in direct_candidates:
        add_candidate(name, name, getattr(endpoint, name, None))

    for attr_name in dir(endpoint):
        if attr_name in direct_candidates:
            continue
        add_candidate(attr_name, attr_name, getattr(endpoint, attr_name, None))

    endpoint_path = getattr(endpoint, '__path__', None)
    if endpoint_path:
        base_module = endpoint.__name__
        for module_info in pkgutil.iter_modules(endpoint_path):
            module_name = module_info.name
            normalized_module = module_name.lower().replace('_', '')
            if 'payment' not in normalized_module:
                continue
            if any(blocked in normalized_module for blocked in ('attachment', 'batch', 'draft', 'request', 'schedule')):
                continue
            try:
                module = importlib.import_module(f"{base_module}.{module_name}")
            except Exception:
                continue
            for class_name in direct_candidates:
                add_candidate(
                    f"{module_name}.{class_name}",
                    class_name,
                    getattr(module, class_name, None),
                )
            for class_name in dir(module):
                if class_name in direct_candidates:
                    continue
                add_candidate(
                    f"{module_name}.{class_name}",
                    class_name,
                    getattr(module, class_name, None),
                )

    return discovered

def _call_payment_list(payment_endpoint, account_id, mode, params=None):
    query_params = params or {}
    if mode == 'kw_monetary_account_id':
        return payment_endpoint.list(monetary_account_id=account_id)
    if mode == 'kw_monetary_account_id_params':
        return payment_endpoint.list(monetary_account_id=account_id, params=query_params)
    if mode == 'kw_account_id':
        return payment_endpoint.list(account_id=account_id)
    if mode == 'kw_account_id_params':
        return payment_endpoint.list(account_id=account_id, params=query_params)
    if mode == 'kw_monetary_account_bank_id':
        return payment_endpoint.list(monetary_account_bank_id=account_id)
    if mode == 'kw_monetary_account_bank_id_params':
        return payment_endpoint.list(monetary_account_bank_id=account_id, params=query_params)
    if mode == 'positional':
        return payment_endpoint.list(account_id)
    if mode == 'positional_with_count':
        return payment_endpoint.list(account_id, {'count': query_params.get('count')})
    if mode == 'positional_with_params':
        return payment_endpoint.list(account_id, query_params)
    raise RuntimeError(f"Unknown payment list mode: {mode}")

def _extract_payment_created_datetime(payment):
    created_raw = get_obj_field(payment, 'created', 'created_at', 'date')
    if not created_raw:
        return None
    return parse_bunq_datetime(created_raw, context='payment paging created')

def _extract_payment_numeric_id(payment):
    payment_id = get_obj_field(payment, 'id_', 'id')
    if payment_id is None:
        return None
    try:
        return int(payment_id)
    except (TypeError, ValueError):
        return None

def list_payments_for_account(account_id, cutoff_date=None):
    """List payments for one monetary account across bunq-sdk variants."""
    global _PAYMENT_ENDPOINT, _PAYMENT_LIST_MODE

    page_size = get_int_env('BUNQ_PAYMENT_PAGE_SIZE', 200)
    if page_size < 1:
        page_size = 200
    if page_size > 200:
        page_size = 200
    max_pages = get_int_env('BUNQ_PAYMENT_MAX_PAGES', 50)
    if max_pages < 1:
        max_pages = 50

    modes = (
        'kw_monetary_account_id_params',
        'kw_monetary_account_id',
        'kw_account_id_params',
        'kw_account_id',
        'kw_monetary_account_bank_id_params',
        'kw_monetary_account_bank_id',
        'positional_with_count',
        'positional',
        'positional_with_params',
    )

    candidates = []
    if _PAYMENT_ENDPOINT is not None and _PAYMENT_LIST_MODE is not None:
        candidates.append(('cached', _PAYMENT_ENDPOINT, (_PAYMENT_LIST_MODE,)))

    for name, candidate in discover_payment_endpoints():
        if _PAYMENT_ENDPOINT is not None and candidate is _PAYMENT_ENDPOINT:
            continue
        candidates.append((name, candidate, modes))

    if not candidates:
        payment_like = [name for name in dir(endpoint) if 'payment' in name.lower()]
        logger.error(
            "❌ No payment endpoints discovered. payment-like exports: %s",
            payment_like[:20] if payment_like else 'none'
        )
        raise RuntimeError('bunq-sdk missing payment endpoint')

    last_exc = None
    for name, payment_endpoint, candidate_modes in candidates:
        for mode in candidate_modes:
            older_id = None
            collected = []
            seen_payment_ids = set()

            try:
                for _ in range(max_pages):
                    query_params = {'count': page_size}
                    if older_id is not None:
                        query_params['older_id'] = older_id

                    result = _call_payment_list(payment_endpoint, account_id, mode, params=query_params)
                    payments = getattr(result, 'value', result)
                    if payments is None:
                        payments = []
                    if not isinstance(payments, list):
                        payments = list(payments)
                    if not payments:
                        break

                    oldest_payment_id = None
                    oldest_payment_created = None

                    for payment in payments:
                        payment_id_raw = get_obj_field(payment, 'id_', 'id')
                        dedupe_key = str(payment_id_raw) if payment_id_raw is not None else f"obj:{id(payment)}"
                        if dedupe_key in seen_payment_ids:
                            continue
                        seen_payment_ids.add(dedupe_key)
                        collected.append(payment)

                        payment_id = _extract_payment_numeric_id(payment)
                        if payment_id is not None:
                            if oldest_payment_id is None or payment_id < oldest_payment_id:
                                oldest_payment_id = payment_id

                        created_at = _extract_payment_created_datetime(payment)
                        if created_at is not None:
                            if oldest_payment_created is None or created_at < oldest_payment_created:
                                oldest_payment_created = created_at

                    if cutoff_date and oldest_payment_created and oldest_payment_created < cutoff_date:
                        break

                    if len(payments) < page_size:
                        break
                    if oldest_payment_id is None:
                        break
                    if older_id is not None and oldest_payment_id == older_id:
                        break
                    older_id = oldest_payment_id

                if _PAYMENT_ENDPOINT is not payment_endpoint or _PAYMENT_LIST_MODE != mode:
                    logger.info(f"Using bunq payment endpoint: {name} ({mode})")
                _PAYMENT_ENDPOINT = payment_endpoint
                _PAYMENT_LIST_MODE = mode
                return collected
            except TypeError as exc:
                last_exc = exc
                continue
            except Exception as exc:
                last_exc = exc
                logger.warning(f"⚠️ Bunq payment endpoint {name} ({mode}) failed: {exc}")
                break

    raise RuntimeError(f"bunq-sdk payment list failed: {last_exc}")

def _unwrap_endpoint_result(result):
    value = getattr(result, 'value', result)
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    try:
        return list(value)
    except TypeError:
        return [value]

def _normalize_endpoint_name(name):
    return str(name or '').lower().replace('_', '').replace('-', '').replace('.', '')

def _is_credential_password_endpoint(name_hint, candidate):
    if candidate is None or not callable(getattr(candidate, 'list', None)):
        return False
    normalized = _normalize_endpoint_name(name_hint)
    if not normalized.startswith('credentialpasswordip'):
        return False
    # Exclude the nested /ip endpoint class here.
    if 'credentialpasswordipip' in normalized:
        return False
    return True

def _is_credential_password_ip_endpoint(name_hint, candidate):
    if candidate is None or not callable(getattr(candidate, 'list', None)):
        return False
    normalized = _normalize_endpoint_name(name_hint)
    if 'credentialpasswordip' not in normalized:
        return False
    if 'credentialpasswordipip' not in normalized and not normalized.endswith('ip'):
        return False
    return callable(getattr(candidate, 'create', None)) or callable(getattr(candidate, 'post', None))

def discover_credential_password_endpoints():
    direct_candidates = (
        'CredentialPasswordIp',
        'CredentialPasswordIpApiObject',
    )
    discovered = []
    seen = set()

    def add_candidate(display_name, candidate_name, candidate_obj):
        name_hint = f"{display_name}.{candidate_name}" if display_name else candidate_name
        if not _is_credential_password_endpoint(name_hint, candidate_obj):
            return
        candidate_id = id(candidate_obj)
        if candidate_id in seen:
            return
        seen.add(candidate_id)
        discovered.append((name_hint, candidate_obj))

    for name in direct_candidates:
        add_candidate('', name, getattr(endpoint, name, None))

    for attr_name in dir(endpoint):
        if attr_name in direct_candidates:
            continue
        add_candidate('', attr_name, getattr(endpoint, attr_name, None))

    endpoint_path = getattr(endpoint, '__path__', None)
    if endpoint_path:
        base_module = endpoint.__name__
        for module_info in pkgutil.iter_modules(endpoint_path):
            module_name = module_info.name
            normalized_module = _normalize_endpoint_name(module_name)
            if 'credentialpasswordip' not in normalized_module:
                continue
            try:
                module = importlib.import_module(f"{base_module}.{module_name}")
            except Exception:
                continue

            for class_name in direct_candidates:
                add_candidate(module_name, class_name, getattr(module, class_name, None))
            for class_name in dir(module):
                if class_name in direct_candidates:
                    continue
                add_candidate(module_name, class_name, getattr(module, class_name, None))

    return discovered

def discover_credential_password_ip_endpoints():
    direct_candidates = (
        'CredentialPasswordIpIp',
        'CredentialPasswordIpIpApiObject',
    )
    discovered = []
    seen = set()

    def add_candidate(display_name, candidate_name, candidate_obj):
        name_hint = f"{display_name}.{candidate_name}" if display_name else candidate_name
        if not _is_credential_password_ip_endpoint(name_hint, candidate_obj):
            return
        candidate_id = id(candidate_obj)
        if candidate_id in seen:
            return
        seen.add(candidate_id)
        discovered.append((name_hint, candidate_obj))

    for name in direct_candidates:
        add_candidate('', name, getattr(endpoint, name, None))

    for attr_name in dir(endpoint):
        if attr_name in direct_candidates:
            continue
        add_candidate('', attr_name, getattr(endpoint, attr_name, None))

    endpoint_path = getattr(endpoint, '__path__', None)
    if endpoint_path:
        base_module = endpoint.__name__
        for module_info in pkgutil.iter_modules(endpoint_path):
            module_name = module_info.name
            normalized_module = _normalize_endpoint_name(module_name)
            if 'credentialpasswordip' not in normalized_module:
                continue
            try:
                module = importlib.import_module(f"{base_module}.{module_name}")
            except Exception:
                continue

            for class_name in direct_candidates:
                add_candidate(module_name, class_name, getattr(module, class_name, None))
            for class_name in dir(module):
                if class_name in direct_candidates:
                    continue
                add_candidate(module_name, class_name, getattr(module, class_name, None))

    return discovered

def get_bunq_user_id():
    try:
        user_context = BunqContext.user_context()
    except Exception as exc:
        logger.warning(f"⚠️ Unable to read Bunq user context: {exc}")
        return None

    for attr_name in ('user_id', 'user_id_', 'id_', 'id'):
        value = getattr(user_context, attr_name, None)
        if value:
            return value
    getter = getattr(user_context, 'get_user_id', None)
    if callable(getter):
        try:
            value = getter()
            if value:
                return value
        except Exception:
            pass
    return None

def _call_credential_password_list(password_endpoint, user_id, mode):
    if mode == 'kw_user_id':
        return password_endpoint.list(user_id=user_id)
    if mode == 'positional_user_id':
        return password_endpoint.list(user_id)
    if mode == 'no_args':
        return password_endpoint.list()
    raise RuntimeError(f"Unknown credential-password list mode: {mode}")

def list_credential_password_profiles(user_id):
    global _CREDENTIAL_PASSWORD_ENDPOINT, _CREDENTIAL_PASSWORD_LIST_MODE

    modes = ('kw_user_id', 'positional_user_id', 'no_args')
    candidates = []
    if _CREDENTIAL_PASSWORD_ENDPOINT is not None and _CREDENTIAL_PASSWORD_LIST_MODE is not None:
        candidates.append(('cached', _CREDENTIAL_PASSWORD_ENDPOINT, (_CREDENTIAL_PASSWORD_LIST_MODE,)))

    for name, candidate in discover_credential_password_endpoints():
        if _CREDENTIAL_PASSWORD_ENDPOINT is not None and candidate is _CREDENTIAL_PASSWORD_ENDPOINT:
            continue
        candidates.append((name, candidate, modes))

    if not candidates:
        raise RuntimeError('bunq-sdk missing credential-password endpoint')

    last_exc = None
    for name, password_endpoint, candidate_modes in candidates:
        for mode in candidate_modes:
            try:
                result = _call_credential_password_list(password_endpoint, user_id, mode)
                profiles = _unwrap_endpoint_result(result)
                if _CREDENTIAL_PASSWORD_ENDPOINT is not password_endpoint or _CREDENTIAL_PASSWORD_LIST_MODE != mode:
                    logger.info(f"Using bunq credential endpoint: {name} ({mode})")
                _CREDENTIAL_PASSWORD_ENDPOINT = password_endpoint
                _CREDENTIAL_PASSWORD_LIST_MODE = mode
                return profiles
            except TypeError as exc:
                last_exc = exc
                continue
            except Exception as exc:
                last_exc = exc
                logger.warning(f"⚠️ Bunq credential endpoint {name} ({mode}) failed: {exc}")
                break

    raise RuntimeError(f"bunq-sdk credential-password list failed: {last_exc}")

def _call_credential_password_ip_list(ip_endpoint, user_id, credential_password_ip_id, mode):
    if mode == 'kw_user_credential':
        return ip_endpoint.list(user_id=user_id, credential_password_ip_id=credential_password_ip_id)
    if mode == 'positional_user_credential':
        return ip_endpoint.list(user_id, credential_password_ip_id)
    if mode == 'kw_credential_only':
        return ip_endpoint.list(credential_password_ip_id=credential_password_ip_id)
    if mode == 'positional_credential_only':
        return ip_endpoint.list(credential_password_ip_id)
    raise RuntimeError(f"Unknown credential-password-ip list mode: {mode}")

def _call_credential_password_ip_create(ip_endpoint, user_id, credential_password_ip_id, payload, mode):
    creator = getattr(ip_endpoint, 'create', None) or getattr(ip_endpoint, 'post', None)
    if not callable(creator):
        raise RuntimeError('Endpoint has no create/post method')
    if mode == 'kw_user_credential_payload':
        return creator(user_id=user_id, credential_password_ip_id=credential_password_ip_id, data=payload)
    if mode == 'kw_user_credential_object':
        return creator(user_id=user_id, credential_password_ip_id=credential_password_ip_id, object_=payload)
    if mode == 'positional_user_credential_payload':
        return creator(user_id, credential_password_ip_id, payload)
    if mode == 'kw_credential_payload':
        return creator(credential_password_ip_id=credential_password_ip_id, data=payload)
    if mode == 'positional_credential_payload':
        return creator(credential_password_ip_id, payload)
    raise RuntimeError(f"Unknown credential-password-ip create mode: {mode}")

def _call_credential_password_ip_update(ip_endpoint, user_id, credential_password_ip_id, ip_entry_id, payload, mode):
    updater = getattr(ip_endpoint, 'update', None) or getattr(ip_endpoint, 'put', None)
    if not callable(updater):
        raise RuntimeError('Endpoint has no update/put method')
    if mode == 'kw_full_payload':
        return updater(
            user_id=user_id,
            credential_password_ip_id=credential_password_ip_id,
            credential_password_ip_ip_id=ip_entry_id,
            data=payload
        )
    if mode == 'kw_full_ip_id':
        return updater(
            user_id=user_id,
            credential_password_ip_id=credential_password_ip_id,
            ip_id=ip_entry_id,
            data=payload
        )
    if mode == 'kw_full_item_id':
        return updater(
            user_id=user_id,
            credential_password_ip_id=credential_password_ip_id,
            item_id=ip_entry_id,
            data=payload
        )
    if mode == 'positional_full_payload':
        return updater(user_id, credential_password_ip_id, ip_entry_id, payload)
    if mode == 'kw_credential_ip_payload':
        return updater(
            credential_password_ip_id=credential_password_ip_id,
            credential_password_ip_ip_id=ip_entry_id,
            data=payload
        )
    if mode == 'positional_credential_ip_payload':
        return updater(credential_password_ip_id, ip_entry_id, payload)
    raise RuntimeError(f"Unknown credential-password-ip update mode: {mode}")

def list_credential_password_ip_entries(user_id, credential_password_ip_id):
    global _CREDENTIAL_PASSWORD_IP_ENDPOINT, _CREDENTIAL_PASSWORD_IP_LIST_MODE

    modes = (
        'kw_user_credential',
        'positional_user_credential',
        'kw_credential_only',
        'positional_credential_only',
    )
    candidates = []
    if _CREDENTIAL_PASSWORD_IP_ENDPOINT is not None and _CREDENTIAL_PASSWORD_IP_LIST_MODE is not None:
        candidates.append(('cached', _CREDENTIAL_PASSWORD_IP_ENDPOINT, (_CREDENTIAL_PASSWORD_IP_LIST_MODE,)))

    for name, candidate in discover_credential_password_ip_endpoints():
        if _CREDENTIAL_PASSWORD_IP_ENDPOINT is not None and candidate is _CREDENTIAL_PASSWORD_IP_ENDPOINT:
            continue
        candidates.append((name, candidate, modes))

    if not candidates:
        raise RuntimeError('bunq-sdk missing credential-password-ip endpoint')

    last_exc = None
    for name, ip_endpoint, candidate_modes in candidates:
        for mode in candidate_modes:
            try:
                result = _call_credential_password_ip_list(ip_endpoint, user_id, credential_password_ip_id, mode)
                entries = _unwrap_endpoint_result(result)
                if _CREDENTIAL_PASSWORD_IP_ENDPOINT is not ip_endpoint or _CREDENTIAL_PASSWORD_IP_LIST_MODE != mode:
                    logger.info(f"Using bunq credential-ip endpoint: {name} ({mode})")
                _CREDENTIAL_PASSWORD_IP_ENDPOINT = ip_endpoint
                _CREDENTIAL_PASSWORD_IP_LIST_MODE = mode
                return entries
            except TypeError as exc:
                last_exc = exc
                continue
            except Exception as exc:
                last_exc = exc
                logger.warning(f"⚠️ Bunq credential-ip endpoint {name} ({mode}) failed: {exc}")
                break

    raise RuntimeError(f"bunq-sdk credential-password-ip list failed: {last_exc}")

def create_credential_password_ip_entry(user_id, credential_password_ip_id, payload):
    global _CREDENTIAL_PASSWORD_IP_ENDPOINT, _CREDENTIAL_PASSWORD_IP_CREATE_MODE

    modes = (
        'kw_user_credential_payload',
        'kw_user_credential_object',
        'positional_user_credential_payload',
        'kw_credential_payload',
        'positional_credential_payload',
    )
    candidates = []
    if _CREDENTIAL_PASSWORD_IP_ENDPOINT is not None and _CREDENTIAL_PASSWORD_IP_CREATE_MODE is not None:
        candidates.append(('cached', _CREDENTIAL_PASSWORD_IP_ENDPOINT, (_CREDENTIAL_PASSWORD_IP_CREATE_MODE,)))

    for name, candidate in discover_credential_password_ip_endpoints():
        if _CREDENTIAL_PASSWORD_IP_ENDPOINT is not None and candidate is _CREDENTIAL_PASSWORD_IP_ENDPOINT:
            continue
        candidates.append((name, candidate, modes))

    last_exc = None
    for name, ip_endpoint, candidate_modes in candidates:
        for mode in candidate_modes:
            try:
                result = _call_credential_password_ip_create(ip_endpoint, user_id, credential_password_ip_id, payload, mode)
                if _CREDENTIAL_PASSWORD_IP_ENDPOINT is not ip_endpoint or _CREDENTIAL_PASSWORD_IP_CREATE_MODE != mode:
                    logger.info(f"Using bunq credential-ip create mode: {name} ({mode})")
                _CREDENTIAL_PASSWORD_IP_ENDPOINT = ip_endpoint
                _CREDENTIAL_PASSWORD_IP_CREATE_MODE = mode
                return result
            except TypeError as exc:
                last_exc = exc
                continue
            except Exception as exc:
                last_exc = exc
                logger.warning(f"⚠️ Bunq credential-ip create {name} ({mode}) failed: {exc}")
                break

    raise RuntimeError(f"bunq-sdk credential-password-ip create failed: {last_exc}")

def update_credential_password_ip_entry(user_id, credential_password_ip_id, ip_entry_id, payload):
    global _CREDENTIAL_PASSWORD_IP_ENDPOINT, _CREDENTIAL_PASSWORD_IP_UPDATE_MODE

    modes = (
        'kw_full_payload',
        'kw_full_ip_id',
        'kw_full_item_id',
        'positional_full_payload',
        'kw_credential_ip_payload',
        'positional_credential_ip_payload',
    )
    candidates = []
    if _CREDENTIAL_PASSWORD_IP_ENDPOINT is not None and _CREDENTIAL_PASSWORD_IP_UPDATE_MODE is not None:
        candidates.append(('cached', _CREDENTIAL_PASSWORD_IP_ENDPOINT, (_CREDENTIAL_PASSWORD_IP_UPDATE_MODE,)))

    for name, candidate in discover_credential_password_ip_endpoints():
        if _CREDENTIAL_PASSWORD_IP_ENDPOINT is not None and candidate is _CREDENTIAL_PASSWORD_IP_ENDPOINT:
            continue
        candidates.append((name, candidate, modes))

    last_exc = None
    for name, ip_endpoint, candidate_modes in candidates:
        for mode in candidate_modes:
            try:
                result = _call_credential_password_ip_update(
                    ip_endpoint,
                    user_id,
                    credential_password_ip_id,
                    ip_entry_id,
                    payload,
                    mode
                )
                if _CREDENTIAL_PASSWORD_IP_ENDPOINT is not ip_endpoint or _CREDENTIAL_PASSWORD_IP_UPDATE_MODE != mode:
                    logger.info(f"Using bunq credential-ip update mode: {name} ({mode})")
                _CREDENTIAL_PASSWORD_IP_ENDPOINT = ip_endpoint
                _CREDENTIAL_PASSWORD_IP_UPDATE_MODE = mode
                return result
            except TypeError as exc:
                last_exc = exc
                continue
            except Exception as exc:
                last_exc = exc
                logger.warning(f"⚠️ Bunq credential-ip update {name} ({mode}) failed: {exc}")
                break

    raise RuntimeError(f"bunq-sdk credential-password-ip update failed: {last_exc}")

def validate_ipv4_or_none(ip_value, require_public=False):
    if ip_value is None:
        return None
    candidate = str(ip_value).strip()
    if not candidate:
        return None
    parsed = ipaddress.ip_address(candidate)
    if parsed.version != 4:
        raise ValueError(f"Only IPv4 is supported by Bunq allowlist (received {candidate})")
    if require_public and not parsed.is_global:
        raise ValueError(f"Bunq allowlist requires a public/external IPv4 (received {candidate})")
    return str(parsed)

def extract_credential_profile_id(profile):
    return get_obj_field(profile, 'id_', 'id')

def extract_whitelist_ip_entry(entry):
    entry_id = get_obj_field(entry, 'id_', 'id')
    status = str(get_obj_field(entry, 'status', default='')).strip().upper()
    raw_ip = get_obj_field(entry, 'ip')
    ip_value = ''
    if isinstance(raw_ip, dict):
        ip_value = str(raw_ip.get('ip') or raw_ip.get('value') or '').strip()
    elif hasattr(raw_ip, 'ip'):
        ip_value = str(getattr(raw_ip, 'ip')).strip()
    elif raw_ip is not None:
        ip_value = str(raw_ip).strip()
    return {
        'id': entry_id,
        'ip': ip_value,
        'status': status,
    }

def pick_credential_password_profile(profiles):
    preferred_id = os.getenv('BUNQ_CREDENTIAL_PASSWORD_IP_ID', '').strip()
    if preferred_id:
        for profile in profiles:
            profile_id = str(extract_credential_profile_id(profile) or '').strip()
            if profile_id == preferred_id:
                return profile

    active_profiles = []
    for profile in profiles:
        status = str(get_obj_field(profile, 'status', default='')).strip().upper()
        if status == 'ACTIVE':
            active_profiles.append(profile)
    target_pool = active_profiles if active_profiles else profiles
    # Most recent profile usually has the highest id.
    sorted_profiles = sorted(
        target_pool,
        key=lambda item: int(get_obj_field(item, 'id_', 'id', default=0) or 0),
        reverse=True
    )
    return sorted_profiles[0] if sorted_profiles else None

def set_bunq_api_whitelist_ip(target_ip=None, deactivate_others=False):
    """
    Ensure target IPv4 is ACTIVE in Bunq API allowlist via SDK endpoints.
    """
    try:
        resolved_target_ip = validate_ipv4_or_none(target_ip, require_public=True)
        if not resolved_target_ip:
            resolved_target_ip = validate_ipv4_or_none(get_public_egress_ip(), require_public=True)
    except ValueError as exc:
        return {
            'success': False,
            'error': str(exc)
        }
    if not resolved_target_ip:
        return {
            'success': False,
            'error': 'Unable to determine target IPv4 for Bunq allowlist'
        }

    user_id = get_bunq_user_id()
    if not user_id:
        return {
            'success': False,
            'error': 'Unable to resolve Bunq user_id from current session context'
        }

    try:
        profiles = list_credential_password_profiles(user_id)
        if not profiles:
            return {
                'success': False,
                'error': 'No credential-password profiles returned by Bunq API'
            }

        selected_profile = pick_credential_password_profile(profiles)
        credential_password_ip_id = extract_credential_profile_id(selected_profile)
        if not credential_password_ip_id:
            return {
                'success': False,
                'error': 'Unable to determine credential_password_ip_id'
            }

        entries = list_credential_password_ip_entries(user_id, credential_password_ip_id)
        normalized_entries = [extract_whitelist_ip_entry(item) for item in entries]

        actions = {
            'created': [],
            'activated': [],
            'deactivated': [],
            'unchanged': [],
        }

        matching_entry = None
        for entry in normalized_entries:
            if entry.get('ip') == resolved_target_ip:
                matching_entry = entry
                break

        if matching_entry is None:
            create_credential_password_ip_entry(
                user_id,
                credential_password_ip_id,
                {'ip': resolved_target_ip, 'status': 'ACTIVE'}
            )
            actions['created'].append(resolved_target_ip)
        elif matching_entry.get('status') != 'ACTIVE':
            matching_entry_id = matching_entry.get('id')
            if not matching_entry_id:
                create_credential_password_ip_entry(
                    user_id,
                    credential_password_ip_id,
                    {'ip': resolved_target_ip, 'status': 'ACTIVE'}
                )
                actions['created'].append(resolved_target_ip)
            else:
                update_credential_password_ip_entry(
                    user_id,
                    credential_password_ip_id,
                    matching_entry_id,
                    {'ip': resolved_target_ip, 'status': 'ACTIVE'}
                )
                actions['activated'].append(resolved_target_ip)
        else:
            actions['unchanged'].append(resolved_target_ip)

        if deactivate_others:
            for entry in normalized_entries:
                if entry.get('ip') == resolved_target_ip:
                    continue
                if entry.get('status') != 'ACTIVE':
                    continue
                entry_id = entry.get('id')
                entry_ip = entry.get('ip')
                if not entry_id or not entry_ip:
                    continue
                update_credential_password_ip_entry(
                    user_id,
                    credential_password_ip_id,
                    entry_id,
                    {'ip': entry_ip, 'status': 'INACTIVE'}
                )
                actions['deactivated'].append(entry_ip)

        final_entries = [
            extract_whitelist_ip_entry(item)
            for item in list_credential_password_ip_entries(user_id, credential_password_ip_id)
        ]
        return {
            'success': True,
            'target_ip': resolved_target_ip,
            'user_id': user_id,
            'credential_password_ip_id': credential_password_ip_id,
            'actions': actions,
            'entries': final_entries,
        }
    except Exception as exc:
        # Whitelist sync is best-effort for SDK variants that may not expose credential-password endpoints.
        logger.warning(
            f"⚠️ Failed updating Bunq whitelist IP: {exc}",
            exc_info=logger.isEnabledFor(logging.DEBUG)
        )
        return {
            'success': False,
            'target_ip': resolved_target_ip,
            'error': str(exc)
        }

# ============================================
# SECRET HELPERS (Docker Swarm secrets)
# ============================================

def read_secret(name):
    path = f"/run/secrets/{name}"
    try:
        with open(path, "r", encoding="utf-8") as file:
            return file.read().strip()
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.warning(f"⚠️ Failed to read secret '{name}': {exc}")
        return None

def get_config(key, default=None, secret_name=None):
    if secret_name:
        secret_value = read_secret(secret_name)
        if secret_value:
            return secret_value
    env_value = os.getenv(key)
    if env_value is not None and env_value != "":
        return env_value
    return default

def has_config(key, secret_name=None):
    if secret_name and read_secret(secret_name):
        return True
    return bool(os.getenv(key))

def get_vaultwarden_device_identifier():
    env_value = os.getenv('VAULTWARDEN_DEVICE_IDENTIFIER')
    if env_value:
        return env_value.strip()

    device_id_path = os.path.join('config', 'vaultwarden_device_id')
    try:
        with open(device_id_path, "r", encoding="utf-8") as file:
            stored = file.read().strip()
            if stored:
                return stored
    except FileNotFoundError:
        pass
    except Exception as exc:
        logger.warning(f"⚠️ Failed to read Vaultwarden device identifier: {exc}")

    new_id = str(uuid.uuid4())
    try:
        os.makedirs(os.path.dirname(device_id_path), exist_ok=True)
        with open(device_id_path, "w", encoding="utf-8") as file:
            file.write(new_id)
    except Exception as exc:
        logger.warning(f"⚠️ Failed to persist Vaultwarden device identifier: {exc}")
    return new_id

# ============================================
# FLASK APP INITIALIZATION
# ============================================

app = Flask(__name__)
STATIC_DIR = APP_DIR
STATIC_FILES = {'index.html', 'styles.css', 'app.js'}

# Simple in-memory cache (per process)
CACHE_ENABLED = os.getenv('CACHE_ENABLED', 'true').lower() == 'true'
CACHE_TTL_SECONDS = get_int_env('CACHE_TTL_SECONDS', 60)
DEFAULT_PAGE_SIZE = get_int_env('DEFAULT_PAGE_SIZE', 500)
MAX_PAGE_SIZE = get_int_env('MAX_PAGE_SIZE', 2000)
MAX_DAYS = get_int_env('MAX_DAYS', 3650)

# Local data store for historical analytics (P1)
DATA_DB_ENABLED = os.getenv('DATA_DB_ENABLED', 'true').lower() == 'true'
DATA_DB_PATH = os.getenv('DATA_DB_PATH', os.path.join('config', 'dashboard_data.db'))
FX_ENABLED = os.getenv('FX_ENABLED', 'true').lower() == 'true'
FX_RATE_SOURCE = os.getenv('FX_RATE_SOURCE', 'frankfurter').strip().lower()
FX_REQUEST_TIMEOUT_SECONDS = get_int_env('FX_REQUEST_TIMEOUT_SECONDS', 8)
FX_CACHE_HOURS = get_int_env('FX_CACHE_HOURS', 24)
AUTO_SET_BUNQ_WHITELIST_IP = get_bool_env('AUTO_SET_BUNQ_WHITELIST_IP', True)
AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS = get_bool_env('AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS', False)

def get_data_db_connection():
    if not DATA_DB_ENABLED:
        return None
    os.makedirs(os.path.dirname(DATA_DB_PATH), exist_ok=True)
    connection = sqlite3.connect(DATA_DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection

def init_data_store():
    if not DATA_DB_ENABLED:
        logger.info("📦 Historical data store disabled (DATA_DB_ENABLED=false)")
        return

    connection = get_data_db_connection()
    if connection is None:
        return

    try:
        with connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=NORMAL")

            connection.execute("""
                CREATE TABLE IF NOT EXISTS account_snapshots (
                    snapshot_date TEXT NOT NULL,
                    account_id TEXT NOT NULL,
                    description TEXT,
                    account_type TEXT,
                    account_class TEXT,
                    status TEXT,
                    balance_value REAL NOT NULL,
                    balance_currency TEXT NOT NULL,
                    balance_eur_value REAL,
                    fx_rate_to_eur REAL,
                    captured_at TEXT NOT NULL,
                    PRIMARY KEY (snapshot_date, account_id)
                )
            """)

            connection.execute("""
                CREATE TABLE IF NOT EXISTS transaction_cache (
                    tx_key TEXT PRIMARY KEY,
                    tx_id TEXT,
                    account_id TEXT NOT NULL,
                    account_name TEXT,
                    tx_date TEXT NOT NULL,
                    amount REAL NOT NULL,
                    currency TEXT,
                    amount_eur REAL,
                    description TEXT,
                    counterparty TEXT,
                    merchant TEXT,
                    category TEXT,
                    tx_type TEXT,
                    is_internal_transfer INTEGER NOT NULL DEFAULT 0,
                    captured_at TEXT NOT NULL
                )
            """)

            connection.execute("""
                CREATE TABLE IF NOT EXISTS fx_rates (
                    base_currency TEXT NOT NULL,
                    quote_currency TEXT NOT NULL,
                    rate_date TEXT NOT NULL,
                    rate REAL NOT NULL,
                    source TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    PRIMARY KEY (base_currency, quote_currency, rate_date)
                )
            """)

            connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_account_snapshots_date
                ON account_snapshots(snapshot_date)
            """)

            connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_transaction_cache_date
                ON transaction_cache(tx_date)
            """)

            connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_transaction_cache_account
                ON transaction_cache(account_id)
            """)

            connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_fx_rates_date
                ON fx_rates(rate_date)
            """)

        logger.info(f"📦 Historical data store initialized at {DATA_DB_PATH}")
    except Exception as exc:
        logger.warning(f"⚠️ Failed to initialize historical data store: {exc}")
    finally:
        connection.close()

cache = Cache(app, config={
    'CACHE_TYPE': 'SimpleCache',
    'CACHE_DEFAULT_TIMEOUT': CACHE_TTL_SECONDS
})

# Session configuration - CRITICAL for security
app.config['SECRET_KEY'] = get_config('FLASK_SECRET_KEY', secrets.token_hex(32), 'flask_secret_key')
app.config['SESSION_COOKIE_HTTPONLY'] = True  # Prevents JavaScript access
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'True').lower() == 'true'  # HTTPS only
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF protection
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)  # Session expires after 24h

# Log session configuration
logger.info(f"🔐 Session cookie secure: {app.config['SESSION_COOKIE_SECURE']}")
logger.info(f"⏱️  Session lifetime: 24 hours")

# CORS Configuration - WITH CREDENTIALS SUPPORT
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv('ALLOWED_ORIGINS', 'https://bunq.jouwdomein.nl').split(',')
    if origin.strip()
]
logger.info(f"🔒 CORS allowed origins: {ALLOWED_ORIGINS}")
if app.config['SESSION_COOKIE_SECURE'] and any(origin.startswith('http://') for origin in ALLOWED_ORIGINS):
    logger.warning("⚠️ SESSION_COOKIE_SECURE=true with HTTP origin(s): auth cookie may not be sent by browser")
if (not app.config['SESSION_COOKIE_SECURE']) and any(origin.startswith('https://') for origin in ALLOWED_ORIGINS):
    logger.warning("⚠️ SESSION_COOKIE_SECURE=false while HTTPS origin configured; set SESSION_COOKIE_SECURE=true")

CORS(app, 
     origins=ALLOWED_ORIGINS, 
     supports_credentials=True,  # CRITICAL: Allow cookies
     allow_headers=['Content-Type', 'Authorization'],
     expose_headers=['Content-Type'])

# Initialize optional local data store (non-fatal on failure).
init_data_store()

# ============================================
# SECURITY: SESSION-BASED AUTHENTICATION
# ============================================

def check_credentials(username, password):
    """
    Verify username and password against environment variables.
    Uses constant-time comparison to prevent timing attacks.
    """
    expected_username = os.getenv('BASIC_AUTH_USERNAME', 'admin')
    expected_password = get_config('BASIC_AUTH_PASSWORD', '', 'basic_auth_password')
    
    # If no password set, deny all access
    if not expected_password:
        logger.error("❌ No BASIC_AUTH_PASSWORD set (env or secret)!")
        return False
    
    # Constant-time comparison to prevent timing attacks
    username_match = secrets.compare_digest(username, expected_username)
    password_match = secrets.compare_digest(password, expected_password)
    
    return username_match and password_match

def requires_auth(f):
    """
    Decorator for endpoints that require authentication.
    Checks if user has valid session.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        # Check if user is logged in (has valid session)
        if not session.get('authenticated'):
            logger.warning(f"🚫 Unauthorized access attempt from {request.remote_addr}")
            return jsonify({
                'success': False,
                'error': 'Not authenticated. Please login first.',
                'login_required': True
            }), 401
        
        # Optional: Check session expiry
        if session.get('expires_at'):
            if datetime.fromisoformat(session['expires_at']) < datetime.now():
                session.clear()
                logger.info(f"⏱️  Session expired for {request.remote_addr}")
                return jsonify({
                    'success': False,
                    'error': 'Session expired. Please login again.',
                    'login_required': True
                }), 401
        
        return f(*args, **kwargs)
    return decorated

# ============================================
# SECURITY: RATE LIMITING
# ============================================

class RateLimiter:
    """Simple in-memory rate limiter"""
    
    def __init__(self, max_requests=30, window_seconds=60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)
        self.login_attempts = defaultdict(list)  # Separate tracking for login
    
    def is_allowed(self, client_id, endpoint='general'):
        """Check if client is allowed to make request"""
        now = time.time()
        window_start = now - self.window_seconds
        
        # Choose appropriate tracking dict
        tracking = self.login_attempts if endpoint == 'login' else self.requests
        
        # Clean old requests
        tracking[client_id] = [
            req_time for req_time in tracking[client_id]
            if req_time > window_start
        ]
        
        # Different limits for login (stricter)
        max_reqs = 5 if endpoint == 'login' else self.max_requests
        
        # Check limit
        if len(tracking[client_id]) >= max_reqs:
            return False
        
        # Record request
        tracking[client_id].append(now)
        return True

rate_limiter = RateLimiter(max_requests=30, window_seconds=60)

def rate_limit(endpoint='general'):
    """Decorator factory for rate limiting"""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            client_id = request.remote_addr
            
            if not rate_limiter.is_allowed(client_id, endpoint):
                logger.warning(f"🚫 Rate limit exceeded for {client_id} on {endpoint}")
                return jsonify({
                    'success': False,
                    'error': 'Rate limit exceeded. Please try again later.'
                }), 429
            
            return f(*args, **kwargs)
        return decorated
    return decorator

# ============================================
# PERFORMANCE: CACHE + PAGINATION HELPERS
# ============================================

def cache_allowed():
    if not CACHE_ENABLED:
        return False
    cache_param = request.args.get('cache', 'true').lower()
    return cache_param not in ('0', 'false', 'no')

def make_cache_key(prefix):
    user = session.get('username', 'anon')
    args = '&'.join(
        [f"{k}={v}" for k, v in sorted(request.args.items()) if k != 'cache']
    )
    return f"{prefix}:{user}:{args}"

def parse_pagination():
    """Parse pagination parameters from query string."""
    if 'limit' in request.args or 'offset' in request.args:
        limit = min(int(request.args.get('limit', DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE)
        offset = max(int(request.args.get('offset', 0)), 0)
        page = offset // limit + 1 if limit > 0 else 1
    else:
        page = max(int(request.args.get('page', 1)), 1)
        page_size = min(int(request.args.get('page_size', DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE)
        limit = page_size
        offset = (page - 1) * page_size
    
    sort = request.args.get('sort', 'desc').lower()
    if sort not in ('asc', 'desc'):
        sort = 'desc'
    
    return limit, offset, page, sort

def clamp_days(days):
    try:
        days_int = int(days)
    except (TypeError, ValueError):
        return 90
    if days_int <= 0:
        return 90
    return min(days_int, MAX_DAYS)

def parse_bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')

def safe_float(value, default=0.0, context="value"):
    """Convert numeric-like values to float; fallback to default on None/invalid."""
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return default
        try:
            return float(normalized)
        except ValueError:
            # Fallback for values like "12,34"
            if ',' in normalized and '.' not in normalized:
                try:
                    return float(normalized.replace(',', '.'))
                except ValueError:
                    pass
    logger.warning(f"⚠️ Invalid numeric {context}: {value!r}; using default {default}")
    return default

def parse_monetary_value(monetary_value, default_currency='EUR', context='amount'):
    """Return tuple(float value, currency) from bunq MonetaryValue-like objects."""
    if monetary_value is None:
        logger.warning(f"⚠️ Missing monetary object for {context}; using 0 {default_currency}")
        return 0.0, default_currency
    value = safe_float(
        get_obj_field(monetary_value, 'value', 'amount', default=None),
        default=0.0,
        context=context
    )
    currency = get_obj_field(monetary_value, 'currency', 'currency_code', default=None) or default_currency
    return value, currency

def normalize_iban(value):
    if not value:
        return None
    normalized = str(value).strip().replace(' ', '').upper()
    if len(normalized) < 15:
        return None
    if not (normalized[:2].isalpha() and normalized[2:4].isdigit()):
        return None
    return normalized

def extract_alias_iban(alias):
    """Extract IBAN from bunq alias-like objects across SDK variants."""
    if alias is None:
        return None

    alias_type = (get_obj_field(alias, 'type', 'type_', default='') or '').upper()
    alias_value = get_obj_field(alias, 'value', 'iban')
    if alias_type == 'IBAN':
        normalized = normalize_iban(alias_value)
        if normalized:
            return normalized

    # Some SDK variants expose raw IBAN or embed pointer-like objects.
    for candidate in (
        get_obj_field(alias, 'iban', 'value'),
        get_obj_field(get_obj_field(alias, 'pointer'), 'value', 'iban'),
        get_obj_field(get_obj_field(alias, 'alias'), 'value', 'iban'),
    ):
        normalized = normalize_iban(candidate)
        if normalized:
            return normalized

    return None

def extract_counterparty_name(counterparty_alias):
    """Extract a readable counterparty name for different alias object types."""
    if counterparty_alias is None:
        return 'Unknown'

    for attr_name in ('display_name', 'name', 'description', 'label'):
        value = get_obj_field(counterparty_alias, attr_name)
        if isinstance(value, str) and value.strip():
            return value.strip()

    iban = extract_alias_iban(counterparty_alias)
    if iban:
        return iban

    alias_value = get_obj_field(counterparty_alias, 'value', 'iban')
    if isinstance(alias_value, str) and alias_value.strip():
        return alias_value.strip()

    return 'Unknown'

def is_opaque_reference_value(value):
    """
    Detect machine-like values that are poor merchant labels
    (e.g. IBANs, opaque ids, hash/reference codes).
    """
    if value is None:
        return False
    text = str(value).strip()
    if not text:
        return True

    compact = text.replace(' ', '')
    if normalize_iban(compact):
        return True

    if re.fullmatch(r'[A-Z0-9._:-]{12,}', compact) and ' ' not in text:
        return True

    return False

def parse_bunq_datetime(value, context='datetime'):
    """
    Parse bunq datetime strings and always return timezone-aware UTC datetimes.
    Some SDK variants return naive timestamps (without timezone).
    """
    if value is None:
        return None

    raw = str(value).strip()
    if not raw:
        return None

    if raw.endswith('Z'):
        raw = raw[:-1] + '+00:00'

    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        logger.warning(f"⚠️ Invalid {context}: {value!r}; skipping")
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)

def extract_own_ibans(accounts):
    """Extract own IBANs from Bunq accounts for internal transfer detection."""
    ibans = set()
    for account in accounts:
        aliases = getattr(account, 'alias', None) or []
        for alias in aliases:
            alias_iban = extract_alias_iban(alias)
            if alias_iban:
                ibans.add(alias_iban)
    return ibans

def _normalize_account_type_text(value):
    if value is None:
        return ''
    return str(value).strip().lower()

def classify_account_type(account):
    """
    Coarse account classification for dashboard grouping.
    Returns one of: checking, savings, investment.
    """
    class_name = _normalize_account_type_text(account.__class__.__name__)
    description = _normalize_account_type_text(get_obj_field(account, 'description', 'display_name', default=''))
    profile = get_obj_field(account, 'monetary_account_profile')
    setting = get_obj_field(account, 'monetary_account_setting', 'setting')
    subtype = (
        get_obj_field(
            account,
            'sub_type',
            'subtype',
            'type_',
            'type',
            'monetary_account_type',
            'account_type',
            default=''
        ) or ''
    )
    profile_type = (
        get_obj_field(
            profile,
            'sub_type',
            'type_',
            'type',
            'profile_type',
            'account_type',
            default=''
        ) or ''
    )
    setting_type = (
        get_obj_field(
            setting,
            'sub_type',
            'type_',
            'type',
            'account_type',
            default=''
        ) or ''
    )

    explicit_type_fields = [
        subtype,
        profile_type,
        setting_type,
        get_obj_field(account, 'monetary_account_type', default=''),
        get_obj_field(account, 'account_type', default=''),
    ]
    explicit_type_text = " ".join(_normalize_account_type_text(field) for field in explicit_type_fields if field)
    fingerprint = f"{class_name} {description} {explicit_type_text}"

    # Hard signals based on official type-like fields
    if any(token in explicit_type_text for token in ('investment', 'stock', 'share', 'crypto', 'belegging')):
        return 'investment'
    if any(token in explicit_type_text for token in ('saving', 'savings', 'spaar', 'reserve', 'goal')):
        return 'savings'
    if any(token in explicit_type_text for token in ('checking', 'payment', 'bank', 'card', 'current')):
        return 'checking'

    if any(token in fingerprint for token in (
        'savings', 'spaar', 'spaarrekening', 'sparen',
        'reserve', 'buffer', 'onvoorzien', 'emergency',
        'vakantie', 'doel', 'goal'
    )):
        return 'savings'
    if any(token in fingerprint for token in ('investment', 'stock', 'share', 'crypto', 'belegging')):
        return 'investment'
    return 'checking'

def get_cached_fx_rate(base_currency, quote_currency='EUR', rate_date=None):
    if not DATA_DB_ENABLED:
        return None
    date_key = rate_date or datetime.now(timezone.utc).date().isoformat()
    connection = get_data_db_connection()
    if connection is None:
        return None
    try:
        row = connection.execute(
            """
            SELECT rate, fetched_at
            FROM fx_rates
            WHERE base_currency = ? AND quote_currency = ? AND rate_date = ?
            """,
            (base_currency.upper(), quote_currency.upper(), date_key),
        ).fetchone()
        if not row:
            return None
        fetched_at = parse_bunq_datetime(row['fetched_at'], context='fx_rates.fetched_at')
        if fetched_at is None:
            return float(row['rate'])
        age = datetime.now(timezone.utc) - fetched_at
        if age.total_seconds() > FX_CACHE_HOURS * 3600:
            return None
        return float(row['rate'])
    except Exception as exc:
        logger.warning(f"⚠️ Failed reading cached FX rate {base_currency}->{quote_currency}: {exc}")
        return None
    finally:
        connection.close()

def cache_fx_rate(base_currency, quote_currency, rate, rate_date=None, source='unknown'):
    if not DATA_DB_ENABLED:
        return
    date_key = rate_date or datetime.now(timezone.utc).date().isoformat()
    connection = get_data_db_connection()
    if connection is None:
        return
    try:
        with connection:
            connection.execute(
                """
                INSERT INTO fx_rates (
                    base_currency, quote_currency, rate_date, rate, source, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(base_currency, quote_currency, rate_date) DO UPDATE SET
                    rate = excluded.rate,
                    source = excluded.source,
                    fetched_at = excluded.fetched_at
                """,
                (
                    base_currency.upper(),
                    quote_currency.upper(),
                    date_key,
                    float(rate),
                    source,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
    except Exception as exc:
        logger.warning(f"⚠️ Failed caching FX rate {base_currency}->{quote_currency}: {exc}")
    finally:
        connection.close()

def fetch_fx_rate(base_currency, quote_currency='EUR', rate_date=None):
    if base_currency.upper() == quote_currency.upper():
        return 1.0
    if not FX_ENABLED:
        return None

    base = base_currency.upper()
    quote = quote_currency.upper()
    date_key = rate_date or datetime.now(timezone.utc).date().isoformat()
    runtime_key = (base, quote, date_key)

    runtime_entry = _FX_RUNTIME_CACHE.get(runtime_key)
    if runtime_entry:
        cached_rate, cached_at_epoch = runtime_entry
        if (time.time() - cached_at_epoch) <= (FX_CACHE_HOURS * 3600):
            return cached_rate

    # Try cache first.
    cached = get_cached_fx_rate(base, quote, rate_date=date_key)
    if cached is not None:
        _FX_RUNTIME_CACHE[runtime_key] = (cached, time.time())
        return cached

    try:
        # Frankfurter API (ECB-backed) supports latest and historical dates.
        if FX_RATE_SOURCE == 'frankfurter':
            endpoint_path = date_key if rate_date else 'latest'
            response = requests.get(
                f"https://api.frankfurter.app/{endpoint_path}",
                params={'from': base, 'to': quote},
                timeout=FX_REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            payload = response.json()
            rates = payload.get('rates', {})
            rate = rates.get(quote)
            if rate is None:
                return None
            cache_fx_rate(base, quote, float(rate), rate_date=date_key, source='frankfurter')
            _FX_RUNTIME_CACHE[runtime_key] = (float(rate), time.time())
            return float(rate)
    except Exception as exc:
        logger.warning(f"⚠️ FX lookup failed for {base}->{quote}: {exc}")

    return None

def convert_amount_to_eur(amount, currency, rate_date=None):
    if amount is None:
        return None, None, False
    if not currency:
        return float(amount), 1.0, True

    currency_upper = str(currency).upper()
    numeric_amount = float(amount)
    if currency_upper == 'EUR':
        return numeric_amount, 1.0, True

    rate = fetch_fx_rate(currency_upper, 'EUR', rate_date=rate_date)
    if rate is None:
        return None, None, False
    return numeric_amount * rate, rate, True

def persist_account_snapshots(accounts_data):
    if not DATA_DB_ENABLED or not accounts_data:
        return

    snapshot_date = datetime.now(timezone.utc).date().isoformat()
    captured_at = datetime.now(timezone.utc).isoformat()
    connection = get_data_db_connection()
    if connection is None:
        return

    try:
        with connection:
            for account in accounts_data:
                account_id = str(account.get('id'))
                balance = account.get('balance', {})
                balance_eur = account.get('balance_eur', {})
                connection.execute(
                    """
                    INSERT INTO account_snapshots (
                        snapshot_date, account_id, description, account_type, account_class, status,
                        balance_value, balance_currency, balance_eur_value, fx_rate_to_eur, captured_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(snapshot_date, account_id) DO UPDATE SET
                        description = excluded.description,
                        account_type = excluded.account_type,
                        account_class = excluded.account_class,
                        status = excluded.status,
                        balance_value = excluded.balance_value,
                        balance_currency = excluded.balance_currency,
                        balance_eur_value = excluded.balance_eur_value,
                        fx_rate_to_eur = excluded.fx_rate_to_eur,
                        captured_at = excluded.captured_at
                    """,
                    (
                        snapshot_date,
                        account_id,
                        account.get('description'),
                        account.get('account_type'),
                        account.get('account_class'),
                        account.get('status'),
                        safe_float(balance.get('value'), default=0.0, context=f"account {account_id} snapshot balance"),
                        balance.get('currency') or 'EUR',
                        (
                            None if balance_eur.get('value') is None else
                            safe_float(balance_eur.get('value'), default=0.0, context=f"account {account_id} snapshot balance_eur")
                        ),
                        account.get('fx_rate_to_eur'),
                        captured_at,
                    ),
                )
    except Exception as exc:
        logger.warning(f"⚠️ Failed persisting account snapshots: {exc}")
    finally:
        connection.close()

def build_transaction_cache_key(transaction):
    payload = "|".join([
        str(transaction.get('id')),
        str(transaction.get('account_id')),
        str(transaction.get('date')),
        str(transaction.get('amount')),
        str(transaction.get('description')),
    ])
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()

def persist_transactions(transactions):
    if not DATA_DB_ENABLED or not transactions:
        return

    connection = get_data_db_connection()
    if connection is None:
        return
    captured_at = datetime.now(timezone.utc).isoformat()

    try:
        with connection:
            for transaction in transactions:
                tx_key = build_transaction_cache_key(transaction)
                amount = safe_float(transaction.get('amount'), default=0.0, context='transaction amount')
                currency = (transaction.get('currency') or 'EUR').upper()
                tx_date = parse_bunq_datetime(transaction.get('date'), context='transaction date')
                rate_date = tx_date.date().isoformat() if tx_date else None
                amount_eur, _, _ = convert_amount_to_eur(amount, currency, rate_date=rate_date)
                connection.execute(
                    """
                    INSERT INTO transaction_cache (
                        tx_key, tx_id, account_id, account_name, tx_date, amount, currency, amount_eur,
                        description, counterparty, merchant, category, tx_type, is_internal_transfer, captured_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(tx_key) DO UPDATE SET
                        account_name = excluded.account_name,
                        amount = excluded.amount,
                        currency = excluded.currency,
                        amount_eur = excluded.amount_eur,
                        description = excluded.description,
                        counterparty = excluded.counterparty,
                        merchant = excluded.merchant,
                        category = excluded.category,
                        tx_type = excluded.tx_type,
                        is_internal_transfer = excluded.is_internal_transfer,
                        captured_at = excluded.captured_at
                    """,
                    (
                        tx_key,
                        transaction.get('id'),
                        str(transaction.get('account_id')),
                        transaction.get('account_name'),
                        transaction.get('date'),
                        amount,
                        currency,
                        amount_eur,
                        transaction.get('description'),
                        transaction.get('counterparty'),
                        transaction.get('merchant'),
                        transaction.get('category'),
                        transaction.get('type'),
                        1 if transaction.get('is_internal_transfer') else 0,
                        captured_at,
                    ),
                )
    except Exception as exc:
        logger.warning(f"⚠️ Failed persisting transactions: {exc}")
    finally:
        connection.close()

# ============================================
# AUTHENTICATION ENDPOINTS
# ============================================

@app.route('/api/auth/login', methods=['POST'])
@rate_limit('login')  # Stricter rate limit for login: 5 attempts per minute
def login():
    """
    Login endpoint - creates session on successful authentication
    
    Request body:
    {
        "username": "admin",
        "password": "your_password"
    }
    
    Response:
    {
        "success": true,
        "message": "Login successful",
        "username": "admin",
        "expires_in": 86400
    }
    """
    try:
        data = request.get_json()
        
        if not data or 'username' not in data or 'password' not in data:
            logger.warning(f"🚫 Invalid login request from {request.remote_addr}")
            return jsonify({
                'success': False,
                'error': 'Username and password required'
            }), 400
        
        username = data['username']
        password = data['password']
        
        # Verify credentials
        if check_credentials(username, password):
            # Create session
            session.clear()  # Clear any existing session
            session['authenticated'] = True
            session['username'] = username
            session['login_time'] = datetime.now().isoformat()
            session['expires_at'] = (datetime.now() + timedelta(hours=24)).isoformat()
            session.permanent = True  # Use PERMANENT_SESSION_LIFETIME
            
            logger.info(f"✅ Successful login: {username} from {request.remote_addr}")
            
            response = make_response(jsonify({
                'success': True,
                'message': 'Login successful',
                'username': username,
                'expires_in': 86400  # 24 hours in seconds
            }))
            
            return response, 200
        
        else:
            logger.warning(f"🚫 Failed login attempt: {username} from {request.remote_addr}")
            return jsonify({
                'success': False,
                'error': 'Invalid username or password'
            }), 401
            
    except Exception as e:
        logger.error(f"❌ Login error: {e}")
        return jsonify({
            'success': False,
            'error': 'Login failed'
        }), 500

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """Logout endpoint - destroys session"""
    username = session.get('username', 'unknown')
    session.clear()
    logger.info(f"👋 Logout: {username} from {request.remote_addr}")
    
    return jsonify({
        'success': True,
        'message': 'Logged out successfully'
    }), 200

@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    """Check if user is authenticated and get session info"""
    if session.get('authenticated'):
        return jsonify({
            'authenticated': True,
            'username': session.get('username'),
            'login_time': session.get('login_time'),
            'expires_at': session.get('expires_at')
        }), 200
    else:
        return jsonify({
            'authenticated': False
        }), 200

# ============================================
# VAULTWARDEN SECRET RETRIEVAL
# ============================================

def get_vaultwarden_access_method():
    raw = os.getenv('VAULTWARDEN_ACCESS_METHOD', 'cli').strip().lower()
    if raw not in {'cli', 'api', 'auto'}:
        logger.warning(f"⚠️ Unknown VAULTWARDEN_ACCESS_METHOD '{raw}', defaulting to 'cli'")
        return 'cli'
    return raw

def run_bw_command(args, env, timeout_seconds=30, check=True):
    result = subprocess.run(
        ['bw', *args],
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout_seconds
    )
    if check and result.returncode != 0:
        stderr = (result.stderr or '').strip()
        stdout = (result.stdout or '').strip()
        message = stderr or stdout or f"bw exited with code {result.returncode}"
        raise RuntimeError(message)
    return (result.stdout or '').strip()

def get_api_key_from_vaultwarden_cli(return_status=False):
    """
    Retrieve Bunq API key from Vaultwarden using Bitwarden CLI.
    This path can decrypt item values (server API returns encrypted ciphers).
    """
    vault_url = os.getenv('VAULTWARDEN_URL', 'http://vaultwarden:80').strip()
    item_name = os.getenv('VAULTWARDEN_ITEM_NAME', 'Bunq API Key').strip()
    client_id = get_config('VAULTWARDEN_CLIENT_ID', None, 'vaultwarden_client_id')
    client_secret = get_config('VAULTWARDEN_CLIENT_SECRET', None, 'vaultwarden_client_secret')
    master_password = get_config('VAULTWARDEN_MASTER_PASSWORD', None, 'vaultwarden_master_password')
    timeout_seconds = get_int_env('VAULTWARDEN_CLI_TIMEOUT_SECONDS', 30)

    status = {
        'access_method': 'cli',
        'enabled': True,
        'vault_url': vault_url,
        'item_name': item_name,
        'client_configured': bool(client_id and client_secret),
        'master_password_configured': bool(master_password),
        'bw_cli_installed': bool(shutil.which('bw')),
        'token_ok': False,
        'item_found': False,
        'item_has_password': False,
        'error': None,
    }

    if not status['bw_cli_installed']:
        status['error'] = 'Bitwarden CLI (bw) is not installed in the container'
        if return_status:
            return None, status
        logger.error(f"❌ Vaultwarden CLI error: {status['error']}")
        return None

    if not status['client_configured']:
        status['error'] = 'Vaultwarden credentials missing (client_id/client_secret)'
        if return_status:
            return None, status
        logger.error(f"❌ Vaultwarden CLI error: {status['error']}")
        return None

    if not status['master_password_configured']:
        status['error'] = 'VAULTWARDEN_MASTER_PASSWORD (secret) is missing'
        if return_status:
            return None, status
        logger.error(f"❌ Vaultwarden CLI error: {status['error']}")
        return None

    appdata_dir = os.getenv('VAULTWARDEN_CLI_APPDATA_DIR', '/tmp/bwcli-dashboard').strip() or '/tmp/bwcli-dashboard'
    os.makedirs(appdata_dir, exist_ok=True)

    bw_env = os.environ.copy()
    bw_env.update({
        'BW_CLIENTID': client_id,
        'BW_CLIENTSECRET': client_secret,
        'BW_PASSWORD': master_password,
        'BW_NOINTERACTION': 'true',
        'BITWARDENCLI_APPDATA_DIR': appdata_dir,
    })

    session_key = None
    with _VAULTWARDEN_CLI_LOCK:
        try:
            # Clean any stale session state first.
            run_bw_command(['logout'], bw_env, timeout_seconds=timeout_seconds, check=False)
            run_bw_command(['config', 'server', vault_url], bw_env, timeout_seconds=timeout_seconds, check=True)
            run_bw_command(['login', '--apikey', '--raw'], bw_env, timeout_seconds=timeout_seconds, check=True)
            status['token_ok'] = True
            session_key = run_bw_command(
                ['unlock', '--passwordenv', 'BW_PASSWORD', '--raw'],
                bw_env,
                timeout_seconds=timeout_seconds,
                check=True
            )
            if not session_key:
                raise RuntimeError('bw unlock did not return a session key')

            run_bw_command(['sync', '--session', session_key], bw_env, timeout_seconds=timeout_seconds, check=False)
            raw_items = run_bw_command(
                ['list', 'items', '--search', item_name, '--session', session_key],
                bw_env,
                timeout_seconds=timeout_seconds,
                check=True
            )
            items = json.loads(raw_items) if raw_items else []

            login_items = [item for item in items if item.get('type') == 1]
            exact = [item for item in login_items if str(item.get('name', '')).strip() == item_name]
            candidates = exact if exact else login_items

            if not candidates:
                status['item_found'] = False
                return (None, status) if return_status else None

            chosen = candidates[0]
            status['item_found'] = True
            password = ((chosen.get('login') or {}).get('password') or '').strip()
            status['item_has_password'] = bool(password)
            if not password:
                if return_status:
                    return None, status
                logger.error(f"❌ Vault item '{item_name}' found but password field is empty")
                return None

            if return_status:
                return password, status
            logger.info("✅ API key retrieved from vault (CLI decrypt path)")
            return password
        except Exception as exc:
            status['error'] = str(exc)
            if return_status:
                return None, status
            logger.error(f"❌ Vaultwarden CLI error: {exc}")
            return None
        finally:
            if session_key:
                run_bw_command(['lock', '--session', session_key], bw_env, timeout_seconds=timeout_seconds, check=False)
            run_bw_command(['logout'], bw_env, timeout_seconds=timeout_seconds, check=False)

def get_api_key_from_vaultwarden_api(return_status=False):
    """Retrieve Bunq API key from Vaultwarden API (works only if ciphers are not encrypted for this token)."""
    vault_url = os.getenv('VAULTWARDEN_URL', 'http://vaultwarden:80')
    client_id = get_config('VAULTWARDEN_CLIENT_ID', None, 'vaultwarden_client_id')
    client_secret = get_config('VAULTWARDEN_CLIENT_SECRET', None, 'vaultwarden_client_secret')
    item_name = os.getenv('VAULTWARDEN_ITEM_NAME', 'Bunq API Key')

    status = {
        'access_method': 'api',
        'enabled': True,
        'vault_url': vault_url,
        'item_name': item_name,
        'client_configured': bool(client_id and client_secret),
        'master_password_configured': None,
        'bw_cli_installed': bool(shutil.which('bw')),
        'token_ok': False,
        'item_found': False,
        'item_has_password': False,
        'error': None,
    }

    if not status['client_configured']:
        status['error'] = 'Vaultwarden credentials missing (client_id/client_secret)'
        if return_status:
            return None, status
        logger.error("❌ Vaultwarden credentials missing (env or secret)!")
        return None

    try:
        logger.info("🔑 Authenticating with Vaultwarden...")
        token_url = f"{vault_url}/identity/connect/token"
        token_data = {
            'grant_type': 'client_credentials',
            'scope': 'api',
            'client_id': client_id,
            'client_secret': client_secret,
            'deviceType': os.getenv('VAULTWARDEN_DEVICE_TYPE', '22').strip(),
            'deviceIdentifier': get_vaultwarden_device_identifier(),
            'deviceName': os.getenv('VAULTWARDEN_DEVICE_NAME', 'Bunq Dashboard').strip()
        }
        token_response = requests.post(token_url, data=token_data, timeout=10)
        token_response.raise_for_status()
        access_token = token_response.json()['access_token']
        status['token_ok'] = bool(access_token)

        logger.info("✅ Vaultwarden authentication successful")
        logger.info(f"🔍 Searching for vault item: '{item_name}'...")
        items_response = requests.get(
            f"{vault_url}/api/ciphers",
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=10
        )
        items_response.raise_for_status()
        items = items_response.json().get('data', [])

        for item in items:
            if item.get('name') == item_name and item.get('type') == 1:
                status['item_found'] = True
                password = ((item.get('login') or {}).get('password') or '').strip()
                status['item_has_password'] = bool(password)
                if password:
                    if return_status:
                        return password, status
                    logger.info("✅ API key retrieved from vault (API path)")
                    return password
                if return_status:
                    return None, status
                logger.error(f"❌ Item '{item_name}' found but password field is empty!")
                return None

        if items:
            first_item_name = str(items[0].get('name', ''))
            if first_item_name.startswith('2.') and '|' in first_item_name:
                status['error'] = (
                    "Vault returned encrypted cipher payloads. "
                    "Use VAULTWARDEN_ACCESS_METHOD=cli and provide vaultwarden_master_password secret."
                )
            else:
                status['error'] = f"Item '{item_name}' not found in vault"
        else:
            status['error'] = f"Item '{item_name}' not found in vault"

        if return_status:
            return None, status
        logger.error(f"❌ {status['error']}")
        return None
    except Exception as exc:
        status['error'] = str(exc)
        if return_status:
            return None, status
        logger.error(f"❌ Vaultwarden error: {exc}")
        return None

def get_api_key_from_vaultwarden():
    """
    Retrieve Bunq API key with Vaultwarden-first flow.
    Preferred method: Vaultwarden CLI decryption (`VAULTWARDEN_ACCESS_METHOD=cli`).
    """
    use_vaultwarden = os.getenv('USE_VAULTWARDEN', 'true').lower() == 'true'
    if not use_vaultwarden:
        logger.warning("⚠️ Vaultwarden disabled: falling back to direct API key (env/secret)")
        api_key = get_config('BUNQ_API_KEY', '', 'bunq_api_key')
        if api_key:
            logger.info("✅ API key loaded from env/secret")
        return api_key

    method = get_vaultwarden_access_method()
    logger.info(f"🔐 Retrieving API key from Vaultwarden ({method} method)...")

    if method == 'cli':
        return get_api_key_from_vaultwarden_cli()
    if method == 'api':
        return get_api_key_from_vaultwarden_api()

    # auto: try CLI first, then API fallback
    api_key = get_api_key_from_vaultwarden_cli()
    if api_key:
        return api_key
    logger.warning("⚠️ Vaultwarden CLI path failed, trying API fallback")
    return get_api_key_from_vaultwarden_api()

# ============================================
# ADMIN/MAINTENANCE HELPERS
# ============================================

def refresh_api_key():
    """Reload API key according to current auth mode (Vaultwarden preferred)."""
    global API_KEY
    API_KEY = get_api_key_from_vaultwarden()
    return API_KEY

def get_public_egress_ip(timeout_seconds=8):
    """Best-effort public egress IP lookup from container runtime."""
    try:
        response = requests.get("https://api64.ipify.org", timeout=timeout_seconds)
        response.raise_for_status()
        return response.text.strip()
    except Exception as exc:
        logger.warning(f"⚠️ Unable to resolve public egress IP: {exc}")
        return None

def get_vaultwarden_status_snapshot():
    """Runtime status snapshot for admin panel diagnostics (no secret leakage)."""
    use_vaultwarden = os.getenv('USE_VAULTWARDEN', 'true').strip().lower() == 'true'
    method = get_vaultwarden_access_method()
    item_name = os.getenv('VAULTWARDEN_ITEM_NAME', 'Bunq API Key').strip()
    vault_url = os.getenv('VAULTWARDEN_URL', 'http://vaultwarden:80').strip()
    status = {
        'enabled': use_vaultwarden,
        'access_method': method,
        'vault_url': vault_url,
        'item_name': item_name,
        'client_configured': False,
        'master_password_configured': None,
        'bw_cli_installed': bool(shutil.which('bw')),
        'token_ok': False,
        'item_found': False,
        'item_has_password': False,
        'error': None,
    }

    if not use_vaultwarden:
        status['error'] = 'Vaultwarden disabled (USE_VAULTWARDEN=false)'
        return status

    if method == 'cli':
        _, cli_status = get_api_key_from_vaultwarden_cli(return_status=True)
        status.update(cli_status)
        return status

    if method == 'api':
        _, api_status = get_api_key_from_vaultwarden_api(return_status=True)
        status.update(api_status)
        return status

    # auto: show CLI status first, then API fallback status when needed
    _, cli_status = get_api_key_from_vaultwarden_cli(return_status=True)
    status.update(cli_status)
    if status.get('item_found') and status.get('item_has_password') and status.get('token_ok'):
        return status

    _, api_status = get_api_key_from_vaultwarden_api(return_status=True)
    status['api_fallback'] = api_status
    if not status.get('error'):
        status['error'] = f"CLI path failed, API fallback status: {api_status.get('error')}"
    return status

# ============================================
# CONFIGURATION
# ============================================

API_KEY = get_api_key_from_vaultwarden()
CONFIG_FILE = 'config/bunq_production.conf'
ENVIRONMENT_LABEL = os.getenv('BUNQ_ENVIRONMENT', 'PRODUCTION').strip().upper()
if ENVIRONMENT_LABEL not in ('PRODUCTION', 'SANDBOX'):
    logger.warning(f"⚠️ Unknown BUNQ_ENVIRONMENT '{ENVIRONMENT_LABEL}', defaulting to PRODUCTION")
    ENVIRONMENT_LABEL = 'PRODUCTION'

ENVIRONMENT_TYPE = ApiEnvironmentType.SANDBOX if ENVIRONMENT_LABEL == 'SANDBOX' else ApiEnvironmentType.PRODUCTION

# Validate configuration
if not API_KEY:
    logger.error("❌ No valid API key found!")

if not has_config('BASIC_AUTH_PASSWORD', 'basic_auth_password'):
    logger.error("⚠️⚠️⚠️ WARNING: No BASIC_AUTH_PASSWORD set!")
    logger.error("⚠️ Authentication is NOT configured!")

if not has_config('FLASK_SECRET_KEY', 'flask_secret_key'):
    logger.warning("⚠️ Using auto-generated FLASK_SECRET_KEY - sessions will reset on restart!")
    logger.warning("⚠️ Set FLASK_SECRET_KEY via Docker secret for persistent sessions")

# ============================================
# BUNQ API INITIALIZATION
# ============================================

def init_bunq(force_recreate=False, refresh_key=False, run_auto_whitelist=True):
    """Initialize Bunq API context with READ-ONLY access."""
    global API_KEY

    if refresh_key:
        API_KEY = get_api_key_from_vaultwarden()

    if not API_KEY:
        logger.warning("⚠️ No API key available, running in demo mode only")
        return False
    
    try:
        if force_recreate and os.path.exists(CONFIG_FILE):
            try:
                os.remove(CONFIG_FILE)
                logger.info(f"🧹 Removed existing Bunq context: {CONFIG_FILE}")
            except Exception as remove_exc:
                logger.warning(f"⚠️ Failed removing Bunq context '{CONFIG_FILE}': {remove_exc}")

        if not os.path.exists(CONFIG_FILE):
            logger.info("🔄 Creating new Bunq API context...")
            # Use positional args for compatibility across bunq-sdk versions
            api_context = ApiContext.create(
                ENVIRONMENT_TYPE,
                API_KEY,
                "Bunq Dashboard (READ-ONLY)"
            )
            api_context.save(CONFIG_FILE)
            logger.info("✅ Bunq API context created and saved")
        else:
            logger.info("🔄 Restoring existing Bunq API context...")
            api_context = ApiContext.restore(CONFIG_FILE)
            logger.info("✅ Bunq API context restored")
        
        BunqContext.load_api_context(api_context)
        logger.info("✅ Bunq API initialized successfully")
        logger.info(f"   Environment: {ENVIRONMENT_LABEL}")
        logger.info(f"   Access Level: READ-ONLY")

        if run_auto_whitelist and AUTO_SET_BUNQ_WHITELIST_IP:
            try:
                whitelist_result = set_bunq_api_whitelist_ip(
                    target_ip=None,
                    deactivate_others=AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS
                )
                if whitelist_result.get('success'):
                    actions = whitelist_result.get('actions', {})
                    logger.info(
                        "✅ Bunq whitelist ensured for %s (created=%d activated=%d deactivated=%d unchanged=%d)",
                        whitelist_result.get('target_ip'),
                        len(actions.get('created', [])),
                        len(actions.get('activated', [])),
                        len(actions.get('deactivated', [])),
                        len(actions.get('unchanged', [])),
                    )
                else:
                    logger.warning(
                        "⚠️ Bunq whitelist auto-update failed: %s",
                        whitelist_result.get('error', 'unknown error')
                    )
            except Exception as whitelist_exc:
                logger.warning(f"⚠️ Bunq whitelist auto-update exception: {whitelist_exc}")

        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize Bunq API: {e}")
        return False

# ============================================
# API ENDPOINTS (PROTECTED)
# ============================================

@app.route('/', methods=['GET'])
def serve_index():
    """Serve the dashboard frontend"""
    return send_from_directory(STATIC_DIR, 'index.html')

@app.route('/<path:filename>', methods=['GET'])
def serve_static(filename):
    """Serve static assets for the dashboard"""
    if filename in STATIC_FILES:
        return send_from_directory(STATIC_DIR, filename)
    return abort(404)

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint - NO AUTH REQUIRED"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'version': '3.0.0-session-auth',
        'api_status': 'initialized' if API_KEY else 'demo_mode',
        'security': {
            'type': 'session-based',
            'rate_limiting': True,
            'https_only': app.config['SESSION_COOKIE_SECURE']
        },
        'auth_configured': has_config('BASIC_AUTH_PASSWORD', 'basic_auth_password'),
        'history_store_enabled': DATA_DB_ENABLED,
        'fx_enabled': FX_ENABLED
    })

@app.route('/api/admin/status', methods=['GET'])
@requires_auth
@rate_limit('general')
def get_admin_status():
    """Admin maintenance status snapshot for the dashboard settings panel."""
    context_exists = os.path.exists(CONFIG_FILE)
    db_exists = os.path.exists(DATA_DB_PATH) if DATA_DB_PATH else False
    vault_status = get_vaultwarden_status_snapshot()
    use_vaultwarden = os.getenv('USE_VAULTWARDEN', 'true').strip().lower() == 'true'

    response = {
        'success': True,
        'data': {
            'environment': ENVIRONMENT_LABEL,
            'api_initialized': bool(API_KEY),
            'use_vaultwarden': use_vaultwarden,
            'api_key_source': 'vaultwarden' if use_vaultwarden else 'direct-secret',
            'vaultwarden': vault_status,
            'context_file': CONFIG_FILE,
            'context_exists': context_exists,
            'history_store_enabled': DATA_DB_ENABLED,
            'history_db_path': DATA_DB_PATH,
            'history_db_exists': db_exists,
            'session_cookie_secure': app.config['SESSION_COOKIE_SECURE'],
            'allowed_origins': ALLOWED_ORIGINS,
            'auto_set_bunq_whitelist_ip': AUTO_SET_BUNQ_WHITELIST_IP,
            'auto_set_bunq_whitelist_deactivate_others': AUTO_SET_BUNQ_WHITELIST_DEACTIVATE_OTHERS,
        }
    }
    return jsonify(response)

@app.route('/api/admin/egress-ip', methods=['GET'])
@requires_auth
@rate_limit('general')
def get_admin_egress_ip():
    """Return current public egress IP as seen from the dashboard container."""
    public_ip = get_public_egress_ip()
    if not public_ip:
        return jsonify({
            'success': False,
            'error': 'Unable to determine egress IP'
        }), 503

    return jsonify({
        'success': True,
        'data': {
            'egress_ip': public_ip
        }
    })

@app.route('/api/admin/bunq/reinitialize', methods=['POST'])
@requires_auth
@rate_limit('general')
def reinitialize_bunq_context():
    """
    Force refresh Bunq API key (Vaultwarden/direct), recreate context and reload BunqContext.
    Useful after Bunq API key rotation or IP whitelist updates.
    """
    payload = request.get_json(silent=True) or {}
    force_recreate = parse_bool(payload.get('force_recreate'), default=True)
    refresh_key = parse_bool(payload.get('refresh_key'), default=False)
    clear_runtime_cache = parse_bool(payload.get('clear_runtime_cache'), default=True)

    if clear_runtime_cache:
        cache.clear()
        _FX_RUNTIME_CACHE.clear()

    success = init_bunq(force_recreate=force_recreate, refresh_key=refresh_key)
    if not success:
        return jsonify({
            'success': False,
            'error': 'Failed to reinitialize Bunq API context',
            'api_initialized': False
        }), 500

    return jsonify({
        'success': True,
        'message': 'Bunq context reinitialized',
        'data': {
            'context_file': CONFIG_FILE,
            'context_exists': os.path.exists(CONFIG_FILE),
            'api_initialized': True,
            'egress_ip': get_public_egress_ip(),
            'api_key_source': (
                'vaultwarden'
                if os.getenv('USE_VAULTWARDEN', 'true').strip().lower() == 'true'
                else 'direct-secret'
            )
        }
    })

@app.route('/api/admin/bunq/whitelist-ip', methods=['POST'])
@requires_auth
@rate_limit('general')
def set_bunq_whitelist_ip():
    """
    Ensure Bunq API allowlist contains the requested IPv4.
    If no ip is supplied, current container egress IP is used.
    """
    payload = request.get_json(silent=True) or {}
    deactivate_others = parse_bool(payload.get('deactivate_others'), default=False)
    refresh_key = parse_bool(payload.get('refresh_key'), default=True)
    force_recreate = parse_bool(payload.get('force_recreate'), default=False)
    clear_runtime_cache = parse_bool(payload.get('clear_runtime_cache'), default=False)

    target_ip = payload.get('ip')
    try:
        target_ip = validate_ipv4_or_none(target_ip, require_public=True)
    except ValueError as exc:
        return jsonify({
            'success': False,
            'error': str(exc)
        }), 400

    if clear_runtime_cache:
        cache.clear()
        _FX_RUNTIME_CACHE.clear()

    if not init_bunq(
        force_recreate=force_recreate,
        refresh_key=refresh_key,
        run_auto_whitelist=False
    ):
        return jsonify({
            'success': False,
            'error': 'Bunq API is not initialized'
        }), 500

    result = set_bunq_api_whitelist_ip(target_ip=target_ip, deactivate_others=deactivate_others)
    if not result.get('success'):
        return jsonify({
            'success': False,
            'error': result.get('error', 'Failed to set Bunq allowlist IP'),
            'data': result
        }), 500

    return jsonify({
        'success': True,
        'message': 'Bunq API allowlist updated',
        'data': result
    })

@app.route('/api/admin/maintenance/run', methods=['POST'])
@requires_auth
@rate_limit('general')
def run_admin_maintenance():
    """
    Run bundled admin maintenance from dashboard UI with explicit options.
    This replaces most manual SSH maintenance flow for Bunq/Vaultwarden operations.
    """
    payload = request.get_json(silent=True) or {}

    auto_target_ip = parse_bool(payload.get('auto_target_ip'), default=False)
    deactivate_others = parse_bool(payload.get('deactivate_others'), default=False)
    refresh_key = parse_bool(payload.get('refresh_key'), default=False)
    force_recreate = parse_bool(payload.get('force_recreate'), default=True)
    clear_runtime_cache = parse_bool(payload.get('clear_runtime_cache'), default=True)

    target_ip = payload.get('target_ip')
    try:
        target_ip = validate_ipv4_or_none(target_ip, require_public=True)
    except ValueError as exc:
        return jsonify({
            'success': False,
            'error': str(exc)
        }), 400

    if not auto_target_ip and not target_ip:
        return jsonify({
            'success': False,
            'error': 'target_ip is required when auto_target_ip=false'
        }), 400

    maintenance_steps = []
    whitelist_result = None

    if clear_runtime_cache:
        cache.clear()
        _FX_RUNTIME_CACHE.clear()
        maintenance_steps.append('runtime_cache_cleared')

    # Always re-init Bunq context in this maintenance flow (with caller-controlled options).
    initialized = init_bunq(
        force_recreate=force_recreate,
        refresh_key=refresh_key,
        run_auto_whitelist=False
    )
    if not initialized:
        return jsonify({
            'success': False,
            'error': 'Failed to initialize Bunq API context',
            'data': {
                'steps': maintenance_steps,
                'api_initialized': False
            }
        }), 500
    maintenance_steps.append('bunq_initialized')

    effective_target_ip = target_ip
    if auto_target_ip and not effective_target_ip:
        effective_target_ip = None  # set_bunq_api_whitelist_ip resolves current egress IP

    whitelist_result = set_bunq_api_whitelist_ip(
        target_ip=effective_target_ip,
        deactivate_others=deactivate_others
    )
    if not whitelist_result.get('success'):
        return jsonify({
            'success': False,
            'error': whitelist_result.get('error', 'Failed to update Bunq allowlist IP'),
            'data': {
                'steps': maintenance_steps,
                'api_initialized': True,
                'whitelist': whitelist_result
            }
        }), 500
    resolved_target_ip = whitelist_result.get('target_ip')
    maintenance_steps.append('bunq_whitelist_updated')

    return jsonify({
        'success': True,
        'message': 'Admin maintenance completed',
        'data': {
            'steps': maintenance_steps,
            'api_initialized': True,
            'context_file': CONFIG_FILE,
            'context_exists': os.path.exists(CONFIG_FILE),
            'egress_ip': get_public_egress_ip(),
            'resolved_target_ip': resolved_target_ip,
            'whitelist': whitelist_result,
            'options': {
                'auto_target_ip': auto_target_ip,
                'deactivate_others': deactivate_others,
                'refresh_key': refresh_key,
                'force_recreate': force_recreate,
                'clear_runtime_cache': clear_runtime_cache
            }
        }
    })

@app.route('/api/accounts', methods=['GET'])
@requires_auth
@rate_limit('general')
def get_accounts():
    """Get all Bunq accounts (READ-ONLY) - SESSION AUTH REQUIRED"""
    if not API_KEY:
        return jsonify({
            'success': False,
            'error': 'Demo mode - configure API key'
        }), 503
    
    try:
        cache_key = make_cache_key('accounts')
        if cache_allowed():
            cached = cache.get(cache_key)
            if cached:
                return jsonify(cached)
        
        logger.info(f"📊 Fetching accounts for {session.get('username')}")
        accounts = list_monetary_accounts()
        account_type_hints = discover_account_type_hints()
        
        accounts_data = []
        for account in accounts:
            account_id = get_obj_field(account, 'id_', 'id')
            balance_value, balance_currency = parse_monetary_value(
                get_obj_field(account, 'balance'),
                context=f"account {account_id} balance"
            )
            account_type = account_type_hints.get(str(account_id)) or classify_account_type(account)
            balance_eur_value = None
            fx_rate_to_eur = None
            fx_converted = False

            # Prefer Bunq-provided converted balance when available.
            converted_obj = get_obj_field(account, 'balance_converted')
            if converted_obj is not None:
                converted_value, converted_currency = parse_monetary_value(
                    converted_obj,
                    context=f"account {account_id} balance_converted"
                )
                if converted_currency.upper() == 'EUR':
                    balance_eur_value = converted_value
                    fx_converted = balance_currency.upper() != 'EUR'
                    if abs(balance_value) > 1e-9:
                        fx_rate_to_eur = balance_eur_value / balance_value

            if balance_eur_value is None:
                balance_eur_value, fx_rate_to_eur, fx_converted = convert_amount_to_eur(
                    balance_value,
                    balance_currency,
                )
            accounts_data.append({
                'id': account_id,
                'description': get_obj_field(account, 'description', 'display_name') or f"Account {account_id}",
                'balance': {
                    'value': balance_value,
                    'currency': balance_currency
                },
                'balance_eur': {
                    'value': balance_eur_value,
                    'currency': 'EUR'
                },
                'fx_rate_to_eur': fx_rate_to_eur,
                'fx_converted': fx_converted,
                'status': get_obj_field(account, 'status', 'status_') or 'UNKNOWN',
                'account_type': account_type,
                'account_class': account.__class__.__name__
            })
        
        logger.info(f"✅ Retrieved {len(accounts_data)} accounts")
        persist_account_snapshots(accounts_data)
        response = {
            'success': True,
            'data': accounts_data,
            'count': len(accounts_data)
        }
        
        if cache_allowed():
            cache.set(cache_key, response, timeout=CACHE_TTL_SECONDS)
        
        return jsonify(response)
        
    except Exception as e:
        logger.exception(f"❌ Error fetching accounts: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/transactions', methods=['GET'])
@requires_auth
@rate_limit('general')
def get_transactions():
    """Get transactions - SESSION AUTH REQUIRED"""
    if not API_KEY:
        return jsonify({
            'success': False,
            'error': 'Demo mode - configure API key'
        }), 503
    
    try:
        account_id = request.args.get('account_id')
        account_ids_param = request.args.get('account_ids')
        days = clamp_days(request.args.get('days', 90))
        limit, offset, page, sort = parse_pagination()
        sort_desc = sort == 'desc'
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        exclude_internal = parse_bool(request.args.get('exclude_internal'), default=False)
        
        cache_key = make_cache_key('transactions')
        if cache_allowed():
            cached = cache.get(cache_key)
            if cached:
                return jsonify(cached)
        
        logger.info(f"📊 Fetching transactions (last {days} days) for {session.get('username')}")
        
        accounts = list_monetary_accounts()
        accounts_by_id = {}
        for acc in accounts:
            acc_id = get_obj_field(acc, 'id_', 'id')
            if acc_id is not None:
                accounts_by_id[str(acc_id)] = acc
        own_ibans = extract_own_ibans(accounts)
        
        target_ids = None
        if account_id:
            target_ids = [str(account_id)]
        elif account_ids_param:
            target_ids = [part.strip() for part in account_ids_param.split(',') if part.strip()]
        
        if target_ids:
            selected_accounts = [accounts_by_id[acc_id] for acc_id in target_ids if acc_id in accounts_by_id]
        else:
            selected_accounts = accounts
        
        all_transactions = []
        for account in selected_accounts:
            account_id_value = get_obj_field(account, 'id_', 'id')
            transactions = get_account_transactions(
                account_id_value,
                cutoff_date,
                sort_desc,
                own_ibans,
                get_obj_field(account, 'description', 'display_name')
            )
            all_transactions.extend(transactions)
        
        if exclude_internal:
            all_transactions = [t for t in all_transactions if not t.get('is_internal_transfer')]

        persist_transactions(all_transactions)
        all_transactions.sort(key=lambda t: t['date'], reverse=sort_desc)
        total_count = len(all_transactions)
        paged = all_transactions[offset:offset + limit]
        
        logger.info(f"✅ Retrieved {total_count} transactions (page {page})")
        response = {
            'success': True,
            'data': paged,
            'count': total_count,
            'page': page,
            'page_size': limit,
            'sort': sort
        }
        
        if cache_allowed():
            cache.set(cache_key, response, timeout=CACHE_TTL_SECONDS)
        
        return jsonify(response)
            
    except Exception as e:
        logger.exception(f"❌ Error fetching transactions: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def get_account_transactions(account_id, cutoff_date=None, sort_desc=True, own_ibans=None, account_name=None):
    """Get transactions for specific account"""
    payments = list_payments_for_account(account_id, cutoff_date=cutoff_date)
    transactions = []
    own_ibans = own_ibans or set()
    
    for payment in payments:
        payment_id = get_obj_field(payment, 'id_', 'id', default='unknown')
        created_raw = get_obj_field(payment, 'created', 'created_at', 'date')
        if not created_raw:
            logger.warning(f"⚠️ Payment {payment_id} missing created timestamp; skipping")
            continue
        created = parse_bunq_datetime(
            created_raw,
            context=f"payment {payment_id} created"
        )
        if created is None:
            logger.warning(f"⚠️ Payment {payment_id} has invalid created timestamp; skipping")
            continue

        if cutoff_date and created < cutoff_date:
            if sort_desc:
                break
            continue
        
        is_internal_transfer = False
        counterparty_alias = get_obj_field(payment, 'counterparty_alias', 'counterparty')
        counterparty_name = extract_counterparty_name(counterparty_alias)
        counterparty_iban = extract_alias_iban(counterparty_alias)
        if counterparty_iban and counterparty_iban in own_ibans:
            is_internal_transfer = True
        
        description = get_obj_field(payment, 'description', 'label', default='') or ''
        amount_value, amount_currency = parse_monetary_value(
            get_obj_field(payment, 'amount', 'monetary_value'),
            context=f"payment {payment_id} amount"
        )
        merchant_reference = get_obj_field(payment, 'merchant_reference', 'merchant_reference_')
        merchant_category_code = get_obj_field(counterparty_alias, 'merchant_category_code')
        category = categorize_transaction(
            description,
            counterparty_name,
            is_internal_transfer,
            merchant_category_code=merchant_category_code,
            amount=amount_value
        )
        merchant_candidates = [counterparty_name, description, merchant_reference]
        merchant_label = next(
            (
                value.strip()
                for value in merchant_candidates
                if isinstance(value, str) and value.strip() and not is_opaque_reference_value(value)
            ),
            None
        )
        if merchant_label is None:
            merchant_label = next(
                (value.strip() for value in merchant_candidates if isinstance(value, str) and value.strip()),
                'Onbekend'
            )
        
        transactions.append({
            'id': payment_id,
            'date': created.isoformat(),
            'amount': amount_value,
            'currency': amount_currency,
            'description': description,
            'counterparty': counterparty_name,
            'merchant': merchant_label,
            'category': category,
            'type': get_obj_field(payment, 'type_', 'type'),
            'account_id': account_id,
            'account_name': account_name,
            'is_internal_transfer': is_internal_transfer
        })
    
    return transactions

def categorize_transaction(description, counterparty_name, is_internal=False, merchant_category_code=None, amount=None):
    """Rule-based categorization with MCC fallback."""
    if is_internal:
        return 'Internal Transfer'

    desc_lower = description.lower() if description else ''
    counter_lower = counterparty_name.lower() if counterparty_name else ''
    combined = f"{desc_lower} {counter_lower}".strip()
    try:
        amount_value = 0.0 if amount is None else float(amount)
    except (TypeError, ValueError):
        amount_value = 0.0

    mcc = str(merchant_category_code or '').strip()
    if mcc:
        if mcc in {'5411', '5422', '5441', '5451', '5462', '5499'}:
            return 'Boodschappen'
        if mcc in {'5812', '5813', '5814'}:
            return 'Horeca'
        if mcc in {'4111', '4121', '4789', '5541', '5542'}:
            return 'Vervoer'
        if mcc in {'4900', '4814'}:
            return 'Utilities'
        if mcc in {'5960', '5966', '6300'}:
            return 'Verzekering'
        if mcc in {'9211', '9311', '9399'}:
            return 'Belastingen'
        if mcc in {'5912', '8011', '8021', '8099'}:
            return 'Zorg'
        if mcc in {'7832', '7922', '7997', '7999'}:
            return 'Entertainment'
        if mcc in {'5311', '5331', '5399', '5651', '5732'}:
            return 'Shopping'

    if amount_value > 0:
        if any(word in combined for word in ['refund', 'terugbetaling', 'chargeback', 'retour', 'reversal']):
            return 'Refund'
        if any(word in combined for word in ['rente', 'interest']):
            return 'Rente'
        if any(word in combined for word in ['salaris', 'salary', 'loon', 'wage']):
            return 'Salaris'

    if any(word in combined for word in [
        'albert heijn', ' ah ', 'jumbo', 'lidl', 'aldi', 'plus', 'dirk',
        'picnic', 'ekoplaza', 'spar ', 'coop', 'supermarkt', 'carrefour'
    ]):
        return 'Boodschappen'
    elif any(word in combined for word in [
        'restaurant', 'cafe', 'bar', 'pizza', 'burger', 'starbucks',
        'thuisbezorgd', 'ubereats', 'deliveroo', 'mcdonald'
    ]):
        return 'Horeca'
    elif any(word in combined for word in [
        'ns ', 'train', 'bus', 'taxi', 'uber', 'ov ', 'parking',
        'q-park', 'shell', 'texaco', 'esso', 'total', 'benzine'
    ]):
        return 'Vervoer'
    elif any(word in combined for word in ['huur', 'rent', 'hypotheek', 'mortgage', 'vve']):
        return 'Wonen'
    elif any(word in combined for word in ['verzekering', 'insur', 'aegon', 'allianz', 'ohra', 'unive', 'zilveren kruis']):
        return 'Verzekering'
    elif any(word in combined for word in ['belasting', 'belastingdienst', 'tax', 'gemeente', 'waterschap']):
        return 'Belastingen'
    elif any(word in combined for word in ['eneco', 'essent', 'energie', 'gas', 'water', 'ziggo', 'kpn', 'telecom']):
        return 'Utilities'
    elif any(word in combined for word in ['bol.com', 'coolblue', 'mediamarkt', 'amazon', 'zara', 'h&m', 'shop']):
        return 'Shopping'
    elif any(word in combined for word in ['netflix', 'spotify', 'youtube', 'cinema', 'pathé', 'concert', 'steam']):
        return 'Entertainment'
    elif any(word in combined for word in ['apotheek', 'pharmacy', 'dokter', 'doctor', 'tandarts', 'dentist']):
        return 'Zorg'
    elif any(word in combined for word in ['salaris', 'salary', 'loon', 'wage']):
        return 'Salaris'
    else:
        return 'Overig'

@app.route('/api/statistics', methods=['GET'])
@requires_auth
@rate_limit('general')
def get_statistics():
    """Get aggregated statistics - SESSION AUTH REQUIRED"""
    if not API_KEY:
        return jsonify({
            'success': False,
            'error': 'Demo mode - configure API key'
        }), 503
        
    try:
        days = clamp_days(request.args.get('days', 90))
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        exclude_internal = parse_bool(request.args.get('exclude_internal'), default=False)
        
        cache_key = make_cache_key('statistics')
        if cache_allowed():
            cached = cache.get(cache_key)
            if cached:
                return jsonify(cached)
        
        accounts = list_monetary_accounts()
        own_ibans = extract_own_ibans(accounts)
        all_transactions = []
        
        for account in accounts:
            account_id_value = get_obj_field(account, 'id_', 'id')
            transactions = get_account_transactions(
                account_id_value,
                cutoff_date,
                True,
                own_ibans,
                get_obj_field(account, 'description', 'display_name')
            )
            all_transactions.extend(transactions)
        
        if exclude_internal:
            all_transactions = [t for t in all_transactions if not t.get('is_internal_transfer')]
        
        income = sum(t['amount'] for t in all_transactions if t['amount'] > 0)
        expenses = abs(sum(t['amount'] for t in all_transactions if t['amount'] < 0))
        net_savings = income - expenses
        savings_rate = (net_savings / income * 100) if income > 0 else 0
        
        category_totals = {}
        for t in all_transactions:
            if t['amount'] < 0:
                cat = t['category']
                category_totals[cat] = category_totals.get(cat, 0) + abs(t['amount'])
        
        response = {
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
        }
        
        if cache_allowed():
            cache.set(cache_key, response, timeout=CACHE_TTL_SECONDS)
        
        return jsonify(response)
        
    except Exception as e:
        logger.exception(f"❌ Error fetching statistics: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/history/balances', methods=['GET'])
@requires_auth
@rate_limit('general')
def get_balance_history():
    """Return historical balance series from local data store."""
    if not DATA_DB_ENABLED:
        return jsonify({
            'success': False,
            'error': 'Historical data store disabled'
        }), 503

    days = clamp_days(request.args.get('days', 90))
    start_date = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
    connection = get_data_db_connection()
    if connection is None:
        return jsonify({
            'success': False,
            'error': 'Unable to open historical data store'
        }), 500

    try:
        rows = connection.execute(
            """
            SELECT snapshot_date, account_type,
                   SUM(
                       CASE
                           WHEN balance_eur_value IS NOT NULL THEN balance_eur_value
                           WHEN balance_currency = 'EUR' THEN balance_value
                           ELSE 0
                       END
                   ) AS total_eur
            FROM account_snapshots
            WHERE snapshot_date >= ?
            GROUP BY snapshot_date, account_type
            ORDER BY snapshot_date ASC
            """,
            (start_date,),
        ).fetchall()

        latest_row = connection.execute(
            "SELECT MAX(snapshot_date) AS latest_date FROM account_snapshots"
        ).fetchone()
        latest_date = latest_row['latest_date'] if latest_row else None

        breakdown = {'checking': [], 'savings': [], 'investment': []}
        if latest_date:
            breakdown_rows = connection.execute(
                """
                SELECT account_id, description, account_type, account_class, status,
                       balance_value, balance_currency, balance_eur_value, fx_rate_to_eur
                FROM account_snapshots
                WHERE snapshot_date = ?
                ORDER BY account_type, description
                """,
                (latest_date,),
            ).fetchall()
            for row in breakdown_rows:
                account_type = row['account_type'] or 'checking'
                if account_type not in breakdown:
                    breakdown[account_type] = []
                breakdown[account_type].append({
                    'id': row['account_id'],
                    'description': row['description'],
                    'account_type': account_type,
                    'account_class': row['account_class'],
                    'status': row['status'],
                    'balance': {
                        'value': float(row['balance_value']),
                        'currency': row['balance_currency'],
                    },
                    'balance_eur': {
                        'value': (
                            None if row['balance_eur_value'] is None
                            else float(row['balance_eur_value'])
                        ),
                        'currency': 'EUR',
                    },
                    'fx_rate_to_eur': row['fx_rate_to_eur'],
                })

        series_map = defaultdict(lambda: {'checking': 0.0, 'savings': 0.0, 'investment': 0.0})
        for row in rows:
            account_type = row['account_type'] or 'checking'
            if account_type not in ('checking', 'savings', 'investment'):
                account_type = 'checking'
            series_map[row['snapshot_date']][account_type] = float(row['total_eur'] or 0.0)

        dates = sorted(series_map.keys())
        series = {
            account_type: [
                {'date': date_key, 'total': series_map[date_key].get(account_type, 0.0)}
                for date_key in dates
            ]
            for account_type in ('checking', 'savings', 'investment')
        }

        latest_totals = {key: 0.0 for key in ('checking', 'savings', 'investment')}
        if dates:
            latest_totals = series_map[dates[-1]]

        missing_fx_count = 0
        if latest_date:
            row = connection.execute(
                """
                SELECT COUNT(*) AS missing_fx
                FROM account_snapshots
                WHERE snapshot_date = ?
                  AND balance_currency != 'EUR'
                  AND balance_eur_value IS NULL
                """,
                (latest_date,),
            ).fetchone()
            missing_fx_count = int(row['missing_fx']) if row else 0

        return jsonify({
            'success': True,
            'data': {
                'days': days,
                'start_date': start_date,
                'latest_snapshot_date': latest_date,
                'series': series,
                'latest_totals': latest_totals,
                'account_breakdown': breakdown,
                'missing_fx_count': missing_fx_count,
            }
        })

    except Exception as exc:
        logger.exception(f"❌ Error fetching balance history: {exc}")
        return jsonify({
            'success': False,
            'error': str(exc)
        }), 500
    finally:
        connection.close()

@app.route('/api/demo-data', methods=['GET'])
def get_demo_data():
    """Get demo data - NO AUTH for testing"""
    import random
    from datetime import timedelta
    
    days = int(request.args.get('days', 90))
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
    for i in range(days * 3):
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
    
    for i in range(days // 30):
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
        'note': 'Demo data - no authentication required'
    })

if __name__ == '__main__':
    print("🚀 Starting Bunq Dashboard API (SESSION-BASED AUTH)...")
    print(f"📡 Environment: {ENVIRONMENT_LABEL}")
    print(f"🔒 CORS Origins: {ALLOWED_ORIGINS}")
    print(f"🔐 Authentication: {'ENABLED ✅' if has_config('BASIC_AUTH_PASSWORD', 'basic_auth_password') else 'DISABLED ⚠️'}")
    print(f"🍪 Session-based auth with secure cookies")
    print(f"⏱️  Rate Limiting: 30 req/min (general), 5 req/min (login)")
    print(f"🔑 Secret key: {'Set ✅' if has_config('FLASK_SECRET_KEY', 'flask_secret_key') else 'Auto-generated ⚠️'}")
    
    if init_bunq():
        print("✅ Bunq API initialized")
    else:
        print("⚠️ Running in demo mode only")
    
    # Production mode
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=False
    )
