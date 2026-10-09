from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.urls import ensure_scheme, is_http_url
from app.models.interview import InterviewResult, InterviewStatus, RoundType

QUESTION_CATEGORIES = [
    "PHP",
    "Magento 2",
    "Adobe Commerce",
    "MySQL",
    "GraphQL",
    "REST",
    "System Design",
    "Coding",
    "AWS",
    "Docker",
    "Redis",
    "RabbitMQ",
    "React",
    "Python",
    "FastAPI",
    "Behavioral",
    "Leadership",
    "Other",
]


def _link(v: str | None) -> str | None:
    if not v:
        return None
    v = ensure_scheme(v.strip())
    if not is_http_url(v):
        raise ValueError("meeting_link must be an http(s) URL")
    return v


class InterviewCreate(BaseModel):
    job_id: int
    application_id: int | None = None
    round_number: int | None = Field(default=None, ge=1, le=20)
    round_type: RoundType
    mode: str | None = Field(default=None, pattern=r"^(VIDEO|PHONE|ONSITE)$")
    scheduled_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=600)
    interviewers: str | None = Field(default=None, max_length=500)
    interviewer_contact_id: int | None = None
    meeting_link: str | None = None
    topics: list[str] = Field(default_factory=list)
    notes: str | None = None

    _check = field_validator("meeting_link")(lambda cls, v: _link(v))


class InterviewUpdate(BaseModel):
    round_type: RoundType | None = None
    mode: str | None = Field(default=None, pattern=r"^(VIDEO|PHONE|ONSITE)$")
    scheduled_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=600)
    interviewers: str | None = None
    interviewer_contact_id: int | None = None
    meeting_link: str | None = None
    status: InterviewStatus | None = None
    topics: list[str] | None = None
    notes: str | None = None
    feedback: str | None = None
    result: InterviewResult | None = None
    next_round: str | None = None

    _check = field_validator("meeting_link")(lambda cls, v: _link(v))


class InterviewComplete(BaseModel):
    result: InterviewResult
    feedback: str | None = None
    next_round: str | None = None


class InterviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    job_title: str = ""
    application_id: int | None
    company_id: int
    company_name: str = ""
    round_number: int
    round_type: str
    mode: str | None
    scheduled_at: datetime | None
    duration_minutes: int | None
    interviewers: str | None
    interviewer_contact_id: int | None
    meeting_link: str | None
    status: str
    topics: list[str]
    notes: str | None
    feedback: str | None
    result: str
    next_round: str | None
    created_at: datetime
    updated_at: datetime


class QuestionIn(BaseModel):
    question: str = Field(min_length=3, max_length=5000)
    category: str = "Other"
    technology: str | None = Field(default=None, max_length=80)
    difficulty: str | None = Field(default=None, pattern=r"^(EASY|MEDIUM|HARD)$")
    company_id: int | None = None
    job_id: int | None = None
    interview_id: int | None = None
    round_type: RoundType | None = None
    expected_answer: str | None = None
    my_answer: str | None = None
    confidence: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = None

    @field_validator("category")
    @classmethod
    def _cat(cls, v: str) -> str:
        match = next((c for c in QUESTION_CATEGORIES if c.lower() == v.strip().lower()), None)
        if match is None:
            raise ValueError(f"category must be one of {QUESTION_CATEGORIES}")
        return match


class QuestionUpdate(BaseModel):
    question: str | None = Field(default=None, min_length=3, max_length=5000)
    technology: str | None = None
    difficulty: str | None = Field(default=None, pattern=r"^(EASY|MEDIUM|HARD)$")
    expected_answer: str | None = None
    my_answer: str | None = None
    confidence: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = None


class PracticeIn(BaseModel):
    confidence: int | None = Field(default=None, ge=1, le=5)
    my_answer: str | None = None


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question: str
    category: str
    technology: str | None
    difficulty: str | None
    company_id: int | None
    company_name: str | None = None
    job_id: int | None
    interview_id: int | None
    round_type: str | None
    expected_answer: str | None
    my_answer: str | None
    confidence: int | None
    notes: str | None
    times_practiced: int
    last_practiced_at: datetime | None
    created_at: datetime
    updated_at: datetime
