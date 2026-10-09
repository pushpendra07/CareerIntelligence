from datetime import datetime
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
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class CV(TimestampMixin, Base):
    """A named CV (e.g. "Tech Lead – Magento") with immutable uploaded versions."""

    __tablename__ = "cvs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    target_role: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    current_version_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("cv_versions.id", use_alter=True, ondelete="SET NULL")
    )

    versions: Mapped[list["CVVersion"]] = relationship(
        back_populates="cv",
        foreign_keys="CVVersion.cv_id",
        order_by="CVVersion.version_number",
    )
    current_version: Mapped["CVVersion | None"] = relationship(
        foreign_keys=[current_version_id], post_update=True
    )

    __table_args__ = (
        # At most one active CV.
        Index("uq_cvs_single_active", "is_active", unique=True, postgresql_where=text("is_active")),
    )


class CVVersion(Base):
    """One uploaded file. Rows and files are never modified or deleted (only re-parsed)."""

    __tablename__ = "cv_versions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    cv_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("cvs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str | None] = mapped_column(String(200))
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_ext: Mapped[str] = mapped_column(String(12), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    storage_key: Mapped[str] = mapped_column(String(300), nullable=False)
    extracted_text: Mapped[str] = mapped_column(Text, nullable=False)
    parsed: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    parser_version: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    cv: Mapped[CV] = relationship(back_populates="versions", foreign_keys=[cv_id])

    __table_args__ = (UniqueConstraint("cv_id", "version_number"),)
