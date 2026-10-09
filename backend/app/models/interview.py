from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.company import Company, Contact
from app.models.job import Job


class RoundType(StrEnum):
    RECRUITER_SCREEN = "RECRUITER_SCREEN"
    HR = "HR"
    TECHNICAL = "TECHNICAL"
    CODING = "CODING"
    SYSTEM_DESIGN = "SYSTEM_DESIGN"
    MANAGERIAL = "MANAGERIAL"
    CLIENT = "CLIENT"
    FINAL = "FINAL"
    OFFER_HR = "OFFER_HR"


class InterviewStatus(StrEnum):
    SCHEDULED = "SCHEDULED"
    RESCHEDULED = "RESCHEDULED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    NO_SHOW = "NO_SHOW"


class InterviewResult(StrEnum):
    PENDING = "PENDING"
    PASSED = "PASSED"
    FAILED = "FAILED"
    ON_HOLD = "ON_HOLD"


class Interview(TimestampMixin, Base):
    __tablename__ = "interviews"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    application_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("applications.id", ondelete="SET NULL"), index=True
    )
    company_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    round_number: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    round_type: Mapped[str] = mapped_column(String(30), nullable=False)
    mode: Mapped[str | None] = mapped_column(String(20))  # VIDEO | PHONE | ONSITE
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    interviewers: Mapped[str | None] = mapped_column(String(500))
    interviewer_contact_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("contacts.id", ondelete="SET NULL")
    )
    meeting_link: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=InterviewStatus.SCHEDULED.value, index=True
    )
    topics: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    feedback: Mapped[str | None] = mapped_column(Text)
    result: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=InterviewResult.PENDING.value
    )
    next_round: Mapped[str | None] = mapped_column(String(300))

    job: Mapped[Job] = relationship()
    company: Mapped[Company] = relationship()
    interviewer: Mapped[Contact | None] = relationship()


class InterviewQuestion(TimestampMixin, Base):
    """Question bank entry (asked in a real interview, or added for practice)."""

    __tablename__ = "interview_questions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    technology: Mapped[str | None] = mapped_column(String(80), index=True)
    difficulty: Mapped[str | None] = mapped_column(String(10))
    company_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("companies.id", ondelete="SET NULL"), index=True
    )
    job_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("jobs.id", ondelete="SET NULL")
    )
    interview_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("interviews.id", ondelete="SET NULL"), index=True
    )
    round_type: Mapped[str | None] = mapped_column(String(30))
    expected_answer: Mapped[str | None] = mapped_column(Text)
    my_answer: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[int | None] = mapped_column(Integer)  # 1-5
    notes: Mapped[str | None] = mapped_column(Text)
    times_practiced: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_practiced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    company: Mapped[Company | None] = relationship()

    __table_args__ = (Index("ix_interview_questions_confidence", "confidence"),)
