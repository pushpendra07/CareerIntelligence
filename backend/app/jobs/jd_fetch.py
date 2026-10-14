"""Read a job description from the job's own link (no AI, no keys).

Job boards with public APIs (Greenhouse, Lever, SmartRecruiters, Workday) are read through
them; any other page is read only if it publishes schema.org `JobPosting` data — the
description the page itself declares for search engines. Sites whose terms forbid automated
reading (LinkedIn, Indeed, Glassdoor, Naukri) are never fetched.
"""

import re
from urllib.parse import quote, urlsplit

from app.core.html_text import html_to_text
from app.scanner.jsonld import job_postings
from app.scanner.providers import Http, ProviderError, _json

# Never fetched: their terms forbid automated access. The user opens these and pastes the JD.
NOT_FETCHED = ("linkedin.com", "indeed.", "glassdoor.", "naukri.com")
MIN_LENGTH = 200  # shorter text is a teaser or a cookie banner, not a job description

_GREENHOUSE = re.compile(r"https?://(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io/([\w-]+)/jobs/(\d+)")
_LEVER = re.compile(r"https?://jobs\.(?:eu\.)?lever\.co/([\w.-]+)/([0-9a-f-]{36})")
_SMARTRECRUITERS = re.compile(r"https?://(?:jobs|careers)\.smartrecruiters\.com/([\w-]+)/(\d+)")
_WORKDAY = re.compile(
    r"https?://([\w-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([\w-]+)(/job/[^?#]+)")


def not_fetched_reason(url: str) -> str | None:
    host = (urlsplit(url).hostname or "").lower()
    for blocked in NOT_FETCHED:
        if blocked in host:
            return (f"{host} doesn't allow automated reading — "
                    "open the posting and paste the description")
    return None


def _greenhouse(slug: str, job_id: str, http: Http) -> str:
    data = _json(http, "GET", f"https://boards-api.greenhouse.io/v1/boards/{quote(slug)}/jobs/{job_id}")
    return html_to_text(data.get("content"))


def _lever(slug: str, posting: str, http: Http) -> str:
    data = _json(http, "GET", f"https://api.lever.co/v0/postings/{quote(slug)}/{posting}")
    parts = [data.get("descriptionPlain") or html_to_text(data.get("description"))]
    for block in data.get("lists") or []:
        parts.append(f"{block.get('text', '')}\n{html_to_text(block.get('content'))}")
    parts.append(data.get("additionalPlain") or "")
    return "\n\n".join(p.strip() for p in parts if p and p.strip())


def _smartrecruiters(company: str, posting: str, http: Http) -> str:
    data = _json(http, "GET", f"https://api.smartrecruiters.com/v1/companies/{quote(company)}/postings/{posting}")
    sections = (data.get("jobAd") or {}).get("sections") or {}
    return "\n\n".join(
        f"{s.get('title', '')}\n{html_to_text(s.get('text'))}".strip()
        for key in ("jobDescription", "qualifications", "additionalInformation")
        if (s := sections.get(key)) and s.get("text"))


def _workday(tenant: str, wd: str, site: str, path: str, http: Http) -> str:
    host = f"{tenant}.{wd}.myworkdayjobs.com"
    data = _json(http, "GET", f"https://{host}/wday/cxs/{tenant}/{site}{path}")
    info = data.get("jobPostingInfo") or {}
    return html_to_text(info.get("jobDescription"))


def _page(url: str, http: Http) -> str:
    res = http("GET", url, None)
    if res.status != 200:
        raise ProviderError(f"HTTP {res.status}")
    for posting in job_postings(res.text):
        text = html_to_text(str(posting.get("description") or ""))
        if text.strip():
            return text
    return ""


def fetch_description(url: str, http: Http) -> str | None:
    """The job description at `url`, or None if the page doesn't provide one.

    Raises ProviderError for HTTP failures (the caller records them as failed).
    """
    if m := _GREENHOUSE.match(url):
        text = _greenhouse(m.group(1), m.group(2), http)
    elif m := _LEVER.match(url):
        text = _lever(m.group(1), m.group(2), http)
    elif m := _SMARTRECRUITERS.match(url):
        text = _smartrecruiters(m.group(1), m.group(2), http)
    elif m := _WORKDAY.match(url):
        text = _workday(m.group(1), m.group(2), m.group(3), m.group(4), http)
    else:
        text = _page(url, http)
    text = (text or "").strip()
    return text if len(text) >= MIN_LENGTH else None
