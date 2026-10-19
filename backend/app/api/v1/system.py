from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app.ai.features import suggest_interview_questions, summarize_job
from app.ai.providers import AIUnavailableError, get_provider
from app.api.deps import DB, AppSettings
from app.chat import service as chat_service
from app.core.errors import AppError, DomainValidationError
from app.integrations.career_ops import service as career_ops
from app.matching.config import ENGINE_VERSION
from app.models.app_settings import AppSettings as AppSettingsRow
from app.scanner.filters import DEFAULT_SCANNER_SETTINGS, validate_scanner_settings
from app.services import backup_service, data_io, extension_package, goals_service
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

# Only settings the app actually uses. (Notification and list-view preferences were removed:
# nothing read them. Jobs list sort/filters are remembered in the browser.)
DEFAULT_APP_SETTINGS: dict[str, Any] = {
    "scanner": DEFAULT_SCANNER_SETTINGS,
    "goals": goals_service.DEFAULT_GOALS,  # weekly targets on Today (0 = off)
    "backups": backup_service.DEFAULTS,  # automatic backups (Settings -> Backup & import)
    "career_ops": career_ops.DEFAULT_SETTINGS,  # automatic Scan + import / import on change
    "assistant": chat_service.DEFAULT_SETTINGS,  # the Assistant chat on/off, AI on/off
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
    if "scanner" in body:
        merged["scanner"] = validate_scanner_settings(merged["scanner"])
    if "goals" in body:
        merged["goals"] = goals_service.validate_goals(merged["goals"])
    if "backups" in body:
        merged["backups"] = backup_service.validate_settings(merged["backups"])
    if "assistant" in body:
        merged["assistant"] = chat_service.validate_settings(merged["assistant"])
    if "career_ops" in body:
        merged["career_ops"] = career_ops.validate_settings(merged["career_ops"])
    row.data = merged
    db.commit()
    return {**DEFAULT_APP_SETTINGS, **row.data}


@router.get("/extension.zip")
def extension_zip(request: Request, app: str | None = None) -> Response:
    """The Job collector Chrome extension, set up for this app (Settings -> Job sources).

    `app` is the address the UI runs on (defaults to this API's address, as in the Docker install).
    """
    api_url = str(request.base_url)
    data = extension_package.build_zip(api_url, app or api_url)
    return Response(data, media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="career-intelligence-extension.zip"'})


@router.get("/backups")
def backups(db: DB, settings: AppSettings) -> dict[str, Any]:
    """Backup settings, folder, whether pg_dump is available, and the backups (newest first)."""
    return backup_service.status(db, settings)


@router.post("/backups", status_code=201)
def backup_now(db: DB, settings: AppSettings) -> dict[str, Any]:
    """Make a backup now (database dump + data.json + uploaded files, zipped)."""
    return backup_service.create_backup(db, settings)


@router.get("/backups/{name}")
def download_backup(settings: AppSettings, name: str) -> FileResponse:
    path = backup_service.backup_file(settings, name)
    return FileResponse(path, media_type="application/zip", filename=path.name)


@router.get("/goals/week")
def goals_week(db: DB) -> dict[str, Any]:
    """This week's goals (Mon–Sun): target, done, left, per day needed, last week, streak."""
    targets = {**goals_service.DEFAULT_GOALS, **_app_settings(db).data.get("goals", {})}
    return goals_service.weekly(db, targets)


@router.get("/reminders")
def reminders(db: DB) -> dict[str, Any]:
    """Follow-ups due today or late, and interviews in the next 24 hours (for browser
    notifications)."""
    return goals_service.reminders(db)


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
        return {"kind": kind, **data_io.import_jobs(db, rows, label, origin="sheet")}
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
