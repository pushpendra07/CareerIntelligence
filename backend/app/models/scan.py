from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ScanRun(Base):
    """One run of the built-in job scanner (or of job-board detection)."""

    __tablename__ = "scan_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, server_default="SCAN")
    trigger: Mapped[str] = mapped_column(String(20), nullable=False, server_default="manual")
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="RUNNING")
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stats: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    # One entry per company: {company_id, company, provider, found, kept, new, error}
    companies: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
