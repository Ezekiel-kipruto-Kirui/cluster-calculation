import logging
import os
import secrets
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


class Config:
    SECRET_KEY = os.getenv("APP_SECRET_KEY") or secrets.token_urlsafe(32)
    DATABASE_PATH = os.getenv("DATABASE_PATH", str(BASE_DIR / "kuccps.db"))
    DEFAULT_ADMIN_USERNAME = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
    DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123")
    FLASK_DEBUG = os.getenv("FLASK_DEBUG", "0") == "1"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "0") == "1"

    CLUSTER_CALC_AMOUNT = int(os.getenv("CLUSTER_CALC_AMOUNT", "50"))

    MPESA_ENABLED = os.getenv("MPESA_ENABLED", "1") == "1"
    MPESA_ENV = os.getenv("MPESA_ENV", "sandbox").strip().lower()
    MPESA_CONSUMER_KEY = os.getenv("MPESA_CONSUMER_KEY", "").strip()
    MPESA_CONSUMER_SECRET = os.getenv("MPESA_CONSUMER_SECRET", "").strip()
    MPESA_SHORTCODE = os.getenv("MPESA_SHORTCODE", "").strip()
    MPESA_PASSKEY = os.getenv("MPESA_PASSKEY", "").strip()
    MPESA_CALLBACK_URL = os.getenv("MPESA_CALLBACK_URL", "").strip()
    MPESA_TRANSACTION_TYPE = os.getenv("MPESA_TRANSACTION_TYPE", "CustomerPayBillOnline").strip()
    MPESA_ACCOUNT_REFERENCE = os.getenv("MPESA_ACCOUNT_REFERENCE", "KUCCPS").strip()
    MPESA_TRANSACTION_DESC = os.getenv(
        "MPESA_TRANSACTION_DESC", "KUCCPS cluster points calculation"
    ).strip()

    @classmethod
    def warn_if_insecure(cls, logger: logging.Logger) -> None:
        if os.getenv("APP_SECRET_KEY") is None:
            logger.warning(
                "APP_SECRET_KEY is not set; using a random secret key (sessions will reset on restart)."
            )
        if os.getenv("DEFAULT_ADMIN_PASSWORD") is None:
            logger.warning(
                "DEFAULT_ADMIN_PASSWORD is not set; using the default admin credentials."
            )
        if cls.MPESA_ENABLED:
            required = [
                ("MPESA_CONSUMER_KEY", cls.MPESA_CONSUMER_KEY),
                ("MPESA_CONSUMER_SECRET", cls.MPESA_CONSUMER_SECRET),
                ("MPESA_SHORTCODE", cls.MPESA_SHORTCODE),
                ("MPESA_PASSKEY", cls.MPESA_PASSKEY),
                ("MPESA_CALLBACK_URL", cls.MPESA_CALLBACK_URL),
            ]
            missing = [name for name, value in required if not value]
            if missing:
                logger.warning(
                    "M-Pesa is enabled but these settings are missing: %s",
                    ", ".join(missing),
                )
