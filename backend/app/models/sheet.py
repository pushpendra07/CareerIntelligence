from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SavedSheet(Base):
    """A Google Sheet kept in Settings so it can be re-imported with one click."""

    __tablename__ = "saved_sheets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    spreadsheet_id: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    url: Mapped[str] = mapped_column(String(2000), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_imported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # {"via": "direct"|"connector", "tabs": [{"tab", "kind", "read", "created", "merged", ...}]}
    last_result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    last_error: Mapped[str | None] = mapped_column(String(1000))
    meta: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
