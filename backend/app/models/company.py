from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class VerificationStatus(StrEnum):
    DISCOVERED = "DISCOVERED"
    RESEARCHED = "RESEARCHED"
    VERIFIED = "VERIFIED"
    PARTIALLY_VERIFIED = "PARTIALLY_VERIFIED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    INVALID = "INVALID"
    STALE = "STALE"
    REJECTED = "REJECTED"


class Tier(StrEnum):
    TIER_A = "TIER_A"
    TIER_B = "TIER_B"
    TIER_C = "TIER_C"


class HiringStatus(StrEnum):
    HIRING = "HIRING"
    NOT_HIRING = "NOT_HIRING"
    UNKNOWN = "UNKNOWN"


class SourceKind(StrEnum):
    """Evidence strength, strongest first (spec §12)."""

    OFFICIAL_WEBSITE = "OFFICIAL_WEBSITE"
    OFFICIAL_CAREERS = "OFFICIAL_CAREERS"
    OFFICIAL_LINKEDIN = "OFFICIAL_LINKEDIN"
    OFFICIAL_ATS = "OFFICIAL_ATS"
    SECONDARY = "SECONDARY"
    AGGREGATOR = "AGGREGATOR"
    IMPORT = "IMPORT"  # value came from an imported dataset; not independently checked
    MANUAL = "MANUAL"  # typed by the user


SOURCE_RANK = {k: i for i, k in enumerate(SourceKind)}


class Company(TimestampMixin, Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_key: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    legal_name: Mapped[str | None] = mapped_column(String(300))
    aliases: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    website: Mapped[str | None] = mapped_column(String(500))
    domain: Mapped[str | None] = mapped_column(String(200), index=True)
    careers_url: Mapped[str | None] = mapped_column(String(500))
    linkedin_url: Mapped[str | None] = mapped_column(String(500))
    ats_provider: Mapped[str | None] = mapped_column(String(40))
    ats_slug: Mapped[str | None] = mapped_column(String(200))
    headquarters: Mapped[str | None] = mapped_column(String(300))
    india_presence: Mapped[bool | None] = mapped_column(Boolean)
    india_locations: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    industry: Mapped[str | None] = mapped_column(String(200))
    company_type: Mapped[str | None] = mapped_column(String(200))
    employee_range: Mapped[str | None] = mapped_column(String(100))
    priority: Mapped[str | None] = mapped_column(String(10))
    tier: Mapped[str | None] = mapped_column(String(10), index=True)
    hiring_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=HiringStatus.UNKNOWN.value
    )
    job_search_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    verification_status: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default=VerificationStatus.DISCOVERED.value, index=True
    )
    # A status the user set by hand (REJECTED, INVALID, NEEDS_REVIEW...) wins over the derived one.
    verification_override: Mapped[str | None] = mapped_column(String(30))
    verification_score: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    # Imported research details that don't deserve their own column (relevance ratings,
    # evidence text, ratings...), keyed by source.
    attributes: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )

    sources: Mapped[list["CompanyFieldSource"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", order_by="CompanyFieldSource.id"
    )


class CompanyFieldSource(Base):
    """Provenance for one field value: where it came from and how well it is verified."""

    __tablename__ = "company_field_sources"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field: Mapped[str] = mapped_column(String(40), nullable=False)
    value: Mapped[str | None] = mapped_column(Text)
    source_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(100))  # e.g. "jobsearch_csv"
    source_url: Mapped[str | None] = mapped_column(String(1000))
    verification_status: Mapped[str] = mapped_column(String(30), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    company: Mapped[Company] = relationship(back_populates="sources")

    __table_args__ = (Index("ix_company_field_sources_field", "company_id", "field"),)


class ContactStatus(StrEnum):
    NOT_CONTACTED = "NOT_CONTACTED"
    CONTACTED = "CONTACTED"
    REPLIED = "REPLIED"
    INTERESTED = "INTERESTED"
    NOT_INTERESTED = "NOT_INTERESTED"
    SCREENING = "SCREENING"
    CLOSED = "CLOSED"


class Contact(TimestampMixin, Base):
    """Recruiter / HR / hiring-manager contact. Public professional information only."""

    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    company_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("companies.id", ondelete="SET NULL"), index=True
    )
    job_title: Mapped[str | None] = mapped_column(String(200))
    contact_type: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="RECRUITER"
    )
    linkedin_url: Mapped[str | None] = mapped_column(String(500))
    email: Mapped[str | None] = mapped_column(String(200))
    source: Mapped[str | None] = mapped_column(String(200))
    location: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=ContactStatus.NOT_CONTACTED.value, index=True
    )
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_followup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    company: Mapped[Company | None] = relationship()
