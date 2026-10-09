from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.application import ApplicationMethod, ApplicationStatus, FollowUpKind


class ApplicationCreate(BaseModel):
    job_id: int
    applied_on: date | None = None
    method: ApplicationMethod = ApplicationMethod.OTHER
    cv_version_id: int | None = None  # defaults to the job's recommended CV
    cover_letter: str | None = Field(default=None, max_length=20_000)
    recruiter_contact_id: int | None = None
    referral_contact_id: int | None = None
    referral_note: str | None = Field(default=None, max_length=300)
    status: ApplicationStatus = ApplicationStatus.APPLIED
    expected_salary: Decimal | None = Field(default=None, ge=0)
    salary_currency: str | None = Field(default=None, min_length=3, max_length=3)
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    follow_up_date: date | None = None  # defaults to applied_on + 7 days
    notes: str | None = None

    @field_validator("salary_currency")
    @classmethod
    def _cur(cls, v: str | None) -> str | None:
        return v.upper() if v else v


class ApplicationUpdate(BaseModel):
    applied_on: date | None = None
    method: ApplicationMethod | None = None
    cv_version_id: int | None = None
    cover_letter: str | None = None
    recruiter_contact_id: int | None = None
    referral_contact_id: int | None = None
    referral_note: str | None = None
    expected_salary: Decimal | None = Field(default=None, ge=0)
    salary_currency: str | None = Field(default=None, min_length=3, max_length=3)
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    follow_up_date: date | None = None
    notes: str | None = None


class ApplicationStatusIn(BaseModel):
    status: ApplicationStatus
    note: str | None = None


class NoteIn(BaseModel):
    note: str = Field(min_length=1, max_length=5000)


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: str
    from_status: str | None
    to_status: str | None
    note: str | None
    occurred_at: datetime


class ApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    job_title: str = ""
    company_id: int
    company_name: str = ""
    match_score: int | None = None
    applied_on: date
    method: str
    cv_version_id: int | None
    cv_name: str | None = None
    cover_letter: str | None
    recruiter_contact_id: int | None
    recruiter_name: str | None = None
    referral_contact_id: int | None
    referral_name: str | None = None
    referral_note: str | None
    status: str
    expected_salary: Decimal | None
    salary_currency: str | None
    notice_period_days: int | None
    follow_up_date: date | None
    notes: str | None
    origin: str
    created_at: datetime
    updated_at: datetime
    events: list[EventOut] = Field(default_factory=list)


class FollowUpIn(BaseModel):
    kind: FollowUpKind = FollowUpKind.OTHER
    title: str = Field(min_length=1, max_length=300)
    due_date: date
    remind_at: datetime | None = None
    job_id: int | None = None
    company_id: int | None = None
    contact_id: int | None = None
    application_id: int | None = None
    interview_id: int | None = None
    offer_id: int | None = None
    notes: str | None = None


class FollowUpUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    due_date: date | None = None
    remind_at: datetime | None = None
    notes: str | None = None
    completed: bool | None = None


class FollowUpOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    title: str
    due_date: date
    remind_at: datetime | None
    job_id: int | None
    job_title: str | None = None
    company_id: int | None
    company_name: str | None = None
    contact_id: int | None
    contact_name: str | None = None
    application_id: int | None
    interview_id: int | None
    offer_id: int | None
    notes: str | None
    completed: bool
    completed_at: datetime | None
    overdue: bool = False
