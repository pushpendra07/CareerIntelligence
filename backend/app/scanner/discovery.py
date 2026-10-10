"""Find how a company publishes its jobs, so the scanner can read them.

Methods, cheapest and most certain first:
1. Links on the careers page to a supported job board (Greenhouse, Lever, Workday, Oracle…).
2. Career-Ops' own company list (`portals.yml`) naming the company's job system.
3. SAP SuccessFactors on the company's own domain (careers.wipro.com style).
4. schema.org `JobPosting` data on the careers page or the job pages it links to.
5. The company's name on the public APIs of key-less job boards — accepted only when the board
   itself says it belongs to that company (its name) or its jobs name the company.
Careers pages are found from the company website when no careers URL is known.
Nothing is guessed: every board is checked against the live site before it is saved.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

from app.core.http import FetchResult
from app.core.text import company_key, fold
from app.scanner.jsonld import job_links, job_postings
from app.scanner.providers import (
    Board,
    Http,
    careers_page_board,
    oracle_board,
    resolve_board,
    successfactors_board,
    teamtailor_board,
)

CAREERS_LINK_RE = re.compile(
    r"""<a\b[^>]*href=["']([^"'#]+)["'][^>]*>(.*?)</a>""", re.IGNORECASE | re.DOTALL)
CAREERS_WORDS = re.compile(r"\b(careers?|jobs?|join (?:us|our team)|work (?:with|at) us|openings|"
                           r"vacanc(?:y|ies)|we'?re hiring|hiring)\b", re.IGNORECASE)
LINK_RE = re.compile(r"""https?://[^\s"'<>\\)]+""")
SF_MARKERS = ("jobs2web", "tile-search-results", "/services/recruiting/v1/jobs", "rmkcdn",
              "successfactors")


@dataclass
class Found:
    board: Board
    method: str  # page_link | career_ops | successfactors | job_posting_data | name_probe
    evidence: str  # URL that proves it


def _get(http: Http, url: str) -> FetchResult | None:
    try:
        res = http("GET", url, None)
    except Exception:  # noqa: BLE001 - unreachable / blocked sites just aren't found
        return None
    return res if res.status == 200 else None


# --- careers page from the website --------------------------------------------------------------

def find_careers_url(website: str, http: Http) -> str | None:
    """The careers link on the company's homepage (same site or a job board), if any."""
    res = _get(http, website)
    if res is None:
        return None
    site = ".".join((urlsplit(res.url).hostname or "").split(".")[-2:])
    best: str | None = None
    for href, text in CAREERS_LINK_RE.findall(res.text):
        label = re.sub(r"<[^>]+>", " ", text)
        if not (CAREERS_WORDS.search(label) or CAREERS_WORDS.search(href.replace("-", " "))):
            continue
        url = str(urljoin(res.url, str(href).strip()))
        host = urlsplit(url).hostname or ""
        if resolve_board(url):
            return url  # links straight to a job board
        if host.endswith(site) and url.rstrip("/") != res.url.rstrip("/"):
            best = best or url
    return best


# --- 1/3/4: what the careers page itself shows ----------------------------------------------------

def _board_name(board: Board, http: Http) -> str | None:
    """The name a Greenhouse/Workable board gives itself (others don't say)."""
    import json

    api = {"GREENHOUSE": f"https://boards-api.greenhouse.io/v1/boards/{board.slug}",
           "WORKABLE": f"https://apply.workable.com/api/v1/widget/accounts/{board.slug}"}.get(
        board.provider)
    res = _get(http, api) if api else None
    try:
        return str(json.loads(res.text).get("name") or "") or None if res else None
    except (ValueError, AttributeError):
        return None


def successfactors_answers(board: Board, http: Http) -> bool:
    """The SuccessFactors site really lists jobs (tile page or the JSON search API)."""
    tiles = _get(http, f"{board.extra['base']}/tile-search-results/?startrow=0")
    if tiles is not None and "job-tile" in tiles.text:
        return True
    try:
        api = http("POST", f"{board.extra['base']}/services/recruiting/v1/jobs",
                   {"keywords": "", "locale": "en_US", "location": "", "pageNumber": 0,
                    "sortBy": "recent"})
    except Exception:  # noqa: BLE001
        return False
    return api.status == 200 and "jobSearchResult" in api.text


