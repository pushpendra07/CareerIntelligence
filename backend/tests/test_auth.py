import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core import auth
from app.core.config import Settings


def _login(client: TestClient, username: str, password: str) -> int:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    return r.status_code


def test_no_account_means_no_login(client: TestClient) -> None:
    assert client.get("/api/v1/auth/status").json() == {
        "required": False, "authenticated": True, "username": None}
    assert client.get("/api/v1/jobs").status_code == 200
    assert client.get("/api/v1/auth/account").json()["enabled"] is False


def test_app_password_becomes_the_first_account(client: TestClient, settings: Settings) -> None:
    settings.app_password = SecretStr("open sesame")
    assert client.get("/api/v1/health").status_code == 200  # stays open
    blocked = client.get("/api/v1/jobs")
    assert blocked.status_code == 401 and blocked.json()["error"]["code"] == "unauthorized"
    assert client.get("/openapi.json").status_code == 401
    assert client.get("/api/v1/auth/account").status_code == 401
    assert client.get("/api/v1/auth/status").json() == {
        "required": True, "authenticated": False, "username": None}

    # Saved hashed, owner-only; the password itself is nowhere in the file.
    saved = settings.login_file.read_text()
    assert "open sesame" not in saved and json.loads(saved)["username"] == "admin"
    assert os.stat(settings.login_file).st_mode & 0o777 == 0o600

    assert _login(client, "admin", "wrong") == 401
    assert _login(client, "someone", "open sesame") == 401
    ok = client.post("/api/v1/auth/login", json={"username": " Admin ", "password": "open sesame"})
    assert ok.status_code == 200 and auth.COOKIE in ok.cookies
    cookie = ok.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert "secure" not in cookie  # plain http://127.0.0.1 would never send it back
    assert client.get("/api/v1/jobs").status_code == 200
    assert client.get("/api/v1/auth/status").json() == {
        "required": True, "authenticated": True, "username": "admin"}

    # Once the account exists, a new APP_PASSWORD changes nothing.
    settings.app_password = SecretStr("other")
    assert client.get("/api/v1/jobs").status_code == 200

    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/jobs").status_code == 401
    over_https = client.post("https://testserver/api/v1/auth/login",
                             json={"username": "admin", "password": "open sesame"})
    assert "secure" in over_https.headers["set-cookie"].lower()


def test_create_and_change_the_login(client: TestClient, settings: Settings) -> None:
    short = client.post("/api/v1/auth/account", json={"username": "me", "password": "short"})
    assert short.status_code == 422
    spaced = client.post("/api/v1/auth/account", json={"username": "a b", "password": "longenough"})
    assert spaced.status_code == 422

    made = client.post("/api/v1/auth/account", json={"username": "me", "password": "longenough"})
    assert made.status_code == 201 and made.json() == {"enabled": True, "username": "me"}
    assert client.get("/api/v1/jobs").status_code == 200  # this browser is logged in
    again = client.post("/api/v1/auth/account", json={"username": "x", "password": "longenough"})
    assert again.status_code == 409

    other = TestClient(client.app)  # a second device
    assert _login(other, "me", "longenough") == 200
    assert other.get("/api/v1/jobs").status_code == 200

    wrong = client.put("/api/v1/auth/account",
                       json={"current_password": "nope", "new_password": "brand-new-pw"})
    assert wrong.status_code == 422
    assert client.put("/api/v1/auth/account",
                      json={"current_password": "longenough"}).status_code == 422
    changed = client.put("/api/v1/auth/account", json={
        "current_password": "longenough", "username": "boss", "new_password": "brand-new-pw"})
    assert changed.status_code == 200 and changed.json()["username"] == "boss"
    assert client.get("/api/v1/jobs").status_code == 200  # still in: new cookie
    assert other.get("/api/v1/jobs").status_code == 401  # other devices are logged out
    assert _login(other, "me", "longenough") == 401
    assert _login(other, "boss", "brand-new-pw") == 200

    # Username only: nobody is logged out.
    renamed = client.put("/api/v1/auth/account",
                         json={"current_password": "brand-new-pw", "username": "chief"})
    assert renamed.status_code == 200 and other.get("/api/v1/jobs").status_code == 200

    assert client.post("/api/v1/auth/logout-others").status_code == 200
    assert client.get("/api/v1/jobs").status_code == 200
    assert other.get("/api/v1/jobs").status_code == 401

    body = client.get("/api/v1/auth/account").json()
    assert body == {"enabled": True, "username": "chief", "min_password": auth.MIN_PASSWORD}


def test_too_many_wrong_passwords_lock_the_client_out(
    client: TestClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.v1.auth.time.sleep", lambda _s: None)
    auth.save_account(settings, auth.new_account("me", "longenough"))
    for _ in range(auth.MAX_FAILURES):
        assert _login(client, "me", "bad") == 401
    locked = client.post("/api/v1/auth/login", json={"username": "me", "password": "longenough"})
    assert locked.status_code == 429 and locked.json()["error"]["code"] == "too_many_attempts"
    # A direct visitor can't dodge the lockout by naming another address.
    spoofed = client.post("/api/v1/auth/login", json={"username": "me", "password": "longenough"},
                          headers={"cf-connecting-ip": "203.0.113.9"})
    assert spoofed.status_code == 429
    # Through the tunnel (cloudflared on this machine) another visitor is not locked out.
    tunnel = TestClient(client.app, client=("127.0.0.1", 50000))
    for _ in range(auth.MAX_FAILURES):
        assert tunnel.post("/api/v1/auth/login", json={"username": "me", "password": "bad"},
                           headers={"cf-connecting-ip": "203.0.113.7"}).status_code == 401
    other = tunnel.post("/api/v1/auth/login", json={"username": "me", "password": "longenough"},
                        headers={"cf-connecting-ip": "203.0.113.9"})
    assert other.status_code == 200


def test_passwords_and_tokens(settings: Settings, tmp_path: Path) -> None:
    stored = auth.hash_password("pw")
    assert stored.startswith("scrypt$") and auth.check_password("pw", stored)
    assert not auth.check_password("pW", stored)
    assert stored != auth.hash_password("pw")  # salted
    assert not auth.check_password("pw", "garbage")

    account = auth.new_account("me", "pw")
    token = auth.make_token(account, now=1_000)
    assert auth.valid_token(account, token, now=2_000)
    assert not auth.valid_token(account, token, now=1_000 + auth.MAX_AGE + 1)
    expires, sig = token.split(".")
    assert not auth.valid_token(account, f"{int(expires) + 99}.{sig}", now=2_000)
    assert not auth.valid_token(account, "garbage", now=2_000)
    assert not auth.valid_token(account, None)
    assert not auth.valid_token(None, token, now=2_000)


def test_a_broken_login_file_keeps_the_app_locked(settings: Settings) -> None:
    settings.login_file.parent.mkdir(parents=True)
    settings.login_file.write_text("{not json")
    account = auth.load_account(settings)
    assert account is not None and not auth.check_password("", account.password_hash)
