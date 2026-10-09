"""The single job pipeline: normalize -> deduplicate -> parse JD -> (analyze).

Manual entry, Career-Ops import and any future source all go through `ingest_job`.
"""

import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, String, cast, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, selectinload

from app.core.errors import DomainValidationError, NotFoundError
from app.core.pagination import PageParams, paginate
from app.core.text import clean, title_key
from app.core.urls import (
    AGGREGATORS,
    JobSource,
    detect_source,
    is_http_url,
    is_listing_url,
    normalize_url,
)
from app.jobs import dedup
from app.jobs.jd_parser import (
    ParsedJD,
    detect_seniority,
    detect_work_model,
    parse_experience,
    parse_jd,
    parse_salary,
)
from app.models.company import Company, Contact
from app.models.job import Job, JobSourceLink, JobStatus, WorkModel
from app.services.activity import record_activity
from app.services.company_service import find_or_create_by_name
from app.skills.catalog import normalize_skill_list

logger = logging.getLogger(__name__)

PARSED_FIELDS = (
    "experience_min",
    "experience_max",
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_text",
    "work_model",
    "employment_type",
    "responsibilities",
    "required_skills",
    "preferred_skills",
    "qualifications",
    "locations",
    "seniority",
)


@dataclass
class JobInput:
    title: str
    company_name: str
    url: str | None = None
    source: JobSource | None = None  # explicit override; otherwise detected from the URL
    source_detail: str | None = None
    external_id: str | None = None
    location: str | None = None
    work_model: str | None = None
    employment_type: str | None = None
    experience_min: Decimal | None = None
    experience_max: Decimal | None = None
    experience_text: str | None = None
    salary_min: Decimal | None = None
    salary_max: Decimal | None = None
    salary_currency: str | None = None
    salary_text: str | None = None
    posting_date: date | None = None
    application_deadline: date | None = None
    jd_text: str = ""
    responsibilities: list[str] | None = None
    required_skills: list[str] | None = None
    preferred_skills: list[str] | None = None
    qualifications: list[str] | None = None
    notes: str | None = None
    recruiter_name: str | None = None
    recruiter_linkedin: str | None = None
    recruiter_email: str | None = None
    status: JobStatus = JobStatus.NEW
    raw: dict[str, Any] = field(default_factory=dict)
    origin: str = "manual"  # "manual" | "career_ops" | "import"
    # False for search/listing pages: kept as provenance, never used to identify the job.
    url_identifies_job: bool = True


@dataclass
class IngestResult:
    job: Job
    created: bool
    matched_by: str | None = None  # how a duplicate was recognised


def preview(url: str | None, jd_text: str, title: str | None = None) -> dict[str, Any]:
    detected = detect_source(url) if url else None
    parsed = parse_jd(jd_text, title)
    return {
        "source": detected.source.value if detected else None,
        "external_id": detected.external_id if detected else None,
        "normalized_url": normalize_url(url) if url and is_http_url(url) else None,
        "is_aggregator": bool(detected and detected.source in AGGREGATORS),
        "parsed": parsed.model_dump(mode="json"),
    }


def _manual_values(data: JobInput) -> dict[str, Any]:
    """Fields the user stated explicitly (they beat anything parsed from the JD)."""
    values: dict[str, Any] = {}
    if data.experience_text and data.experience_min is None:
        lo, hi, _ = parse_experience(data.experience_text)
        data.experience_min = Decimal(str(lo)) if lo is not None else None
        data.experience_max = Decimal(str(hi)) if hi is not None else None
    if data.salary_text and data.salary_min is None:
        lo_s, hi_s, cur, _ = parse_salary(data.salary_text)
        if lo_s is None and (digits := clean(data.salary_text)):
            lo_s, hi_s, cur, _ = parse_salary(f"CTC {digits}")
        data.salary_min, data.salary_max = lo_s, hi_s
        data.salary_currency = data.salary_currency or cur
    for name in (
        "experience_min",
        "experience_max",
        "salary_min",
        "salary_max",
        "salary_currency",
        "salary_text",
        "employment_type",
    ):
        if (v := getattr(data, name)) not in (None, ""):
            values[name] = v
    if data.work_model and data.work_model != WorkModel.UNKNOWN:
        values["work_model"] = WorkModel(data.work_model).value
    for name in ("required_skills", "preferred_skills"):
        if v := getattr(data, name):
            values[name] = normalize_skill_list(v)
    for name in ("responsibilities", "qualifications"):
        if v := getattr(data, name):
            values[name] = [x.strip() for x in v if x.strip()]
    if data.location:
        values["location"] = data.location.strip()
    return values


