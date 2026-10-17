"""Scheduled reminders: the rules (Settings → Reminders) and the reminders that fired."""

from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import DB
from app.models.reminder import ReminderEvent
from app.services import reminder_service

router = APIRouter(tags=["reminders"])


def _event(e: ReminderEvent) -> dict[str, Any]:
    return {"id": e.id, "rule_id": e.rule_id, "title": e.title, "body": e.body, "url": e.url,
            "test": e.test, "created_at": e.created_at.isoformat()}


@router.get("/reminder-rules")
def get_rules(db: DB) -> dict[str, Any]:
    return reminder_service.overview(db)


@router.put("/reminder-rules")
def put_rules(db: DB, body: dict[str, Any]) -> dict[str, Any]:
    return reminder_service.save(db, body)


@router.post("/reminder-rules/{rule_id}/test")
def test_rule(db: DB, rule_id: str) -> dict[str, Any]:
    return _event(reminder_service.fire_now(db, rule_id))


@router.get("/reminder-events")
def list_events(db: DB, after: int = Query(0, ge=0),
                limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
    return [_event(e) for e in reminder_service.events(db, after, limit)]
