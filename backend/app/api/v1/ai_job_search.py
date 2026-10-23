from typing import Any

from fastapi import APIRouter

from app.api.deps import DB, AppSettings
from app.integrations import ai_job_search as service

router = APIRouter(prefix="/ai-job-search", tags=["ai-job-search"])


@router.get("/status")
def status(db: DB, settings: AppSettings) -> dict[str, Any]:
    """Where AI Job Search is, what its files hold, and the last import."""
    return service.status(db, settings)


@router.post("/import")
def import_now(db: DB, settings: AppSettings) -> dict[str, Any]:
    """Read AI Job Search's files (read-only) and add / merge its jobs and applications."""
    return service.import_jobs(db, settings)


@router.put("/settings")
def save_settings(db: DB, body: dict[str, Any]) -> dict[str, Any]:
    """`{"auto_import": true}`: import whenever its files change (checked every 5 minutes)."""
    return service.save_settings(db, body)