def _apply_parsed(job: Job, parsed: ParsedJD) -> None:
    job.parsed_jd = parsed.model_dump(mode="json")
    manual = set(job.manual_fields)
    mapping: dict[str, Any] = {
        "experience_min": Decimal(str(parsed.experience_min))
        if parsed.experience_min is not None
        else None,
        "experience_max": Decimal(str(parsed.experience_max))
        if parsed.experience_max is not None
        else None,
        "salary_min": parsed.salary_min,
        "salary_max": parsed.salary_max,
        "salary_currency": parsed.salary_currency,
        "salary_text": parsed.salary_text,
        "work_model": parsed.work_model or WorkModel.UNKNOWN.value,
        "employment_type": parsed.employment_type,
        "responsibilities": parsed.responsibilities,
        "required_skills": parsed.required_skills,
        "preferred_skills": parsed.preferred_skills,
        "qualifications": parsed.qualifications,
        "locations": parsed.locations,
        "seniority": parsed.seniority,
    }
    for name, value in mapping.items():
        if name in manual:
            continue
        current = getattr(job, name)
        # Parsed data never erases a value an importer already supplied.
        if value in (None, [], "") and current not in (None, [], "", WorkModel.UNKNOWN.value):
            continue
        setattr(job, name, value)
    if job.work_model in (None, WorkModel.UNKNOWN.value) and job.location:
        # Importers often carry "Bengaluru, India (Hybrid)" in the location, not the JD.
        job.work_model = detect_work_model(job.location) or WorkModel.UNKNOWN.value
    if job.location and not job.locations:
        job.locations = [job.location]
    if not job.location and job.locations:
        job.location = ", ".join(job.locations[:3])
    job.jd_status = "OK" if job.original_jd.strip() else "MISSING"


def find_duplicate(
    db: Session,
    company: Company,
    data: JobInput,
    normalized: str | None,
    source: JobSource,
    external_id: str | None,
) -> tuple[Job | None, str | None]:
    if normalized:
        link = db.scalar(select(JobSourceLink).where(JobSourceLink.normalized_url == normalized))
        if link:
            return db.get(Job, link.job_id), "url"
    if external_id:
        link = db.scalar(
            select(JobSourceLink).where(
                JobSourceLink.source == source.value, JobSourceLink.external_id == external_id
            )
        )
        if link:
            return db.get(Job, link.job_id), "external_id"
    if company.id is None:
        return None, None
    candidates = list(
        db.scalars(
            select(Job)
            .options(selectinload(Job.source_links))
            .where(Job.company_id == company.id)
            .order_by(Job.id.desc())
            .limit(200)
        )
    )
    new_locs = [data.location] if data.location else []
    new_req = dedup.requisition_id(data.jd_text) or dedup.requisition_id(data.notes)
    for job in candidates:
        if (
            job.status in (JobStatus.CLOSED, JobStatus.NOT_RELEVANT)
            and job.posting_date
            and data.posting_date
            and (data.posting_date - job.posting_date).days > 60
        ):
            continue
        old_req = dedup.requisition_id(job.original_jd) or dedup.requisition_id(job.notes)
        if new_req and old_req and new_req != old_req:
            continue  # two different requisitions
        if (
            external_id
            and source in AGGREGATORS
            and any(
                s.source == source.value and s.external_id and s.external_id != external_id
                for s in job.source_links
            )
        ):
            continue  # same aggregator, different posting ids => different openings
        same_title = job.normalized_title == title_key(data.title)
        locs_ok = dedup.locations_compatible(
            job.locations or ([job.location] if job.location else []), new_locs
        )
        dates_ok = dedup.dates_compatible(job.posting_date, data.posting_date)
        if same_title and locs_ok and dates_ok:
            return job, "company_title_location"
        if (
            dedup.title_similarity(job.title, data.title) >= 0.85
            and data.jd_text
            and job.original_jd
            and dedup.jd_similarity(job.original_jd, data.jd_text) >= 0.8
        ):
            return job, "similar_jd"
    return None, None


