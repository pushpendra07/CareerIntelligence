from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import DomainValidationError, NotFoundError
from app.core.pagination import PageParams, paginate
from app.models.application import Application, ApplicationStatus
from app.models.interview import (
    Interview,
    InterviewQuestion,
    InterviewResult,
    InterviewStatus,
    RoundType,
)
from app.models.job import Job, JobStatus
from app.services.activity import record_activity
from app.skills.catalog import normalize_skill


def _load(db: Session, interview_id: int) -> Interview:
    iv = db.scalar(
        select(Interview)
        .options(
            selectinload(Interview.job),
            selectinload(Interview.company),
            selectinload(Interview.interviewer),
        )
        .where(Interview.id == interview_id)
    )
    if iv is None:
        raise NotFoundError(f"Interview {interview_id} not found")
    return iv


get_interview = _load


def schedule(db: Session, data: dict[str, Any]) -> Interview:
    job = db.get(Job, data["job_id"])
    if job is None:
        raise NotFoundError(f"Job {data['job_id']} not found")
    app_id = data.get("application_id")
    if app_id is None:
        app_id = db.scalar(
            select(Application.id)
            .where(Application.job_id == job.id)
            .order_by(Application.id.desc())
            .limit(1)
        )
    app = db.get(Application, app_id) if app_id else None
    if app_id and app is None:
        raise DomainValidationError(f"Application {app_id} not found")
    if data.get("round_number") is None:
        count = (
            db.scalar(select(func.count()).select_from(Interview).where(Interview.job_id == job.id))
            or 0
        )
        data["round_number"] = count + 1
    iv = Interview(**{**data, "application_id": app_id, "company_id": job.company_id})
    db.add(iv)
    db.flush()
    if app is not None and app.status in (
        ApplicationStatus.APPLIED,
        ApplicationStatus.RECRUITER_CONTACTED,
        ApplicationStatus.SCREENING,
    ):
        from app.services.application_service import change_status

        db.commit()
        change_status(db, app.id, ApplicationStatus.INTERVIEW, f"Round {iv.round_number} scheduled")
    elif job.status not in (JobStatus.INTERVIEW, JobStatus.OFFER, JobStatus.ACCEPTED):
        from app.services.job_service import set_status

        set_status(db, job.id, JobStatus.INTERVIEW, "interview scheduled", commit=False)
    record_activity(
        db,
        "interview.scheduled",
        "interview",
        iv.id,
        f"Round {iv.round_number} {iv.round_type}: {job.title}",
        {"job_id": job.id, "scheduled_at": str(iv.scheduled_at)},
    )
    db.commit()
    return _load(db, iv.id)


def update(db: Session, interview_id: int, changes: dict[str, Any]) -> Interview:
    iv = _load(db, interview_id)
    before = iv.status
    for k, v in changes.items():
        setattr(iv, k, v)
    if (
        "scheduled_at" in changes
        and before == InterviewStatus.SCHEDULED
        and "status" not in changes
    ):
        iv.status = InterviewStatus.RESCHEDULED.value
    completed = iv.status == InterviewStatus.COMPLETED and before != InterviewStatus.COMPLETED
    record_activity(
        db,
        "interview.completed" if completed else "interview.updated",
        "interview",
        iv.id,
        f"Round {iv.round_number}: {iv.status}",
        {"result": iv.result, "fields": sorted(changes)},
    )
    db.commit()
    return _load(db, interview_id)


def complete(
    db: Session,
    interview_id: int,
    result: InterviewResult,
    feedback: str | None,
    next_round: str | None,
) -> Interview:
    return update(
        db,
        interview_id,
        {
            "status": InterviewStatus.COMPLETED.value,
            "result": result.value,
            **({"feedback": feedback} if feedback is not None else {}),
            **({"next_round": next_round} if next_round is not None else {}),
        },
    )


@dataclass
class InterviewFilters:
    job_id: int | None = None
    company_id: int | None = None
    status: list[str] | None = None
    upcoming: bool | None = None
    sort: str = "scheduled_at"


