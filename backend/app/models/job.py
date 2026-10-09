from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.company import Company, Contact


class JobStatus(StrEnum):
    DISCOVERED = "DISCOVERED"
    NEW = "NEW"
    REVIEWING = "REVIEWING"
    SHORTLISTED = "SHORTLISTED"
    READY_TO_APPLY = "READY_TO_APPLY"
    APPLIED = "APPLIED"
    RECRUITER_CONTACTED = "RECRUITER_CONTACTED"
    SCREENING = "SCREENING"
    INTERVIEW = "INTERVIEW"
    OFFER = "OFFER"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    WITHDRAWN = "WITHDRAWN"
    ON_HOLD = "ON_HOLD"
    CLOSED = "CLOSED"
    NOT_RELEVANT = "NOT_RELEVANT"


class WorkModel(StrEnum):
    REMOTE = "REMOTE"
    HYBRID = "HYBRID"
    ONSITE = "ONSITE"
    UNKNOWN = "UNKNOWN"


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    normalized_title: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    seniority: Mapped[str | None] = mapped_column(String(20))
    # Primary (first/best) source; all sources live in job_sources.
    source: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    source_url: Mapped[str | None] = mapped_column(String(2000))
    external_id: Mapped[str | None] = mapped_column(String(200))
    location: Mapped[str | None] = mapped_column(String(300))
    locations: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    work_model: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=WorkModel.UNKNOWN.value, index=True
    )
    employment_type: Mapped[str | None] = mapped_column(String(40))
    experience_min: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    experience_max: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    salary_min: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    salary_max: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    salary_currency: Mapped[str | None] = mapped_column(String(3))
    salary_text: Mapped[str | None] = mapped_column(String(200))
    posting_date: Mapped[date | None] = mapped_column(Date, index=True)
    application_deadline: Mapped[date | None] = mapped_column(Date)
    original_jd: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    jd_status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="OK")
    parsed_jd: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    responsibilities: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    required_skills: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    preferred_skills: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    qualifications: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    # Fields the user typed explicitly; re-parsing the JD never overwrites these.
    manual_fields: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default=JobStatus.NEW.value, index=True
    )
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recruiter_contact_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("contacts.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    dedup_key: Mapped[str] = mapped_column(String(400), nullable=False, index=True)

    # Latest Career Intelligence match (denormalized from job_matches for filtering/sorting).
    match_score: Mapped[int | None] = mapped_column(Integer, index=True)
    recommendation: Mapped[str | None] = mapped_column(String(30), index=True)
    score_version: Mapped[str | None] = mapped_column(String(100))
    profile_version: Mapped[int | None] = mapped_column(Integer)
    target_version: Mapped[int | None] = mapped_column(Integer)
    config_version: Mapped[int | None] = mapped_column(Integer)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    score_stale: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    current_match_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("job_matches.id", ondelete="SET NULL", use_alter=True)
    )
    recommended_cv_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("cvs.id", ondelete="SET NULL")
    )

    # Career-Ops' own evaluation, preserved as-is (never converted into match_score).
    career_ops_score: Mapped[Decimal | None] = mapped_column(Numeric(3, 1))
    career_ops_evaluation: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    career_ops_report: Mapped[str | None] = mapped_column(String(500))
    career_ops_status: Mapped[str | None] = mapped_column(String(30))

    company: Mapped[Company] = relationship()
    recruiter_contact: Mapped[Contact | None] = relationship()
    source_links: Mapped[list["JobSourceLink"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="JobSourceLink.id"
    )

    __table_args__ = (
        Index("ix_jobs_required_skills", "required_skills", postgresql_using="gin"),
        Index("ix_jobs_company_title", "company_id", "normalized_title"),
    )


class JobSourceLink(Base):
    """One place a job was found. A deduplicated job can have many."""

    __tablename__ = "job_sources"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    original_url: Mapped[str | None] = mapped_column(String(2000))
    normalized_url: Mapped[str | None] = mapped_column(String(2000))
    external_id: Mapped[str | None] = mapped_column(String(200))
    detail: Mapped[str | None] = mapped_column(String(300))  # portal/query name, channel, ...
    raw: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    job: Mapped[Job] = relationship(back_populates="source_links")

    __table_args__ = (
        Index(
            "uq_job_sources_normalized_url",
            "normalized_url",
            unique=True,
            postgresql_where=text("normalized_url IS NOT NULL"),
        ),
        Index(
            "uq_job_sources_external",
            "source",
            "external_id",
            unique=True,
            postgresql_where=text("external_id IS NOT NULL"),
        ),
    )


class DeletedJob(Base):
    """A job the user deleted: imports and scans skip it instead of adding it back."""

    __tablename__ = "deleted_jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    company_name: Mapped[str] = mapped_column(String(300), nullable=False)
    # Lowercased "company|title", used when an imported row has no URL or ID.
    title_key: Mapped[str] = mapped_column(String(820), nullable=False, index=True)
    normalized_urls: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    # ["SOURCE:external_id", ...]
    external_ids: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