def _attach_source(
    job: Job, source: JobSource, data: JobInput, normalized: str | None, external_id: str | None
) -> None:
    now = datetime.now(UTC)
    for link in job.source_links:
        if (
            (normalized and link.normalized_url == normalized)
            or (external_id and link.source == source.value and link.external_id == external_id)
            or (
                not normalized
                and not external_id
                and link.source == source.value
                and not link.normalized_url
            )
        ):
            link.last_seen_at = now
            if data.raw:
                link.raw = {**link.raw, **data.raw}
            return
    job.source_links.append(
        JobSourceLink(
            source=source.value,
            original_url=data.url,
            normalized_url=normalized,
            external_id=external_id,
            detail=data.source_detail,
            raw=data.raw,
            first_seen_at=now,
            last_seen_at=now,
        )
    )


def _recruiter(db: Session, company: Company, data: JobInput) -> Contact | None:
    if not (data.recruiter_name or data.recruiter_email or data.recruiter_linkedin):
        return None
    from app.services.company_service import save_contact

    existing = None
    if data.recruiter_email:
        existing = db.scalar(select(Contact).where(Contact.email == data.recruiter_email.lower()))
    if existing is None and data.recruiter_linkedin:
        existing = db.scalar(select(Contact).where(Contact.linkedin_url == data.recruiter_linkedin))
    if existing:
        return existing
    payload = {
        "name": data.recruiter_name or data.recruiter_email or "Recruiter",
        "company_id": company.id,
        "email": data.recruiter_email,
        "linkedin_url": data.recruiter_linkedin,
        "source": data.origin,
        "contact_type": "RECRUITER",
    }
    return save_contact(db, {k: v for k, v in payload.items() if v is not None})


