"""Job-board connectors for the built-in scanner (public, key-less APIs only).

Each provider turns a company's board into `ScannedJob`s. Providers never touch the database;
the scan service decides what to keep. Shapes were verified against live boards (Greenhouse,
Lever, Ashby, SmartRecruiters, Workday, Pinpoint, Teamtailor); Recruitee and Workable follow
their documented public APIs.
"""

import json
import re
import xml.etree.ElementTree as ET  # noqa: S405 - parses public RSS; no DTD/entity expansion used
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Protocol
from urllib.parse import quote, urlsplit

from app.core.html_text import html_to_text
from app.core.http import FetchResult
from app.core.urls import is_listing_url


@dataclass
class Board:
    provider: str  # GREENHOUSE | LEVER | ASHBY | SMARTRECRUITERS | WORKDAY | ...
    slug: str
    url: str  # human-facing board URL
    extra: dict[str, str] = field(default_factory=dict)


@dataclass
class ScannedJob:
    title: str
    url: str
    external_id: str | None = None
    location: str | None = None
    remote: bool | None = None
    description: str = ""
    posted: date | None = None
    employment_type: str | None = None
    needs_detail: bool = False  # description must be fetched with one extra call
    broad_title: bool = False  # set by the filters: keep only if the JD mentions the stack
    detail_ref: str | None = None


class Http(Protocol):
    def __call__(self, method: str, url: str, json_body: object | None = None) -> FetchResult: ...


class ProviderError(RuntimeError):
    pass


def _json(http: Http, method: str, url: str, body: object | None = None) -> Any:
    res = http(method, url, body)
    if res.status == 404:
        raise ProviderError("board not found (404) — the company may have moved job boards")
    if res.status != 200:
        raise ProviderError(f"HTTP {res.status}")
    try:
        return json.loads(res.text)
    except json.JSONDecodeError as exc:
        raise ProviderError("response was not JSON") from exc


def _date(value: object) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, int | float):  # epoch milliseconds
        return datetime.fromtimestamp(value / 1000, UTC).date()
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        m = re.match(r"(\d{4}-\d{2}-\d{2})", str(value))
        return date.fromisoformat(m.group(1)) if m else None


# --- board detection ------------------------------------------------------------------------

_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("GREENHOUSE", re.compile(
        r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_board\?for=)?([A-Za-z0-9_-]+)")),
    ("GREENHOUSE", re.compile(r"boards-api\.greenhouse\.io/v1/boards/([A-Za-z0-9_-]+)")),
    ("LEVER", re.compile(r"jobs\.(?:eu\.)?lever\.co/([A-Za-z0-9_.-]+)")),
    ("ASHBY", re.compile(r"jobs\.ashbyhq\.com/([A-Za-z0-9_.%-]+)")),
    ("SMARTRECRUITERS", re.compile(r"(?:jobs|careers)\.smartrecruiters\.com/([A-Za-z0-9_-]+)")),
    ("WORKABLE", re.compile(r"apply\.workable\.com/([A-Za-z0-9_-]+)")),
    ("RECRUITEE", re.compile(r"([A-Za-z0-9_-]+)\.recruitee\.com")),
    ("PINPOINT", re.compile(r"([A-Za-z0-9_-]+)\.pinpointhq\.com")),
    ("TEAMTAILOR", re.compile(r"([A-Za-z0-9_-]+)\.teamtailor\.com")),
]
_WORKDAY = re.compile(
    r"https?://([A-Za-z0-9_-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([A-Za-z0-9_-]+)")
_IGNORED_SLUGS = {"embed", "v1", "boards", "jobs", "api", "www", "careers", "apply", "job", "j",
                  # shared Teamtailor/Recruitee/Pinpoint infrastructure, not company boards
                  "app", "tt", "assets", "cdn", "static", "scripts", "career", "images", "media",
                  "help", "support", "status", "blog", "docs", "login", "signup"}


