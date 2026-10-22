from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.api.deps import DB
from app.core.errors import NotFoundError
from app.models.application import ApplicationMethod
from app.services import apply_service

router = APIRouter(tags=["apply"])


class AnswerIn(BaseModel):
    question: str = Field(max_length=500)
    answer: str = Field(default="", max_length=5000)


class ApplyAnswersIn(BaseModel):
    current_ctc: str = ""
    expected_ctc: str = ""
    notice_period: str = ""
    relocate: str = ""
    work_authorization: str = ""
    github: str = ""
    portfolio: str = ""
    current_company: str = ""
    current_title: str = ""
    answers: list[AnswerIn] = Field(default_factory=list, max_length=100)


class AppliedIn(BaseModel):
    method: ApplicationMethod = ApplicationMethod.COMPANY_SITE
    cv_version_id: int | None = None
    note: str | None = Field(default=None, max_length=2000)


@router.get("/apply/answers")
def get_answers(db: DB) -> dict[str, Any]:
    """Answers saved once and used on every application form (CTC, notice period, …)."""
    return apply_service.get_answers(db)


@router.put("/apply/answers")
def save_answers(db: DB, body: ApplyAnswersIn) -> dict[str, Any]:
    return apply_service.save_answers(db, body.model_dump())


@router.get("/apply/kit")
def kit_without_job(db: DB) -> dict[str, Any]:
    """Your details and answers only (an application form for a job not in your list)."""
    return apply_service.kit(db, None)


@router.get("/apply/lookup")
def lookup(db: DB, url: str = Query(min_length=8, max_length=2000)) -> dict[str, Any]:
    """The job in your list that a posting or its application form belongs to."""
    found = apply_service.lookup(db, url)
    if found is None:
        raise NotFoundError("No job in your list has this link")
    return found


@router.get("/jobs/{job_id}/apply-kit")
def job_kit(db: DB, job_id: int) -> dict[str, Any]:
    """Everything the application form for this job asks for: your details, saved answers, the
    CV to send, a cover note and the HR email when there's a contact. Nothing is sent."""
    return apply_service.kit(db, job_id)


@router.post("/jobs/{job_id}/applied")
def applied(db: DB, job_id: int, body: AppliedIn) -> dict[str, Any]:
    """You submitted the application: record it (job → Applied, follow-up planned)."""
    return apply_service.record(db, job_id, body.method.value, body.cv_version_id, body.note)
