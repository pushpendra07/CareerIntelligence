"""Login: one account (username + password) protects the whole app.

The account lives in LOGIN_FILE (backend/secrets/login.json, 0600), never in the database,
backups or API output: the username, a salted scrypt hash of the password and a random session
key. The session cookie holds an expiry time and an HMAC of it keyed by the session key, so a
new password (or "log out other devices") makes a new key and logs every other browser out.

No account file: APP_PASSWORD in .env, if set, becomes the first account (username "admin");
otherwise there is no login until one is created in Settings -> Login. Forgot the password:
delete the file (and set APP_PASSWORD to start over with it).
"""

import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from app.core.config import Settings

logger = logging.getLogger(__name__)

COOKIE = "ci_session"
MAX_AGE = 30 * 24 * 3600  # 30 days
OPEN_PATHS = ("/api/v1/health", "/api/v1/auth/status", "/api/v1/auth/login",
              "/api/v1/auth/logout")
DEFAULT_USERNAME = "admin"
MIN_PASSWORD = 8
# Wrong passwords: this many from one client within the window locks it out for the window.
MAX_FAILURES = 5
FAILURE_WINDOW = 15 * 60
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


@dataclass
class Account:
    username: str
    password_hash: str
    session_key: str


# --- passwords ------------------------------------------------------------------------------


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${salt.hex()}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt, digest = stored.split("$")
        if kind != "scrypt":
            return False
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r),
                             p=int(p), dklen=len(digest) // 2)
    except ValueError:
        return False
    return hmac.compare_digest(got.hex(), digest)


def new_session_key() -> str:
    return secrets.token_hex(32)


def new_account(username: str, password: str) -> Account:
    return Account(username.strip(), hash_password(password), new_session_key())


# --- the account file -----------------------------------------------------------------------

_lock = threading.Lock()
_cache: dict[Path, tuple[int, Account]] = {}  # file -> (mtime_ns, account)


def _read(path: Path) -> Account:
    try:
        info = json.loads(path.read_text(encoding="utf-8"))
        return Account(**{k: str(info[k]) for k in ("username", "password_hash", "session_key")})
    except (OSError, ValueError, KeyError, TypeError):
        logger.warning("login file unreadable; login stays required", extra={"file": str(path)})
        return Account("", "", new_session_key())  # nobody can log in, nothing is open


def save_account(settings: Settings, account: Account) -> None:
    path = settings.login_file
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(asdict(account), f)
    os.replace(tmp, path)
    with _lock:
        _cache.pop(path, None)


def load_account(settings: Settings) -> Account | None:
    """The login account, or None when the app has no login. Re-read when the file changes."""
    path = settings.login_file
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        secret = settings.app_password.get_secret_value() if settings.app_password else ""
        if not secret:
            return None
        account = new_account(DEFAULT_USERNAME, secret)
        save_account(settings, account)
        logger.info("login account created from APP_PASSWORD", extra={"file": str(path)})
        return account
    with _lock:
        hit = _cache.get(path)
        if hit and hit[0] == mtime:
            return hit[1]
    account = _read(path)
    with _lock:
        _cache[path] = (mtime, account)
    return account


def required(settings: Settings) -> bool:
    return load_account(settings) is not None


# --- session cookie -------------------------------------------------------------------------


def make_token(account: Account, now: float | None = None) -> str:
    expires = int((now or time.time()) + MAX_AGE)
    sig = hmac.new(bytes.fromhex(account.session_key), str(expires).encode(),
                   hashlib.sha256).hexdigest()
    return f"{expires}.{sig}"


def valid_token(account: Account | None, token: str | None, now: float | None = None) -> bool:
    if account is None or not token or "." not in token:
        return False
    expires, sig = token.split(".", 1)
    if not expires.isdigit() or int(expires) < (now or time.time()):
        return False
    try:
        key = bytes.fromhex(account.session_key)
    except ValueError:
        return False
    good = hmac.new(key, expires.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(good, sig)


def is_open(path: str) -> bool:
    return not path.startswith(("/api/", "/docs", "/openapi.json", "/redoc")) or path in OPEN_PATHS


# --- wrong-password lockout -----------------------------------------------------------------

_failures: dict[str, list[float]] = {}


def locked_for(client: str, now: float | None = None) -> int:
    """Seconds this client must wait before trying again (0 = may try)."""
    now = now or time.time()
    with _lock:
        recent = [t for t in _failures.get(client, []) if t > now - FAILURE_WINDOW]
        _failures[client] = recent
        if len(recent) < MAX_FAILURES:
            return 0
        return max(1, int(recent[0] + FAILURE_WINDOW - now))


def note_failure(client: str, now: float | None = None) -> None:
    with _lock:
        _failures.setdefault(client, []).append(now or time.time())


def clear_failures(client: str) -> None:
    with _lock:
        _failures.pop(client, None)
