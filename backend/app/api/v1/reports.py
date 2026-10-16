from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.api.deps import DB
from app.services import report_service

router = APIRouter(tags=["reports"])


@router.get("/reports")
def list_reports() -> list[dict[str, str]]:
    """The available reports."""
    return report_service.catalog()


@router.get("/reports/{name}")
def get_report(
    db: DB,
    name: str,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    group: report_service.Group | None = None,
) -> dict[str, Any]:
    """One report for a date range (default: last 90 days): KPIs vs the previous period,
    charts per day/week/month, and a detail table."""
    return report_service.build(db, name, from_, to, group)
