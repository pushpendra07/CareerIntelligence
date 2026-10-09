"""Run scans off the request thread, plus the optional every-N-hours schedule."""

import logging
import threading
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError
from app.db.session import get_sessionmaker
from app.models.scan import ScanRun
from app.scanner import service

logger = logging.getLogger(__name__)
STALE_AFTER = timedelta(hours=3)
CHECK_EVERY_SECONDS = 300


def running_run(db: Session, kind: str = "SCAN") -> ScanRun | None:
    """A run still in progress. Runs left RUNNING by a crash/restart are closed as FAILED."""
    run = db.scalar(select(ScanRun).where(ScanRun.kind == kind, ScanRun.status == "RUNNING")
                    .order_by(ScanRun.id.desc()).limit(1))
    if run and run.started_at < datetime.now(UTC) - STALE_AFTER:
        run.status, run.finished_at = "FAILED", datetime.now(UTC)
        run.stats = {**run.stats, "error": "Interrupted (the app stopped during the run)"}
        db.commit()
        return None
    return run


def _background(run_id: int, kind: str, company_ids: list[int] | None) -> None:
    with get_sessionmaker()() as db:
        run = db.get(ScanRun, run_id)
        assert run is not None
        try:
            if kind == "DETECT":
                service.detect_boards(db, company_ids, trigger=run.trigger, run=run)
            else:
                service.run_scan(db, company_ids=company_ids, trigger=run.trigger, run=run)
        except Exception as exc:
            logger.exception("background scan failed", extra={"run_id": run_id})
            db.rollback()
            if run.status == "RUNNING":
                run.status, run.finished_at = "FAILED", datetime.now(UTC)
                run.stats = {**run.stats, "error": str(exc)[:300]}
                db.commit()


def start_background(db: Session, kind: str = "SCAN", company_ids: list[int] | None = None,
                     trigger: str = "manual") -> ScanRun:
    if running_run(db, kind):
        raise ConflictError("A scan is already running — wait for it to finish")
    run = ScanRun(kind=kind, trigger=trigger, stats={}, companies=[])
    db.add(run)
    db.commit()
    threading.Thread(target=_background, args=(run.id, kind, company_ids),
                     name=f"scan-{run.id}", daemon=True).start()
    return run


def _due(db: Session) -> bool:
    hours = int(service.scanner_settings(db).get("schedule_hours") or 0)
    if hours <= 0 or running_run(db):
        return False
    last = db.scalar(select(ScanRun.started_at).where(ScanRun.kind == "SCAN")
                     .order_by(ScanRun.id.desc()).limit(1))
    return last is None or last < datetime.now(UTC) - timedelta(hours=hours)


def _scheduler_loop(stop: threading.Event) -> None:
    while not stop.wait(CHECK_EVERY_SECONDS):
        try:
            with get_sessionmaker()() as db:
                if _due(db):
                    logger.info("scheduled scan starting")
                    service.run_scan(db, trigger="schedule")
        except ConflictError:
            pass
        except Exception:
            logger.exception("scheduled scan failed")


def start_scheduler() -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=_scheduler_loop, args=(stop,), name="scan-scheduler",
                     daemon=True).start()
    return stop