def ingest_job(
    db: Session, data: JobInput, *, analyze: bool = True, commit: bool = True
) -> IngestResult:
    title = (data.title or "").strip()
    if not title:
        raise DomainValidationError("Job title is required")
    if not (data.company_name or "").strip():
        raise DomainValidationError("Company is required")
    if data.url and not is_http_url(data.url):
        raise DomainValidationError("Job URL must be an http(s) URL")
    detected = detect_source(data.url) if data.url else None
    source = data.source or (detected.source if detected else JobSource.OTHER)
    identifies = bool(data.url) and data.url_identifies_job and not is_listing_url(data.url or "")
    normalized = normalize_url(data.url) if data.url and identifies else None
    external_id = data.external_id or (detected.external_id if detected and identifies else None)
    company = find_or_create_by_name(db, data.company_name)
    manual = _manual_values(data) if data.origin in ("manual", "import") else {}

    existing, matched_by = find_duplicate(db, company, data, normalized, source, external_id)
    if existing is not None:
        job = existing
        _attach_source(job, source, data, normalized, external_id)
        changed = False
        if data.jd_text.strip() and not job.original_jd.strip():
            job.original_jd = data.jd_text
            changed = True
        for name in ("posting_date", "application_deadline"):
            if getattr(job, name) is None and getattr(data, name):
                setattr(job, name, getattr(data, name))
        for name, value in manual.items():
            if getattr(job, name) in (None, [], "", WorkModel.UNKNOWN.value):
                setattr(job, name, value)
                job.manual_fields = sorted({*job.manual_fields, name})
                changed = True
        if data.notes and data.notes not in (job.notes or ""):
            job.notes = "\n".join(filter(None, [job.notes, data.notes]))
        if changed:
            _apply_parsed(job, parse_jd(job.original_jd, job.title))
        record_activity(
            db,
            "job.source_added",
            "job",
            job.id,
            f"Same job found via {source.value}",
            {"source": source.value, "matched_by": matched_by, "url": data.url},
        )
        result = IngestResult(job, created=False, matched_by=matched_by)
    else:
        job = Job(
            company=company,
            company_id=company.id,
            title=title,
            normalized_title=title_key(title),
            source=source.value,
            source_url=data.url,
            external_id=external_id,
            location=manual.get("location") or clean(data.location),
            posting_date=data.posting_date,
            application_deadline=data.application_deadline,
            original_jd=data.jd_text or "",
            notes=data.notes,
            status=data.status.value,
            status_changed_at=datetime.now(UTC),
            manual_fields=sorted(manual),
            locations=[],
            responsibilities=[],
            required_skills=[],
            preferred_skills=[],
            qualifications=[],
            parsed_jd={},
            work_model=WorkModel.UNKNOWN.value,
            dedup_key="",
        )
        if data.origin != "manual":
            for name in (
                "experience_min",
                "experience_max",
                "salary_min",
                "salary_max",
                "salary_currency",
                "salary_text",
                "employment_type",
            ):
                if (v := getattr(data, name)) is not None:
                    setattr(job, name, v)
            if data.work_model:
                job.work_model = data.work_model
        for name, value in manual.items():
            setattr(job, name, value)
        db.add(job)
        _attach_source(job, source, data, normalized, external_id)
        _apply_parsed(job, parse_jd(job.original_jd, title))
        job.seniority = job.seniority or detect_seniority(title)
        db.flush()
        action = "job.manually_added" if data.origin == "manual" else "job.imported"
        record_activity(
            db,
            action,
            "job",
            job.id,
            f"{title} at {company.name}",
            {"source": source.value, "url": data.url},
        )
        result = IngestResult(job, created=True)

    job.dedup_key = dedup.dedup_key(company.id, job.title, job.locations, job.location)
    if (contact := _recruiter(db, company, data)) and job.recruiter_contact_id is None:
        job.recruiter_contact_id = contact.id
    db.flush()
    if analyze:
        from app.services.match_service import analyze_job

        analyze_job(db, job)
    if commit:
        db.commit()
    return result


# --- reads -------------------------------------------------------------------------------


def get_job(db: Session, job_id: int) -> Job:
    job = db.scalar(
        select(Job)
        .options(
            selectinload(Job.source_links),
            selectinload(Job.company),
            selectinload(Job.recruiter_contact),
        )
        .where(Job.id == job_id)
    )
    if job is None:
        raise NotFoundError(f"Job {job_id} not found")
    return job


@dataclass
class JobFilters:
    q: str | None = None
    min_score: int | None = None
    max_score: int | None = None
    recommendation: str | None = None
    company_id: int | None = None
    tier: str | None = None
    role: str | None = None
    technology: str | None = None
    location: str | None = None
    work_model: str | None = None
    source: str | None = None
    posted_after: date | None = None
    experience: float | None = None
    salary_min: Decimal | None = None
    status: list[str] | None = None
    closed: bool | None = None  # True: only closed positions; False: hide them
    stale: bool | None = None
    has_application: bool | None = None
    sort: str = "-match_score"


SORTS: dict[str, Any] = {
    "-match_score": (Job.match_score.desc().nulls_last(), Job.id.desc()),
    "-posting_date": (Job.posting_date.desc().nulls_last(), Job.id.desc()),
    "posting_date": (Job.posting_date.asc().nulls_last(), Job.id),
    "company": (Company.name.asc(), Job.id),
    "-salary": (Job.salary_max.desc().nulls_last(), Job.id.desc()),
    "experience": (Job.experience_min.asc().nulls_last(), Job.id),
    "-created_at": (Job.created_at.desc(), Job.id.desc()),
}


