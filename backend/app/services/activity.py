from typing import Any

from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog


def record_activity(
    db: Session,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    summary: str | None = None,
    data: dict[str, Any] | None = None,
) -> ActivityLog:
    """Add an audit entry to the caller's transaction (the caller commits)."""
    entry = ActivityLog(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        data=data or {},
    )
    db.add(entry)
    return entry
