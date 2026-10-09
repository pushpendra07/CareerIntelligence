"""Career-Ops -> Career Intelligence import/sync.

Reads Career-Ops' files (never writes them), joins reports, tracker rows, pipeline entries and
scan history by normalized URL, and sends every job through the same `ingest_job` pipeline
as manual entry (normalize -> dedup -> JD parse -> 0-100 match).

Career-Ops' own 1-5 score and report are stored separately on the job
(career_ops_score / career_ops_evaluation / career_ops_report) and are never converted.
"""

import contextlib
import hashlib
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import DomainValidationError
from app.core.text import clean
from app.core.urls import JobSource, detect_source, normalize_url
from app.integrations.career_ops import readers, runner
from app.models.career_ops import CareerOpsImport
from app.models.job import Job, JobStatus
from app.services.activity import record_activity
from app.services.job_service import JobInput, ingest_job

logger = logging.getLogger(__name__)

# Initial job status from Career-Ops' tracker state (applied only when the job is first
# created here; afterwards Career Intelligence owns the status).
STATUS_MAP = {
    "evaluated": JobStatus.REVIEWING,
    "applied": JobStatus.APPLIED,
    "responded": JobStatus.RECRUITER_CONTACTED,
    "interview": JobStatus.INTERVIEW,
    "offer": JobStatus.OFFER,
    "hired": JobStatus.ACCEPTED,
    "rejected": JobStatus.REJECTED,
    "discarded": JobStatus.CLOSED,
    "skip": JobStatus.NOT_RELEVANT,
}
IMPORTED_PIPELINE_STATES = {"PENDING", "PROCESSED", "BLOCKED"}


@dataclass
class CORecord:
    url: str | None
    title: str | None = None
    company: str | None = None
    location: str | None = None
    posted: date | None = None
    salary_text: str | None = None
    jd_text: str | None = None
    jd_source: str | None = None
    portal: str | None = None
    report: readers.Report | None = None
    tracker: readers.TrackerRow | None = None
    pipeline_state: str | None = None
    scan: dict[str, str] | None = None
    sources: list[str] = field(default_factory=list)


def data_root(settings: Settings) -> Path:
    root = readers.resolve_data_root(settings.career_ops_path, settings.career_ops_data_path)
    if root is None:
        raise DomainValidationError("CAREER_OPS_PATH is not configured")
    if not root.is_dir():
        raise DomainValidationError(f"Career-Ops folder not found: {root}")
    return root


