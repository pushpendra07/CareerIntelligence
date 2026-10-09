from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query

from app.api.deps import DB
from app.core.pagination import Page, PageParams, page_params
from app.interviews.prep import build_prep
from app.models.interview import Interview, InterviewQuestion
from app.schemas.interview import (
    InterviewComplete,
    InterviewCreate,
    InterviewOut,
    InterviewUpdate,
    PracticeIn,
    QuestionIn,
    QuestionOut,
    QuestionUpdate,
)
from app.services import interview_service as svc
from app.services.interview_service import InterviewFilters
from app.services.job_service import get_job

router = APIRouter(tags=["interviews"])


def iv_out(iv: Interview) -> InterviewOut:
    out = InterviewOut.model_validate(iv)
    out.job_title = iv.job.title
    out.company_name = iv.company.name
    return out


def q_out(q: InterviewQuestion) -> QuestionOut:
    out = QuestionOut.model_validate(q)
    out.company_name = q.company.name if q.company else None
    return out


@router.post("/interviews", response_model=InterviewOut, status_code=201)
def schedule(db: DB, body: InterviewCreate) -> InterviewOut:
    data = body.model_dump(exclude_unset=True)
    data["round_type"] = body.round_type.value
    return iv_out(svc.schedule(db, data))


@router.get("/interviews", response_model=Page[InterviewOut])
def list_interviews(
    db: DB,
    params: Annotated[PageParams, Depends(page_params)],
    job_id: int | None = None,
    company_id: int | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    upcoming: bool | None = None,
    sort: Literal["scheduled_at", "-scheduled_at"] = "scheduled_at",
) -> Page[InterviewOut]:
    f = InterviewFilters(
        job_id=job_id, company_id=company_id, status=status, upcoming=upcoming, sort=sort
    )
    items, total = svc.list_interviews(db, params, f)
    return Page(items=[iv_out(i) for i in items], total=total, page=params.page, size=params.size)


@router.get("/interviews/{interview_id}", response_model=InterviewOut)
def get(db: DB, interview_id: int) -> InterviewOut:
    return iv_out(svc.get_interview(db, interview_id))


@router.patch("/interviews/{interview_id}", response_model=InterviewOut)
def update(db: DB, interview_id: int, body: InterviewUpdate) -> InterviewOut:
    changes = body.model_dump(exclude_unset=True)
    for key in ("round_type", "status", "result"):
        if changes.get(key) is not None:
            changes[key] = changes[key].value
    return iv_out(svc.update(db, interview_id, changes))


@router.post("/interviews/{interview_id}/complete", response_model=InterviewOut)
def complete(db: DB, interview_id: int, body: InterviewComplete) -> InterviewOut:
    return iv_out(svc.complete(db, interview_id, body.result, body.feedback, body.next_round))


@router.get("/interviews/{interview_id}/prep")
def interview_prep(db: DB, interview_id: int) -> dict[str, Any]:
    iv = svc.get_interview(db, interview_id)
    return build_prep(db, get_job(db, iv.job_id), iv)


@router.get("/jobs/{job_id}/prep")
def job_prep(db: DB, job_id: int) -> dict[str, Any]:
    return build_prep(db, get_job(db, job_id))


@router.get("/questions", response_model=Page[QuestionOut])
def list_questions(
    db: DB,
    params: Annotated[PageParams, Depends(page_params)],
    q: str | None = None,
    category: str | None = None,
    technology: str | None = None,
    company_id: int | None = None,
    difficulty: str | None = None,
    max_confidence: int | None = None,
    sort: Literal["-updated_at", "last_practiced", "confidence"] = "-updated_at",
) -> Page[QuestionOut]:
    items, total = svc.list_questions(
        db,
        params,
        q=q,
        category=category,
        technology=technology,
        company_id=company_id,
        difficulty=difficulty,
        max_confidence=max_confidence,
        sort=sort,
    )
    return Page(items=[q_out(x) for x in items], total=total, page=params.page, size=params.size)


@router.post("/questions", response_model=QuestionOut, status_code=201)
def create_question(db: DB, body: QuestionIn) -> QuestionOut:
    data = body.model_dump(exclude_unset=True)
    if body.round_type is not None:
        data["round_type"] = body.round_type.value
    data["category"] = body.category
    return q_out(svc.save_question(db, data))


@router.get("/questions/{question_id}", response_model=QuestionOut)
def get_question(db: DB, question_id: int) -> QuestionOut:
    return q_out(svc.get_question(db, question_id))


@router.patch("/questions/{question_id}", response_model=QuestionOut)
def update_question(db: DB, question_id: int, body: QuestionUpdate) -> QuestionOut:
    return q_out(svc.save_question(db, body.model_dump(exclude_unset=True), question_id))


@router.post("/questions/{question_id}/practice", response_model=QuestionOut)
def practice(db: DB, question_id: int, body: PracticeIn) -> QuestionOut:
    return q_out(svc.practice(db, question_id, body.confidence, body.my_answer))
