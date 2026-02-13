import base64
import json
from datetime import datetime
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import current_app


def mpesa_is_configured() -> bool:
    required = [
        current_app.config.get("MPESA_CONSUMER_KEY"),
        current_app.config.get("MPESA_CONSUMER_SECRET"),
        current_app.config.get("MPESA_SHORTCODE"),
        current_app.config.get("MPESA_PASSKEY"),
        current_app.config.get("MPESA_CALLBACK_URL"),
    ]
    return all(required)


def normalize_phone_number(phone: str) -> Optional[str]:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if digits.startswith("0") and len(digits) == 10:
        return "254" + digits[1:]
    if digits.startswith("7") and len(digits) == 9:
        return "254" + digits
    if digits.startswith("254") and len(digits) == 12:
        return digits
    return None


def _api_base() -> str:
    env = current_app.config.get("MPESA_ENV", "sandbox")
    if str(env).lower() == "live":
        return "https://api.safaricom.co.ke"
    return "https://sandbox.safaricom.co.ke"


def _request_json(url: str, method="GET", headers=None, payload=None, timeout=30):
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)

    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"

    req = Request(url, data=body, headers=request_headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"M-Pesa request failed ({exc.code}): {response_body}") from exc
    except URLError as exc:
        raise RuntimeError(f"M-Pesa connection failed: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("M-Pesa returned invalid JSON response.") from exc


def _access_token() -> str:
    consumer_key = current_app.config["MPESA_CONSUMER_KEY"]
    consumer_secret = current_app.config["MPESA_CONSUMER_SECRET"]
    basic_token = base64.b64encode(f"{consumer_key}:{consumer_secret}".encode("utf-8")).decode(
        "utf-8"
    )

    data = _request_json(
        f"{_api_base()}/oauth/v1/generate?grant_type=client_credentials",
        headers={"Authorization": f"Basic {basic_token}"},
    )
    token = data.get("access_token")
    if not token:
        raise RuntimeError("M-Pesa access token was not returned.")
    return token


def start_stk_push(phone_number: str, amount: int):
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    shortcode = current_app.config["MPESA_SHORTCODE"]
    passkey = current_app.config["MPESA_PASSKEY"]
    callback_url = current_app.config["MPESA_CALLBACK_URL"]
    transaction_type = current_app.config["MPESA_TRANSACTION_TYPE"]
    account_reference = current_app.config["MPESA_ACCOUNT_REFERENCE"]
    transaction_desc = current_app.config["MPESA_TRANSACTION_DESC"]

    password_raw = f"{shortcode}{passkey}{timestamp}"
    password = base64.b64encode(password_raw.encode("utf-8")).decode("utf-8")
    token = _access_token()

    payload = {
        "BusinessShortCode": shortcode,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": transaction_type,
        "Amount": int(amount),
        "PartyA": phone_number,
        "PartyB": shortcode,
        "PhoneNumber": phone_number,
        "CallBackURL": callback_url,
        "AccountReference": account_reference,
        "TransactionDesc": transaction_desc,
    }

    return _request_json(
        f"{_api_base()}/mpesa/stkpush/v1/processrequest",
        method="POST",
        headers={"Authorization": f"Bearer {token}"},
        payload=payload,
    )
