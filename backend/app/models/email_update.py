from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EmailKind(StrEnum):
    OFFER = "OFFER"
    REJECTION = "REJECTION"
    INTERVIEW = "INTERVIEW"
    ASSESSMENT = "ASSESSMENT"
    RECEIVED = "RECEIVED"  # "thank you for applying"
    RECRUITER = "RECRUITER"  # a person at the company wrote to you


class EmailUpdateState(StrEnum):
    PENDING = "PENDING"  # waiting for your Confirm / Dismiss
    DONE = "DONE"  # confirmed, or nothing to change
    DISMISSED = "DISMISSED"


class EmailUpdate(Base):
    """A job-search email found in your inbox (Settings → Email) and the status it suggests.

    Only emails about your job search are kept, with the sentence that gave them away; the rest
    of the mailbox is never stored."""

    __tablename__ = "email_updates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    message_id: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    sender_name: Mapped[str] = mapped_column(String(300), nullable=False, server_default=text("''"))
    sender_email: Mapped[str] = mapped_column(String(300), nullable=False,
                                              server_default=text("''"))
    subject: Mapped[str] = mapped_column(String(500), nullable=False, server_default=text("''"))
    evidence: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    company_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("companies.id", ondelete="SET NULL"), index=True
    )
    job_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("jobs.id", ondelete="SET NULL"), index=True
    )
    # Jobs at the company it could be about, when it couldn't tell which one.
    candidate_job_ids: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    match_reason: Mapped[str] = mapped_column(String(200), nullable=False,
                                              server_default=text("''"))
    suggested_status: Mapped[str | None] = mapped_column(String(30))
    applied_status: Mapped[str | None] = mapped_column(String(30))
    state: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=EmailUpdateState.PENDING.value, index=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
