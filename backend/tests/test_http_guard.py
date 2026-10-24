"""safe_request: broken responses become OSError; redirect targets with spaces still work;
connections go to the checked addresses."""

import http.client
import urllib.error
from email.message import Message
from typing import Any

import pytest

from app.core import http as guard


class FakeResponse:
    def __init__(self, status: int = 200, body: bytes = b"ok") -> None:
        self.status, self.body = status, body

    def read(self, _n: int) -> bytes:
        return self.body

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_: object) -> None:
        return None


class FakeOpener:
    """Answers each request from a list of steps: a response, or an exception to raise."""

    def __init__(self, *steps: Any) -> None:
        self.steps, self.urls = list(steps), []

    def open(self, request: Any, timeout: float) -> FakeResponse:
        self.urls.append(request.full_url)
        step = self.steps.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


@pytest.fixture
def opener(monkeypatch: pytest.MonkeyPatch) -> Any:
    holder: dict[str, FakeOpener] = {}
    monkeypatch.setattr(guard, "_check_host", lambda url: ["93.184.216.34"])
    monkeypatch.setattr(guard.urllib.request, "build_opener", lambda *a: holder["o"])
    return holder


def redirect(to: str) -> urllib.error.HTTPError:
    headers = Message()
    headers["Location"] = to
    return urllib.error.HTTPError("https://a.example/", 302, "Found", headers, None)


def test_a_cut_short_response_is_an_os_error(opener: Any) -> None:
    opener["o"] = FakeOpener(http.client.IncompleteRead(b"partial"))
    with pytest.raises(OSError, match="IncompleteRead from a.example"):
        guard.safe_get("https://a.example/jobs")


def test_redirect_to_a_url_with_spaces_is_followed(opener: Any) -> None:
    opener["o"] = FakeOpener(redirect("/?sst=Bot check (support)&x=1"), FakeResponse())
    res = guard.safe_get("https://a.example/")
    assert res.status == 200
    assert res.url == "https://a.example/?sst=Bot%20check%20(support)&x=1"


def fake_dns(*addrs: str) -> Any:
    return lambda host, port, *a, **k: [(2, 1, 6, "", (ip, port)) for ip in addrs]


def test_check_host_returns_the_checked_addresses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(guard.socket, "getaddrinfo", fake_dns("93.184.216.34", "93.184.216.34"))
    assert guard._check_host("https://a.example/") == ["93.184.216.34"]
    monkeypatch.setattr(guard.socket, "getaddrinfo", fake_dns("93.184.216.34", "10.0.0.5"))
    with pytest.raises(guard.BlockedURLError):
        guard._check_host("https://a.example/")



def test_only_web_ports_are_fetched(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(guard.socket, "getaddrinfo", fake_dns("93.184.216.34"))
    assert guard._check_host("https://a.example:8443/jobs") == ["93.184.216.34"]
    for url in ("http://a.example:22/", "http://a.example:25/", "https://a.example:99999/"):
        with pytest.raises(guard.BlockedURLError):
            guard._check_host(url)


class FakeSocket:
    def setsockopt(self, *_: object) -> None:
        return None


def test_connection_goes_to_the_checked_address_not_a_new_lookup(
        monkeypatch: pytest.MonkeyPatch) -> None:
    # A second DNS answer (rebinding to 127.0.0.1) is never asked for: no lookup at connect.
    monkeypatch.setattr(guard.socket, "getaddrinfo", fake_dns("127.0.0.1"))
    tried: list[tuple[str, int]] = []

    def connect(address: tuple[str, int], *_: object) -> FakeSocket:
        tried.append(address)
        if address[0] == "93.184.216.34":
            raise OSError("unreachable")
        return FakeSocket()

    monkeypatch.setattr(guard.socket, "create_connection", connect)
    for cls in (guard._PinnedHTTPConnection, guard._PinnedHTTPSConnection):
        tried.clear()
        conn = cls("a.example", 8443, addrs=["93.184.216.34", "93.184.216.35"])
        conn._create_connection(("a.example", 8443))
        assert tried == [("93.184.216.34", 8443), ("93.184.216.35", 8443)]
        assert conn.host == "a.example"  # TLS name check and Host header keep the name


def test_no_checked_address_fails_without_connecting(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(guard.socket, "create_connection", lambda *a: pytest.fail("connected"))
    conn = guard._PinnedHTTPConnection("a.example", 80, addrs=[])
    with pytest.raises(OSError, match="No address"):
        conn._create_connection(("a.example", 80))
