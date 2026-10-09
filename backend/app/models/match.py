from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ScoringConfigRow(Base):
    """Versioned scoring configuration. Exactly one row is active; edits add a new version."""

    __tablename__ = "scoring_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "uq_scoring_configs_active",
            "is_active",
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )


class JobMatch(Base):
    """One scoring run for a job (history is kept; jobs.current_match_id points to the latest)."""

    __tablename__ = "job_matches"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    recommendation: Mapped[str] = mapped_column(String(30), nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    score_version: Mapped[str] = mapped_column(String(100), nullable=False)
    profile_version: Mapped[int] = mapped_column(Integer, nullable=False)
    target_version: Mapped[int] = mapped_column(Integer, nullable=False)
    config_version: Mapped[int] = mapped_column(Integer, nullable=False)
    inputs_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    recommended_cv_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("cvs.id", ondelete="SET NULL")
    )
    analyzed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