def list_jobs(db: Session, params: PageParams, f: JobFilters) -> tuple[list[Job], int]:
    from app.skills.catalog import normalize_skill

    stmt: Select[Any] = (
        select(Job)
        .join(Company, Job.company_id == Company.id)
        .options(selectinload(Job.company), selectinload(Job.source_links))
    )
    if f.q:
        like = f"%{f.q.strip()}%"
        stmt = stmt.where(
            or_(Job.title.ilike(like), Company.name.ilike(like), Job.location.ilike(like))
        )
    if f.min_score is not None:
        stmt = stmt.where(Job.match_score >= f.min_score)
    if f.max_score is not None:
        stmt = stmt.where(Job.match_score <= f.max_score)
    if f.recommendation:
        stmt = stmt.where(Job.recommendation == f.recommendation)
    if f.company_id:
        stmt = stmt.where(Job.company_id == f.company_id)
    if f.tier:
        stmt = stmt.where(Company.tier == f.tier)
    if f.role:
        stmt = stmt.where(Job.title.ilike(f"%{f.role.strip()}%"))
    if f.technology:
        skill = normalize_skill(f.technology) or f.technology
        stmt = stmt.where(
            or_(
                Job.required_skills.contains(cast([skill], JSONB)),
                Job.preferred_skills.contains(cast([skill], JSONB)),
            )
        )
    if f.location:
        like = f"%{f.location.strip()}%"
        stmt = stmt.where(or_(Job.location.ilike(like), cast(Job.locations, String).ilike(like)))
    if f.work_model:
        stmt = stmt.where(Job.work_model == f.work_model)
    if f.source:
        stmt = stmt.where(Job.source_links.any(JobSourceLink.source == f.source))
    if f.posted_after:
        stmt = stmt.where(Job.posting_date >= f.posted_after)
    if f.experience is not None:
        stmt = stmt.where(or_(Job.experience_min.is_(None), Job.experience_min <= f.experience))
        stmt = stmt.where(or_(Job.experience_max.is_(None), Job.experience_max >= f.experience - 2))
    if f.salary_min is not None:
        stmt = stmt.where(or_(Job.salary_max.is_(None), Job.salary_max >= f.salary_min))
    if f.status:
        stmt = stmt.where(Job.status.in_(f.status))
    if f.closed is not None:
        closed = Job.status == JobStatus.CLOSED.value
        stmt = stmt.where(closed if f.closed else ~closed)
    if f.stale is not None:
        stmt = stmt.where(Job.score_stale.is_(f.stale))
    if f.has_application is not None:
        from app.models.application import Application

        exists = select(Application.id).where(Application.job_id == Job.id).exists()
        stmt = stmt.where(exists if f.has_application else ~exists)
    stmt = stmt.order_by(*SORTS.get(f.sort, SORTS["-match_score"]))
    return paginate(db, stmt, params)


# --- writes ------------------------------------------------------------------------------

EDITABLE = {
    "title",
    "location",
    "work_model",
    "employment_type",
    "experience_min",
    "experience_max",
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_text",
    "posting_date",
    "application_deadline",
    "original_jd",
    "responsibilities",
    "required_skills",
    "preferred_skills",
    "qualifications",
    "notes",
}


def update_job(db: Session, job_id: int, changes: dict[str, Any]) -> Job:
    job = get_job(db, job_id)
    unknown = set(changes) - EDITABLE
    if unknown:
        raise DomainValidationError(f"Fields not editable: {sorted(unknown)}")
    manual = set(job.manual_fields)
    for name, value in changes.items():
        if name in ("required_skills", "preferred_skills") and value is not None:
            value = normalize_skill_list(value)
        setattr(job, name, value)
        if name not in ("original_jd", "notes", "title", "posting_date", "application_deadline"):
            manual.add(name)
    job.manual_fields = sorted(manual)
    if "title" in changes:
        job.normalized_title = title_key(job.title)
    if {"original_jd", "title"} & set(changes):
        _apply_parsed(job, parse_jd(job.original_jd, job.title))
    job.dedup_key = dedup.dedup_key(job.company_id, job.title, job.locations, job.location)
    record_activity(db, "job.updated", "job", job.id, job.title, {"fields": sorted(changes)})
    from app.services.match_service import analyze_job

    analyze_job(db, job)
    db.commit()
    return get_job(db, job_id)


