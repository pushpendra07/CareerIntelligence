from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.urls import ensure_scheme, is_email, is_http_url, is_linkedin_profile_url
from app.models.company import (
    ContactStatus,
    HiringStatus,
    SourceKind,
    Tier,
    VerificationStatus,
)


class FieldSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    field: str
    value: str | None
    source_kind: str
    source_name: str | None
    source_url: str | None
    verification_status: str
    verified_at: datetime | None
    note: str | None
    created_at: datetime


class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    legal_name: str | None
    aliases: list[str]
    website: str | None
    domain: str | None
    careers_url: str | None
    linkedin_url: str | None
    ats_provider: str | None
    ats_slug: str | None
    headquarters: str | None
    india_presence: bool | None
    india_locations: list[str]
    industry: str | None
    company_type: str | None
    employee_range: str | None
    priority: str | None
    tier: str | None
    hiring_status: str
    job_search_enabled: bool
    verification_status: str
    verification_override: str | None
    verification_score: int
    last_verified_at: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class CompanyDetail(CompanyOut):
    attributes: dict[str, Any]
    sources: list[FieldSourceOut]
    stats: dict[str, Any] = Field(default_factory=dict)


class CompanyWrite(BaseModel):
    """Create/update. Factual fields become MANUAL evidence (with source_url if given)."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    legal_name: str | None = None
    aliases: list[str] | None = None
    tier: Tier | None = None
    priority: str | None = Field(default=None, max_length=10)
    hiring_status: HiringStatus | None = None
    job_search_enabled: bool | None = None
    notes: str | None = None
    verification_override: VerificationStatus | None = None
    website: str | None = None
    careers_url: str | None = None
    linkedin_url: str | None = None
    headquarters: str | None = None
    industry: str | None = None
    company_type: str | None = None
    employee_range: str | None = None
    india_presence: bool | None = None
    india_locations: list[str] | None = None
    source_url: str | None = None

    @field_validator("source_url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        if v and not is_http_url(ensure_scheme(v)):
            raise ValueError("source_url must be an http(s) URL")
        return ensure_scheme(v) if v else v


class CompanyCreate(CompanyWrite):
    name: str = Field(min_length=1, max_length=200)


class EvidenceIn(BaseModel):
    field: str
    value: str
    source_kind: SourceKind
    verification_status: VerificationStatus
    source_url: str | None = None
    note: str | None = None

    @field_validator("field")
    @classmethod
    def _field(cls, v: str) -> str:
        allowed = {
            "website",
            "careers_url",
            "linkedin_url",
            "headquarters",
            "industry",
            "company_type",
            "employee_range",
            "india_locations",
            "india_presence",
            "legal_name",
        }
        if v not in allowed:
            raise ValueError(f"field must be one of {sorted(allowed)}")
        return v


class MergeIn(BaseModel):
    merge_id: int


class ContactBase(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    company_id: int | None = None
    company_name: str | None = None
    job_title: str | None = Field(default=None, max_length=200)
    contact_type: str | None = Field(
        default=None,
        pattern=r"^(RECRUITER|HR|HIRING_MANAGER|"
        r"INTERVIEWER|REFERRAL|PEER|OTHER)$",
    )
    linkedin_url: str | None = None
    email: str | None = None
    source: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    notes: str | None = None
    status: ContactStatus | None = None
    last_contacted_at: datetime | None = None
    next_followup_at: datetime | None = None

    @field_validator("linkedin_url")
    @classmethod
    def _linkedin(cls, v: str | None) -> str | None:
        if v and not is_linkedin_profile_url(v):
            raise ValueError("linkedin_url must be a linkedin.com/in/ profile URL")
        return ensure_scheme(v).split("?")[0] if v else v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        if v and not is_email(v):
            raise ValueError("invalid email address")
        return v.strip().lower() if v else v


class ContactCreate(ContactBase):
    name: str = Field(min_length=1, max_length=200)


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    company_id: int | None
    company_name: str | None = None
    job_title: str | None
    contact_type: str
    linkedin_url: str | None
    email: str | None
    source: str | None
    location: str | None
    notes: str | None
    status: str
    last_contacted_at: datetime | None
    next_followup_at: datetime | None
    created_at: datetime
    updated_at: datetime
