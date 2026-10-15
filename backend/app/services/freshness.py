"""Keep job data and scores current without the user clicking "Re-analyze".

A background thread (started in `main.py`) runs `refresh` at startup and then every
`CHECK_EVERY_SECONDS`:

1. Jobs whose stored JD parse is from an older parser or skill catalog are parsed again, so a
   newly added skill (e.g. Drupal) is found in jobs that are already in the app.
2. Every job whose score is stale (profile, preferences, CVs or scoring changed) is re-scored.

Both steps are deterministic and cheap; they only touch jobs that need it.
"""

import logging
import threading
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.session import get_sessionmaker
from app.jobs.jd_parser import JD_PARSER_VERSION, parse_jd
from app.models.job import Job
from app.skills.catalog import CATALOG_VERSION

logger = logging.getLogger(__name__)
CHECK_EVERY_SECONDS = 60
_lock = threading.Lock()  # one refresh at a time (startup, timer and API share it)


def _outdated_parse() -> Any:
    parsed = Job.parsed_jd
    return or_(
        parsed["parser_version"].astext.is_distinct_from(JD_PARSER_VERSION),
        parsed["catalog_version"].astext.is_distinct_from(CATALOG_VERSION),
    )


def outdated_count(db: Session) -> int:
    return int(db.scalar(select(func.count()).select_from(Job).where(_outdated_parse())) or 0)


def reparse_outdated(db: Session, batch_size: int = 200) -> int:
    """Parse JDs again that were parsed by an older parser/catalog; their scores become stale."""
    from app.services.job_service import _apply_parsed

    ids = list(db.scalars(select(Job.id).where(_outdated_parse()).order_by(Job.id)))
    for start in range(0, len(ids), batch_size):
        for job in db.scalars(select(Job).where(Job.id.in_(ids[start : start + batch_size]))):
            try:
                _apply_parsed(job, parse_jd(job.original_jd, job.title))
                job.score_stale = True
            except Exception:  # one bad JD must not stop the rest
                logger.exception("re-parse failed", extra={"job_id": job.id})
        db.commit()
    if ids:
        logger.info("job descriptions re-parsed", extra={"jobs": len(ids)})
    return len(ids)


def refresh(db: Session) -> dict[str, int]:
    """Re-parse outdated JDs, then re-score stale jobs. Skips if a refresh is already running."""
    from app.services.match_service import reanalyze

    if not _lock.acquire(blocking=False):
        return {"reparsed": 0, "rescored": 0, "skipped": 1}
    try:
        from app.services.application_service import ensure_applications

        reparsed = reparse_outdated(db)
        rescored = reanalyze(db, only_stale=True)["analyzed"]
        # Jobs marked Applied by an import (sheet, file, Career-Ops merge) get their application.
        recorded = ensure_applications(db)
        return {"reparsed": reparsed, "rescored": rescored, "applications": recorded,
                "skipped": 0}
    finally:
        _lock.release()


def is_running() -> bool:
    return _lock.locked()


def _loop(stop: threading.Event) -> None:
    while True:
        try:
            with get_sessionmaker()() as db:
                refresh(db)
        except Exception:
            logger.exception("score refresh failed")
        if stop.wait(CHECK_EVERY_SECONDS):
            return


def start_refresher() -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=_loop, args=(stop,), name="score-refresher", daemon=True).start()
    return stop
