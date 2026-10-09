"""URL validation, normalization and job-source / ATS detection.

Normalization mirrors Career-Ops' url-key.mjs rules so the same posting gets the same key in
both systems: lowercase host, drop "www.", drop tracking params, drop trailing slash, drop
non-identity fragments (but keep SPA routes like #/job/123).
"""

import re
from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_PARAMS = re.compile(
    r"^(utm_.*|gclid|fbclid|mc_cid|mc_eid|ref|refid|trk|trkInfo|trackingId|src|source|"
    r"lipi|origin|originalSubdomain|gh_src|lever-source|lever-origin|from|campaign)$",
    re.IGNORECASE,
)
# Query params that identify the posting itself and must survive normalization.
IDENTITY_PARAMS = {
    "gh_jid",
    "jk",
    "vjk",
    "currentjobid",
    "jobid",
    "job_id",
    "id",
    "jid",
    "reqid",
    "requisitionid",
    "pid",
}


class JobSource(StrEnum):
    LINKEDIN = "LINKEDIN"
    NAUKRI = "NAUKRI"
    INDEED = "INDEED"
    GLASSDOOR = "GLASSDOOR"
    GREENHOUSE = "GREENHOUSE"
    LEVER = "LEVER"
    WORKDAY = "WORKDAY"
    SMARTRECRUITERS = "SMARTRECRUITERS"
    SUCCESSFACTORS = "SUCCESSFACTORS"
    ASHBY = "ASHBY"
    OTHER_ATS = "OTHER_ATS"
    COMPANY_CAREERS = "COMPANY_CAREERS"
    UNKNOWN = "UNKNOWN"
    # Non-URL origins (manual entry)
    CAREER_OPS = "CAREER_OPS"
    INSTAHYRE = "INSTAHYRE"
    CUTSHORT = "CUTSHORT"
    WELLFOUND = "WELLFOUND"
    RECRUITER_EMAIL = "RECRUITER_EMAIL"
    WHATSAPP = "WHATSAPP"
    TELEGRAM = "TELEGRAM"
    REFERRAL = "REFERRAL"
    DIRECT = "DIRECT"
    OTHER = "OTHER"


AGGREGATORS = {
    JobSource.LINKEDIN,
    JobSource.NAUKRI,
    JobSource.INDEED,
    JobSource.GLASSDOOR,
    JobSource.INSTAHYRE,
    JobSource.CUTSHORT,
    JobSource.WELLFOUND,
}

# (host regex, source, ats name)
_HOST_RULES: list[tuple[str, JobSource]] = [
    (r"(^|\.)linkedin\.com$", JobSource.LINKEDIN),
    (r"(^|\.)naukri\.com$", JobSource.NAUKRI),
    (r"(^|\.)indeed\.(com|co\.in|[a-z.]+)$", JobSource.INDEED),
    (r"(^|\.)glassdoor\.(com|co\.in|[a-z.]+)$", JobSource.GLASSDOOR),
    (r"(^|\.)instahyre\.com$", JobSource.INSTAHYRE),
    (r"(^|\.)cutshort\.io$", JobSource.CUTSHORT),
    (r"(^|\.)wellfound\.com$|(^|\.)angel\.co$", JobSource.WELLFOUND),
    (r"(^|\.)greenhouse\.io$", JobSource.GREENHOUSE),
    (r"(^|\.)lever\.co$", JobSource.LEVER),
    (r"(^|\.)myworkdayjobs\.com$|(^|\.)workday\.com$|(^|\.)myworkdaysite\.com$", JobSource.WORKDAY),
    (r"(^|\.)smartrecruiters\.com$", JobSource.SMARTRECRUITERS),
    (
        r"(^|\.)successfactors\.(com|eu)$|(^|\.)sapsf\.(com|eu)$|^career\d*\.successfactors",
        JobSource.SUCCESSFACTORS,
    ),
    (r"(^|\.)ashbyhq\.com$", JobSource.ASHBY),
    (
        r"(^|\.)(icims\.com|taleo\.net|jobvite\.com|workable\.com|bamboohr\.com|recruitee\.com|"
        r"teamtailor\.com|breezy\.hr|personio\.(de|com)|keka\.com|zohorecruit\.(com|in)|"
        r"darwinbox\.in|freshteam\.com|oraclecloud\.com|eightfold\.ai|phenompeople\.com|"
        r"jazzhr\.com|applytojob\.com|pinpointhq\.com|rippling\.com|dayforcehcm\.com)$",
        JobSource.OTHER_ATS,
    ),
]
_CAREERS_PATH = re.compile(
    r"/(careers?|jobs?|join(-us)?|work-with-us|vacanc|openings|hiring)", re.IGNORECASE
)


@dataclass(frozen=True)
class DetectedSource:
    source: JobSource
    ats_slug: str | None = None
    external_id: str | None = None


def is_http_url(value: str) -> bool:
    try:
        parts = urlsplit(value.strip())
    except ValueError:
        return False
    return (
        parts.scheme in ("http", "https") and bool(parts.hostname) and "." in (parts.hostname or "")
    )


def ensure_scheme(value: str) -> str:
    value = value.strip()
    if value and not re.match(r"^[a-z][a-z0-9+.-]*://", value, re.IGNORECASE):
        value = "https://" + value
    return value


def host_of(url: str) -> str | None:
    try:
        host = urlsplit(ensure_scheme(url)).hostname
    except ValueError:
        return None
    if not host:
        return None
    host = host.lower().rstrip(".")
    return host[4:] if host.startswith("www.") else host


