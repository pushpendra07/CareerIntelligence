"""AI Job Search (github.com/ai-job-search-dev/ai-job-search): an optional, read-only job source.

AI Job Search is a Claude Code workflow (`/scrape`, `/rank`, `/apply`, `/outcome`) that keeps its
state in plain files. This app only reads them, never writes to the checkout and never starts
its AI commands (they cost tokens and run in the user's own Claude Code):

- `job_scraper/seen_jobs.json`  jobs `/scrape` found ({"seen": {key: entry}}); `/rank` adds
  `rank_score` (0-100), `rank_verdict`, `strengths`, `gaps` and the `location_verdict` /
  `language_gate` vetoes (PASS / FAIL / FLAG)
- `job_search_tracker.csv`      applications (`date,company,sector,role,…,status,…,source,…`)

Every job goes through `ingest_job` (origin `ai_job_search`), so the usual duplicate rules apply
and jobs the user deleted stay deleted. Its rank is kept next to ours (notes + source link raw),
never converted into the deterministic 0-100 match score.
"""

import csv
import hashlib
import json
import logging
import threading
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ConflictError, DomainValidationError
from app.core.text import clean
from app.core.urls import is_http_url, normalize_url
from app.models.application import Application, ApplicationStatus
from app.models.job import Job, JobStatus
from app.services.activity import record_activity
from app.services.import_rules import FilteredJobError
from app.services.job_service import DeletedJobError, JobInput, ingest_job

logger = logging.getLogger(__name__)

SEEN_FILE = "job_scraper/seen_jobs.json"
TRACKER_FILE = "job_search_tracker.csv"
WATCHED = (SEEN_FILE, TRACKER_FILE)
SETTINGS_KEY = "ai_job_search"
CHECK_EVERY_SECONDS = 300

# seen_jobs.json `status`: "skipped" (filtered out by /scrape) and "expired" are not imported.
IMPORTED_SEEN = {"new", "ranked", "unreachable"}
# Tracker `status` (the /outcome vocabulary; legacy space spellings read too) -> job status.
TRACKER_JOB_STATUS = {
    "drafted": JobStatus.READY_TO_APPLY,
    "applied": JobStatus.APPLIED,
    "interview": JobStatus.INTERVIEW,
    "offer": JobStatus.OFFER,
    "hired": JobStatus.ACCEPTED,
    "rejected": JobStatus.REJECTED,
    "no_response": JobStatus.APPLIED,
    "offer_declined": JobStatus.WITHDRAWN,
    "withdrawn": JobStatus.WITHDRAWN,
}
TRACKER_APPLICATION_STATUS = {
    "applied": ApplicationStatus.APPLIED,
    "interview": ApplicationStatus.INTERVIEW,
    "offer": ApplicationStatus.OFFER,
    "hired": ApplicationStatus.ACCEPTED,
    "rejected": ApplicationStatus.REJECTED,
    "no_response": ApplicationStatus.CLOSED,
    "offer_declined": ApplicationStatus.WITHDRAWN,
    "withdrawn": ApplicationStatus.WITHDRAWN,
}

_lock = threading.Lock()  # one import at a time (manual and automatic)


def tracker_status(value: str | None) -> str:
    return "_".join((value or "").strip().lower().split())


def _date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value).strip()[:10]) if value else None
    except ValueError:
        return None


# --- reading --------------------------------------------------------------------------------


def root(settings: Settings) -> Path:
    path = settings.ai_job_search_path
    if path is None:
        raise DomainValidationError(
            "AI Job Search is not set up: run ./scripts/setup-ai-job-search.sh "
            "or set AI_JOB_SEARCH_PATH in backend/.env")
    if not path.is_dir():
        raise DomainValidationError(f"AI Job Search folder not found: {path}")
    return path


