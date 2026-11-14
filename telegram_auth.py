
import hashlib
import hmac
import json
import os
import time
from urllib.parse import parse_qsl

from dotenv import load_dotenv

load_dotenv()


def verify_telegram_init_data(init_data: str) -> dict | None:
    bot_token = os.getenv("EDINSTVO_BOT_TOKEN")

    if not bot_token or not init_data or len(init_data) > 10000:
        return None

    try:
        params = dict(parse_qsl(init_data, keep_blank_values=True))
        received_hash = params.pop("hash", "")

        if len(received_hash) != 64:
            return None

        auth_date = int(params.get("auth_date", "0"))
        now = int(time.time())

        if auth_date > now + 60 or now - auth_date > 86400:
            return None

        data_check_string = "\n".join(
            f"{key}={value}"
            for key, value in sorted(params.items())
        )

        secret_key = hmac.new(
            b"WebAppData",
            bot_token.encode("utf-8"),
            hashlib.sha256,
        ).digest()

        calculated_hash = hmac.new(
            secret_key,
            data_check_string.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(received_hash, calculated_hash):
            return None

        user = json.loads(params.get("user", "{}"))

        if (
            not isinstance(user, dict)
            or type(user.get("id")) is not int
            or user["id"] <= 0
            or not isinstance(user.get("first_name"), str)
        ):
            return None

        return user

    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None