def registrable_domain(url: str) -> str | None:
    """Best-effort registrable domain: "jobs.acme.co.in" -> "acme.co.in"."""
    host = host_of(url)
    if not host:
        return None
    parts = host.split(".")
    if (
        len(parts) >= 3
        and parts[-2] in {"co", "com", "org", "net", "ac", "gov"}
        and len(parts[-1]) == 2
    ):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def normalize_url(url: str) -> str:
    raw = ensure_scheme(url)
    parts = urlsplit(raw)
    host = (parts.hostname or "").lower().rstrip(".")
    if host.startswith("www."):
        host = host[4:]
    port = f":{parts.port}" if parts.port and parts.port not in (80, 443) else ""
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=False)
        if k.lower() in IDENTITY_PARAMS or not TRACKING_PARAMS.match(k)
    ]
    query.sort()
    path = re.sub(r"/{2,}", "/", parts.path).rstrip("/")
    fragment = parts.fragment if re.match(r"^/?jobs?/[\w-]+", parts.fragment or "") else ""
    return urlunsplit(("https", host + port, path, urlencode(query), fragment))


SEARCH_ENGINES = re.compile(r"(^|\.)(google|bing|duckduckgo|yahoo)\.[a-z.]+$")
# Search/listing pages: many different postings share these URLs, so they never identify a job.
_LISTING_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"indeed\.[a-z.]+/(q-|jobs\?|jobs/?$|m/jobs)",
        r"linkedin\.com/jobs/(search|collections)",
        r"naukri\.com/[^/?#]*-jobs(-in-[^/?#]*)?/?($|\?)",
        r"foundit\.[a-z.]+/(srp|search)",
        r"glassdoor\.[a-z.]+/(job|Job)/[^/]*-jobs-SRCH",
        r"/(search|srp)(/|\?|$)",
        r"[?&](q|query|keywords?|search)=",
        r"/company/[^/]+/jobs/?$",
        r"/(jobs|careers|openings|vacancies)/?$",
    )
]


def is_search_engine(url: str) -> bool:
    return bool(SEARCH_ENGINES.search(host_of(url) or ""))


def is_listing_url(url: str) -> bool:
    """True for search results / job-board listing pages that can't identify one posting."""
    if is_search_engine(url):
        return True
    full = ensure_scheme(url)
    return any(p.search(full) for p in _LISTING_PATTERNS)


def linkedin_job_id(url: str) -> str | None:
    if m := re.search(r"linkedin\.com/jobs/view/(?:[^/?#]*-)?(\d{6,})", url, re.IGNORECASE):
        return m.group(1)
    if m := re.search(r"[?&]currentJobId=(\d+)", url, re.IGNORECASE):
        return m.group(1)
    return None


def detect_source(url: str) -> DetectedSource:
    """Classify a job/careers URL. Unknown company domains with a careers-like path are
    COMPANY_CAREERS; anything else is UNKNOWN."""
    if not url or not is_http_url(ensure_scheme(url)):
        return DetectedSource(JobSource.UNKNOWN)
    full = ensure_scheme(url)
    host = host_of(full) or ""
    path = urlsplit(full).path
    for pattern, source in _HOST_RULES:
        if re.search(pattern, host):
            return DetectedSource(source, _ats_slug(source, host, path), _external_id(source, full))
    if _CAREERS_PATH.search(path) or host.startswith(("careers.", "jobs.")):
        return DetectedSource(JobSource.COMPANY_CAREERS)
    return DetectedSource(JobSource.UNKNOWN)


def _ats_slug(source: JobSource, host: str, path: str) -> str | None:
    segments = [s for s in path.split("/") if s]
    if source in (
        JobSource.GREENHOUSE,
        JobSource.LEVER,
        JobSource.ASHBY,
        JobSource.SMARTRECRUITERS,
    ):
        skip = {"v1", "boards", "embed", "job_board", "jobs"}
        for seg in segments:
            if seg.lower() not in skip:
                return seg.lower()
        return None
    if source == JobSource.WORKDAY:
        return host.split(".")[0]
    return None


def _external_id(source: JobSource, url: str) -> str | None:
    if source == JobSource.LINKEDIN:
        return linkedin_job_id(url)
    if source == JobSource.INDEED and (m := re.search(r"[?&]v?jk=([\w]+)", url)):
        return m.group(1)
    if source == JobSource.GREENHOUSE and (m := re.search(r"/jobs/(\d+)|gh_jid=(\d+)", url)):
        return m.group(1) or m.group(2)
    if source == JobSource.LEVER and (m := re.search(r"lever\.co/[^/]+/([0-9a-f-]{36})", url)):
        return m.group(1)
    if source == JobSource.NAUKRI and (m := re.search(r"-(\d{9,})(?:\?|$)", url)):
        return m.group(1)
    if source == JobSource.ASHBY and (m := re.search(r"ashbyhq\.com/[^/]+/([0-9a-f-]{36})", url)):
        return m.group(1)
    return None


def is_linkedin_company_url(url: str) -> bool:
    return bool(
        re.match(
            r"^https?://([a-z]{2,3}\.)?linkedin\.com/company/[\w%.-]+/?$",
            ensure_scheme(url).split("?")[0],
            re.IGNORECASE,
        )
    )


def is_linkedin_profile_url(url: str) -> bool:
    return bool(
        re.match(
            r"^https?://([a-z]{2,3}\.)?linkedin\.com/in/[\w%.-]+/?$",
            ensure_scheme(url).split("?")[0],
            re.IGNORECASE,
        )
    )


EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+(\.[\w-]+)+$")


def is_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value.strip()))