def from_careers_page(url: str, http: Http, company: str | None = None) -> Found | None:
    if board := resolve_board(url):
        return Found(board, "page_link", url)
    res = _get(http, url)
    if res is None:
        return None
    for link in LINK_RE.findall(res.text):
        if board := resolve_board(link):
            # A careers page can link to a client's or partner's board: when the board says
            # whose it is, it must be this company's.
            name = _board_name(board, http) if company else None
            if name and company and not names_match(company, name):
                continue
            if board.provider == "SUCCESSFACTORS" and not successfactors_answers(board, http):
                continue  # an old-style or asset link that doesn't list jobs
            return Found(board, "page_link", url)
    lowered = res.text.lower()
    if "teamtailor" in lowered:
        return Found(teamtailor_board(res.url), "page_link", url)
    if any(m in lowered for m in SF_MARKERS):
        board = successfactors_board(res.url)
        if successfactors_answers(board, http):
            return Found(board, "successfactors", url)
    if job_postings(res.text):
        return Found(careers_page_board(res.url), "job_posting_data", url)
    for link in job_links(res.text, res.url, limit=5):
        page = _get(http, link)
        if page is not None and job_postings(page.text):
            return Found(careers_page_board(res.url), "job_posting_data", link)
    return None


# --- 2: Career-Ops' company list ----------------------------------------------------------------