def read_seen(path: Path) -> dict[str, dict[str, Any]]:
    """seen_jobs.json as {key: entry}; a missing file is an empty history."""
    if not path.is_file():
        return {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DomainValidationError(f"{SEEN_FILE} is not valid JSON: {exc}") from exc
    seen = doc.get("seen") if isinstance(doc, dict) and "seen" in doc else doc
    if not isinstance(seen, dict):
        raise DomainValidationError(f"{SEEN_FILE}: expected an object of job entries")
    return {str(k): v for k, v in seen.items() if isinstance(v, dict)}


def read_tracker(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return [{(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh)]


def read_version(base: Path) -> str | None:
    """framework_version from the evaluation skill (bumped on every framework change)."""
    skill = base / ".claude/skills/job-application-assistant/04-job-evaluation.md"
    try:
        for line in skill.read_text(encoding="utf-8").splitlines()[:5]:
            if line.startswith("framework_version:"):
                return line.split(":", 1)[1].strip() or None
    except OSError:
        return None
    return None


def file_hashes(base: Path) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for name in WATCHED:
        path = base / name
        out[name] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    return out


@dataclass
class Record:
    """One job, from seen_jobs.json and/or a tracker row."""

    title: str
    company: str
    url: str | None = None
    location: str | None = None
    posted: date | None = None
    deadline: date | None = None
    portal: str | None = None
    seen: dict[str, Any] = field(default_factory=dict)
    tracker: dict[str, str] | None = None


def _identity(url: str | None, company: str, title: str) -> tuple[str | None, str]:
    url_key = normalize_url(url) if url and is_http_url(url) else None
    return url_key, f"{' '.join(company.lower().split())}|{' '.join(title.lower().split())}"


def collect(base: Path) -> tuple[list[Record], dict[str, int]]:
    seen = read_seen(base / SEEN_FILE)
    tracker = read_tracker(base / TRACKER_FILE)
    records: list[Record] = []
    by_url: dict[str, Record] = {}
    by_pair: dict[str, Record] = {}
    skipped = {"skipped_by_scrape": 0, "expired": 0, "vetoed": 0}
    for entry in seen.values():
        status = str(entry.get("status") or "new").lower()
        if status not in IMPORTED_SEEN:
            skipped["expired" if status == "expired" else "skipped_by_scrape"] += 1
            continue
        title, company = clean(entry.get("title")), clean(entry.get("company"))
        if not title or not company:
            continue
        loc = entry.get("location")
        rec = Record(title=title, company=company, url=clean(entry.get("url")) or None,
                     location=clean(loc) if isinstance(loc, str) and loc not in
                     ("PASS", "FAIL", "FLAG") else None,
                     posted=_date(entry.get("posted_date")), deadline=_date(entry.get("deadline")),
                     portal=clean(entry.get("portal")) or None, seen=entry)
        url_key, pair = _identity(rec.url, company, title)
        if url_key:
            by_url[url_key] = rec
        by_pair[pair] = rec
        records.append(rec)
    for row in tracker:
        title, company = clean(row.get("role")), clean(row.get("company"))
        if not title or not company:
            continue
        url = clean(row.get("source")) or None
        url_key, pair = _identity(url, company, title)
        found = (by_url.get(url_key) if url_key else None) or by_pair.get(pair)
        if found is None:
            rec = Record(title=title, company=company,
                         url=url if url and is_http_url(url) else None)
            records.append(rec)
            by_pair[pair] = rec
        else:
            rec = found
        rec.tracker = row
        rec.deadline = rec.deadline or _date(row.get("deadline"))
    return records, skipped


def rank_note(entry: dict[str, Any]) -> str | None:
    """AI Job Search's own /rank result, as one note (kept apart from our match score)."""
    score = entry.get("rank_score")
    if score is None:
        return None
    parts = [f"AI Job Search rank: {score}/100"
             + (f" ({entry['rank_verdict']})" if entry.get("rank_verdict") else "")]
    if entry.get("strengths"):
        parts.append("Strengths: " + "; ".join(str(s) for s in entry["strengths"]))
    if entry.get("gaps"):
        parts.append("Gaps: " + "; ".join(str(g) for g in entry["gaps"]))
    for gate in ("location_verdict", "language_gate"):
        if entry.get(gate) in ("FAIL", "FLAG"):
            label = "Location" if gate == "location_verdict" else "Language"
            note = f" - {entry['language_note']}" if gate == "language_gate" and entry.get(
                "language_note") else ""
            parts.append(f"{label} check: {entry[gate]}{note}")
    return "\n".join(parts)


def _vetoed(entry: dict[str, Any]) -> bool:
    return "FAIL" in (entry.get("location_verdict"), entry.get("language_gate"))


# --- importing ------------------------------------------------------------------------------


def _state(db: Session) -> dict[str, Any]:
    from app.models.app_settings import AppSettings

    row = db.get(AppSettings, 1)
    return dict((row.data if row else {}).get(SETTINGS_KEY) or {})


def _save_state(db: Session, **changes: Any) -> None:
    from app.models.app_settings import AppSettings

    row = db.get(AppSettings, 1)
    if row is None:
        row = AppSettings(id=1, data={})
        db.add(row)
    row.data = {**(row.data or {}), SETTINGS_KEY: {**_state(db), **changes}}


def _application(db: Session, job: Job, row: dict[str, str]) -> bool:
    """Record the application the tracker shows as sent (once per job)."""
    from app.services.application_service import create_application

    status = TRACKER_APPLICATION_STATUS.get(tracker_status(row.get("status")))
    if status is None or db.scalar(select(Application.id).where(Application.job_id == job.id)):
        return False
    create_application(
        db, job.id,
        {"applied_on": _date(row.get("date")) or date.today(), "status": status.value,
         "method": "OTHER",
         "notes": " · ".join(filter(None, ["Imported from AI Job Search tracker",
                                          row.get("channel"), row.get("notes")]))[:2000]},
        origin="ai_job_search", commit=False)
    return True


def import_jobs(db: Session, settings: Settings) -> dict[str, Any]:
    """Read AI Job Search's files and add / merge its jobs and applications."""
    base = root(settings)
    if not _lock.acquire(blocking=False):
        raise ConflictError("An AI Job Search import is already running")
    try:
        return _import(db, base)
    finally:
        _lock.release()


def _import(db: Session, base: Path) -> dict[str, Any]:
    from app.services.job_service import _status_rank, set_status
    from app.services.match_service import reanalyze

    started = datetime.now(UTC)
    hashes = file_hashes(base)
    records, skipped = collect(base)
    stats: dict[str, int] = {"records": len(records), "created": 0, "merged": 0, "ranked": 0,
                             "applications": 0, "deleted_skipped": 0, "filtered_skipped": 0,
                             **skipped}
    errors: list[dict[str, Any]] = []
    touched: list[int] = []
    for rec in records:
        row = rec.tracker
        status = JobStatus.NEW
        if row and tracker_status(row.get("status")) in TRACKER_JOB_STATUS:
            status = TRACKER_JOB_STATUS[tracker_status(row.get("status"))]
        elif _vetoed(rec.seen):
            status = JobStatus.NOT_RELEVANT
            stats["vetoed"] += 1
        note = rank_note(rec.seen)
        try:
            with db.begin_nested():
                result = ingest_job(
                    db,
                    JobInput(
                        title=rec.title,
                        company_name=rec.company,
                        url=rec.url,
                        source_detail=" · ".join(filter(None, ["AI Job Search", rec.portal])),
                        location=rec.location,
                        posting_date=rec.posted,
                        application_deadline=rec.deadline,
                        notes=note,
                        status=status,
                        raw={"ai_job_search": {k: v for k, v in rec.seen.items() if k in (
                            "rank_score", "rank_verdict", "rank_date", "strengths", "gaps",
                            "location_verdict", "language_gate", "language_note", "fit",
                            "first_seen", "portal", "source", "status")} | (
                            {"tracker": row} if row else {})},
                        origin="ai_job_search",
                    ),
                    analyze=False,
                    commit=False,
                )
                job = result.job
                if not result.created and row and status != JobStatus.NEW \
                        and _status_rank(status.value) > _status_rank(job.status):
                    set_status(db, job.id, status, note="AI Job Search tracker", commit=False,
                               plan_follow_up=False)
                if row and _application(db, job, row):
                    stats["applications"] += 1
            stats["created" if result.created else "merged"] += 1
            stats["ranked"] += 1 if note else 0
            touched.append(job.id)
        except DeletedJobError:
            stats["deleted_skipped"] += 1
        except FilteredJobError:
            stats["filtered_skipped"] += 1
        except Exception as exc:  # noqa: BLE001 - one bad record must not stop the import
            logger.exception("ai-job-search record failed", extra={"url": rec.url})
            errors.append({"title": rec.title, "company": rec.company, "error": str(exc)[:300]})
    db.commit()
    if touched:
        stats["scored"] = reanalyze(db, only_stale=False, job_ids=touched)["analyzed"]
    last = {"started_at": started.isoformat(), "finished_at": datetime.now(UTC).isoformat(),
            "stats": stats, "errors": errors[:20]}
    _save_state(db, last_import=last, file_hashes=hashes)
    record_activity(db, "ai_job_search.imported", "ai_job_search", None,
                    f"{stats['created']} new, {stats['merged']} updated", stats)
    db.commit()
    logger.info("ai-job-search import finished", extra={"stats": stats})
    return last


# --- status, settings, automatic import -----------------------------------------------------


def status(db: Session, settings: Settings) -> dict[str, Any]:
    state = _state(db)
    out: dict[str, Any] = {
        "configured": settings.ai_job_search_path is not None,
        "path": str(settings.ai_job_search_path) if settings.ai_job_search_path else None,
        "available": False, "version": None, "error": None, "counts": None,
        "running": _lock.locked(),
        "auto_import": bool(state.get("auto_import")),
        "last_import": state.get("last_import"),
    }
    try:
        base = root(settings)
        seen = read_seen(base / SEEN_FILE)
        tracker = read_tracker(base / TRACKER_FILE)
    except DomainValidationError as exc:
        out["error"] = exc.message
        return out
    statuses = [str(e.get("status") or "new").lower() for e in seen.values()]
    out.update(
        available=True,
        version=read_version(base),
        counts={"seen": len(seen), "new": statuses.count("new"),
                "ranked": statuses.count("ranked"), "skipped": statuses.count("skipped"),
                "tracker": len(tracker)},
        changed_since_import=state.get("file_hashes") != file_hashes(base),
    )
    return out


def save_settings(db: Session, data: dict[str, Any]) -> dict[str, Any]:
    _save_state(db, auto_import=bool(data.get("auto_import")))
    db.commit()
    return {"auto_import": bool(_state(db).get("auto_import"))}


def scheduled_tick(db: Session, settings: Settings) -> bool:
    """Import when auto-import is on and its files changed since the last import."""
    state = _state(db)
    if not state.get("auto_import") or settings.ai_job_search_path is None:
        return False
    try:
        base = root(settings)
    except DomainValidationError:
        return False
    if state.get("file_hashes") == file_hashes(base) or not any(file_hashes(base).values()):
        return False
    import_jobs(db, settings)
    return True


def _scheduler_loop(stop: threading.Event, settings: Settings) -> None:
    from app.db.session import get_sessionmaker

    while not stop.wait(CHECK_EVERY_SECONDS):
        try:
            with get_sessionmaker()() as db:
                if scheduled_tick(db, settings):
                    logger.info("ai-job-search automatic import")
        except ConflictError:
            pass
        except Exception:
            logger.exception("ai-job-search automatic import failed")


def start_scheduler(settings: Settings) -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=_scheduler_loop, args=(stop, settings),
                     name="ai-job-search-scheduler", daemon=True).start()
    return stop
