"""A small, guarded HTTP GET for verification checks (stdlib only).

Guards: http(s) only, no private/loopback/link-local targets (re-checked on every redirect),
bounded redirects, timeout and response size.
"""

import ipaddress
import socket
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urljoin, urlsplit

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


def _check_host(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise BlockedURLError(f"Unsupported URL: {url}")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or 443)
    except socket.gaierror as exc:
        raise BlockedURLError(f"Cannot resolve {parts.hostname}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise BlockedURLError(f"Refusing non-public address for {parts.hostname}")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


def safe_get(
    url: str, timeout: float = 10.0, max_redirects: int = 5, max_bytes: int = MAX_BYTES
) -> FetchResult:
    opener = urllib.request.build_opener(
        _NoRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context())
    )
    current = url
    for _ in range(max_redirects + 1):
        _check_host(current)
        request = urllib.request.Request(  # noqa: S310 - scheme checked in _check_host
            current, headers={"User-Agent": USER_AGENT}
        )
        try:
            with opener.open(request, timeout=timeout) as resp:  # noqa: S310 - scheme checked
                body = resp.read(max_bytes).decode("utf-8", "replace")
                return FetchResult(current, resp.status, body)
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308) and exc.headers.get("Location"):
                current = urljoin(current, exc.headers["Location"])
                continue
            return FetchResult(current, exc.code, "")
    raise BlockedURLError("Too many redirects")