def career_ops_hints(career_ops_path: Path | None) -> dict[str, dict[str, Any]]:
    """company_key -> portals.yml entry (only entries whose job system we can read)."""
    if career_ops_path is None or not (career_ops_path / "portals.yml").is_file():
        return {}
    import yaml

    try:
        data = yaml.safe_load((career_ops_path / "portals.yml").read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return {}
    hints = {}
    for entry in (data or {}).get("tracked_companies") or []:
        if isinstance(entry, dict) and entry.get("name"):
            hints[company_key(str(entry["name"]))] = entry
    return hints


def from_career_ops(entry: dict[str, Any]) -> Found | None:
    provider = str(entry.get("provider") or "").lower()
    urls = [str(u) for u in (entry.get("api"), entry.get("careers_url")) if u]
    for url in urls:
        if board := resolve_board(url):
            return Found(board, "career_ops", url)
        if (board := oracle_board(url)) is not None:
            return Found(board, "career_ops", url)
    if provider == "successfactors" and urls:
        return Found(successfactors_board(urls[-1]), "career_ops", urls[-1])
    if provider == "teamtailor" and urls:
        return Found(teamtailor_board(urls[-1]), "career_ops", urls[-1])
    return None


# --- 5: name on key-less job board APIs -----------------------------------------------------------

def slug_candidates(name: str, domains: list[str]) -> list[str]:
    key = company_key(name)
    words = [w for w in re.split(r"[^a-z0-9]+", fold(name).lower()) if w]
    cands = [key, "".join(words[:2]), "-".join(words[:2]), *(d.split(".")[0] for d in domains)]
    out: list[str] = []
    for c in cands:
        if c and len(c) >= 4 and c not in out:
            out.append(c)
    return out[:4]


REGION_WORDS = {"india", "uk", "us", "usa", "global", "worldwide", "emea", "apac"}


def _strict_key(name: str) -> str:
    words = [w for w in re.split(r"[^a-z0-9]+", fold(name).lower()) if w]
    while words and words[-1] in REGION_WORDS:
        words.pop()
    return company_key(" ".join(words))


LEGAL_WORDS = {"pvt", "private", "ltd", "limited", "inc", "llc", "llp", "co", "corp", "corporation",
               "company", "gmbh", "plc", "the", "and", "sa", "bv", "ag"}


def _full_name(name: str) -> str:
    """Name without legal/region words but WITH generic ones ("technologies", "group")."""
    words = [w for w in re.split(r"[^a-z0-9]+", fold(name).lower()) if w]
    return " ".join(w for w in words if w not in LEGAL_WORDS and w not in REGION_WORDS)


def same_company(company: str, board_name: str | None, domains: list[str],
                 job_texts: list[str]) -> bool:
    """A board found by name belongs to the company when the full names are equal, or the names
    match apart from generic words and the board's jobs mention the company or its website."""
    if not names_match(company, board_name):
        return False
    if _full_name(company) == _full_name(board_name or ""):
        return True
    return _mentions(company, domains, job_texts)


def names_match(company: str, other: str | None) -> bool:
    """Same company name, ignoring legal suffixes and a trailing region ("Accenture India").
    Deliberately exact: "Unified Infotech" is not "Unified Life Insurance"."""
    if not other:
        return False
    a, b = _strict_key(company), _strict_key(other)
    return len(a) >= 5 and a == b  # short keys ("net" from "Net Solutions") are too ambiguous


def _mentions(company: str, domains: list[str], texts: list[str]) -> bool:
    needle = fold(company).lower().strip()
    hay = " ".join(fold(t).lower() for t in texts)
    return bool(needle and needle in hay) or any(d and d in hay for d in domains)


def probe_name(name: str, domains: list[str], http: Http) -> Found | None:
    """Try the company's name on Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee
    and Pinpoint. Only boards that identify as this company are returned."""
    import json

    def get_json(url: str) -> Any:
        res = _get(http, url)
        if res is None:
            return None
        try:
            return json.loads(res.text)
        except ValueError:
            return None

    for slug in slug_candidates(name, domains):
        gh = get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}")
        gh_jobs = get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true") \
            if isinstance(gh, dict) and names_match(name, gh.get("name")) else None
        if isinstance(gh_jobs, dict) and gh_jobs.get("jobs") and same_company(
                name, gh.get("name"), domains,
                [str(j.get("content") or "") for j in gh_jobs["jobs"][:10]]):
            return Found(Board("GREENHOUSE", slug, f"https://job-boards.greenhouse.io/{slug}"),
                         "name_probe", f"https://boards-api.greenhouse.io/v1/boards/{slug}")
        wk = get_json(f"https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true")
        # Workable answers with an empty placeholder (name = slug, no jobs) for any slug.
        if isinstance(wk, dict) and wk.get("jobs") and same_company(
                name, wk.get("name"), domains,
                [str(j.get("description") or "") for j in wk["jobs"][:10]]):
            return Found(Board("WORKABLE", slug, f"https://apply.workable.com/{slug}"),
                         "name_probe", f"https://apply.workable.com/{slug}")
        sr = get_json(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=5")
        if isinstance(sr, dict) and any(
                same_company(name, (p.get("company") or {}).get("name"), domains, [])
                for p in sr.get("content") or []):
            return Found(Board("SMARTRECRUITERS", slug, f"https://jobs.smartrecruiters.com/{slug}"),
                         "name_probe", f"https://jobs.smartrecruiters.com/{slug}")
        rc = get_json(f"https://{slug}.recruitee.com/api/offers/")
        offers = rc.get("offers") or [] if isinstance(rc, dict) else []
        if offers and any(same_company(name, o.get("company_name"), domains,
                                       [str(x.get("description") or "") for x in offers[:10]])
                          for o in offers):
            return Found(Board("RECRUITEE", slug, f"https://{slug}.recruitee.com"),
                         "name_probe", f"https://{slug}.recruitee.com")
        lv = get_json(f"https://api.lever.co/v0/postings/{slug}?mode=json&limit=5")
        if isinstance(lv, list) and lv and _mentions(
                name, domains, [str(p.get("descriptionPlain") or "") + str(p.get("additionalPlain")
                                                                           or "") for p in lv]):
            return Found(Board("LEVER", slug, f"https://jobs.lever.co/{slug}"),
                         "name_probe", f"https://jobs.lever.co/{slug}")
        ab = get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
        if isinstance(ab, dict) and ab.get("jobs") and _mentions(
                name, domains, [str(j.get("descriptionPlain") or "") for j in ab["jobs"][:5]]):
            return Found(Board("ASHBY", slug, f"https://jobs.ashbyhq.com/{slug}"),
                         "name_probe", f"https://jobs.ashbyhq.com/{slug}")
        pp = get_json(f"https://{slug}.pinpointhq.com/postings.json")
        if isinstance(pp, dict) and pp.get("data") and _mentions(
                name, domains, [str(j.get("description") or "") for j in pp["data"][:5]]):
            return Found(Board("PINPOINT", slug, f"https://{slug}.pinpointhq.com"),
                         "name_probe", f"https://{slug}.pinpointhq.com")
    return None
