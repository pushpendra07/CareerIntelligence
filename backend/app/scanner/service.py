"""Built-in job scanner: company boards -> filter -> the normal job pipeline.

Network work (fetching boards and descriptions) runs in a small thread pool; everything that
touches the database runs in the caller's session, one company at a time. Jobs go through
`ingest_job`, so dedup, JD parsing and 0-100 scoring are identical to every other source.
"""

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.companies.verification import Claim, _usable, add_claim, recompute
from app.core.errors import ConflictError
from app.core.http import BlockedURLError, FetchResult, safe_request
from app.core.urls import JobSource
from app.models.company import Company, SourceKind, VerificationStatus
from app.models.job import JobStatus
from app.models.scan import ScanRun
from app.scanner.filters import DEFAULT_SCANNER_SETTINGS, ScanFilters
from app.scanner.providers import (
    DETAILS,
    PROVIDERS,
    Board,
    Http,
    ProviderError,
    ScannedJob,
    resolve_board,
    teamtailor_board,
)
from app.services.activity import record_activity
from app.services.job_service import DeletedJobError, JobInput, ingest_job

logger = logging.getLogger(__name__)
SCAN_LOCK_ID = 4_210_771  # pg advisory lock: one scan at a time across processes
MAX_DETAIL_FETCHES = 40
WORKERS = 6


def default_http(method: str, url: str, json_body: object | None = None) -> FetchResult:
    return safe_request(method, url, json_body=json_body, timeout=25, max_bytes=12 * 1024 * 1024)


def scanner_settings(db: Session) -> dict[str, Any]:
    from app.models.app_settings import AppSettings

    row = db.get(AppSettings, 1)
    return {**DEFAULT_SCANNER_SETTINGS, **((row.data if row else {}).get("scanner") or {})}


def board_for(company: Company) -> Board | None:
    """The company's job board: one saved by board discovery, else the first supported board
    among its usable careers URLs."""
    saved = (company.attributes or {}).get("scanner_board")
    if isinstance(saved, dict) and saved.get("provider") and saved.get("url"):
        return Board(str(saved["provider"]), str(saved.get("slug") or ""), str(saved["url"]),
                     dict(saved.get("extra") or {}))
    urls = [s.value for s in _usable(company, "careers_url") if s.value]
    for url in urls:
        if board := resolve_board(url):
            return board
    platform = str((company.attributes.get("google_sheet") or {}).get("ats_platform", ""))
    if "teamtailor" in platform.lower() and urls:
        return teamtailor_board(urls[0])
    return None


def scan_targets(db: Session, company_ids: list[int] | None = None
                 ) -> list[tuple[Company, Board]]:
    stmt = select(Company).order_by(Company.name)
    stmt = stmt.where(Company.id.in_(company_ids)) if company_ids else stmt.where(
        Company.job_search_enabled.is_(True))
    out = []
    for company in db.scalars(stmt):
        if board := board_for(company):
            out.append((company, board))
    return out


@dataclass
class _Fetched:
    company_id: int
    board: Board
    jobs: list[ScannedJob] = field(default_factory=list)
    found: int = 0
    skipped: dict[str, int] = field(default_factory=dict)
    error: str | None = None


def _fetch(company_id: int, board: Board, filters: ScanFilters, http: Http,
           known_urls: set[str], limit: int) -> _Fetched:
    out = _Fetched(company_id, board)
    try:
        jobs = PROVIDERS[board.provider](board, http)
    except (ProviderError, BlockedURLError, OSError, ValueError, KeyError) as exc:
        out.error = str(exc)[:300]
        return out
    out.found = len(jobs)
    kept = []
    for job in jobs:
        reason = filters.check(job)
        if reason:
            out.skipped[reason] = out.skipped.get(reason, 0) + 1
        else:
            kept.append(job)
    detail = DETAILS.get(board.provider)
    fetched = 0
    # Specific titles first, so the per-company limit never drops a Magento role for a generic one.
    kept.sort(key=lambda j: j.broad_title)
    for job in kept[:limit]:
        if detail and job.needs_detail and job.url not in known_urls and fetched < \
                MAX_DETAIL_FETCHES:
            try:
                detail(job, http)
                fetched += 1
            except (ProviderError, OSError, ValueError) as exc:
                logger.info("detail fetch failed", extra={"url": job.url, "error": str(exc)})
        if job.url in known_urls and not job.description:
            out.jobs.append(job)  # already in Career Intelligence: refresh it, keep its JD
            continue
        if reason := filters.check_description(job) or filters.check_age(job):
            out.skipped[reason] = out.skipped.get(reason, 0) + 1
            continue
        out.jobs.append(job)
    if len(kept) > limit:
        out.skipped["over_limit"] = len(kept) - limit
    return out


