from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.urls import JobSource, ensure_scheme, is_email, is_http_url, is_linkedin_profile_url
from app.models.job import JobStatus, WorkModel


def _url(v: str | None) -> str | None:
    if not v:
        return None
    v = ensure_scheme(v.strip())
    if not is_http_url(v):
        raise ValueError("must be an http(s) URL")
    return v


class JobCreate(BaseModel):
    """Manual "Add Job": the main path is title + company + URL + pasted JD."""

    title: str = Field(min_length=1, max_length=300)
    company: str = Field(min_length=1, max_length=200)
    url: str | None = Field(default=None, max_length=2000)
    source: JobSource | None = None  # manual override of the detected source
    location: str | None = Field(default=None, max_length=300)
    work_model: WorkModel | None = None
    employment_type: str | None = Field(default=None, max_length=40)
    experience: str | None = Field(default=None, max_length=100, description='e.g. "8-12 years"')
    experience_min: Decimal | None = Field(default=None, ge=0, le=50)
    experience_max: Decimal | None = Field(default=None, ge=0, le=50)
    salary: str | None = Field(default=None, max_length=200, description='e.g. "30-40 LPA"')
    salary_min: Decimal | None = Field(default=None, ge=0)
    salary_max: Decimal | None = Field(default=None, ge=0)
    salary_currency: str | None = Field(default=None, min_length=3, max_length=3)
    posting_date: date | None = None
    application_deadline: date | None = None
    recruiter_name: str | None = Field(default=None, max_length=200)
    recruiter_linkedin: str | None = None
    recruiter_email: str | None = None
    jd: str = Field(min_length=1, max_length=100_000)
    responsibilities: list[str] | None = None
    required_skills: list[str] | None = None
    preferred_skills: list[str] | None = None
    qualifications: list[str] | None = None
    notes: str | None = None

    _check_url = field_validator("url")(lambda cls, v: _url(v))

    @field_validator("recruiter_linkedin")
    @classmethod
    def _li(cls, v: str | None) -> str | None:
        if v and not is_linkedin_profile_url(v):
            raise ValueError("must be a linkedin.com/in/ profile URL")
        return ensure_scheme(v).split("?")[0] if v else v

    @field_validator("recruiter_email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        if v and not is_email(v):
            raise ValueError("invalid email address")
        return v.strip().lower() if v else v

    @field_validator("salary_currency")
    @classmethod
    def _cur(cls, v: str | None) -> str | None:
        return v.upper() if v else v


class JobPreviewIn(BaseModel):
    url: str | None = None
    jd: str = Field(default="", max_length=100_000)
    title: str | None = None

    _check_url = field_validator("url")(lambda cls, v: _url(v))


class JobUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    location: str | None = None
    work_model: WorkModel | None = None
    employment_type: str | None = None
    experience_min: Decimal | None = Field(default=None, ge=0, le=50)
    experience_max: Decimal | None = Field(default=None, ge=0, le=50)
    salary_min: Decimal | None = Field(default=None, ge=0)
    salary_max: Decimal | None = Field(default=None, ge=0)
    salary_currency: str | None = Field(default=None, min_length=3, max_length=3)
    salary_text: str | None = None
    posting_date: date | None = None
    application_deadline: date | None = None
    original_jd: str | None = Field(default=None, max_length=100_000)
    responsibilities: list[str] | None = None
    required_skills: list[str] | None = None
    preferred_skills: list[str] | None = None
    qualifications: list[str] | None = None
    notes: str | None = None


class StatusIn(BaseModel):
    status: JobStatus
    note: str | None = None


class SourceIn(BaseModel):
    url: str
    source: JobSource | None = None
    detail: str | None = None

    _check_url = field_validator("url")(lambda cls, v: _url(v))


class MergeJobsIn(BaseModel):
    merge_id: int


class JobSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    original_url: str | None
    normalized_url: str | None
    external_id: str | None
    detail: str | None
    first_seen_at: datetime
    last_seen_at: datetime


class CompanyBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    tier: str | None
    verification_status: str
    website: str | None
    careers_url: str | None


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    company: CompanyBrief
    source: str
    source_url: str | None
    sources: list[str] = Field(default_factory=list)
    added_via: list[str] = Field(default_factory=list)
    location: str | None
    locations: list[str]
    work_model: str
    employment_type: str | None
    seniority: str | None
    experience_min: Decimal | None
    experience_max: Decimal | None
    salary_min: Decimal | None
    salary_max: Decimal | None
    salary_currency: str | None
    salary_text: str | None
    posting_date: date | None
    application_deadline: date | None
    status: str
    match_score: int | None
    recommendation: str | None
    score_stale: bool
    analyzed_at: datetime | None
    jd_status: str
    required_skills: list[str]
    preferred_skills: list[str]
    created_at: datetime
    updated_at: datetime


class JobDetail(JobOut):
    original_jd: str
    parsed_jd: dict[str, Any]
    responsibilities: list[str]
    qualifications: list[str]
    manual_fields: list[str]
    notes: str | None
    external_id: str | None
    score_version: str | None
    profile_version: int | None
    target_version: int | None
    source_links: list[JobSourceOut] = Field(default_factory=list)
    match: dict[str, Any] | None = None
    recommended_cv: dict[str, Any] | None = None
    recruiter: dict[str, Any] | None = None
    activity: list[dict[str, Any]] = Field(default_factory=list)
    career_ops: dict[str, Any] | None = None
    career_ops_score: Decimal | None = None
    career_ops_evaluation: dict[str, Any] | None = None
    career_ops_report: str | None = None
    career_ops_status: str | None = None


class JobCreateOut(BaseModel):
    job: JobDetail
    created: bool
    duplicate_matched_by: str | None
