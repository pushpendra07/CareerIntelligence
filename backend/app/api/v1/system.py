from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.ai.features import suggest_interview_questions, summarize_job
from app.ai.providers import AIUnavailableError, get_provider
from app.api.deps import DB, AppSettings
from app.core.errors import AppError, DomainValidationError
from app.matching.config import ENGINE_VERSION
from app.models.app_settings import AppSettings as AppSettingsRow
from app.services import data_io
from app.services.job_service import get_job
from app.skills.catalog import CATALOG_VERSION

router = APIRouter(tags=["system"])


class AIError(AppError):
    status_code = 503
    code = "ai_unavailable"


# --- AI (optional) ----------------------------------------------------------------------------


@router.get("/ai/status")
def ai_status(settings: AppSettings) -> dict[str, Any]:
    try:
        provider = get_provider(settings)
        return {"enabled": True, "provider": provider.name, "model": settings.ai_model}
    except AIUnavailableError as exc:
        return {"enabled": False, "reason": str(exc)}


class QuestionsIn(BaseModel):
    round_type: str | None = None
    count: int = Field(default=10, ge=1, le=25)


@router.post("/ai/jobs/{job_id}/interview-questions")
def ai_questions(db: DB, settings: AppSettings, job_id: int, body: QuestionsIn) -> dict[str, Any]:
    """Suggested questions (not saved; save the ones you want via POST /questions)."""
    try:
        provider = get_provider(settings)
        return {
            "suggestions": suggest_interview_questions(
                provider, get_job(db, job_id), body.round_type, body.count
            )
        }
    except AIUnavailableError as exc:
        raise AIError(str(exc)) from exc


@router.post("/ai/jobs/{job_id}/summary")
def ai_summary(db: DB, settings: AppSettings, job_id: int) -> dict[str, Any]:
    try:
        return summarize_job(get_provider(settings), get_job(db, job_id))
    except AIUnavailableError as exc:
        raise AIError(str(exc)) from exc


# --- settings ---------------------------------------------------------------------------------

DEFAULT_APP_SETTINGS: dict[str, Any] = {
    "notifications": {
        "followup_reminders": True,
        "interview_reminder_hours": 24,
        "daily_digest": False,
    },
    "ui": {"default_job_sort": "-match_score", "jobs_page_size": 50},
}


def _app_settings(db: DB) -> AppSettingsRow:
    row = db.get(AppSettingsRow, 1)
    if row is None:
        row = AppSettingsRow(id=1, data=DEFAULT_APP_SETTINGS)
        db.add(row)
        db.commit()
    return row


@router.get("/settings/app")
def get_app_settings(db: DB) -> dict[str, Any]:
    return {**DEFAULT_APP_SETTINGS, **_app_settings(db).data}


@router.patch("/settings/app")
def patch_app_settings(db: DB, body: dict[str, Any]) -> dict[str, Any]:
    row = _app_settings(db)
    unknown = set(body) - set(DEFAULT_APP_SETTINGS)
    if unknown:
        raise DomainValidationError(f"Unknown settings sections: {sorted(unknown)}")
    merged = dict(row.data)
    for section, values in body.items():
        if not isinstance(values, dict):
            raise DomainValidationError(f"'{section}' must be an object")
        merged[section] = {**DEFAULT_APP_SETTINGS[section], **merged.get(section, {}), **values}
    row.data = merged
    db.commit()
    return {**DEFAULT_APP_SETTINGS, **row.data}


@router.get("/settings/system")
def system_info(settings: AppSettings) -> dict[str, Any]:
    """Non-secret configuration overview (never returns keys)."""
    return {
        "environment": settings.environment,
        "engine_version": ENGINE_VERSION,
        "skills_catalog_version": CATALOG_VERSION,
        "career_ops": {
            "path": str(settings.career_ops_path) if settings.career_ops_path else None,
            "scan_enabled": settings.career_ops_scan_enabled,
        },
        "ai": {
            "provider": settings.ai_provider,
            "model": settings.ai_model,
            "api_key_set": settings.ai_api_key is not None,
        },
        "storage_path": str(settings.storage_path),
        "max_upload_mb": round(settings.max_upload_bytes / 1024 / 1024, 1),
    }


# --- import / export --------------------------------------------------------------------------


@router.get("/export/all")
def export_all(db: DB) -> Response:
    return Response(
        data_io.export_all(db),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="career-data.json"'},
    )


@router.get("/export/{entity}")
def export(db: DB, entity: str, format: Literal["csv", "json"] = "csv") -> Response:  # noqa: A002
    body, media = data_io.export(db, entity, format)
    return Response(
        body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{entity}.{format}"'},
    )


class SheetImportIn(BaseModel):
    url: str = Field(min_length=10, max_length=2000)
    kind: Literal["auto", "jobs", "companies"] = "auto"
    label: str | None = Field(default=None, max_length=100)


@router.post("/import/google-sheet")
def import_google_sheet(db: DB, body: SheetImportIn) -> dict[str, Any]:
    """Import one tab of a Google Sheet shared as "Anyone with the link → Viewer"."""
    from app.companies.importers import records_from_rows
    from app.integrations.google_sheets import detect_kind, fetch_rows, parse_sheet_url
    from app.services.company_service import import_records

    parse_sheet_url(body.url)  # reject non-Sheets URLs before any network call
    rows = fetch_rows(body.url)
    if not rows:
        raise DomainValidationError("The sheet tab is empty")
    kind = detect_kind(rows) if body.kind == "auto" else body.kind
    label = body.label or "Google Sheet"
    if kind == "jobs":
        return {"kind": kind, **data_io.import_jobs(db, rows, label)}
    summary = import_records(db, records_from_rows(rows, "google_sheet"), "google_sheet")
    return {"kind": kind, **vars(summary)}


@router.post("/import/{entity}")
async def import_file(
    db: DB,
    settings: AppSettings,
    entity: Literal["jobs", "recruiters"],
    file: Annotated[UploadFile, File()],
    label: Annotated[str, Query(max_length=100)] = "import",
) -> dict[str, Any]:
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise DomainValidationError("File is too large")
    name = file.filename or "upload.csv"
    if not name.lower().endswith((".csv", ".json")):
        raise DomainValidationError("Upload a .csv or .json file")
    try:
        rows = data_io.parse_rows(data, name)
    except (ValueError, UnicodeDecodeError) as exc:
        raise DomainValidationError(f"Could not read file: {exc}") from exc
    if entity == "jobs":
        return data_io.import_jobs(db, rows, label)
    return data_io.import_recruiters(db, rows)
