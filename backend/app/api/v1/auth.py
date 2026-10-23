import hmac
import time
from dataclasses import replace
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.deps import AppSettings
from app.core import auth
from app.core.config import Settings
from app.core.errors import (
    ConflictError,
    DomainValidationError,
    TooManyAttemptsError,
    UnauthorizedError,
)

router = APIRouter(tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(default=auth.DEFAULT_USERNAME, max_length=100)
    password: str = Field(min_length=1, max_length=500)


class AccountIn(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=auth.MIN_PASSWORD, max_length=500)


class AccountUpdate(BaseModel):
    current_password: str = Field(min_length=1, max_length=500)
    username: str | None = Field(default=None, min_length=1, max_length=100)
    new_password: str | None = Field(default=None, min_length=auth.MIN_PASSWORD, max_length=500)


def _client(request: Request) -> str:
    # Through a Cloudflare tunnel every request comes from 127.0.0.1; Cloudflare names the
    # real visitor in CF-Connecting-IP (it overwrites any value the visitor sends).
    return request.headers.get("cf-connecting-ip") or (
        request.client.host if request.client else "?")


def _logged_in(account: auth.Account, request: Request, body: dict[str, Any],
               status_code: int = 200) -> Response:
    res = JSONResponse(body, status_code=status_code)
    # Secure when the app is reached over HTTPS; plain http://127.0.0.1 needs it off.
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    res.set_cookie(auth.COOKIE, auth.make_token(account), max_age=auth.MAX_AGE, httponly=True,
                   samesite="lax", path="/", secure=secure)
    return res


def _same_name(a: str, b: str) -> bool:
    return hmac.compare_digest(a.strip().casefold().encode(), b.strip().casefold().encode())


def _username(value: str) -> str:
    name = value.strip()
    if not name or any(c.isspace() for c in name):
        raise DomainValidationError("Username: letters, digits and symbols, no spaces")
    return name


def _account(settings: Settings) -> auth.Account:
    account = auth.load_account(settings)
    if account is None:
        raise ConflictError("There is no login yet; create one first")
    return replace(account)  # a copy: the cached one changes only once saved


@router.get("/auth/status")
def status(request: Request, settings: AppSettings) -> dict[str, Any]:
    """Whether a login is required, whether this browser is logged in, and as whom."""
    account = auth.load_account(settings)
    if account is None:
        return {"required": False, "authenticated": True, "username": None}
    ok = auth.valid_token(account, request.cookies.get(auth.COOKIE))
    return {"required": True, "authenticated": ok, "username": account.username if ok else None}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, settings: AppSettings) -> Response:
    account = auth.load_account(settings)
    if account is None:
        return JSONResponse({"authenticated": True})
    client = _client(request)
    if wait := auth.locked_for(client):
        raise TooManyAttemptsError(
            f"Too many wrong passwords. Try again in {max(1, wait // 60)} min.")
    ok = auth.check_password(body.password, account.password_hash)  # always hashed: same time
    if not (ok and _same_name(body.username, account.username)):
        auth.note_failure(client)
        time.sleep(1)  # slows down guessing
        raise UnauthorizedError("Wrong username or password")
    auth.clear_failures(client)
    return _logged_in(account, request, {"authenticated": True, "username": account.username})


@router.post("/auth/logout")
def logout() -> Response:
    res = JSONResponse({"authenticated": False})
    res.delete_cookie(auth.COOKIE, path="/")
    return res


@router.get("/auth/account")
def get_account(settings: AppSettings) -> dict[str, Any]:
    """Settings -> Login. Never includes the password hash or the session key."""
    account = auth.load_account(settings)
    return {"enabled": account is not None, "username": account.username if account else None,
            "min_password": auth.MIN_PASSWORD}


@router.post("/auth/account", status_code=201)
def create_account(body: AccountIn, request: Request, settings: AppSettings) -> Response:
    """Turn the login on: only while the app has none (then every page is open anyway)."""
    if auth.load_account(settings) is not None:
        raise ConflictError("A login already exists; change it instead")
    account = auth.new_account(_username(body.username), body.password)
    auth.save_account(settings, account)
    return _logged_in(account, request, {"enabled": True, "username": account.username}, 201)


@router.put("/auth/account")
def update_account(body: AccountUpdate, request: Request, settings: AppSettings) -> Response:
    """Change the username and/or password. A new password logs every other browser out."""
    account = _account(settings)
    if not auth.check_password(body.current_password, account.password_hash):
        time.sleep(1)
        raise DomainValidationError("Current password is wrong")
    if body.username is None and body.new_password is None:
        raise DomainValidationError("Nothing to change")
    if body.username is not None:
        account.username = _username(body.username)
    if body.new_password is not None:
        account.password_hash = auth.hash_password(body.new_password)
        account.session_key = auth.new_session_key()
    auth.save_account(settings, account)
    return _logged_in(account, request, {"enabled": True, "username": account.username})


@router.post("/auth/logout-others")
def logout_others(request: Request, settings: AppSettings) -> Response:
    """Log out every other browser and device; this one stays logged in."""
    account = _account(settings)
    account.session_key = auth.new_session_key()
    auth.save_account(settings, account)
    return _logged_in(account, request, {"enabled": True, "username": account.username})