def run_scan(db: Session, *, company_ids: list[int] | None = None, trigger: str = "manual",
             http: Http | None = None, run: ScanRun | None = None) -> ScanRun:
    if not db.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": SCAN_LOCK_ID}).scalar():
        if run is not None:
            run.status, run.finished_at = "FAILED", datetime.now(UTC)
            run.stats = {"error": "Another scan is already running"}
            db.commit()
        raise ConflictError("Another scan is already running")
    try:
        return _run_scan(db, company_ids, trigger, http or default_http, run)
    except Exception as exc:
        db.rollback()
        if run is not None and run.status == "RUNNING":
            run.status, run.finished_at = "FAILED", datetime.now(UTC)
            run.stats = {**(run.stats or {}), "error": str(exc)[:300]}
            db.commit()
        raise
    finally:
        db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": SCAN_LOCK_ID})
        db.commit()


def _run_scan(db: Session, company_ids: list[int] | None, trigger: str, http: Http,
              run: ScanRun | None) -> ScanRun:
    cfg = scanner_settings(db)
    filters = ScanFilters.from_settings(cfg)
    limit = int(cfg.get("max_new_per_company") or 50)
    if run is None:
        run = ScanRun(kind="SCAN", trigger=trigger, stats={}, companies=[])
        db.add(run)
        db.commit()
    targets = scan_targets(db, company_ids)
    known = {u for (u,) in db.execute(text(
        "SELECT original_url FROM job_sources WHERE original_url IS NOT NULL"))}
    by_id = {c.id: c for c, _ in targets}
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda t: _fetch(t[0].id, t[1], filters, http, known, limit),
                                targets))
    stats: dict[str, Any] = {"companies": len(targets), "found": 0, "kept": 0, "new": 0,
                             "updated": 0, "errors": 0, "skipped": {}}
    rows: list[dict[str, Any]] = []
    touched: list[int] = []
    for res in results:
        company = by_id[res.company_id]
        row: dict[str, Any] = {"company_id": company.id, "company": company.name,
                               "provider": res.board.provider, "board": res.board.url,
                               "found": res.found, "kept": len(res.jobs), "new": 0,
                               "error": res.error}
        stats["found"] += res.found
        for k, v in res.skipped.items():
            stats["skipped"][k] = stats["skipped"].get(k, 0) + v
        if res.error:
            stats["errors"] += 1
        for job in res.jobs:
            if not job.url:
                continue
            try:
                with db.begin_nested():
                    result = ingest_job(db, JobInput(
                        title=job.title, company_name=company.name, url=job.url,
                        source=JobSource(res.board.provider)
                        if res.board.provider in JobSource.__members__ else JobSource.OTHER_ATS,
                        source_detail=f"Built-in scanner · {res.board.provider.title()}",
                        external_id=job.external_id, location=job.location,
                        work_model="REMOTE" if job.remote else None,
                        employment_type=job.employment_type, posting_date=job.posted,
                        jd_text=job.description, status=JobStatus.NEW, origin="scan",
                        raw={"scanner": {"provider": res.board.provider, "board": res.board.url}},
                    ), analyze=False, commit=False)
                touched.append(result.job.id)
                if result.created:
                    row["new"] += 1
                    stats["new"] += 1
                else:
                    stats["updated"] += 1
            except DeletedJobError:
                stats["skipped"]["deleted"] = stats["skipped"].get("deleted", 0) + 1
            except Exception as exc:  # noqa: BLE001 - one bad posting must not stop the scan
                logger.warning("scanned job failed", extra={"url": job.url, "error": str(exc)})
        stats["kept"] += len(res.jobs)
        rows.append(row)
        db.commit()
    from app.services.match_service import reanalyze

    stats["scored"] = reanalyze(db, only_stale=False, job_ids=sorted(set(touched)))["analyzed"]
    run.stats, run.companies = stats, rows
    run.status = "COMPLETED" if stats["errors"] < max(1, len(targets)) else "FAILED"
    run.finished_at = datetime.now(UTC)
    record_activity(db, "scanner.completed", "scan_run", run.id,
                    f"{stats['new']} new jobs from {stats['companies']} companies",
                    {k: v for k, v in stats.items() if k != "skipped"})
    db.commit()
    logger.info("scan finished", extra={"run_id": run.id, "scan_stats": stats})
    return run


# --- job-board detection --------------------------------------------------------------------

