"""safe_request: broken responses become OSError; redirect targets with spaces still work."""

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
    monkeypatch.setattr(guard, "_check_host", lambda url: None)
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
