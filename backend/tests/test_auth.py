from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core import auth
from app.core.config import Settings


def test_no_password_means_no_login(client: TestClient) -> None:
    assert client.get("/api/v1/auth/status").json() == {"required": False, "authenticated": True}
    assert client.get("/api/v1/jobs").status_code == 200


def test_password_protects_the_api(client: TestClient, settings: Settings) -> None:
    settings.app_password = SecretStr("open sesame")
    assert client.get("/api/v1/health").status_code == 200  # stays open
    blocked = client.get("/api/v1/jobs")
    assert blocked.status_code == 401 and blocked.json()["error"]["code"] == "unauthorized"
    assert client.get("/openapi.json").status_code == 401
    assert client.get("/api/v1/auth/status").json() == {"required": True, "authenticated": False}

    assert client.post("/api/v1/auth/login", json={"password": "wrong"}).status_code == 401
    ok = client.post("/api/v1/auth/login", json={"password": "open sesame"})
    assert ok.status_code == 200 and auth.COOKIE in ok.cookies
    cookie = ok.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert client.get("/api/v1/jobs").status_code == 200
    assert client.get("/api/v1/auth/status").json()["authenticated"] is True

    # A new password logs everyone out.
    settings.app_password = SecretStr("new one")
    assert client.get("/api/v1/jobs").status_code == 401
    client.post("/api/v1/auth/login", json={"password": "new one"})
    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/jobs").status_code == 401


def test_tokens_expire_and_cannot_be_forged(settings: Settings) -> None:
    settings.app_password = SecretStr("pw")
    token = auth.make_token(settings, now=1_000)
    assert auth.valid_token(settings, token, now=2_000)
    assert not auth.valid_token(settings, token, now=1_000 + auth.MAX_AGE + 1)
    expires, _ = token.split(".")
    assert not auth.valid_token(settings, f"{int(expires) + 99}.{token.split('.')[1]}", now=2_000)
    assert not auth.valid_token(settings, "garbage", now=2_000)
    assert not auth.valid_token(settings, None)
