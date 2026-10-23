"""Google Sheets kept in Settings and imported on demand.

Rows reach the normal importers (deduplication, JD parsing, scoring) either way:
- "direct": the app downloads the sheet itself (works for sheets shared by link);
- "google_api": private sheets, read with the app's Google service account (all tabs);
- "connector": an agent reads a private sheet through a Google connector and posts the rows to
  `/sheets/{id}/import-rows`.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.core.http import BlockedURLError, Fetcher, safe_get
from app.integrations import google_api
from app.integrations.google_sheets import (
    detect_kind,
    export_url,
    fetch_rows,
    parse_sheet_url,
    rows_from_values,
)
from app.models.sheet import SavedSheet

PRIVATE_HINT = (
    "This sheet is private. To import it from here, connect a Google service account once "
    "(Settings → Google Sheets → 'Connect private sheets') and share the sheet with it as Viewer. "
    "Or share the sheet as 'Anyone with the link → Viewer'."
)


def list_sheets(db: Session) -> list[SavedSheet]:
    return list(db.scalars(select(SavedSheet).order_by(SavedSheet.id)))


def get_sheet(db: Session, sheet_id: int) -> SavedSheet:
    sheet = db.get(SavedSheet, sheet_id)
    if sheet is None:
        raise NotFoundError("Saved sheet not found")
    return sheet


def add_sheet(db: Session, url: str, title: str | None = None) -> SavedSheet:
    spreadsheet_id, _ = parse_sheet_url(url)
    if db.scalar(select(SavedSheet.id).where(SavedSheet.spreadsheet_id == spreadsheet_id)):
        raise ConflictError("This sheet is already saved")
    sheet = SavedSheet(spreadsheet_id=spreadsheet_id, url=url.strip(),
                       title=(title or "").strip() or "Google Sheet", meta={})
    db.add(sheet)
    db.commit()
    return sheet


def delete_sheet(db: Session, sheet_id: int) -> None:
    db.delete(get_sheet(db, sheet_id))
    db.commit()


def _import_tab(db: Session, label: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    from app.companies.importers import records_from_rows
    from app.services import data_io
    from app.services.company_service import import_records

    if not rows:
        return {"kind": None, "read": 0, "created": 0, "merged": 0, "errors": 0}
    kind = detect_kind(rows)
    if kind == "jobs":
        stats = data_io.import_jobs(db, rows, label, origin="sheet")
        return {"kind": kind, "read": stats["read"], "created": stats["created"],
                "merged": stats["merged"], "deleted_skipped": stats.get("deleted_skipped", 0),
                "filtered_skipped": stats.get("filtered_skipped", 0),
                "errors": len(stats["errors"])}
    summary = import_records(db, records_from_rows(rows, "google_sheet"), "google_sheet")
    return {"kind": kind, "read": summary.read, "created": summary.created,
            "merged": summary.merged, "errors": len(summary.errors)}


def import_tabs(db: Session, sheet: SavedSheet, tabs: list[tuple[str, list[dict[str, Any]]]],
                via: str) -> SavedSheet:
    results = []
    for tab, rows in tabs:
        label = f"{sheet.title} · {tab}" if tab else sheet.title
        try:
            results.append({"tab": tab, **_import_tab(db, label, rows)})
        except DomainValidationError as exc:
            results.append({"tab": tab, "kind": None, "error": exc.message})
    sheet.last_result = {
        "via": via,
        "tabs": results,
        "created": sum(r.get("created", 0) for r in results),
        "merged": sum(r.get("merged", 0) for r in results),
    }
    sheet.last_imported_at = datetime.now(UTC)
    sheet.last_error = None
    db.commit()
    return sheet


def access_info(settings: Settings) -> dict[str, Any]:
    """How the app can read sheets: service account (private sheets) or link-shared only."""
    path = google_api.key_file(settings.google_service_account_file)
    if path is None:
        return {"service_account": None, "key_file": str(google_api.DEFAULT_KEY_FILE),
                "error": None}
    try:
        return {"service_account": google_api.ServiceAccount.load(path).email,
                "key_file": str(path), "error": None}
    except DomainValidationError as exc:
        return {"service_account": None, "key_file": str(path), "error": exc.message}


def import_direct(db: Session, sheet: SavedSheet, settings: Settings) -> SavedSheet:
    """Import every tab. Private sheets need the service account; otherwise the public CSV."""
    path = google_api.key_file(settings.google_service_account_file)
    try:
        if path is not None:
            account = google_api.ServiceAccount.load(path)
            title, tabs = google_api.read_all_tabs(account, sheet.spreadsheet_id)
            if title and sheet.title in ("", "Google Sheet"):
                sheet.title = title
            rows = [(tab, rows_from_values(values)) for tab, values in tabs]
            return import_tabs(db, sheet, rows, via="google_api")
        return import_tabs(db, sheet, [("", fetch_rows(sheet.url))], via="direct")
    except DomainValidationError as exc:
        private = "not public" in exc.message
        sheet.last_error = PRIVATE_HINT if private else exc.message
        db.commit()
        raise ConflictError(sheet.last_error,
                            {"reason": "private" if private else "error"}) from exc


def check_access(sheet: SavedSheet, settings: Settings,
                 fetch: Fetcher | None = None) -> dict[str, Any]:
    """Can Import read this sheet right now? Asked before the user clicks Import.

    With a service account the answer depends on whether the sheet is shared with it, which
    only an import can tell, so `readable` is None. Otherwise Google is asked for the CSV: a
    sign-in page (401/403) means the sheet is private.
    """
    if google_api.key_file(settings.google_service_account_file) is not None:
        return {"readable": None, "via": "service_account", "reason": None, "message": None}
    _, gid = parse_sheet_url(sheet.url)
    try:
        res = (fetch or (lambda u: safe_get(u, timeout=15, max_bytes=4096)))(
            export_url(sheet.spreadsheet_id, gid))
    except (BlockedURLError, OSError) as exc:
        return {"readable": None, "via": "link", "reason": "error",
                "message": f"Couldn't reach Google: {exc}"}
    looks_html = res.text.lstrip()[:15].lower().startswith(("<!doctype", "<html"))
    if res.status in (401, 403) or (res.status == 200 and looks_html):
        return {"readable": False, "via": "link", "reason": "private", "message": PRIVATE_HINT}
    if res.status == 404:
        return {"readable": False, "via": "link", "reason": "not_found",
                "message": "Google can't find this sheet — it may have been deleted or the link "
                           "changed."}
    if res.status != 200:
        return {"readable": None, "via": "link", "reason": "error",
                "message": f"Google returned HTTP {res.status}"}
    return {"readable": True, "via": "link", "reason": None, "message": None}
