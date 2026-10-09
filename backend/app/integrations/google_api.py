"""Read private Google Sheets with a service account (no Google SDK; RS256 JWT by hand).

Setup: create a service account in Google Cloud, enable the Google Sheets API, download its
JSON key to `backend/secrets/google-service-account.json` (git-ignored) or point
GOOGLE_SERVICE_ACCOUNT_FILE at it, and share each sheet with the service account's email
as Viewer.
"""

import base64
import json
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from app.core.errors import DomainValidationError
from app.core.http import FetchResult, safe_request

SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
TOKEN_URI = "https://oauth2.googleapis.com/token"  # noqa: S105 - a URL, not a secret
SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"
DEFAULT_KEY_FILE = Path("secrets/google-service-account.json")


class SheetAccessError(DomainValidationError):
    pass


@dataclass
class ServiceAccount:
    email: str
    private_key: str
    token_uri: str = TOKEN_URI

    @classmethod
    def load(cls, path: Path) -> "ServiceAccount":
        try:
            info = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SheetAccessError(f"Could not read the Google key file {path}: {exc}") from exc
        if info.get("type") != "service_account" or not info.get("private_key"):
            raise SheetAccessError(f"{path} is not a Google service-account key (JSON)")
        return cls(info["client_email"], info["private_key"], info.get("token_uri") or TOKEN_URI)


def key_file(configured: Path | None) -> Path | None:
    """The configured key file, or the default location if a key was saved there."""
    if configured:
        return configured
    return DEFAULT_KEY_FILE if DEFAULT_KEY_FILE.is_file() else None


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def signed_assertion(account: ServiceAccount, now: int | None = None) -> str:
    now = now or int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    claims = {"iss": account.email, "scope": SCOPE, "aud": account.token_uri,
              "iat": now, "exp": now + 3600}
    signing_input = f"{_b64(json.dumps(header).encode())}.{_b64(json.dumps(claims).encode())}"
    key = serialization.load_pem_private_key(account.private_key.encode(), password=None)
    if not isinstance(key, rsa.RSAPrivateKey):
        raise SheetAccessError("The service-account key is not an RSA key")
    signature = key.sign(signing_input.encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{signing_input}.{_b64(signature)}"


_token_lock = threading.Lock()
_token_cache: dict[str, tuple[str, float]] = {}


def access_token(account: ServiceAccount) -> str:
    with _token_lock:
        cached = _token_cache.get(account.email)
        if cached and cached[1] > time.time() + 60:
            return cached[0]
        body = urllib.parse.urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": signed_assertion(account),
        }).encode()
        req = urllib.request.Request(  # noqa: S310 - fixed Google token endpoint (https)
            account.token_uri, data=body, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310
                data = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:200]
            raise SheetAccessError(f"Google refused the service-account key: {detail}") from exc
        except OSError as exc:
            raise SheetAccessError(f"Could not reach Google: {exc}") from exc
        _token_cache[account.email] = (data["access_token"],
                                       time.time() + int(data.get("expires_in", 3600)))
        return str(data["access_token"])


def _get(url: str, token: str, account: ServiceAccount) -> Any:
    res: FetchResult = safe_request("GET", url, headers={"Authorization": f"Bearer {token}"},
                                    timeout=30, max_bytes=20 * 1024 * 1024)
    if res.status in (403, 404):
        raise SheetAccessError(
            f"The app's Google account can't open this sheet. In Google Sheets, click Share and "
            f"add {account.email} as Viewer, then click Import again."
        )
    if res.status != 200:
        raise SheetAccessError(f"Google Sheets API returned HTTP {res.status}")
    return json.loads(res.text)


def read_all_tabs(
    account: ServiceAccount, spreadsheet_id: str
) -> tuple[str, list[tuple[str, list[list[str]]]]]:
    """(spreadsheet title, [(tab title, rows of cell values), ...]) for every tab."""
    token = access_token(account)
    meta = _get(f"{SHEETS_API}/{spreadsheet_id}?fields=properties.title,sheets.properties.title",
                token, account)
    titles = [s["properties"]["title"] for s in meta.get("sheets", [])]
    if not titles:
        return meta.get("properties", {}).get("title", ""), []
    # A1 notation: the whole tab, name in single quotes (quotes inside doubled).
    ranges = "&".join("ranges=" + quote("'" + t.replace("'", "''") + "'") for t in titles)
    data = _get(f"{SHEETS_API}/{spreadsheet_id}/values:batchGet?{ranges}&majorDimension=ROWS",
                token, account)
    values = [vr.get("values", []) for vr in data.get("valueRanges", [])]
    return meta.get("properties", {}).get("title", ""), list(zip(titles, values, strict=False))
