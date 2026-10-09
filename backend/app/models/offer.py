from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import BigInteger, Date, ForeignKey, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.company import Company
from app.models.job import Job


class OfferStatus(StrEnum):
    RECEIVED = "RECEIVED"
    NEGOTIATING = "NEGOTIATING"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    EXPIRED = "EXPIRED"


class Offer(TimestampMixin, Base):
    __tablename__ = "offers"

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
    offer_date: Mapped[date] = mapped_column(Date, nullable=False)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="INR")
    base_salary: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    variable_pay: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    bonus: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    equity: Mapped[str | None] = mapped_column(String(300))
    equity_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    total_ctc: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    joining_date: Mapped[date | None] = mapped_column(Date)
    location: Mapped[str | None] = mapped_column(String(300))
    work_model: Mapped[str | None] = mapped_column(String(10))
    designation: Mapped[str | None] = mapped_column(String(300))
    benefits: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    negotiation_notes: Mapped[str | None] = mapped_column(Text)
    # [{"at": "...", "note": "...", "counter_ctc": 4500000, "by": "me|company"}]
    negotiation_log: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=OfferStatus.RECEIVED.value, index=True
    )
    decision: Mapped[str | None] = mapped_column(Text)
    decision_date: Mapped[date | None] = mapped_column(Date)

    job: Mapped[Job] = relationship()
    company: Mapped[Company] = relationship()
