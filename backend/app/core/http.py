"""A small, guarded HTTP GET for verification checks (stdlib only).

Guards: http(s) only, no private/loopback/link-local targets (re-checked on every redirect),
bounded redirects, timeout and response size. The connection goes to the addresses that were
checked, not to a fresh DNS lookup, so a host can't pass the check and then resolve elsewhere.
"""

import http.client
import ipaddress
import json
import socket
import ssl
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from typing import Any, Protocol
from urllib.parse import quote, urljoin, urlsplit

USER_AGENT = "CareerIntelligence/0.1 (personal job-search verification; +local)"
MAX_BYTES = 512 * 1024


@dataclass(frozen=True)
class FetchResult:
    url: str  # final URL after redirects
    status: int
    text: str


class Fetcher(Protocol):
    def __call__(self, url: str) -> FetchResult: ...


class BlockedURLError(ValueError):
    pass


class FetchError(OSError):
    """The server broke the response (cut short, bad redirect…). An OSError, like a network
    failure, so callers that handle those handle this too."""


# Characters a URL may contain as they are; anything else (spaces in a redirect Location) is
# percent-encoded, otherwise http.client refuses the request.
_URL_SAFE = ":/?#[]@!$&'()*+,;=%~"


def _check_host(url: str) -> list[str]:
    """The host's addresses, all public, or BlockedURLError."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise BlockedURLError(f"Unsupported URL: {url}")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or 443)
    except socket.gaierror as exc:
        raise BlockedURLError(f"Cannot resolve {parts.hostname}") from exc
    addrs: list[str] = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise BlockedURLError(f"Refusing non-public address for {parts.hostname}")
        if str(ip) not in addrs:
            addrs.append(str(ip))
    return addrs


def _connect_to(addrs: list[str]) -> Callable[..., socket.socket]:
    """http.client's socket opener, limited to the checked addresses (tried in order)."""

    def create(address: tuple[str, int], *args: Any) -> socket.socket:
        error = OSError(f"No address for {address[0]}")
        for ip in addrs:
            try:
                return socket.create_connection((ip, address[1]), *args)
            except OSError as exc:
                error = exc
        raise error

    return create


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, *args: Any, addrs: list[str], **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._create_connection = _connect_to(addrs)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connects to a checked address; TLS (SNI, certificate) still uses the host name."""

    def __init__(self, *args: Any, addrs: list[str], **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._create_connection = _connect_to(addrs)


class _PinnedHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, addrs: list[str]) -> None:
        super().__init__()
        self.addrs = addrs

    def http_open(self, req: urllib.request.Request) -> http.client.HTTPResponse:
        return self.do_open(partial(_PinnedHTTPConnection, addrs=self.addrs), req)


class _PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, addrs: list[str]) -> None:
        super().__init__(context=ssl.create_default_context())
        self.addrs = addrs

    def https_open(self, req: urllib.request.Request) -> http.client.HTTPResponse:
        return self.do_open(partial(_PinnedHTTPSConnection, addrs=self.addrs), req,
                            context=self._context)  # type: ignore[attr-defined]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


def safe_request(
    method: str,
    url: str,
    *,
    json_body: object | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
    max_redirects: int = 5,
    max_bytes: int = MAX_BYTES,
) -> FetchResult:
    """GET/POST with the SSRF guard re-applied on every redirect hop."""
    data = json.dumps(json_body).encode() if json_body is not None else None
    hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json, text/html;q=0.9, */*;q=0.5"}
    if data is not None:
        hdrs["Content-Type"] = "application/json"
    hdrs.update(headers or {})
    current = url
    for _ in range(max_redirects + 1):
        addrs = _check_host(current)
        # No proxy: the request must go to the address that was checked.
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), _NoRedirect,
            _PinnedHTTPHandler(addrs), _PinnedHTTPSHandler(addrs),
        )
        request = urllib.request.Request(  # noqa: S310 - scheme checked in _check_host
            current, data=data, headers=hdrs, method=method
        )
        try:
            with opener.open(request, timeout=timeout) as resp:  # noqa: S310 - scheme checked
                body = resp.read(max_bytes).decode("utf-8", "replace")
                return FetchResult(current, resp.status, body)
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308) and exc.headers.get("Location"):
                current = quote(urljoin(current, exc.headers["Location"]), safe=_URL_SAFE)
                if exc.code == 303:
                    method, data = "GET", None
                continue
            return FetchResult(current, exc.code, "")
        except http.client.HTTPException as exc:  # IncompleteRead, InvalidURL, BadStatusLine…
            raise FetchError(f"{type(exc).__name__} from {urlsplit(current).hostname}") from exc
    raise BlockedURLError("Too many redirects")


def safe_get(
    url: str, timeout: float = 10.0, max_redirects: int = 5, max_bytes: int = MAX_BYTES
) -> FetchResult:
    return safe_request("GET", url, timeout=timeout, max_redirects=max_redirects,
                        max_bytes=max_bytes)
