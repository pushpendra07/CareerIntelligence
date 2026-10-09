"""Import / export so career data is never locked into the app (spec §57)."""

import csv
import io
import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import DomainValidationError
from app.core.text import clean, split_list
from app.core.urls import is_listing_url
from app.jobs.jd_parser import detect_work_model
from app.models.application import Application, FollowUp
from app.models.company import Contact
from app.models.interview import Interview, InterviewQuestion
from app.models.job import Job, JobStatus
from app.models.offer import Offer
from app.services.activity import record_activity
from app.services.company_service import export_rows as company_rows
from app.services.company_service import save_contact, to_csv
from app.services.job_service import DeletedJobError, JobInput, ingest_job


def _iso(v: Any) -> Any:
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, list):
        return "; ".join(str(x) for x in v)
    return v


def _rows(db: Session, entity: str) -> tuple[list[str], list[dict[str, Any]]]:
    if entity == "companies":
        rows = company_rows(db)
        return list(rows[0].keys()) if rows else ["id", "name"], rows
    if entity == "jobs":
        cols = [
            "id",
            "title",
            "company",
            "status",
            "match_score",
            "recommendation",
            "career_ops_score",
            "source",
            "sources",
            "source_url",
            "location",
            "work_model",
            "employment_type",
            "experience_min",
            "experience_max",
            "salary_min",
            "salary_max",
            "salary_currency",
            "posting_date",
            "application_deadline",
            "required_skills",
            "preferred_skills",
            "notes",
            "original_jd",
        ]
        out = []
        for j in db.scalars(
            select(Job)
            .options(selectinload(Job.company), selectinload(Job.source_links))
            .order_by(Job.id)
        ):
            out.append(
                {
                    **{c: _iso(getattr(j, c, None)) for c in cols},
                    "company": j.company.name,
                    "sources": "; ".join(sorted({s.source for s in j.source_links})),
                }
            )
        return cols, out
    simple: dict[str, tuple[Any, list[str]]] = {
        "applications": (
            Application,
            [
                "id",
                "job_id",
                "company_id",
                "applied_on",
                "method",
                "status",
                "cv_version_id",
                "recruiter_contact_id",
                "expected_salary",
                "salary_currency",
                "notice_period_days",
                "follow_up_date",
                "notes",
                "origin",
            ],
        ),
        "recruiters": (
            Contact,
            [
                "id",
                "name",
                "company_id",
                "job_title",
                "contact_type",
                "linkedin_url",
                "email",
                "source",
                "location",
                "status",
                "last_contacted_at",
                "next_followup_at",
                "notes",
            ],
        ),
        "interviews": (
            Interview,
            [
                "id",
                "job_id",
                "application_id",
                "company_id",
                "round_number",
                "round_type",
                "mode",
                "scheduled_at",
                "status",
                "result",
                "interviewers",
                "topics",
                "feedback",
                "notes",
                "next_round",
            ],
        ),
        "questions": (
            InterviewQuestion,
            [
                "id",
                "question",
                "category",
                "technology",
                "difficulty",
                "company_id",
                "job_id",
                "round_type",
                "expected_answer",
                "my_answer",
                "confidence",
                "times_practiced",
                "last_practiced_at",
                "notes",
            ],
        ),
        "offers": (
            Offer,
            [
                "id",
                "job_id",
                "company_id",
                "offer_date",
                "status",
                "currency",
                "base_salary",
                "variable_pay",
                "bonus",
                "equity",
                "total_ctc",
                "joining_date",
                "location",
                "work_model",
                "decision",
                "decision_date",
                "negotiation_notes",
            ],
        ),
        "followups": (
            FollowUp,
            [
                "id",
                "kind",
                "title",
                "due_date",
                "job_id",
                "company_id",
                "contact_id",
                "application_id",
                "completed",
                "notes",
            ],
        ),
    }
    if entity not in simple:
        raise DomainValidationError(f"Unknown export entity '{entity}'")
    model, cols = simple[entity]
    return cols, [
        {c: _iso(getattr(r, c)) for c in cols} for r in db.scalars(select(model).order_by(model.id))
    ]


EXPORTABLE = [
    "companies",
    "jobs",
    "applications",
    "recruiters",
    "interviews",
    "questions",
    "offers",
    "followups",
]


def export(db: Session, entity: str, fmt: str) -> tuple[str, str]:
    cols, rows = _rows(db, entity)
    if fmt == "json":
        return json.dumps(
            {"entity": entity, "items": rows}, default=str, indent=2
        ), "application/json"
    return to_csv(rows, cols), "text/csv"


def export_all(db: Session) -> str:
    return json.dumps({e: _rows(db, e)[1] for e in EXPORTABLE}, default=str, indent=2)