def reparse_job(db: Session, job_id: int) -> Job:
    job = get_job(db, job_id)
    _apply_parsed(job, parse_jd(job.original_jd, job.title))
    from app.services.match_service import analyze_job

    analyze_job(db, job)
    db.commit()
    return get_job(db, job_id)


STATUS_ACTIONS = {
    JobStatus.SHORTLISTED: "job.shortlisted",
    JobStatus.APPLIED: "job.applied",
    JobStatus.REJECTED: "job.rejected",
    JobStatus.OFFER: "job.offer",
}


def set_status(
    db: Session, job_id: int, status: JobStatus, note: str | None = None, commit: bool = True
) -> Job:
    job = get_job(db, job_id)
    if job.status == status.value:
        return job
    before = job.status
    job.status = status.value
    job.status_changed_at = datetime.now(UTC)
    record_activity(
        db,
        STATUS_ACTIONS.get(status, "job.status_changed"),
        "job",
        job.id,
        f"{before} → {status.value}",
        {"from": before, "to": status.value, "note": note},
    )
    if commit:
        db.commit()
    return job


def add_source(
    db: Session, job_id: int, url: str, source: JobSource | None = None, detail: str | None = None
) -> Job:
    job = get_job(db, job_id)
    if not is_http_url(url):
        raise DomainValidationError("Source URL must be an http(s) URL")
    normalized = normalize_url(url)
    clash = db.scalar(select(JobSourceLink).where(JobSourceLink.normalized_url == normalized))
    if clash and clash.job_id != job.id:
        raise DomainValidationError(
            f"That URL already belongs to job {clash.job_id}; merge the jobs instead"
        )
    detected = detect_source(url)
    _attach_source(
        job,
        source or detected.source,
        JobInput(title=job.title, company_name="", url=url, source_detail=detail),
        normalized,
        detected.external_id,
    )
    record_activity(db, "job.source_added", "job", job.id, url, {"source": detected.source})
    db.commit()
    return get_job(db, job_id)


def merge_jobs(db: Session, keep_id: int, merge_id: int) -> Job:
    if keep_id == merge_id:
        raise DomainValidationError("Cannot merge a job into itself")
    keep, other = get_job(db, keep_id), get_job(db, merge_id)
    for link in list(other.source_links):
        other.source_links.remove(link)
        keep.source_links.append(link)
    if not keep.original_jd.strip() and other.original_jd.strip():
        keep.original_jd = other.original_jd
        _apply_parsed(keep, parse_jd(keep.original_jd, keep.title))
    keep.notes = "\n".join(filter(None, [keep.notes, other.notes])) or None
    db.flush()
    for table in Job.metadata.sorted_tables:
        for column in table.columns:
            for fk in column.foreign_keys:
                if fk.column.table.name == "jobs" and table.name != "job_sources":
                    db.execute(
                        table.update().where(column == other.id).values({column.name: keep.id})
                    )
    db.delete(other)
    record_activity(
        db, "job.merged", "job", keep.id, f"Merged job {merge_id}", {"merged_id": merge_id}
    )
    from app.services.match_service import analyze_job

    analyze_job(db, keep)
    db.commit()
    return get_job(db, keep_id)


def job_counts_by(db: Session, column: Any, where: Any = None) -> dict[str, int]:
    stmt = select(column, func.count()).select_from(Job)
    if where is not None:
        stmt = stmt.where(where)
    return {str(k): v for k, v in db.execute(stmt.group_by(column)).all()}
