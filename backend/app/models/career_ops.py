from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CareerOpsImport(Base):
    """One import/sync run from Career-Ops files (audit + idempotency context)."""

    __tablename__ = "career_ops_imports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    data_root: Mapped[str] = mapped_column(String(1000), nullable=False)
    career_ops_version: Mapped[str | None] = mapped_column(String(40))
    scan_triggered: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    scan_receipt: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    stats: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    file_hashes: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    errors: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="RUNNING")
