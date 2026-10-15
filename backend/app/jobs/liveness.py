"""Is a job posting still open? Asked of the job's own link (no AI, no keys).

Job boards with public APIs (Greenhouse, Lever, SmartRecruiters, Workday, Ashby) say directly
whether the posting still exists. Any other page is read: a 404/410, a redirect to a listing
page, an expired schema.org `validThrough` or a "no longer accepting applications" notice means
closed; `JobPosting` data that is still valid means open. Sites whose terms forbid automated
reading (LinkedIn, Indeed, Glassdoor, Naukri) are never fetched.
"""

import json
import re
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any
from urllib.parse import quote, urlsplit

from app.core.html_text import html_to_text
from app.core.urls import is_listing_url
from app.jobs.jd_fetch import NOT_FETCHED
from app.scanner.jsonld import job_postings
from app.scanner.providers import Http, _date

OPEN, CLOSED, LIKELY_CLOSED, UNKNOWN = "OPEN", "CLOSED", "LIKELY_CLOSED", "UNKNOWN"

_GREENHOUSE = re.compile(r"https?://(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io/([\w-]+)/jobs/(\d+)")
_LEVER = re.compile(r"https?://jobs\.(eu\.)?lever\.co/([\w.-]+)/([0-9a-f-]{36})")
_SMARTRECRUITERS = re.compile(r"https?://(?:jobs|careers)\.smartrecruiters\.com/([\w-]+)/(\d+)")
_WORKDAY = re.compile(
    r"https?://([\w-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([\w-]+)(/job/[^?#]+)")
_ASHBY = re.compile(r"https?://jobs\.ashbyhq\.com/([\w.%-]+)/([0-9a-f-]{36})")
# Notices that job pages show once a posting is taken down.
_CLOSED_TEXT = re.compile(
    r"no longer (?:accepting applications|available|open|active|exists)|"
    r"(?:job|position|posting|vacancy|role|requisition) (?:has been|is|was) "
    r"(?:filled|closed|expired|removed)|"
    r"(?:job|posting|position) (?:has )?expired|this job is closed|"
    r"applications? (?:are |is )?closed|"
    r"job (?:you are looking for|you're looking for) (?:is|was|could not|can't|cannot)|"
    r"(?:page|job) (?:not found|could not be found|does not exist|doesn't exist)",
    re.IGNORECASE)
_SCRIPTS = re.compile(r"<(script|style|noscript)\b.*?</\1>", re.IGNORECASE | re.DOTALL)


@dataclass(frozen=True)
class PostingCheck:
    state: str  # OPEN | CLOSED | LIKELY_CLOSED | UNKNOWN
    reason: str
    url: str
    valid_through: date | None = None

    def as_dict(self) -> dict[str, Any]:
        out = asdict(self)
        out["valid_through"] = self.valid_through.isoformat() if self.valid_through else None
        return out


def _gone(status: int) -> bool:
    return status in (404, 410)


def _api(http: Http, url: str) -> tuple[int, Any]:
    res = http("GET", url, None)
    if res.status != 200:
        return res.status, None
    try:
        return 200, json.loads(res.text)
    except json.JSONDecodeError:
        return 200, None


def _from_api(status: int, board: str, url: str, open_: bool = True) -> PostingCheck:
    if _gone(status):
        return PostingCheck(CLOSED, f"{board} says this posting no longer exists", url)
    if status != 200:
        return PostingCheck(UNKNOWN, f"{board} didn't answer (HTTP {status}) — try again later",
                            url)
    if not open_:
        return PostingCheck(CLOSED, f"{board} lists this posting as closed", url)
    return PostingCheck(OPEN, f"{board} still lists this posting", url)


def _page(url: str, http: Http, today: date) -> PostingCheck:
    res = http("GET", url, None)
    if _gone(res.status):
        return PostingCheck(CLOSED, f"The posting page is gone (HTTP {res.status})", url)
    if res.status != 200:
        return PostingCheck(UNKNOWN, f"The posting page didn't load (HTTP {res.status})", url)
    moved = res.url.rstrip("/") != url.rstrip("/")
    postings = job_postings(res.text)
    for posting in postings:
        until = _date(posting.get("validThrough"))
        if until and until < today:
            return PostingCheck(CLOSED, f"The page says applications closed on {until:%d %b %Y}",
                                url, until)
    if not postings and moved and is_listing_url(res.url):
        return PostingCheck(LIKELY_CLOSED, f"The link now goes to a job list ({res.url}) — "
                            "the posting was likely removed", url)
    if not postings and _CLOSED_TEXT.search(html_to_text(_SCRIPTS.sub(" ", res.text))):
        return PostingCheck(CLOSED, "The page says the job is no longer open", url)
    if postings:
        until = _date(postings[0].get("validThrough"))
        return PostingCheck(OPEN, "The page still publishes this job"
                            + (f" (open until {until:%d %b %Y})" if until else ""), url, until)
    if moved:
        return PostingCheck(LIKELY_CLOSED, f"The link now redirects to {res.url} — "
                            "check whether the job is still there", url)
    return PostingCheck(UNKNOWN, "The page loads but doesn't say whether the job is open — "
                        "open it to check", url)


def check_posting(url: str, http: Http, today: date) -> PostingCheck:
    """Ask the posting's own site whether it is still open.

    Network errors propagate (ProviderError, BlockedURLError, OSError); the caller reports them.
    """
    host = (urlsplit(url).hostname or "").lower()
    if any(blocked in host for blocked in NOT_FETCHED):
        return PostingCheck(UNKNOWN, f"{host} doesn't allow automated checks — open the posting, "
                            "or use “Find on other portals” to look for it elsewhere", url)
    if is_listing_url(url):
        return PostingCheck(UNKNOWN, "This link is a job list, not one posting — "
                            "add the posting's own link", url)
    if m := _GREENHOUSE.match(url):
        status, _ = _api(
            http, f"https://boards-api.greenhouse.io/v1/boards/{quote(m.group(1))}/jobs/{m.group(2)}")
        return _from_api(status, "Greenhouse", url)
    if m := _LEVER.match(url):
        api = "https://api.eu.lever.co" if m.group(1) else "https://api.lever.co"
        status, _ = _api(http, f"{api}/v0/postings/{quote(m.group(2))}/{m.group(3)}")
        return _from_api(status, "Lever", url)
    if m := _SMARTRECRUITERS.match(url):
        status, data = _api(
            http, f"https://api.smartrecruiters.com/v1/companies/{quote(m.group(1))}/postings/{m.group(2)}")
        active = not isinstance(data, dict) or data.get("active", True) is not False
        return _from_api(status, "SmartRecruiters", url, active)
    if m := _WORKDAY.match(url):
        tenant, wd, site, path = m.groups()
        status, data = _api(http, f"https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{path}")
        info = (data.get("jobPostingInfo") or {}) if isinstance(data, dict) else {}
        if status == 200 and not info:
            return PostingCheck(CLOSED, "Workday no longer has this posting", url)
        return _from_api(status, "Workday", url, info.get("canApply", True) is not False)
    if m := _ASHBY.match(url):
        status, data = _api(http, f"https://api.ashbyhq.com/posting-api/job-board/{quote(m.group(1))}")
        if status == 200 and isinstance(data, dict):
            ids = {j.get("id") for j in data.get("jobs") or []}
            return _from_api(200, "Ashby", url, m.group(2) in ids)
        return _from_api(status, "Ashby", url)
    return _page(url, http, today)
