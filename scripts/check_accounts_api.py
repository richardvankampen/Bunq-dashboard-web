#!/usr/bin/env python3
"""Validate expected Bunq accounts via /api/accounts."""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from typing import Any


def _error(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)


def _request_json(
    opener: urllib.request.OpenerDirector,
    method: str,
    url: str,
    payload: dict[str, Any] | None,
    timeout: float,
) -> Any:
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url=url, data=body, method=method.upper(), headers=headers)
    try:
        with opener.open(request, timeout=timeout) as response:
            content = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {details}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {url} failed: {exc.reason}") from exc

    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{method} {url} returned non-JSON payload: {content[:200]}") from exc


def _build_opener(insecure: bool) -> urllib.request.OpenerDirector:
    cookie_jar = CookieJar()
    handlers: list[Any] = [urllib.request.HTTPCookieProcessor(cookie_jar)]
    if insecure:
        handlers.append(urllib.request.HTTPSHandler(context=ssl._create_unverified_context()))
    return urllib.request.build_opener(*handlers)


def _to_float(value: Any) -> float:
    if value is None:
        raise ValueError("None")
    return float(str(value).strip())


def _load_expectations(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"EXPECTED_ACCOUNTS_JSON is invalid JSON: {exc}") from exc

    if not isinstance(parsed, list):
        raise ValueError("EXPECTED_ACCOUNTS_JSON must be a JSON array.")

    normalized: list[dict[str, Any]] = []
    for idx, item in enumerate(parsed):
        if not isinstance(item, dict):
            raise ValueError(f"Expected object at index {idx}, got {type(item).__name__}.")
        description = item.get("description")
        if not isinstance(description, str) or not description.strip():
            raise ValueError(f"Expectation index {idx} requires non-empty string field 'description'.")
        currency = item.get("currency")
        if currency is not None and not isinstance(currency, str):
            raise ValueError(f"Expectation index {idx}: 'currency' must be a string.")
        balance = item.get("balance")
        if balance is not None:
            try:
                _to_float(balance)
            except Exception as exc:  # noqa: BLE001
                raise ValueError(
                    f"Expectation index {idx}: 'balance' must be numeric-like, got {balance!r}."
                ) from exc
        normalized.append(
            {
                "description": description.strip(),
                "currency": currency.strip() if isinstance(currency, str) else None,
                "balance": balance,
            }
        )
    return normalized


def _find_account(accounts: list[dict[str, Any]], description: str) -> dict[str, Any] | None:
    exact = [a for a in accounts if str(a.get("description", "")).strip() == description]
    if exact:
        return exact[0]
    lower = description.lower()
    ci = [a for a in accounts if str(a.get("description", "")).strip().lower() == lower]
    return ci[0] if ci else None