def parse_rows(data: bytes, filename: str) -> list[dict[str, Any]]:
    text = data.decode("utf-8-sig")
    if filename.lower().endswith(".json"):
        parsed = json.loads(text)
        items = parsed.get("items", parsed) if isinstance(parsed, dict) else parsed
        if not isinstance(items, list):
            raise DomainValidationError('JSON must be a list or {"items": [...]}')
        return [i for i in items if isinstance(i, dict)]
    return list(csv.DictReader(io.StringIO(text)))


def _dec(v: Any) -> Decimal | None:
    s = clean(v)
    if s is None:
        return None
    try:
        return Decimal(s.replace(",", ""))
    except InvalidOperation:
        return None


def _date(v: Any) -> date | None:
    s = clean(v)
    try:
        return date.fromisoformat(s[:10]) if s else None
    except ValueError:
        return None


def _key(k: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(k).lower()).strip("_")


def _first(r: dict[str, Any], *names: str) -> str | None:
    for n in names:
        if (v := clean(r.get(n))) is not None:
            return v
    return None


MONTH_DATE = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})",
    re.IGNORECASE,
)
STATUS_MAP = {
    "discovered": JobStatus.DISCOVERED,
    "new": JobStatus.NEW,
    "to apply": JobStatus.READY_TO_APPLY,
    "shortlisted": JobStatus.SHORTLISTED,
    "applied": JobStatus.APPLIED,
    "interview": JobStatus.INTERVIEW,
    "rejected": JobStatus.REJECTED,
    "closed": JobStatus.CLOSED,
    "expired": JobStatus.CLOSED,
    "not relevant": JobStatus.NOT_RELEVANT,
}


def _posted(value: str | None) -> date | None:
    """Only explicit dates count; "4 days ago" has no reliable reference date."""
    if not value:
        return None
    if d := _date(value):
        return d
    if m := MONTH_DATE.search(value):
        try:
            return datetime.strptime(
                f"{m.group(1)[:3]} {m.group(2)} {m.group(3)}", "%b %d %Y"
            ).date()
        except ValueError:
            return None
    return None


def _status(value: str | None) -> JobStatus:
    v = (value or "").lower()
    if "expired" in v or "closed" in v:
        return JobStatus.CLOSED
    if "to apply" in v:
        return JobStatus.NEW
    if v.startswith("resume-ready") or v.startswith("ready"):
        return JobStatus.READY_TO_APPLY
    if v.startswith("skipped"):
        return JobStatus.NOT_RELEVANT
    return next((s for k, s in STATUS_MAP.items() if v.startswith(k)), JobStatus.NEW)


def job_input_from_row(
    raw: dict[str, Any], source_label: str = "import", url_identifies_job: bool = True
) -> JobInput | None:
    """Map a CSV/JSON/Google-Sheet row (many column spellings) to a JobInput."""
    r = {_key(k): v for k, v in raw.items()}
    title = _first(r, "title", "job_title", "role", "position")
    company = _first(r, "company", "company_name", "employer")
    if not title or not company:
        return None
    salary = _first(r, "salary_ctc", "salary", "ctc", "compensation")
    if salary and salary.lower().startswith(("not ", "n/a", "undisclosed", "competitive")):
        salary = None
    workplace = _first(r, "work_model", "workplace_type", "workplace", "work_mode")
    sheet = {
        k: v
        for k, v in {
            "category": _first(r, "category", "priority"),
            "match_score": _first(r, "match_score", "score"),
            "key_match_factors": _first(r, "key_match_factors", "match_factors"),
            "posted_age": _first(r, "posted_age"),
            "status": _first(r, "status"),
            "alert_status": _first(r, "alert_status"),
            "sheet_id": _first(r, "job_id", "id"),
        }.items()
        if v
    }
    notes_parts = [_first(r, "notes", "apply_contact_notes", "apply_contact", "contact")]
    for col, label in (("tailored_resume_link", "Tailored resume"), ("base_resume", "Base resume"),
                       ("find_job_link_stable", "Find job"), ("find_job_link", "Find job")):
        if value := _first(r, col):
            notes_parts.append(f"{label}: {value}")
    if sheet.get("category") or sheet.get("match_score"):
        notes_parts.append(
            f"{source_label}: {sheet.get('category', '')} {sheet.get('match_score', '')}".strip()
        )
    if sheet.get("key_match_factors"):
        notes_parts.append(f"Key match factors (from {source_label}): {sheet['key_match_factors']}")
    if sheet.get("posted_age"):
        notes_parts.append(f"Posted: {sheet['posted_age']}")
    return JobInput(
        title=title,
        company_name=company,
        url=_first(r, "url", "source_url", "application_link", "job_url", "link", "apply_link"),
        source_detail=source_label,
        location=_first(r, "location", "city"),
        work_model=detect_work_model(workplace) if workplace else None,
        employment_type=_first(r, "employment_type", "job_type"),
        experience_min=_dec(r.get("experience_min")),
        experience_max=_dec(r.get("experience_max")),
        experience_text=_first(r, "experience_req", "experience", "experience_required"),
        salary_min=_dec(r.get("salary_min")),
        salary_max=_dec(r.get("salary_max")),
        salary_currency=_first(r, "salary_currency", "currency"),
        salary_text=salary,
        posting_date=_posted(_first(r, "posting_date", "date_posted", "posted_on"))
        or _posted(sheet.get("posted_age")),
        application_deadline=_date(r.get("application_deadline")),
        jd_text=_first(r, "original_jd", "jd", "description", "job_description") or "",
        required_skills=split_list(r.get("required_skills"), r"[;,|]") or None,
        preferred_skills=split_list(r.get("preferred_skills"), r"[;,|]") or None,
        notes="\n".join(p for p in notes_parts if p) or None,
        status=_status(sheet.get("status")),
        raw={"import": {"source": source_label, **sheet}} if sheet else {},
        origin="import",
        url_identifies_job=url_identifies_job,
    )


