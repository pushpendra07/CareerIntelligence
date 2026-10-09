"""Professional Profile (who I am) and Target Profile (what I'm looking for).

Both are single-row tables (id = 1). Each carries a `version` that increments on every change;
match scores record the versions they were computed against so stale scores can be detected.
"""

from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _list() -> Any:
    return mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))


class ProfessionalProfile(TimestampMixin, Base):
    __tablename__ = "professional_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    full_name: Mapped[str | None] = mapped_column(String(200))
    headline: Mapped[str | None] = mapped_column(String(300))
    email: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(50))
    linkedin_url: Mapped[str | None] = mapped_column(String(300))
    location: Mapped[str | None] = mapped_column(String(200))
    summary: Mapped[str | None] = mapped_column(Text)
    total_experience_years: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    relevant_experience_years: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    leadership_experience_years: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    primary_roles: Mapped[list[str]] = _list()
    core_skills: Mapped[list[str]] = _list()
    additional_skills: Mapped[list[str]] = _list()
    # {"PHP": 12.5, ...} years per technology, entered/edited by the user.
    skill_years: Mapped[dict[str, float]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    domains: Mapped[list[str]] = _list()
    leadership: Mapped[list[str]] = _list()
    companies: Mapped[list[dict[str, Any]]] = _list()
    certifications: Mapped[list[str]] = _list()
    education: Mapped[list[dict[str, Any]]] = _list()
    projects: Mapped[list[dict[str, Any]]] = _list()
    achievements: Mapped[list[str]] = _list()
    source_cv_version_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("cv_versions.id", ondelete="SET NULL")
    )


class TargetProfile(TimestampMixin, Base):
    __tablename__ = "target_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    target_titles: Mapped[list[str]] = _list()
    include_architect_roles: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    required_skills: Mapped[list[str]] = _list()
    preferred_skills: Mapped[list[str]] = _list()
    preferred_domains: Mapped[list[str]] = _list()
    preferred_companies: Mapped[list[str]] = _list()
    preferred_locations: Mapped[list[str]] = _list()
    remote_ok: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    hybrid_ok: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    onsite_ok: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    min_experience_years: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    max_experience_years: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    min_salary: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    target_salary: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    salary_currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'INR'")
    )
    employment_types: Mapped[list[str]] = _list()
    notice_period_days: Mapped[int | None] = mapped_column(Integer)
    excluded_roles: Mapped[list[str]] = _list()
    excluded_technologies: Mapped[list[str]] = _list()
    excluded_industries: Mapped[list[str]] = _list()
    notes: Mapped[str | None] = mapped_column(Text)