def resolve_board(url: str | None) -> Board | None:
    """Find a supported job board in a careers URL (or a link found on a careers page)."""
    if not url:
        return None
    if m := _WORKDAY.search(url):
        tenant, wd, site = m.groups()
        return Board("WORKDAY", tenant, f"https://{tenant}.{wd}.myworkdayjobs.com/{site}",
                     {"host": f"{tenant}.{wd}.myworkdayjobs.com", "site": site})
    for provider, pattern in _RULES:
        m = pattern.search(url)
        if m and m.group(1).lower() not in _IGNORED_SLUGS:
            slug = m.group(1)
            board_url = {
                "GREENHOUSE": f"https://job-boards.greenhouse.io/{slug}",
                "LEVER": f"https://jobs.lever.co/{slug}",
                "ASHBY": f"https://jobs.ashbyhq.com/{slug}",
                "SMARTRECRUITERS": f"https://jobs.smartrecruiters.com/{slug}",
                "WORKABLE": f"https://apply.workable.com/{slug}",
                "RECRUITEE": f"https://{slug}.recruitee.com",
                "PINPOINT": f"https://{slug}.pinpointhq.com",
                "TEAMTAILOR": f"https://{slug}.teamtailor.com",
            }[provider]
            return Board(provider, slug, board_url)
    return None


def teamtailor_board(careers_url: str) -> Board:
    """Teamtailor sites often live on a custom domain (careers.vaimo.com): use its RSS feed."""
    parts = urlsplit(careers_url if "://" in careers_url else f"https://{careers_url}")
    return Board("TEAMTAILOR", parts.hostname or "", f"https://{parts.hostname}",
                 {"rss": f"https://{parts.hostname}/jobs.rss"})


# --- providers ------------------------------------------------------------------------------

def greenhouse(board: Board, http: Http) -> list[ScannedJob]:
    data = _json(http, "GET",
                 f"https://boards-api.greenhouse.io/v1/boards/{quote(board.slug)}/jobs?content=true")
    out = []
    for j in data.get("jobs", []):
        loc = (j.get("location") or {}).get("name")
        url = j.get("absolute_url") or ""
        if not url or is_listing_url(url):  # e.g. stripe.com/jobs/search?gh_jid=...
            url = f"https://job-boards.greenhouse.io/{board.slug}/jobs/{j['id']}"
        out.append(ScannedJob(
            title=j["title"], url=url, external_id=str(j["id"]), location=loc,
            remote=bool(loc and "remote" in loc.lower()),
            description=html_to_text(j.get("content")),
            posted=_date(j.get("first_published") or j.get("updated_at"))))
    return out


def lever(board: Board, http: Http) -> list[ScannedJob]:
    data = _json(http, "GET", f"https://api.lever.co/v0/postings/{quote(board.slug)}?mode=json")
    out = []
    for j in data if isinstance(data, list) else []:
        cat = j.get("categories") or {}
        lists = "\n".join(
            f"{x.get('text', '')}\n{html_to_text(x.get('content'))}" for x in j.get("lists") or [])
        intro = j.get("descriptionPlain") or html_to_text(j.get("description"))
        desc = "\n\n".join(p for p in (intro, lists, j.get("additionalPlain") or "") if p)
        out.append(ScannedJob(
            title=j["text"], url=j["hostedUrl"], external_id=j.get("id"),
            location=cat.get("location"), remote=j.get("workplaceType") == "remote",
            description=desc, posted=_date(j.get("createdAt")),
            employment_type=cat.get("commitment")))
    return out


