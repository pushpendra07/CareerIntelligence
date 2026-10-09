from datetime import datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import DB
from app.integrations import saved_sheets as svc
from app.models.sheet import SavedSheet

router = APIRouter(prefix="/sheets", tags=["sheets"])


class SheetOut(BaseModel):
    id: int
    url: str
    title: str
    spreadsheet_id: str
    created_at: datetime
    last_imported_at: datetime | None
    last_result: dict[str, Any] | None
    last_error: str | None


def _out(s: SavedSheet) -> SheetOut:
    return SheetOut(id=s.id, url=s.url, title=s.title, spreadsheet_id=s.spreadsheet_id,
                    created_at=s.created_at, last_imported_at=s.last_imported_at,
                    last_result=s.last_result, last_error=s.last_error)


class SheetIn(BaseModel):
    url: str = Field(min_length=10, max_length=2000)
    title: str | None = Field(default=None, max_length=300)


class TabRows(BaseModel):
    tab: str = Field(default="", max_length=200)
    rows: list[dict[str, Any]] = Field(max_length=20000)


class RowsIn(BaseModel):
    tabs: list[TabRows] = Field(min_length=1, max_length=50)


@router.get("", response_model=list[SheetOut])
def list_sheets(db: DB) -> list[SheetOut]:
    return [_out(s) for s in svc.list_sheets(db)]


@router.post("", response_model=SheetOut, status_code=201)
def add_sheet(db: DB, body: SheetIn) -> SheetOut:
    return _out(svc.add_sheet(db, body.url, body.title))


@router.delete("/{sheet_id}", status_code=204)
def delete_sheet(db: DB, sheet_id: int) -> None:
    svc.delete_sheet(db, sheet_id)


@router.post("/{sheet_id}/import", response_model=SheetOut)
def import_sheet(db: DB, sheet_id: int) -> SheetOut:
    """Download and import the sheet. 409 with a hint when the sheet is private."""
    return _out(svc.import_direct(db, svc.get_sheet(db, sheet_id)))


@router.post("/{sheet_id}/import-rows", response_model=SheetOut)
def import_rows(db: DB, sheet_id: int, body: RowsIn) -> SheetOut:
    """Import rows read elsewhere (e.g. by Claude through the Google Drive connector)."""
    sheet = svc.get_sheet(db, sheet_id)
    return _out(svc.import_tabs(db, sheet, [(t.tab, t.rows) for t in body.tabs], via="connector"))
