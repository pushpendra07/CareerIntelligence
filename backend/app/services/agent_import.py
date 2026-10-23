"""Jobs found by an AI assistant browsing job portals (Claude in Chrome, Gemini, …).

The assistant searches LinkedIn, Naukri and other portals in the user's browser and hands the
postings over as a JSON list (pasted on Jobs → AI search, or POSTed to
`/api/v1/jobs/agent-import`). Every row goes through `ingest_job`, so the usual duplicate
rules apply; `dry_run` reports what would happen without saving anything.
"""

import re
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError
from app.core.text import clean
from app.models.job import WorkModel
from app.services.import_rules import FilteredJobError
from app.services.job_service import DeletedJobError, JobInput, ingest_job

MAX_ROWS = 200
MAX_JD_CHARS = 50_000

# Accepted names for each field (assistants don't always use the exact key).
_KEYS: dict[str, tuple[str, ...]] = {
    "title": ("title", "job_title", "role", "position"),
    "company": ("company", "company_name", "employer"),
    "url": ("url", "link", "job_url", "application_link", "apply_url"),
    "location": ("location", "city", "locations"),
    "work_model": ("work_model", "workplace", "workplace_type", "work_mode", "remote"),
    "experience": ("experience", "experience_required", "experience_req", "years"),
    "salary": ("salary", "ctc", "salary_ctc", "compensation", "pay"),
    "posted": ("posted", "posted_date", "posting_date", "date_posted", "posted_on"),
    "description": ("description", "jd", "job_description", "summary", "details"),
    "portal": ("portal", "source", "site", "website", "found_on"),
    "notes": ("notes", "note", "why", "match_reason", "key_match_factors"),
}
_WORK_MODELS = {"remote": WorkModel.REMOTE, "hybrid": WorkModel.HYBRID,
                "onsite": WorkModel.ONSITE, "on-site": WorkModel.ONSITE,
                "on site": WorkModel.ONSITE, "office": WorkModel.ONSITE}


def _get(row: dict[str, Any], field: str) -> str | None:
    lowered = {str(k).strip().lower().replace(" ", "_"): v for k, v in row.items()}
    for key in _KEYS[field]:
        value = lowered.get(key)
        if isinstance(value, list):
            value = " / ".join(str(v) for v in value if v)
        if value not in (None, "") and (text := clean(str(value))):
            return text
    return None


def _posted(value: str | None) -> date | None:
    if value and (m := re.search(r"\d{4}-\d{2}-\d{2}", value)):
        try:
            return date.fromisoformat(m.group(0))
        except ValueError:
            return None
    return None


def to_input(row: dict[str, Any]) -> JobInput:
    if not isinstance(row, dict):
        raise DomainValidationError("Each job must be an object")
    title, company = _get(row, "title"), _get(row, "company")
    if not title or not company:
        raise DomainValidationError("Job title and company are required")
    work = (_get(row, "work_model") or "").lower()
    portal = _get(row, "portal")
    jd = next((v for k, v in row.items() if str(k).strip().lower().replace(" ", "_")
               in _KEYS["description"] and isinstance(v, str) and v.strip()), "")
    return JobInput(
        title=title,
        company_name=company,
        url=_get(row, "url"),
        source_detail=" · ".join(filter(None, ["AI search", portal])),
        location=_get(row, "location"),
        work_model=next((m.value for k, m in _WORK_MODELS.items() if k in work), None),
        experience_text=_get(row, "experience"),
        salary_text=_get(row, "salary"),
        posting_date=_posted(_get(row, "posted")),
        jd_text=jd.strip()[:MAX_JD_CHARS],  # keeps line breaks (the JD parser uses them)
        notes=_get(row, "notes"),
        origin="agent",
    )


def import_jobs(db: Session, rows: list[Any], *, dry_run: bool = False,
                allow_deleted: bool = False) -> dict[str, Any]:
    """Add the assistant's jobs (or, with dry_run, only report what would happen).

    allow_deleted: the user chose to add a job they deleted before (as if added by hand).
    """
    if not isinstance(rows, list) or not rows:
        raise DomainValidationError("Paste a JSON list of jobs")
    if len(rows) > MAX_ROWS:
        raise DomainValidationError(f"At most {MAX_ROWS} jobs at a time")
    results: list[dict[str, Any]] = []
    created: dict[int, int] = {}  # job id -> row index, for repeats inside this list
    batch = db.begin_nested()
    for i, row in enumerate(rows):
        out: dict[str, Any] = {"index": i}
        try:
            data = to_input(row)
            out.update(title=data.title, company=data.company_name, url=data.url,
                       has_description=bool(data.jd_text))
            try:
                with db.begin_nested():
                    r = ingest_job(db, data, analyze=False, commit=False)
            except DeletedJobError:
                if not allow_deleted:
                    raise
                data.origin = "manual"
                with db.begin_nested():
                    r = ingest_job(db, data, analyze=False, commit=False)
            if r.created:
                created[r.job.id] = i
                out.update(result="new", job_id=None if dry_run else r.job.id)
            elif r.job.id in created:
                out.update(result="repeat", same_as=created[r.job.id])
            else:
                out.update(result="duplicate", job_id=r.job.id, matched_by=r.matched_by,
                           existing_title=r.job.title, existing_status=r.job.status)
        except DeletedJobError:
            out.update(result="deleted")
        except FilteredJobError as exc:
            out.update(result="filtered", error=exc.reason)
        except DomainValidationError as exc:
            out.update(result="invalid", error=exc.message)
        results.append(out)
    counts = {k: sum(1 for r in results if r["result"] == k)
              for k in ("new", "duplicate", "repeat", "deleted", "filtered", "invalid")}
    if dry_run:
        batch.rollback()
        return {"dry_run": True, "counts": counts, "results": results}
    batch.commit()
    db.commit()
    if created:
        from app.services.match_service import reanalyze

        reanalyze(db, only_stale=False, job_ids=list(created))
    from app.models.job import Job

    for out in results:  # what the extension shows: "Added #12 · score 78"
        if out.get("job_id") and (job := db.get(Job, out["job_id"])) is not None:
            out.update(score=job.match_score, status=job.status)
    return {"dry_run": False, "counts": counts, "results": results}
