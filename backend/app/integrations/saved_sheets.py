"""Google Sheets kept in Settings and imported on demand.

Rows reach the normal importers (deduplication, JD parsing, scoring) either way:
- "direct": the app downloads the sheet itself (works for sheets shared by link);
- "connector": Claude reads a private sheet through the Google Drive/Sheets connector and
  posts the rows to `/sheets/{id}/import-rows`.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.integrations.google_sheets import detect_kind, fetch_rows, parse_sheet_url
from app.models.sheet import SavedSheet

PRIVATE_HINT = (
    "This sheet is private, so the app can't open it. Ask Claude to import it "
    "(it reads the sheet through your Google Drive connector), or share the sheet as "
    "'Anyone with the link → Viewer'."
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
        stats = data_io.import_jobs(db, rows, label)
        return {"kind": kind, "read": stats["read"], "created": stats["created"],
                "merged": stats["merged"], "deleted_skipped": stats.get("deleted_skipped", 0),
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


def import_direct(db: Session, sheet: SavedSheet) -> SavedSheet:
    """Download the sheet as CSV (sheets shared by link). Private sheets get a clear hint."""
    try:
        rows = fetch_rows(sheet.url)
    except DomainValidationError as exc:
        sheet.last_error = PRIVATE_HINT if "not public" in exc.message else exc.message
        db.commit()
        raise ConflictError(sheet.last_error) from exc
    return import_tabs(db, sheet, [("", rows)], via="direct")
