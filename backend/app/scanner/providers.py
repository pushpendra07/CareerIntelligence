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
from urllib.parse import quote, urljoin, urlsplit

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


_ORACLE = re.compile(
    r"https?://([a-z0-9-]+\.fa\.(?:[a-z0-9-]+\.)?(?:ocs\.)?oraclecloud(?:[1-9][0-9]?)?\.com)"
    r"(/[^\s\"'<>]*)?", re.IGNORECASE)
_SUCCESSFACTORS = re.compile(r"https?://([a-z0-9.-]*(?:successfactors\.(?:eu|com)|jobs2web\.com))"
                             r"(/[^\s\"'<>?#]*)?", re.IGNORECASE)


def _sf_career_site(host: str, path: str) -> bool:
    """A SuccessFactors career site, not a script/style file on a SuccessFactors server."""
    if re.search(r"\.(js|css|png|jpe?g|gif|svg|ico|woff2?)$", path, re.IGNORECASE):
        return False
    return "jobs2web" in host.lower() or bool(re.search(r"career|/job|/search", path, re.I))


def oracle_board(url: str) -> Board | None:
    m = _ORACLE.search(url)
    if not m:
        return None
    host, path = m.group(1).lower(), m.group(2) or ""
    segs = [x for x in path.split("/") if x]

    def after(name: str, default: str) -> str:
        i = segs.index(name) + 1 if name in segs else len(segs)
        return segs[i] if i < len(segs) else default

    site, lang = after("sites", "CX_1"), after("CandidateExperience", "en")
    return Board("ORACLE", host, f"https://{host}/hcmUI/CandidateExperience/{lang}/sites/{site}",
                 {"host": host, "site": site, "lang": lang})


def successfactors_board(url: str) -> Board:
    """SAP SuccessFactors career sites, including ones on the company's own domain."""
    parts = urlsplit(url if "://" in url else f"https://{url}")
    path = re.sub(r"/(?:search|tile-search-results|services/recruiting/v1/jobs)/?$", "",
                  re.sub(r"/go/[^/]+/\d+(?:/\d+)?/?$", "", parts.path or "")).rstrip("/")
    base = f"https://{parts.hostname}{path}"
    return Board("SUCCESSFACTORS", parts.hostname or "", base, {"base": base})


def careers_page_board(url: str) -> Board:
    """A company's own careers page that publishes JobPosting data (no job board)."""
    parts = urlsplit(url if "://" in url else f"https://{url}")
    return Board("CAREERS_PAGE", parts.hostname or "", url, {})


def resolve_board(url: str | None) -> Board | None:
    """Find a supported job board in a careers URL (or a link found on a careers page)."""
    if not url:
        return None
    if board := oracle_board(url):
        return board
    if (m := _SUCCESSFACTORS.search(url)) and _sf_career_site(m.group(1), m.group(2) or ""):
        return successfactors_board(url)
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


# --- SAP SuccessFactors -------------------------------------------------------------------------

_TILE_RE = re.compile(r'<li class="job-tile job-id-(\d+)\b[\s\S]*?</li>')


def _sf_tiles(html: str, origin: str) -> list[ScannedJob]:
    out = []
    for m in _TILE_RE.finditer(html):
        block = m.group(0)
        url_m = re.search(r'data-url="([^"]+)"', block)
        title_m = re.search(r'class="jobTitle-link[^"]*"[^>]*>([\s\S]*?)</a>', block)
        if not url_m or not title_m:
            continue
        title = html_to_text(title_m.group(1)).strip()
        city_m = re.search(r'id="[^"]*-section-city-value">([\s\S]*?)</div>', block)
        path = html_to_text(url_m.group(1)).strip()
        url = path if path.startswith("http") else urljoin(origin + "/", path)
        city = html_to_text(city_m.group(1)).strip() if city_m else None
        if title:
            out.append(ScannedJob(title=title, url=url, external_id=m.group(1), location=city,
                                  needs_detail=True, detail_ref=url))
    return out


def successfactors(board: Board, http: Http) -> list[ScannedJob]:
    base = board.extra["base"]
    origin = f"https://{urlsplit(base).hostname}" if urlsplit(base).hostname else base
    jobs: list[ScannedJob] = []
    seen: set[str] = set()
    start = 0
    for _ in range(40):  # older "RMK" sites: HTML job tiles, 25 per page
        res = http("GET", f"{base}/tile-search-results/?startrow={start}", None)
        if res.status != 200:
            break
        tiles = [t for t in _sf_tiles(res.text, origin) if t.external_id not in seen]
        if not tiles:
            break
        for t in tiles:
            seen.add(t.external_id or t.url)
        jobs += tiles
        start += len(tiles)
        if len(jobs) >= 1000:
            break
    if jobs:
        return jobs
    # Newer "Career Site Builder" sites: JSON search API, 10 per page.
    for page in range(100):
        data = _json(http, "POST", f"{base}/services/recruiting/v1/jobs",
                     {"keywords": "", "locale": "en_US", "location": "", "pageNumber": page,
                      "sortBy": "recent"})
        rows = data.get("jobSearchResult") or []
        for item in rows:
            r = item.get("response") or {}
            jid = str(r.get("id") or "")
            title = html_to_text(str(r.get("unifiedStandardTitle") or r.get("jobTitle") or ""))
            if not jid or not title or jid in seen:
                continue
            seen.add(jid)
            slug = str(r.get("unifiedUrlTitle") or r.get("urlTitle") or "job")
            url = f"{base}/job/{slug}/{jid}-en_US"
            loc = r.get("jobLocationShort")
            jobs.append(ScannedJob(
                title=title.strip(), url=url, external_id=jid,
                location=" / ".join(loc) if isinstance(loc, list) else (loc or None),
                posted=_sf_date(r.get("unifiedStandardStart")), needs_detail=True, detail_ref=url))
        total = int(data.get("totalJobs") or 0)
        if len(rows) < 10 or (total and (page + 1) * 10 >= total):
            break
    return jobs


