from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DB
from app.core.pagination import Page, PageParams, page_params
from app.db.session import get_sessionmaker
from app.matching.config import ScoringConfig
from app.models.activity_log import ActivityLog
from app.models.cv import CV
from app.models.job import Job
from app.schemas.job import (
    JobCreate,
    JobCreateOut,
    JobDetail,
    JobOut,
    JobPreviewIn,
    JobSourceOut,
    JobUpdate,
    MergeJobsIn,
    SourceIn,
    StatusIn,
)
from app.services import job_service, match_service
from app.services.job_service import JobFilters, JobInput

router = APIRouter(tags=["jobs"])


def _out(job: Job) -> JobOut:
    out = JobOut.model_validate(job)
    out.sources = sorted({s.source for s in job.source_links})
    return out


def detail(db: DB, job: Job) -> JobDetail:
    out = JobDetail.model_validate(job)
    out.sources = sorted({s.source for s in job.source_links})
    out.source_links = [JobSourceOut.model_validate(s) for s in job.source_links]
    match = match_service.current_match(db, job)
    out.match = match.result if match else None
    if job.recommended_cv_id and (cv := db.get(CV, job.recommended_cv_id)):
        out.recommended_cv = {
            "id": cv.id,
            "name": cv.name,
            "target_role": cv.target_role,
            "version_id": cv.current_version_id,
        }
    if job.recruiter_contact:
        r = job.recruiter_contact
        out.recruiter = {
            "id": r.id,
            "name": r.name,
            "email": r.email,
            "linkedin_url": r.linkedin_url,
            "status": r.status,
        }
    out.activity = [
        {"action": a.action, "summary": a.summary, "occurred_at": a.occurred_at, "data": a.data}
        for a in db.scalars(
            select(ActivityLog)
            .where(ActivityLog.entity_type == "job", ActivityLog.entity_id == job.id)
            .order_by(ActivityLog.occurred_at.desc())
            .limit(50)
        )
    ]
    co = [s.raw.get("career_ops") for s in job.source_links if s.raw.get("career_ops")]
    out.career_ops = co[0] if co else None
    return out


@router.post("/jobs/preview")
def preview(body: JobPreviewIn) -> dict[str, Any]:
    """Detect the source and parse a JD without saving anything."""
    return job_service.preview(body.url, body.jd, body.title)


@router.post("/jobs", response_model=JobCreateOut, status_code=201)
def create_job(db: DB, body: JobCreate) -> JobCreateOut:
    data = JobInput(
        title=body.title,
        company_name=body.company,
        url=body.url,
        source=body.source,
        location=body.location,
        work_model=body.work_model.value if body.work_model else None,
        employment_type=body.employment_type,
        experience_text=body.experience,
        experience_min=body.experience_min,
        experience_max=body.experience_max,
        salary_text=body.salary,
        salary_min=body.salary_min,
        salary_max=body.salary_max,
        salary_currency=body.salary_currency,
        posting_date=body.posting_date,
        application_deadline=body.application_deadline,
        jd_text=body.jd,
        responsibilities=body.responsibilities,
        required_skills=body.required_skills,
        preferred_skills=body.preferred_skills,
        qualifications=body.qualifications,
        notes=body.notes,
        recruiter_name=body.recruiter_name,
        recruiter_linkedin=body.recruiter_linkedin,
        recruiter_email=body.recruiter_email,
        origin="manual",
    )
    result = job_service.ingest_job(db, data)
    return JobCreateOut(
        job=detail(db, job_service.get_job(db, result.job.id)),
        created=result.created,
        duplicate_matched_by=result.matched_by,
    )


def job_filters(
    q: str | None = None,
    min_score: Annotated[int | None, Query(ge=0, le=100)] = None,
    max_score: Annotated[int | None, Query(ge=0, le=100)] = None,
    recommendation: str | None = None,
    company_id: int | None = None,
    tier: str | None = None,
    role: str | None = None,
    technology: str | None = None,
    location: str | None = None,
    work_model: str | None = None,
    source: str | None = None,
    posted_after: date | None = None,
    experience: float | None = None,
    salary_min: Decimal | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    closed: bool | None = None,
    added_via: Literal["manual", "sheet", "scanner", "career_ops", "file"] | None = None,
    stale: bool | None = None,
    has_application: bool | None = None,
    sort: Literal[
        "-match_score", "match_score", "title", "-title", "company", "-company",
        "location", "-location", "experience", "-experience", "salary", "-salary",
        "posting_date", "-posting_date", "status", "-status", "created_at", "-created_at",
        "id", "-id",
    ] = "-match_score",
) -> JobFilters:
    return JobFilters(
        q=q,
        min_score=min_score,
        max_score=max_score,
        recommendation=recommendation,
        company_id=company_id,
        tier=tier,
        role=role,
        technology=technology,
        location=location,
        work_model=work_model,
        source=source,
        posted_after=posted_after,
        experience=experience,
        salary_min=salary_min,
        status=status,
        closed=closed,
        added_via=added_via,
        stale=stale,
        has_application=has_application,
        sort=sort,
    )


