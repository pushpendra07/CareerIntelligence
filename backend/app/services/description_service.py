"""Fill in missing job descriptions, best-scoring jobs first, so their scores become reliable.

Runs in the background (one at a time) and records its progress as a `ScanRun` of kind
DESCRIBE. Each job is read from its own link (`jobs/jd_fetch.py`); Career-Ops' `fetch-jd.mjs`
is tried as well when Career-Ops is set up. Jobs that can't be read are marked FETCH_FAILED so
the next run moves on to others.
"""

import logging
import threading
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings, get_settings
from app.core.errors import ConflictError
from app.core.http import BlockedURLError
from app.db.session import get_sessionmaker
from app.jobs.jd_fetch import fetch_description, not_fetched_reason
from app.models.job import Job, JobStatus
from app.models.scan import ScanRun
from app.scanner.providers import Http, ProviderError

logger = logging.getLogger(__name__)
KIND = "DESCRIBE"
DEFAULT_LIMIT = 40
FINISHED = [JobStatus.CLOSED.value, JobStatus.REJECTED.value, JobStatus.NOT_RELEVANT.value,
            JobStatus.IGNORED.value, JobStatus.DUPLICATE.value, JobStatus.WITHDRAWN.value]


def _url(job: Job) -> str | None:
    """The job's link to read: the first one the app may fetch (a careers page or job board,
    not LinkedIn / Indeed / Naukri), else the first link at all."""
    links = [u for u in (job.source_url, *(s.original_url for s in job.source_links)) if u]
    return next((u for u in links if not not_fetched_reason(u)), links[0] if links else None)


def candidates_query(min_score: int = 0) -> Any:
    """Open jobs still without a description that haven't been tried yet, best score first."""
    stmt = (select(Job).where(Job.jd_status == "MISSING", Job.status.not_in(FINISHED))
            .order_by(Job.match_score.desc().nulls_last(), Job.id))
    return stmt.where(Job.match_score >= min_score) if min_score else stmt


def candidate_count(db: Session, min_score: int = 0) -> int:
    sub = candidates_query(min_score).subquery()
    return int(db.scalar(select(func.count()).select_from(sub)) or 0)


def _career_ops_text(settings: Settings, url: str) -> str | None:
    from app.integrations.career_ops import runner as co_runner

    if settings.career_ops_path is None or co_runner.node_binary() is None:
        return None
    try:
        return co_runner.fetch_jd(settings.career_ops_path, url)
    except co_runner.RunnerError:
        return None


def fetch_descriptions(
    db: Session, run: ScanRun, *, limit: int = DEFAULT_LIMIT, min_score: int = 0,
    http: Http | None = None, settings: Settings | None = None,
) -> dict[str, Any]:
    from app.scanner.service import default_http
    from app.services.job_service import update_job

    http = http or default_http
    settings = settings or get_settings()
    stmt = candidates_query(min_score).options(selectinload(Job.source_links)).limit(limit)
    jobs = list(db.scalars(stmt))
    stats: dict[str, Any] = {"total": len(jobs), "checked": 0, "fetched": 0, "failed": 0,
                             "not_allowed": 0, "no_link": 0, "fetched_jobs": []}
    for job in jobs:
        url = _url(job)
        text: str | None = None
        if not url:
            stats["no_link"] += 1
        elif not_fetched_reason(url):
            stats["not_allowed"] += 1
        else:
            try:
                text = fetch_description(url, http)
            except (ProviderError, BlockedURLError, OSError, ValueError) as exc:
                logger.info("description fetch failed",
                            extra={"job_id": job.id, "error": str(exc)[:200]})
            text = text or _career_ops_text(settings, url)
            if text:
                update_job(db, job.id, {"original_jd": text})  # re-parses and re-scores
                stats["fetched"] += 1
                stats["fetched_jobs"].append({"id": job.id, "title": job.title})
            else:
                stats["failed"] += 1
                stats.setdefault("failed_jobs", []).append({"id": job.id, "title": job.title})
        if not text and url:
            # Tried (or only on sites that can't be read automatically): the next run moves on.
            job.jd_status = "PASTE_NEEDED" if not_fetched_reason(url) else "FETCH_FAILED"
        stats["checked"] += 1
        run.stats = dict(stats)
        db.commit()
    run.status, run.finished_at = "COMPLETED", datetime.now(UTC)
    db.commit()
    return stats


def _background(run_id: int, limit: int, min_score: int) -> None:
    with get_sessionmaker()() as db:
        run = db.get(ScanRun, run_id)
        assert run is not None
        try:
            fetch_descriptions(db, run, limit=limit, min_score=min_score)
        except Exception as exc:
            logger.exception("description fetch failed", extra={"run_id": run_id})
            db.rollback()
            run.status, run.finished_at = "FAILED", datetime.now(UTC)
            run.stats = {**run.stats, "error": str(exc)[:300]}
            db.commit()


def start(db: Session, *, limit: int = DEFAULT_LIMIT, min_score: int = 0, wait: bool = False,
          http: Http | None = None, settings: Settings | None = None) -> ScanRun:
    from app.scanner.runner import running_run

    if running_run(db, KIND):
        raise ConflictError("Descriptions are already being fetched — wait for it to finish")
    run = ScanRun(kind=KIND, trigger="manual", stats={"total": 0, "checked": 0}, companies=[])
    db.add(run)
    db.commit()
    if wait:
        fetch_descriptions(db, run, limit=limit, min_score=min_score, http=http, settings=settings)
    else:
        threading.Thread(target=_background, args=(run.id, limit, min_score),
                         name=f"describe-{run.id}", daemon=True).start()
    return run


def status(db: Session) -> dict[str, Any]:
    from app.scanner.runner import running_run

    last = db.scalar(
        select(ScanRun).where(ScanRun.kind == KIND).order_by(ScanRun.id.desc()).limit(1))
    running = running_run(db, KIND)

    def out(r: ScanRun | None) -> dict[str, Any] | None:
        if r is None:
            return None
        return {"id": r.id, "status": r.status, "started_at": r.started_at,
                "finished_at": r.finished_at, "stats": r.stats}

    return {"missing": candidate_count(db), "missing_70_plus": candidate_count(db, 70),
            "running": out(running), "last_run": out(last)}
