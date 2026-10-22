"""Check a CV against one job (ATS score) and tailor a DOCX copy for it.

Everything happens in memory within one request: the uploaded CV is never written to
storage, the database, backups or logs, and the saved profile and scores are not touched.
The tailored file goes back in the response and that is the only copy.
"""

import base64
import re
from dataclasses import asdict
from pathlib import PurePath
from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError
from app.cv import ats, tailor_docx, text_docx
from app.cv.extract import extract_text, validate_upload
from app.models.job import Job
from app.services import job_service


def _job_terms(job: Job) -> tuple[str | None, list[str], list[str], float | None]:
    required = list(job.required_skills or [])
    preferred = [s for s in (job.preferred_skills or []) if s not in required]
    if not required and not preferred:
        raise DomainValidationError("This job has no skills to check yet: add its description "
                                    "(or the required skills) and save first.")
    exp = float(job.experience_min) if job.experience_min is not None else None
    return job.title, required, preferred, exp


def _report(text: str, job: Job) -> dict[str, Any]:
    title, required, preferred, exp = _job_terms(job)
    return asdict(ats.score_cv(text, title, required, preferred, exp))


def _cv_text(filename: str, data: bytes, max_bytes: int) -> tuple[str, str]:
    file = validate_upload(filename, data, max_bytes)
    text = tailor_docx.docx_text(data) if file.ext == ".docx" else extract_text(data, file.ext)
    if not text.strip():
        raise DomainValidationError("No text could be read from this CV (a scanned image?). "
                                    "Upload a DOCX or a PDF with selectable text.")
    return file.ext, text


def check(db: Session, job_id: int, filename: str, data: bytes, max_bytes: int) -> dict[str, Any]:
    job = job_service.get_job(db, job_id)
    ext, text = _cv_text(filename, data, max_bytes)
    report = _report(text, job)
    return {
        "format": ext.lstrip("."),
        # A PDF or text CV is tailored as a plain Word copy built from its text.
        "can_edit": True,
        "builds_copy": ext != ".docx",
        "report": report,
        # Implied skills are true by definition (the CV names a more specific form): pre-tick.
        "suggested": [k["skill"] for k in report["keywords"] if k["status"] == "implied"],
    }


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:40] or "job"


def build(db: Session, job_id: int, filename: str, data: bytes, max_bytes: int,
          add: list[str], use_title: bool) -> dict[str, Any]:
    job = job_service.get_job(db, job_id)
    ext, text = _cv_text(filename, data, max_bytes)
    copied = ext != ".docx"
    if copied:
        data = text_docx.text_to_docx(text)
    title, required, preferred, _ = _job_terms(job)
    job_skills = required + preferred
    allowed = {s.lower(): s for s in job_skills}
    chosen = [allowed[s.strip().lower()] for s in add if s.strip().lower() in allowed]
    result = tailor_docx.tailor(data, add=chosen, job_skills=job_skills,
                                headline_title=title if use_title else None)
    after = _report(tailor_docx.docx_text(result.data), job)
    company = job.company.name if job.company else ""
    name = f"{_slug(PurePath(filename).stem)}-{_slug(company or title or 'job')}.docx"
    return {
        "before": _report(text, job),
        "after": after,
        "added": result.added,
        "not_added": result.not_added,
        "reordered_lines": result.reordered_lines,
        "headline": result.headline,
        "notes": ([f"Built as a Word copy of your {ext.lstrip('.').upper()}: the text is the "
                    "same, the design is a plain layout. Check it before sending."] if copied
                   else []) + result.notes,
        "filename": name,
        "content_base64": base64.b64encode(result.data).decode(),
    }
