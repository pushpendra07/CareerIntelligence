import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.urls import ensure_scheme, is_email, is_http_url, is_linkedin_profile_url
from app.jobs.contacts import normalize_phone
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


class ExtraLinkOut(BaseModel):
    portal: str
    url: str
    source: str | None = None
    added_at: datetime | None = None


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
    # Company pages on job portals: Naukri, LinkedIn, Monster, Foundit...
    extra_links: list[ExtraLinkOut] = Field(default_factory=list)
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
    scan_excluded: bool = False
    rating: float | None = None  # employee rating on a job portal (Naukri), 1-5
    rating_reviews: int | None = None
    verification_status: str
    verification_override: str | None
    verification_score: int
    last_verified_at: datetime | None
    # Jobs for this company in Career Intelligence (all statuses / still being pursued).
    job_count: int = 0
    open_job_count: int = 0
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
    scan_excluded: bool | None = None
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
    extra_links: list[str] | None = None
    source_url: str | None = None

    @field_validator("extra_links")
    @classmethod
    def _links(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        links = [ensure_scheme(x) for x in v if x.strip()]
        if bad := [x for x in links if not is_http_url(x)]:
            raise ValueError(f"extra_links must be http(s) URLs: {bad[0]}")
        return links

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


class CompanyIdsIn(BaseModel):
    company_ids: list[int] = Field(min_length=1, max_length=500)


class CompanyBulkIn(CompanyIdsIn):
    action: Literal["job_search_on", "job_search_off", "tier", "delete"]
    tier: Tier | None = None  # for "tier"; null clears it


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
    phone: str | None = Field(default=None, max_length=40)
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

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        if not v or not v.strip():
            return None
        phone = normalize_phone(v) or (v.strip() if len(re.sub(r"\D", "", v)) >= 8 else None)
        if phone is None:
            raise ValueError("invalid phone number")
        return phone


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
    phone: str | None = None
    source: str | None
    location: str | None
    notes: str | None
    status: str
    last_contacted_at: datetime | None
    next_followup_at: datetime | None
    # Jobs this person is the recruiter for.
    jobs: list[dict[str, Any]] = []
    created_at: datetime
    updated_at: datetime