def _sf_date(raw: object) -> date | None:
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", str(raw or "").strip())
    if not m:
        return None
    month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return date(year + 2000 if year < 100 else year, month, day)
    except ValueError:
        return None


def page_detail(job: ScannedJob, http: Http) -> None:
    """Description from the job page's JobPosting data (or its main text as a fallback)."""
    from app.scanner.jsonld import job_postings, to_fields

    res = http("GET", job.detail_ref or job.url, None)
    if res.status != 200:
        raise ProviderError(f"HTTP {res.status}")
    postings = job_postings(res.text)
    if postings:
        f = to_fields(postings[0], job.url)
        job.description = f["description"] or job.description
        job.posted = f["posted"] or job.posted
        job.location = job.location or f["location"]
        job.remote = job.remote or f["remote"]
        job.employment_type = job.employment_type or f["employment_type"]


# --- Oracle Cloud (Fusion HCM Candidate Experience) ---------------------------------------------

def oracle(board: Board, http: Http) -> list[ScannedJob]:
    host, site, lang = board.extra["host"], board.extra["site"], board.extra.get("lang", "en")
    jobs: list[ScannedJob] = []
    for page in range(25):
        offset = page * 200
        finder = (f"findReqs;siteNumber={site},limit=200,sortBy=POSTING_DATES_DESC,offset={offset}")
        url = (f"https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true"
               f"&expand=requisitionList.workLocation&finder={finder}&limit=200&offset={offset}")
        data = _json(http, "GET", url)
        item = (data.get("items") or [{}])[0]
        rows = item.get("requisitionList") or []
        for r in rows:
            rid = str(r.get("Id") or r.get("RequisitionNumber") or "")
            if not rid:
                continue
            wt = r.get("WorkplaceTypeCode")
            jobs.append(ScannedJob(
                title=str(r.get("Title") or "").strip(), external_id=rid,
                url=r.get("ExternalURL") or
                f"https://{host}/hcmUI/CandidateExperience/{lang}/sites/{site}/job/{rid}",
                location=r.get("PrimaryLocation"), remote=wt == "ORA_REMOTE",
                description=html_to_text(r.get("ShortDescriptionStr")),
                posted=_date(r.get("PostedDate")), needs_detail=True,
                detail_ref=(f"https://{host}/hcmRestApi/resources/latest/"
                            f"recruitingCEJobRequisitionDetails?expand=all&onlyData=true"
                            f'&finder=ById;Id="{rid}",siteNumber={site}')))
        total = item.get("TotalJobsCount")
        if not rows or (isinstance(total, int) and offset + 200 >= total) or len(rows) < 200:
            break
    return jobs


def oracle_detail(job: ScannedJob, http: Http) -> None:
    data = _json(http, "GET", job.detail_ref or "")
    item = (data.get("items") or [{}])[0]
    parts = [item.get(k) for k in ("ExternalDescriptionStr", "ExternalResponsibilitiesStr",
                                   "ExternalQualificationsStr")]
    text = "\n\n".join(html_to_text(p) for p in parts if p)
    job.description = text or job.description


# --- the company's own careers page (schema.org JobPosting) --------------------------------------

def careers_page(board: Board, http: Http) -> list[ScannedJob]:
    from app.scanner.jsonld import job_links, job_postings, to_fields

    res = http("GET", board.url, None)
    if res.status != 200:
        raise ProviderError(f"careers page returned HTTP {res.status}")
    found = [to_fields(p, board.url) for p in job_postings(res.text)]
    if not found:  # listing page without data: open the job pages it links to
        for link in job_links(res.text, board.url):
            page = http("GET", link, None)
            if page.status == 200:
                found += [to_fields(p, link) for p in job_postings(page.text)]
    jobs: dict[str, ScannedJob] = {}
    for f in found:
        if f["title"] and f["url"] not in jobs:
            jobs[f["url"]] = ScannedJob(**f)
    return list(jobs.values())


PROVIDERS: dict[str, Callable[[Board, Http], list[ScannedJob]]] = {
    "GREENHOUSE": greenhouse, "LEVER": lever, "ASHBY": ashby, "SMARTRECRUITERS": smartrecruiters,
    "WORKDAY": workday, "PINPOINT": pinpoint, "RECRUITEE": recruitee, "WORKABLE": workable,
    "TEAMTAILOR": teamtailor, "SUCCESSFACTORS": successfactors, "ORACLE": oracle,
    "CAREERS_PAGE": careers_page,
}
DETAILS: dict[str, Callable[[ScannedJob, Http], None]] = {
    "SMARTRECRUITERS": smartrecruiters_detail, "WORKDAY": workday_detail,
    "SUCCESSFACTORS": page_detail, "ORACLE": oracle_detail,
}
SUPPORTED = sorted(PROVIDERS)