JobFiltersDep = Annotated[JobFilters, Depends(job_filters)]


@router.get("/jobs/status-counts")
def job_status_counts(db: DB, f: JobFiltersDep) -> dict[str, int]:
    """Number of jobs per status for these filters (status/closed ignored) — for status tabs."""
    return job_service.status_counts(db, f)


@router.get("/jobs", response_model=Page[JobOut])
def list_jobs(
    db: DB, params: Annotated[PageParams, Depends(page_params)], f: JobFiltersDep
) -> Page[JobOut]:
    items, total = job_service.list_jobs(db, params, f)
    return Page(items=[_out(j) for j in items], total=total, page=params.page, size=params.size)


@router.get("/jobs/{job_id}", response_model=JobDetail)
def get_job(db: DB, job_id: int) -> JobDetail:
    return detail(db, job_service.get_job(db, job_id))


@router.patch("/jobs/{job_id}", response_model=JobDetail)
def update_job(db: DB, job_id: int, body: JobUpdate) -> JobDetail:
    changes = body.model_dump(exclude_unset=True)
    if "work_model" in changes and changes["work_model"] is not None:
        changes["work_model"] = changes["work_model"].value
    return detail(db, job_service.update_job(db, job_id, changes))


@router.delete("/jobs/{job_id}")
def delete_job(db: DB, job_id: int, force: bool = False) -> dict[str, Any]:
    """Delete a job. 409 (with counts) if it has applications/interviews/offers, unless `force`."""
    return job_service.delete_job(db, job_id, force=force)


@router.post("/jobs/{job_id}/status", response_model=JobDetail)
def set_status(db: DB, job_id: int, body: StatusIn) -> JobDetail:
    job_service.set_status(db, job_id, body.status, body.note)
    return detail(db, job_service.get_job(db, job_id))


@router.post("/jobs/{job_id}/sources", response_model=JobDetail)
def add_source(db: DB, job_id: int, body: SourceIn) -> JobDetail:
    return detail(db, job_service.add_source(db, job_id, body.url, body.source, body.detail))


@router.post("/jobs/{job_id}/merge", response_model=JobDetail)
def merge(db: DB, job_id: int, body: MergeJobsIn) -> JobDetail:
    return detail(db, job_service.merge_jobs(db, job_id, body.merge_id))


@router.post("/jobs/{job_id}/reparse", response_model=JobDetail)
def reparse(db: DB, job_id: int) -> JobDetail:
    return detail(db, job_service.reparse_job(db, job_id))


# --- matches ----------------------------------------------------------------------------------


@router.post("/matches/jobs/{job_id}", response_model=JobDetail)
def analyze(db: DB, job_id: int) -> JobDetail:
    """Re-analyze one job now."""
    job = job_service.get_job(db, job_id)
    match_service.analyze_job(db, job)
    db.commit()
    return detail(db, job_service.get_job(db, job_id))


@router.get("/matches/jobs/{job_id}/history")
def history(db: DB, job_id: int) -> list[dict[str, Any]]:
    return [
        {
            "id": m.id,
            "score": m.score,
            "recommendation": m.recommendation,
            "score_version": m.score_version,
            "profile_version": m.profile_version,
            "target_version": m.target_version,
            "inputs_hash": m.inputs_hash,
            "analyzed_at": m.analyzed_at,
        }
        for m in match_service.match_history(db, job_id)
    ]


class ReanalyzeIn(BaseModel):
    only_stale: bool = True
    job_ids: list[int] | None = None


def _reanalyze_in_background(only_stale: bool, job_ids: list[int] | None) -> None:
    with get_sessionmaker()() as db:
        match_service.reanalyze(db, only_stale=only_stale, job_ids=job_ids)


@router.post("/matches/reanalyze")
def reanalyze(
    db: DB, body: ReanalyzeIn, background: BackgroundTasks, wait: bool = False
) -> dict[str, Any]:
    """Re-analyze stale (or all / selected) jobs. Large runs continue in the background."""
    if wait or (body.job_ids is not None and len(body.job_ids) <= 200):
        return match_service.reanalyze(db, only_stale=body.only_stale, job_ids=body.job_ids)
    background.add_task(_reanalyze_in_background, body.only_stale, body.job_ids)
    return {"status": "started"}


@router.get("/settings/scoring")
def get_scoring(db: DB) -> dict[str, Any]:
    row, cfg = match_service.active_config(db)
    db.commit()
    return {"version": row.version, "config": cfg.model_dump(mode="json"), "note": row.note}


class ScoringIn(BaseModel):
    config: ScoringConfig
    note: str | None = None


@router.put("/settings/scoring")
def put_scoring(db: DB, body: ScoringIn) -> dict[str, Any]:
    row = match_service.save_config(db, body.config, body.note)
    return {"version": row.version, "config": row.config, "note": row.note}


@router.get("/settings/scoring/history")
def scoring_history(db: DB) -> list[dict[str, Any]]:
    return [
        {"version": r.version, "is_active": r.is_active, "note": r.note, "created_at": r.created_at}
        for r in match_service.config_history(db)
    ]