def import_jobs(
    db: Session, rows: list[dict[str, Any]], source_label: str = "import", origin: str = "import"
) -> dict[str, Any]:
    """`origin`: "sheet" (Google Sheets) or "import" (uploaded files) — the Added-via tag."""
    stats: dict[str, Any] = {
        "read": 0,
        "created": 0,
        "merged": 0,
        "skipped": 0,
        "listing_urls": 0,
        "errors": [],
    }
    # A URL shared by different (company, title) rows is a listing page, not a posting.
    owners: dict[str, set[tuple[str, str]]] = {}
    for raw in rows:
        r = {_key(k): v for k, v in raw.items()}
        url = _first(r, "url", "source_url", "application_link", "job_url", "link", "apply_link")
        if url:
            owners.setdefault(url, set()).add(
                (
                    (_first(r, "company", "company_name") or "").lower(),
                    (_first(r, "title", "job_title") or "").lower(),
                )
            )
    ids: list[int] = []
    for n, raw in enumerate(rows, 1):
        stats["read"] += 1
        data = job_input_from_row(raw, source_label)
        if data is None:
            stats["skipped"] += 1
            stats["errors"].append({"row": n, "error": "title and company are required"})
            continue
        data.origin = origin
        if data.url and (len(owners.get(data.url, set())) > 1 or is_listing_url(data.url)):
            data.url_identifies_job = False
            stats["listing_urls"] += 1
        try:
            with db.begin_nested():
                result = ingest_job(db, data, analyze=False, commit=False)
            stats["created" if result.created else "merged"] += 1
            ids.append(result.job.id)
        except DeletedJobError:
            stats["deleted_skipped"] = stats.get("deleted_skipped", 0) + 1
        except Exception as exc:  # noqa: BLE001 - report per-row errors, keep going
            stats["errors"].append({"row": n, "error": str(exc)[:300]})
    db.commit()
    from app.services.match_service import reanalyze

    stats["scored"] = reanalyze(db, only_stale=False, job_ids=sorted(set(ids)))["analyzed"]
    record_activity(
        db,
        "jobs.imported",
        "job",
        None,
        f"Imported jobs from {source_label}",
        {k: v for k, v in stats.items() if k != "errors"},
    )
    db.commit()
    return stats


def import_recruiters(db: Session, rows: list[dict[str, Any]]) -> dict[str, Any]:
    from app.schemas.company import ContactCreate

    stats: dict[str, Any] = {"read": 0, "created": 0, "errors": []}
    for n, raw in enumerate(rows, 1):
        r = {str(k).strip().lower().replace(" ", "_"): clean(v) for k, v in raw.items()}
        stats["read"] += 1
        try:
            body = ContactCreate.model_validate(
                {
                    "name": r.get("name"),
                    "company_name": r.get("company") or r.get("company_name"),
                    "job_title": r.get("job_title") or r.get("title"),
                    "linkedin_url": r.get("linkedin_url") or r.get("linkedin"),
                    "email": r.get("email"),
                    "source": r.get("source") or "import",
                    "location": r.get("location"),
                    "notes": r.get("notes"),
                }
            )
            save_contact(db, body.model_dump(exclude_none=True))
            stats["created"] += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            stats["errors"].append({"row": n, "error": str(exc)[:300]})
    return stats
