from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.skills.catalog import normalize_skill_list

Years = Decimal | None


def _clean_list(values: list[str] | None) -> list[str] | None:
    if values is None:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        v = v.strip()
        if v and v.lower() not in seen:
            seen.add(v.lower())
            out.append(v)
    return out


class ProfessionalProfileBase(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    headline: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    linkedin_url: str | None = Field(default=None, max_length=300)
    location: str | None = Field(default=None, max_length=200)
    summary: str | None = None
    total_experience_years: Years = Field(default=None, ge=0, le=60)
    relevant_experience_years: Years = Field(default=None, ge=0, le=60)
    leadership_experience_years: Years = Field(default=None, ge=0, le=60)
    primary_roles: list[str] = Field(default_factory=list)
    core_skills: list[str] = Field(default_factory=list)
    additional_skills: list[str] = Field(default_factory=list)
    skill_years: dict[str, float] = Field(default_factory=dict)
    domains: list[str] = Field(default_factory=list)
    leadership: list[str] = Field(default_factory=list)
    companies: list[dict[str, Any]] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    education: list[dict[str, Any]] = Field(default_factory=list)
    projects: list[dict[str, Any]] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)


class ProfessionalProfileOut(ProfessionalProfileBase):
    model_config = ConfigDict(from_attributes=True)

    version: int
    source_cv_version_id: int | None
    updated_at: datetime


class ProfessionalProfileUpdate(BaseModel):
    """Partial update: only the fields sent are changed."""

    full_name: str | None = Field(default=None, max_length=200)
    headline: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    linkedin_url: str | None = Field(default=None, max_length=300)
    location: str | None = Field(default=None, max_length=200)
    summary: str | None = None
    total_experience_years: Years = Field(default=None, ge=0, le=60)
    relevant_experience_years: Years = Field(default=None, ge=0, le=60)
    leadership_experience_years: Years = Field(default=None, ge=0, le=60)
    primary_roles: list[str] | None = None
    core_skills: list[str] | None = None
    additional_skills: list[str] | None = None
    skill_years: dict[str, float] | None = None
    domains: list[str] | None = None
    leadership: list[str] | None = None
    companies: list[dict[str, Any]] | None = None
    certifications: list[str] | None = None
    education: list[dict[str, Any]] | None = None
    projects: list[dict[str, Any]] | None = None
    achievements: list[str] | None = None

    @field_validator("core_skills", "additional_skills")
    @classmethod
    def _skills(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else normalize_skill_list(v)

    @field_validator("primary_roles", "domains", "leadership", "certifications", "achievements")
    @classmethod
    def _lists(cls, v: list[str] | None) -> list[str] | None:
        return _clean_list(v)


class ImportFromCV(BaseModel):
    cv_version_id: int
    mode: Literal["merge", "replace"] = "merge"


class TargetProfileBase(BaseModel):
    target_titles: list[str] = Field(default_factory=list)
    include_architect_roles: bool = False
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    preferred_domains: list[str] = Field(default_factory=list)
    preferred_companies: list[str] = Field(default_factory=list)
    preferred_locations: list[str] = Field(default_factory=list)
    remote_ok: bool = True
    hybrid_ok: bool = True
    onsite_ok: bool = True
    min_experience_years: Years = Field(default=None, ge=0, le=60)
    max_experience_years: Years = Field(default=None, ge=0, le=60)
    min_salary: Decimal | None = Field(default=None, ge=0)
    target_salary: Decimal | None = Field(default=None, ge=0)
    salary_currency: str = Field(default="INR", min_length=3, max_length=3)
    employment_types: list[str] = Field(default_factory=list)
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    excluded_roles: list[str] = Field(default_factory=list)
    excluded_technologies: list[str] = Field(default_factory=list)
    excluded_industries: list[str] = Field(default_factory=list)
    notes: str | None = None


class TargetProfileOut(TargetProfileBase):
    model_config = ConfigDict(from_attributes=True)

    version: int
    updated_at: datetime
    effective_titles: list[str] = Field(default_factory=list)


class TargetProfileUpdate(BaseModel):
    target_titles: list[str] | None = None
    include_architect_roles: bool | None = None
    required_skills: list[str] | None = None
    preferred_skills: list[str] | None = None
    preferred_domains: list[str] | None = None
    preferred_companies: list[str] | None = None
    preferred_locations: list[str] | None = None
    remote_ok: bool | None = None
    hybrid_ok: bool | None = None
    onsite_ok: bool | None = None
    min_experience_years: Years = Field(default=None, ge=0, le=60)
    max_experience_years: Years = Field(default=None, ge=0, le=60)
    min_salary: Decimal | None = Field(default=None, ge=0)
    target_salary: Decimal | None = Field(default=None, ge=0)
    salary_currency: str | None = Field(default=None, min_length=3, max_length=3)
    employment_types: list[str] | None = None
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    excluded_roles: list[str] | None = None
    excluded_technologies: list[str] | None = None
    excluded_industries: list[str] | None = None
    notes: str | None = None

    @field_validator("required_skills", "preferred_skills", "excluded_technologies")
    @classmethod
    def _skills(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else normalize_skill_list(v)

    @field_validator(
        "target_titles",
        "preferred_domains",
        "preferred_companies",
        "preferred_locations",
        "employment_types",
        "excluded_roles",
        "excluded_industries",
    )
    @classmethod
    def _lists(cls, v: list[str] | None) -> list[str] | None:
        return _clean_list(v)

    @field_validator("salary_currency")
    @classmethod
    def _currency(cls, v: str | None) -> str | None:
        return v.upper() if v else v

    @model_validator(mode="after")
    def _ranges(self) -> Self:
        if (
            self.min_experience_years is not None
            and self.max_experience_years is not None
            and self.min_experience_years > self.max_experience_years
        ):
            raise ValueError("min_experience_years must not exceed max_experience_years")
        if (
            self.min_salary is not None
            and self.target_salary is not None
            and self.min_salary > self.target_salary
        ):
            raise ValueError("min_salary must not exceed target_salary")
        return self
