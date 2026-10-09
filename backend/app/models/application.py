from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.company import Company, Contact
from app.models.cv import CVVersion
from app.models.job import Job


class ApplicationStatus(StrEnum):
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


class ApplicationMethod(StrEnum):
    COMPANY_SITE = "COMPANY_SITE"
    ATS = "ATS"
    LINKEDIN = "LINKEDIN"
    NAUKRI = "NAUKRI"
    INDEED = "INDEED"
    EMAIL = "EMAIL"
    REFERRAL = "REFERRAL"
    RECRUITER = "RECRUITER"
    OTHER = "OTHER"


class Application(TimestampMixin, Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    company_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    applied_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(30), nullable=False, server_default="OTHER")
    cv_version_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("cv_versions.id", ondelete="SET NULL"), index=True
    )
    cover_letter: Mapped[str | None] = mapped_column(Text)
    recruiter_contact_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("contacts.id", ondelete="SET NULL")
    )
    referral_contact_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("contacts.id", ondelete="SET NULL")
    )
    referral_note: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default=ApplicationStatus.APPLIED.value, index=True
    )
    expected_salary: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    salary_currency: Mapped[str | None] = mapped_column(String(3))
    notice_period_days: Mapped[int | None] = mapped_column(Integer)
    follow_up_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String(20), nullable=False, server_default="manual")

    job: Mapped[Job] = relationship()
    company: Mapped[Company] = relationship()
    cv_version: Mapped[CVVersion | None] = relationship()
    recruiter: Mapped[Contact | None] = relationship(foreign_keys=[recruiter_contact_id])
    referral: Mapped[Contact | None] = relationship(foreign_keys=[referral_contact_id])
    events: Mapped[list["ApplicationEvent"]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="ApplicationEvent.occurred_at",
    )


class ApplicationEvent(Base):
    """Immutable application history (status changes, notes, contacts...)."""

    __tablename__ = "application_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    application_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("applications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(30))
    to_status: Mapped[str | None] = mapped_column(String(30))
    note: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    application: Mapped[Application] = relationship(back_populates="events")


class FollowUpKind(StrEnum):
    APPLICATION = "APPLICATION"
    RECRUITER = "RECRUITER"
    INTERVIEW = "INTERVIEW"
    OFFER = "OFFER"
    OTHER = "OTHER"


class FollowUp(TimestampMixin, Base):
    __tablename__ = "followups"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    remind_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    job_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("jobs.id", ondelete="CASCADE"), index=True
    )
    company_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("companies.id", ondelete="SET NULL"), index=True
    )
    contact_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("contacts.id", ondelete="SET NULL")
    )
    application_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    interview_id: Mapped[int | None] = mapped_column(BigInteger)
    offer_id: Mapped[int | None] = mapped_column(BigInteger)
    notes: Mapped[str | None] = mapped_column(Text)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    job: Mapped[Job | None] = relationship()
    company: Mapped[Company | None] = relationship()
    contact: Mapped[Contact | None] = relationship()

    __table_args__ = (Index("ix_followups_open_due", "completed", "due_date"),)