LINK_RE = re.compile(r"""https?://[^\s"'<>\\)]+""")


def detect_board_from_page(html: str) -> Board | None:
    for url in LINK_RE.findall(html):
        if board := resolve_board(url):
            return board
    return None


def _detect_http(method: str, url: str, json_body: object | None = None) -> FetchResult:
    return safe_request(method, url, json_body=json_body, timeout=15, max_bytes=3 * 1024 * 1024)


def detect_boards(db: Session, company_ids: list[int] | None = None,
                  fetch: Any = None, trigger: str = "manual",
                  run: ScanRun | None = None, http: Http | None = None) -> ScanRun:
    """Find how each not-yet-scannable company publishes jobs (see scanner/discovery.py).

    `fetch` (GET-only, kept for tests) or `http` (GET/POST) does the network calls.
    """
    from app.core.config import get_settings
    from app.core.text import company_key
    from app.core.urls import registrable_domain
    from app.scanner import discovery

    if http is None:
        if fetch is not None:
            def http(method: str, url: str, json_body: object | None = None) -> FetchResult:
                return fetch(url) if method == "GET" else FetchResult(url, 405, "")
        else:
            http = _detect_http
    hints = discovery.career_ops_hints(get_settings().career_ops_path)
    if run is None:
        run = ScanRun(kind="DETECT", trigger=trigger, stats={}, companies=[])
        db.add(run)
        db.commit()
    stmt = select(Company).order_by(Company.name)
    stmt = stmt.where(Company.id.in_(company_ids)) if company_ids else stmt
    candidates = []
    for company in db.scalars(stmt):
        if board_for(company):
            continue  # already scannable
        careers = [s.value for s in _usable(company, "careers_url") if s.value]
        websites = [s.value for s in _usable(company, "website") if s.value]
        domains = [d for d in {registrable_domain(u) for u in [*careers, *websites]} if d]
        candidates.append((company.id, company.name, careers[0] if careers else None,
                           websites[0] if websites else None, domains,
                           hints.get(company_key(company.name))))

    def probe(item: tuple[Any, ...]) -> dict[str, Any]:
        cid, name, careers, website, domains, hint = item
        out: dict[str, Any] = {"company_id": cid, "company": name, "careers_url": careers,
                               "found_careers_url": None, "found": None, "error": None}
        try:
            if careers is None and website:
                careers = discovery.find_careers_url(website, http)
                out["found_careers_url"] = careers
            found = (discovery.from_career_ops(hint) if hint else None)
            if found is None and careers:
                found = discovery.from_careers_page(careers, http, name)
            if found is None:
                found = discovery.probe_name(name, domains, http)
            out["found"] = found
        except (BlockedURLError, OSError, ValueError) as exc:
            out["error"] = str(exc)[:200]
        return out

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(probe, candidates))
    rows, found_n, careers_n = [], 0, 0
    methods: dict[str, int] = {}
    now = datetime.now(UTC)
    for r in results:
        found = r.pop("found")
        target = db.get(Company, r["company_id"])
        assert target is not None
        if r["found_careers_url"]:
            careers_n += 1
            add_claim(target, Claim("careers_url", r["found_careers_url"],
                                     SourceKind.OFFICIAL_WEBSITE,
                                     VerificationStatus.PARTIALLY_VERIFIED, "careers_link",
                                     None, now, "Careers link on the company's website"))
        if found is not None:
            found_n += 1
            methods[found.method] = methods.get(found.method, 0) + 1
            board = found.board
            target.attributes = {**(target.attributes or {}), "scanner_board": {
                "provider": board.provider, "slug": board.slug, "url": board.url,
                "extra": board.extra, "method": found.method, "evidence": found.evidence,
                "found_at": now.isoformat()}}
            if resolve_board(board.url):
                add_claim(target, Claim("careers_url", board.url, SourceKind.OFFICIAL_ATS,
                                         VerificationStatus.PARTIALLY_VERIFIED, "board_detection",
                                         found.evidence, now, f"Job board found ({found.method})"))
        recompute(target)
        rows.append({**r, "provider": found.board.provider if found else None,
                     "board": found.board.url if found else None,
                     "method": found.method if found else None})
    run.stats = {"checked": len(candidates), "found": found_n, "careers_urls_found": careers_n,
                 "by_method": methods, "errors": sum(1 for r in rows if r["error"])}
    run.companies = rows
    run.status = "COMPLETED"
    run.finished_at = now
    record_activity(db, "scanner.boards_detected", "scan_run", run.id,
                    f"Found job boards for {found_n} of {len(candidates)} companies", run.stats)
    db.commit()
    return run