def ashby(board: Board, http: Http) -> list[ScannedJob]:
    data = _json(http, "GET", f"https://api.ashbyhq.com/posting-api/job-board/{quote(board.slug)}"
                              "?includeCompensation=true")
    out = []
    for j in data.get("jobs", []):
        if j.get("isListed") is False:
            continue
        out.append(ScannedJob(
            title=j["title"], url=j.get("jobUrl") or j.get("applyUrl", ""), external_id=j.get("id"),
            location=j.get("location"), remote=bool(j.get("isRemote")),
            description=j.get("descriptionPlain") or html_to_text(j.get("descriptionHtml")),
            posted=_date(j.get("publishedAt")), employment_type=j.get("employmentType")))
    return out


def smartrecruiters(board: Board, http: Http) -> list[ScannedJob]:
    out: list[ScannedJob] = []
    offset = 0
    while offset < 1000:
        data = _json(http, "GET", f"https://api.smartrecruiters.com/v1/companies/"
                                  f"{quote(board.slug)}/postings?limit=100&offset={offset}")
        for j in data.get("content", []):
            loc = j.get("location") or {}
            place = ", ".join(x for x in (loc.get("city"), loc.get("region"), loc.get("country",
                              "").upper()) if x and x.strip(", ")) or None
            out.append(ScannedJob(
                title=j["name"], external_id=str(j["id"]),
                url=f"https://jobs.smartrecruiters.com/{board.slug}/{j['id']}",
                location=place, remote=bool(loc.get("remote")), posted=_date(j.get("releasedDate")),
                employment_type=(j.get("typeOfEmployment") or {}).get("label"),
                needs_detail=True, detail_ref=j.get("ref")))
        offset += 100
        if offset >= int(data.get("totalFound", 0)):
            break
    return out


def smartrecruiters_detail(job: ScannedJob, http: Http) -> None:
    if not job.detail_ref:
        return
    data = _json(http, "GET", job.detail_ref)
    sections = (data.get("jobAd") or {}).get("sections") or {}
    job.description = "\n\n".join(
        f"{s.get('title', '')}\n{html_to_text(s.get('text'))}".strip()
        for key in ("jobDescription", "qualifications", "additionalInformation",
                    "companyDescription")
        if (s := sections.get(key)) and s.get("text"))
    job.url = data.get("postingUrl") or job.url


def workday(board: Board, http: Http) -> list[ScannedJob]:
    host, site = board.extra["host"], board.extra["site"]
    api = f"https://{host}/wday/cxs/{board.slug}/{site}"
    out: list[ScannedJob] = []
    offset, total = 0, 0
    while offset < 400:
        data = _json(http, "POST", f"{api}/jobs",
                     {"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": ""})
        posts = data.get("jobPostings", [])
        for j in posts:
            path = j.get("externalPath", "")
            out.append(ScannedJob(
                title=j.get("title", ""), url=f"https://{host}/{site}{path}",
                external_id=(j.get("bulletFields") or [None])[0], location=j.get("locationsText"),
                employment_type=j.get("timeType"), needs_detail=True, detail_ref=f"{api}{path}"))
        offset += 20
        total = int(data.get("total") or 0) or total  # later pages report total=0
        if not posts or offset >= total:
            break
    return out


def workday_detail(job: ScannedJob, http: Http) -> None:
    if not job.detail_ref:
        return
    info = _json(http, "GET", job.detail_ref).get("jobPostingInfo") or {}
    job.description = html_to_text(info.get("jobDescription"))
    job.posted = _date(info.get("startDate")) or job.posted
    job.location = info.get("location") or job.location
    job.url = info.get("externalUrl") or job.url


def pinpoint(board: Board, http: Http) -> list[ScannedJob]:
    data = _json(http, "GET", f"https://{board.slug}.pinpointhq.com/postings.json")
    out = []
    for j in data.get("data", []):
        loc = j.get("location") or {}
        parts = [j.get("description"), j.get("key_responsibilities_header"),
                 j.get("key_responsibilities"), j.get("skills_knowledge_expertise_header"),
                 j.get("skills_knowledge_expertise"), j.get("benefits_header"), j.get("benefits")]
        out.append(ScannedJob(
            title=j["title"], url=j["url"], external_id=str(j.get("id")),
            location=", ".join(x for x in (loc.get("city"), loc.get("name")) if x) or None,
            remote=j.get("workplace_type") == "remote",
            description="\n\n".join(html_to_text(p) for p in parts if p),
            posted=None, employment_type=j.get("employment_type_text")))
    return out