def list_interviews(
    db: Session, params: PageParams, f: InterviewFilters
) -> tuple[list[Interview], int]:
    stmt: Select[Any] = select(Interview).options(
        selectinload(Interview.job),
        selectinload(Interview.company),
        selectinload(Interview.interviewer),
    )
    if f.job_id:
        stmt = stmt.where(Interview.job_id == f.job_id)
    if f.company_id:
        stmt = stmt.where(Interview.company_id == f.company_id)
    if f.status:
        stmt = stmt.where(Interview.status.in_(f.status))
    if f.upcoming:
        stmt = stmt.where(
            Interview.scheduled_at >= datetime.now(UTC),
            Interview.status.in_(
                [InterviewStatus.SCHEDULED.value, InterviewStatus.RESCHEDULED.value]
            ),
        )
    order = (
        Interview.scheduled_at.desc().nulls_last()
        if f.sort == "-scheduled_at"
        else Interview.scheduled_at.asc().nulls_last()
    )
    return paginate(db, stmt.order_by(order, Interview.id), params)


# --- question bank -------------------------------------------------------------------------


def save_question(
    db: Session, data: dict[str, Any], question_id: int | None = None
) -> InterviewQuestion:
    if data.get("technology"):
        data["technology"] = normalize_skill(data["technology"]) or data["technology"].strip()
    if question_id is None:
        q = InterviewQuestion(**data)
        db.add(q)
        db.flush()
        record_activity(db, "question.created", "interview_question", q.id, q.question[:120])
    else:
        q = get_question(db, question_id)
        for k, v in data.items():
            setattr(q, k, v)
    db.commit()
    return get_question(db, q.id)


def get_question(db: Session, question_id: int) -> InterviewQuestion:
    q = db.scalar(
        select(InterviewQuestion)
        .options(selectinload(InterviewQuestion.company))
        .where(InterviewQuestion.id == question_id)
    )
    if q is None:
        raise NotFoundError(f"Question {question_id} not found")
    return q


def practice(
    db: Session, question_id: int, confidence: int | None, my_answer: str | None
) -> InterviewQuestion:
    q = get_question(db, question_id)
    q.times_practiced += 1
    q.last_practiced_at = datetime.now(UTC)
    if confidence is not None:
        q.confidence = confidence
    if my_answer is not None:
        q.my_answer = my_answer
    db.commit()
    return get_question(db, question_id)


def list_questions(
    db: Session,
    params: PageParams,
    *,
    q: str | None = None,
    category: str | None = None,
    technology: str | None = None,
    company_id: int | None = None,
    difficulty: str | None = None,
    max_confidence: int | None = None,
    sort: str = "-updated_at",
) -> tuple[list[InterviewQuestion], int]:
    stmt: Select[Any] = select(InterviewQuestion).options(selectinload(InterviewQuestion.company))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(InterviewQuestion.question.ilike(like), InterviewQuestion.notes.ilike(like))
        )
    if category:
        stmt = stmt.where(InterviewQuestion.category == category)
    if technology:
        stmt = stmt.where(
            InterviewQuestion.technology == (normalize_skill(technology) or technology)
        )
    if company_id:
        stmt = stmt.where(InterviewQuestion.company_id == company_id)
    if difficulty:
        stmt = stmt.where(InterviewQuestion.difficulty == difficulty)
    if max_confidence is not None:
        stmt = stmt.where(
            or_(
                InterviewQuestion.confidence.is_(None),
                InterviewQuestion.confidence <= max_confidence,
            )
        )
    order: dict[str, Any] = {
        "-updated_at": InterviewQuestion.updated_at.desc(),
        "last_practiced": InterviewQuestion.last_practiced_at.asc().nulls_first(),
        "confidence": InterviewQuestion.confidence.asc().nulls_first(),
    }
    return paginate(
        db, stmt.order_by(order.get(sort, order["-updated_at"]), InterviewQuestion.id), params
    )


__all__ = ["RoundType", "complete", "list_interviews", "schedule"]