def _hash(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def _key(url: str | None, company: str | None, title: str | None) -> str:
    if url:
        return normalize_url(url)
    return f"nourl:{(company or '').lower()}|{(title or '').lower()}"


def collect(root: Path) -> tuple[list[CORecord], dict[str, int]]:
    """Join all Career-Ops sources into one record per posting."""
    records: dict[str, CORecord] = {}
    skipped = {"pipeline_expired": 0, "pipeline_skipped": 0, "scan_not_added": 0}

    def get(url: str | None, company: str | None, title: str | None) -> CORecord:
        key = _key(url, company, title)
        if key not in records:
            records[key] = CORecord(url=url)
        return records[key]

    reports = {r.num: r for r in readers.read_reports(root) if r.num}
    for rep in reports.values():
        rec = get(rep.url, rep.company, rep.role)
        rec.report, rec.title, rec.company = rep, rep.role, rep.company
        rec.sources.append("report")
        if rep.jd_text:
            rec.jd_text, rec.jd_source = rep.jd_text, f"reports/{rep.path.name}"
        elif capture := readers.find_jd_capture(root, rep):
            rec.jd_text, rec.jd_source = capture[1], capture[0]

    for row in readers.read_tracker(readers.resolve_tracker(root)):
        tracked_report: readers.Report | None = reports.get(row.report_num or "") or next(
            (
                r
                for r in reports.values()
                if row.report_num and r.num and int(r.num) == int(row.report_num)
            ),
            None,
        )
        url = row.url or (tracked_report.url if tracked_report else None)
        rec = get(url, row.company, row.role)
        rec.tracker = row
        rec.title = rec.title or row.role
        rec.company = rec.company or row.company
        rec.location = rec.location or row.location
        rec.sources.append("tracker")
        if tracked_report and rec.report is None:
            rec.report = tracked_report

    for item in readers.read_pipeline(root / "data" / "pipeline.md"):
        if item.state not in IMPORTED_PIPELINE_STATES:
            skipped["pipeline_expired" if item.state == "EXPIRED" else "pipeline_skipped"] += 1
            continue
        rec = get(item.url, item.company, item.title)
        rec.pipeline_state = item.state
        rec.title = rec.title or item.title
        rec.company = rec.company or item.company
        rec.location = rec.location or item.location
        rec.posted = rec.posted or item.posted
        rec.salary_text = rec.salary_text or item.salary
        rec.sources.append("pipeline")

    for srow in readers.read_scan_history(root / "data" / "scan-history.tsv"):
        key = _key(srow["url"], None, None)
        if srow["status"] != "added" and key not in records:
            skipped["scan_not_added"] += 1
            continue
        rec = get(srow["url"], srow["company"], srow["title"])
        rec.scan = srow
        rec.title = rec.title or clean(srow["title"])
        rec.company = rec.company or clean(srow["company"])
        rec.location = rec.location or clean(srow["location"])
        rec.portal = clean(srow["portal"])
        posted = clean(srow.get("posted_at"))
        if posted and rec.posted is None:
            with contextlib.suppress(ValueError):
                rec.posted = date.fromisoformat(posted[:10])
        rec.sources.append("scan_history")

    for rec in records.values():
        capture = (
            readers.find_jd_capture(root, None, rec.company, rec.title)
            if rec.jd_text is None and rec.company and rec.title and not rec.report
            else None
        )
        if capture:
            rec.jd_text, rec.jd_source = capture[1], capture[0]
    return list(records.values()), skipped


def _salary(text: str | None) -> tuple[Decimal | None, str | None]:
    if text and (m := re.search(r"(\d[\d,]{3,})\s*(INR|USD|EUR|GBP|AED|SGD)", text, re.I)):
        return Decimal(m.group(1).replace(",", "")), m.group(2).upper()
    return None, None


def _evaluation(rec: CORecord, root: Path) -> dict[str, Any] | None:
    rep = rec.report
    if rep is None and rec.tracker is None:
        return None
    out: dict[str, Any] = {}
    if rep:
        out.update(
            {
                "report_num": rep.num,
                "report_date": rep.date.isoformat() if rep.date else None,
                "score_text": rep.score_text,
                "archetype": rep.archetype,
                "legitimacy": rep.legitimacy,
                "work_auth": rep.work_auth,
                "via": rep.via,
                "machine_summary": rep.machine_summary,
            }
        )
    if rec.tracker:
        out["tracker"] = {
            "num": rec.tracker.num,
            "status": rec.tracker.status,
            "score": rec.tracker.score,
            "notes": rec.tracker.notes,
            "date": rec.tracker.date.isoformat() if rec.tracker.date else None,
        }
    if rec.jd_source:
        out["jd_source"] = rec.jd_source
    return out


def import_from_career_ops(
    db: Session, settings: Settings, *, run_scan: bool = False
) -> CareerOpsImport:
    root = data_root(settings)
    run = CareerOpsImport(
        data_root=str(root),
        career_ops_version=readers.read_version(settings.career_ops_path),
        stats={},
        file_hashes={},
        errors=[],
    )
    db.add(run)
    db.flush()
    if run_scan:
        if not settings.career_ops_scan_enabled:
            raise DomainValidationError("Scanning is disabled (CAREER_OPS_SCAN_ENABLED=false)")
        if settings.career_ops_path is None:
            raise DomainValidationError("CAREER_OPS_PATH is not configured")
        run.scan_triggered = True
        try:
            run.scan_receipt = runner.run_scan(settings.career_ops_path)
        except runner.RunnerError as exc:
            run.errors = [*run.errors, {"stage": "scan", "error": str(exc)}]
            logger.warning("career-ops scan failed", extra={"error": str(exc)})

    run.file_hashes = {
        name: _hash(root / name)
        for name in ("data/pipeline.md", "data/scan-history.tsv", "data/applications.md")
    }
    records, skipped = collect(root)
    stats: dict[str, int] = {
        "records": len(records),
        "created": 0,
        "merged": 0,
        "with_evaluation": 0,
        "with_jd": 0,
        **skipped,
    }
    touched: list[int] = []
    errors: list[dict[str, Any]] = []
    for rec in records:
        if not (rec.title and rec.company):
            errors.append({"url": rec.url, "error": "missing title or company"})
            continue
        status = JobStatus.DISCOVERED
        if rec.tracker and rec.tracker.status:
            status = STATUS_MAP.get(rec.tracker.status.lower(), JobStatus.REVIEWING)
        salary, currency = _salary(rec.salary_text)
        detected = detect_source(rec.url).source.value if rec.url else None
        try:
            with db.begin_nested():
                result = ingest_job(
                    db,
                    JobInput(
                        title=rec.title,
                        company_name=rec.company,
                        url=rec.url,
                        source=JobSource.CAREER_OPS,
                        source_detail=" · ".join(filter(None, [detected, rec.portal])) or None,
                        external_id=clean(rec.scan.get("requisition_id")) if rec.scan else None,
                        location=rec.location,
                        posting_date=rec.posted,
                        salary_min=salary,
                        salary_max=salary,
                        salary_currency=currency,
                        salary_text=rec.salary_text,
                        jd_text=rec.jd_text or "",
                        status=status,
                        raw={
                            "career_ops": {
                                "sources": rec.sources,
                                "portal": rec.portal,
                                "pipeline_state": rec.pipeline_state,
                                "scan": rec.scan,
                                "jd_source": rec.jd_source,
                            }
                        },
                        origin="career_ops",
                    ),
                    analyze=False,
                    commit=False,
                )
                job = result.job
                evaluation = _evaluation(rec, root)
                if evaluation:
                    stats["with_evaluation"] += 1
                    job.career_ops_evaluation = evaluation
                    if rec.report and rec.report.score is not None:
                        job.career_ops_score = Decimal(str(rec.report.score))
                    if rec.report:
                        job.career_ops_report = f"reports/{rec.report.path.name}"
                    if rec.tracker and rec.tracker.status:
                        job.career_ops_status = rec.tracker.status
                if rec.jd_text:
                    stats["with_jd"] += 1
                stats["created" if result.created else "merged"] += 1
                touched.append(job.id)
        except Exception as exc:  # noqa: BLE001 - one bad record must not stop the import
            logger.exception("career-ops record failed", extra={"url": rec.url})
            errors.append({"url": rec.url, "error": str(exc)})
    db.flush()
    from app.services.match_service import reanalyze

    db.commit()
    scored = reanalyze(db, only_stale=False, job_ids=touched)
    stats["scored"] = scored["analyzed"]
    stats["applications"] = _import_applications(db, touched)
    run.stats = stats
    run.errors = [*run.errors, *errors]
    run.finished_at = datetime.now(UTC)
    run.status = "FAILED" if errors and not touched else "COMPLETED"
    record_activity(
        db,
        "career_ops.synced" if run_scan else "career_ops.imported",
        "career_ops",
        run.id,
        f"{stats['created']} new, {stats['merged']} updated",
        stats,
    )
    db.commit()
    logger.info("career-ops import finished", extra={"run_id": run.id, "stats": stats})
    return run


def _import_applications(db: Session, job_ids: list[int]) -> int:
    """Create application records for jobs Career-Ops tracked as applied (Phase 8 hook)."""
    try:
        from app.services.application_service import ensure_application_for_imported_job
    except ImportError:
        return 0
    created = 0
    for job in db.scalars(select(Job).where(Job.id.in_(job_ids))):
        if ensure_application_for_imported_job(db, job):
            created += 1
    db.commit()
    return created


def fetch_missing_jd(db: Session, settings: Settings, job: Job) -> bool:
    if settings.career_ops_path is None:
        raise DomainValidationError("CAREER_OPS_PATH is not configured")
    url = job.source_url or next((s.original_url for s in job.source_links if s.original_url), None)
    if not url:
        raise DomainValidationError("This job has no URL to fetch")
    try:
        text = runner.fetch_jd(settings.career_ops_path, url)
    except runner.RunnerError as exc:
        raise DomainValidationError(str(exc)) from exc
    if not text:
        job.jd_status = "FETCH_FAILED"
        db.commit()
        return False
    from app.services.job_service import update_job

    update_job(db, job.id, {"original_jd": text})
    return True


def status(db: Session, settings: Settings) -> dict[str, Any]:
    info: dict[str, Any] = {
        "configured": settings.career_ops_path is not None,
        "code_root": str(settings.career_ops_path) if settings.career_ops_path else None,
        "scan_enabled": settings.career_ops_scan_enabled,
        "node_available": runner.node_binary() is not None,
        "api": "none (file-based integration; Career-Ops exposes no stable API)",
    }
    try:
        root = data_root(settings)
    except DomainValidationError as exc:
        info["error"] = exc.message
        return info
    info["data_root"] = str(root)
    info["version"] = readers.read_version(settings.career_ops_path)
    pipeline = readers.read_pipeline(root / "data" / "pipeline.md")
    info["counts"] = {
        "pipeline_pending": sum(1 for i in pipeline if i.state == "PENDING"),
        "pipeline_processed": sum(1 for i in pipeline if i.state == "PROCESSED"),
        "scan_history": len(readers.read_scan_history(root / "data" / "scan-history.tsv")),
        "reports": len(list((root / "reports").glob("*.md"))) if (root / "reports").is_dir() else 0,
        "tracker_rows": len(readers.read_tracker(readers.resolve_tracker(root))),
    }
    last = db.scalar(select(CareerOpsImport).order_by(CareerOpsImport.id.desc()).limit(1))
    info["last_import"] = (
        None
        if last is None
        else {
            "id": last.id,
            "started_at": last.started_at,
            "status": last.status,
            "stats": last.stats,
        }
    )
    info["imported_jobs"] = len(
        list(db.scalars(select(Job.id).where(Job.source == JobSource.CAREER_OPS.value)))
    )
    return info