def recruitee(board: Board, http: Http) -> list[ScannedJob]:
    data = _json(http, "GET", f"https://{board.slug}.recruitee.com/api/offers/")
    out = []
    for j in data.get("offers", []):
        out.append(ScannedJob(
            title=j["title"], url=j.get("careers_url") or f"{board.url}/o/{j.get('slug')}",
            external_id=str(j.get("id")), location=j.get("location"), remote=bool(j.get("remote")),
            description="\n\n".join(html_to_text(j.get(k)) for k in ("description", "requirements")
                                    if j.get(k)),
            posted=_date(j.get("published_at")), employment_type=j.get("employment_type_code")))
    return out


def workable(board: Board, http: Http) -> list[ScannedJob]:
    data = _json(http, "GET",
                 f"https://apply.workable.com/api/v1/widget/accounts/{quote(board.slug)}?details=true")
    out = []
    for j in data.get("jobs", []):
        place = ", ".join(x for x in (j.get("city"), j.get("country")) if x) or None
        out.append(ScannedJob(
            title=j["title"], url=j.get("url") or j.get("application_url", ""),
            external_id=j.get("shortcode"), location=place, remote=bool(j.get("telecommuting")),
            description=html_to_text(j.get("description")),
            posted=_date(j.get("published_on") or j.get("created_at")),
            employment_type=j.get("employment_type")))
    return out


def teamtailor(board: Board, http: Http) -> list[ScannedJob]:
    rss = board.extra.get("rss") or f"https://{board.slug}.teamtailor.com/jobs.rss"
    res = http("GET", rss, None)
    if res.status != 200:
        raise ProviderError(f"HTTP {res.status}")
    if "<!DOCTYPE" in res.text[:200].upper() or "<!ENTITY" in res.text:
        raise ProviderError("unexpected feed format")
    root = ET.fromstring(res.text)  # noqa: S314 - DTDs rejected above
    ns = {"tt": "https://teamtailor.com/locations"}
    out = []
    for item in root.iter("item"):
        locs = [n.findtext("tt:city", default="", namespaces=ns) or
                n.findtext("tt:name", default="", namespaces=ns)
                for n in item.iter("{https://teamtailor.com/locations}location")]
        remote = (item.findtext("remoteStatus") or "").lower()
        out.append(ScannedJob(
            title=(item.findtext("title") or "").strip(), url=(item.findtext("link") or "").strip(),
            external_id=(item.findtext("guid") or "").strip() or None,
            location=", ".join(x for x in locs if x) or None,
            remote=remote in ("fully", "remote", "temporary") or None,
            description=html_to_text(item.findtext("description")),
            posted=_date_rfc822(item.findtext("pubDate"))))
    return out


def _date_rfc822(value: str | None) -> date | None:
    if not value:
        return None
    from email.utils import parsedate_to_datetime

    try:
        return parsedate_to_datetime(value).date()
    except (TypeError, ValueError):
        return None


PROVIDERS: dict[str, Callable[[Board, Http], list[ScannedJob]]] = {
    "GREENHOUSE": greenhouse, "LEVER": lever, "ASHBY": ashby, "SMARTRECRUITERS": smartrecruiters,
    "WORKDAY": workday, "PINPOINT": pinpoint, "RECRUITEE": recruitee, "WORKABLE": workable,
    "TEAMTAILOR": teamtailor,
}
DETAILS: dict[str, Callable[[ScannedJob, Http], None]] = {
    "SMARTRECRUITERS": smartrecruiters_detail, "WORKDAY": workday_detail,
}
SUPPORTED = sorted(PROVIDERS)
