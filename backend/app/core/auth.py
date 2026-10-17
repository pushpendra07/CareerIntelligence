"""Optional login: when APP_PASSWORD is set, every API call needs a session cookie.

The cookie holds an expiry time and an HMAC of it keyed by the password, so changing the
password logs every browser out. Nothing is stored server-side. Health and the login
endpoints stay open; everything else answers 401 until you log in.
"""

import hashlib
import hmac
import time

from app.core.config import Settings

COOKIE = "ci_session"
MAX_AGE = 30 * 24 * 3600  # 30 days
OPEN_PATHS = ("/api/v1/health", "/api/v1/auth/")


def required(settings: Settings) -> bool:
    return bool(settings.app_password and settings.app_password.get_secret_value())


def _key(settings: Settings) -> bytes:
    secret = settings.app_password.get_secret_value() if settings.app_password else ""
    return hashlib.sha256(b"career-intelligence-session:" + secret.encode()).digest()


def make_token(settings: Settings, now: float | None = None) -> str:
    expires = int((now or time.time()) + MAX_AGE)
    sig = hmac.new(_key(settings), str(expires).encode(), hashlib.sha256).hexdigest()
    return f"{expires}.{sig}"


def valid_token(settings: Settings, token: str | None, now: float | None = None) -> bool:
    if not token or "." not in token:
        return False
    expires, sig = token.split(".", 1)
    if not expires.isdigit() or int(expires) < (now or time.time()):
        return False
    good = hmac.new(_key(settings), expires.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(good, sig)


def password_ok(settings: Settings, attempt: str) -> bool:
    secret = settings.app_password.get_secret_value() if settings.app_password else ""
    return bool(secret) and hmac.compare_digest(secret.encode(), attempt.encode())


def is_open(path: str) -> bool:
    return not path.startswith(("/api/", "/docs", "/openapi.json", "/redoc")) or path.startswith(
        OPEN_PATHS)
