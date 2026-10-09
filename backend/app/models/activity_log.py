from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ActivityLog(Base):
    """Append-only audit trail (CV uploaded, job scored, status changed, ...)."""

    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(BigInteger)
    summary: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")

    __table_args__ = (
        Index("ix_activity_logs_entity", "entity_type", "entity_id"),
        Index("ix_activity_logs_occurred_at", "occurred_at"),
    )