def _format_accounts(accounts: list[dict[str, Any]]) -> str:
    rows: list[tuple[str, str, str, str]] = []
    for account in accounts:
        description = str(account.get("description", "")).strip() or "<zonder-naam>"
        balance_obj = account.get("balance") if isinstance(account.get("balance"), dict) else {}
        value = str(balance_obj.get("value", ""))
        currency = str(balance_obj.get("currency", ""))
        account_type = str(account.get("account_type", ""))
        rows.append((description, value, currency, account_type))

    rows.sort(key=lambda row: row[0].lower())
    if not rows:
        return "(geen accounts)"

    name_w = max(len("description"), max(len(r[0]) for r in rows))
    value_w = max(len("balance"), max(len(r[1]) for r in rows))
    cur_w = max(len("currency"), max(len(r[2]) for r in rows))
    type_w = max(len("account_type"), max(len(r[3]) for r in rows))

    lines = [
        f"{'description'.ljust(name_w)} | {'balance'.ljust(value_w)} | {'currency'.ljust(cur_w)} | {'account_type'.ljust(type_w)}",
        f"{'-' * name_w}-+-{'-' * value_w}-+-{'-' * cur_w}-+-{'-' * type_w}",
    ]
    for row in rows:
        lines.append(
            f"{row[0].ljust(name_w)} | {row[1].ljust(value_w)} | {row[2].ljust(cur_w)} | {row[3].ljust(type_w)}"
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Log in to Bunq Dashboard, fetch /api/accounts and validate expected account name/currency/balance."
        )
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("BASE_URL", "http://localhost:5000"),
        help="Dashboard base URL (default: %(default)s or BASE_URL env).",
    )
    parser.add_argument(
        "--username",
        default=os.getenv("DASHBOARD_USERNAME", os.getenv("BASIC_AUTH_USERNAME", "")),
        help="Dashboard username (env fallback: DASHBOARD_USERNAME or BASIC_AUTH_USERNAME).",
    )
    parser.add_argument(
        "--password",
        default=os.getenv("DASHBOARD_PASSWORD", os.getenv("BASIC_AUTH_PASSWORD", "")),
        help="Dashboard password (env fallback: DASHBOARD_PASSWORD or BASIC_AUTH_PASSWORD).",
    )
    parser.add_argument(
        "--expected-json",
        default=os.getenv("EXPECTED_ACCOUNTS_JSON", ""),
        help=(
            "JSON array of expectations. Example: "
            "[{\"description\":\"Spaarrekening\",\"currency\":\"EUR\",\"balance\":123.45}]"
        ),
    )
    parser.add_argument(
        "--balance-tolerance",
        type=float,
        default=float(os.getenv("BALANCE_TOLERANCE", "0.01")),
        help="Allowed absolute difference for balance assertions (default: %(default)s).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.getenv("API_TIMEOUT_SECONDS", "20")),
        help="HTTP timeout seconds (default: %(default)s).",
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Disable TLS certificate verification (use only for trusted self-signed environments).",
    )
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    if not args.username or not args.password:
        _error("Missing username/password. Use --username/--password or env vars DASHBOARD_USERNAME/DASHBOARD_PASSWORD.")
        return 2

    try:
        expectations = _load_expectations(args.expected_json)
    except ValueError as exc:
        _error(str(exc))
        return 2

    opener = _build_opener(args.insecure)

    login_url = urllib.parse.urljoin(base_url + "/", "api/auth/login")
    accounts_url = urllib.parse.urljoin(base_url + "/", f"api/accounts?_ts={int(time.time())}")

    try:
        login_payload = {"username": args.username, "password": args.password}
        login_response = _request_json(opener, "POST", login_url, login_payload, args.timeout)
        if not isinstance(login_response, dict) or not login_response.get("success", False):
            raise RuntimeError(f"Login failed: {login_response!r}")

        accounts_response = _request_json(opener, "GET", accounts_url, None, args.timeout)
    except RuntimeError as exc:
        _error(str(exc))
        return 1

    if not isinstance(accounts_response, dict):
        _error(f"Unexpected /api/accounts response shape: {type(accounts_response).__name__}")
        return 1

    accounts_raw = accounts_response.get("data")
    if not isinstance(accounts_raw, list):
        _error(f"Unexpected /api/accounts data field: {type(accounts_raw).__name__}")
        return 1

    accounts: list[dict[str, Any]] = [item for item in accounts_raw if isinstance(item, dict)]

    print(f"Retrieved {len(accounts)} accounts from {base_url}/api/accounts")
    print(_format_accounts(accounts))

    failures: list[str] = []
    for expected in expectations:
        description = expected["description"]
        account = _find_account(accounts, description)
        if not account:
            failures.append(f"Missing expected account '{description}'")
            continue

        expected_currency = expected.get("currency")
        actual_currency = ""
        balance_obj = account.get("balance") if isinstance(account.get("balance"), dict) else {}
        if isinstance(balance_obj, dict):
            actual_currency = str(balance_obj.get("currency", "")).strip()
        if expected_currency and actual_currency != expected_currency:
            failures.append(
                f"Account '{description}' currency mismatch: expected '{expected_currency}', got '{actual_currency or '<empty>'}'"
            )

        expected_balance = expected.get("balance")
        if expected_balance is not None:
            try:
                expected_value = _to_float(expected_balance)
                actual_value = _to_float(balance_obj.get("value"))
            except Exception:  # noqa: BLE001
                failures.append(
                    f"Account '{description}' has non-numeric balance in API response: {balance_obj.get('value')!r}"
                )
                continue
            if abs(actual_value - expected_value) > args.balance_tolerance:
                failures.append(
                    f"Account '{description}' balance mismatch: expected {expected_value:.6f}, got {actual_value:.6f}, "
                    f"tolerance {args.balance_tolerance:.6f}"
                )

    if failures:
        print("\nValidation FAILED:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    if expectations:
        print("\nValidation OK: all expected accounts matched.")
    else:
        print("\nNo expectations provided. Set --expected-json to enforce checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
