from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ReminderEvent(Base):
    """One reminder that fired (Settings → Reminders): shown in the bell and as notifications."""

    __tablename__ = "reminder_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    rule_id: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    url: Mapped[str] = mapped_column(String(300), nullable=False, server_default=text("'/'"))
    test: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
