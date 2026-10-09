"""Import jobs or companies from a Google Sheet tab.

Works without API keys for sheets shared as "Anyone with the link → Viewer": the tab is read
through Google's CSV export. Private sheets are refused with a clear message (download the tab
as CSV and upload it instead). Rows go through the normal importers, never straight to the DB.
"""

import csv
import io
import re
from typing import Any, Literal

from app.core.errors import DomainValidationError
from app.core.http import BlockedURLError, Fetcher, safe_get

SHEET_RE = re.compile(r"docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]{20,})")
GID_RE = re.compile(r"[#?&]gid=(\d+)")
MAX_SHEET_BYTES = 8 * 1024 * 1024


def parse_sheet_url(url: str) -> tuple[str, str | None]:
    m = SHEET_RE.search(url or "")
    if not m:
        raise DomainValidationError("Not a Google Sheets URL")
    gid = GID_RE.search(url)
    return m.group(1), gid.group(1) if gid else None


def export_url(sheet_id: str, gid: str | None) -> str:
    base = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
    return f"{base}&gid={gid}" if gid else base


def rows_from_values(values: list[list[str]]) -> list[dict[str, str]]:
    """First non-empty row is the header; blank rows are dropped."""
    rows = [r for r in values if any(str(c).strip() for c in r)]
    if not rows:
        return []
    header = [str(h).strip() for h in rows[0]]
    return [
        {header[i]: (r[i] if i < len(r) else "") for i in range(len(header)) if header[i]}
        for r in rows[1:]
    ]


def detect_kind(rows: list[dict[str, Any]]) -> Literal["jobs", "companies"]:
    keys = {re.sub(r"[^a-z0-9]+", "_", k.lower()).strip("_") for r in rows[:5] for k in r}
    if keys & {"job_title", "title", "role", "position"}:
        return "jobs"
    if keys & {"company_name", "company", "name"}:
        return "companies"
    raise DomainValidationError(
        "Could not tell whether this tab holds jobs or companies "
        "(expected a 'Job Title' or 'Company Name' column)"
    )


def fetch_rows(url: str, fetch: Fetcher | None = None) -> list[dict[str, str]]:
    sheet_id, gid = parse_sheet_url(url)
    try:
        result = (fetch or (lambda u: safe_get(u, timeout=30, max_bytes=MAX_SHEET_BYTES)))(
            export_url(sheet_id, gid)
        )
    except (BlockedURLError, OSError) as exc:
        raise DomainValidationError(f"Could not download the sheet: {exc}") from exc
    looks_html = result.text.lstrip()[:15].lower().startswith(("<!doctype", "<html"))
    if result.status in (401, 403) or looks_html:
        raise DomainValidationError(
            "This sheet is not public. Share it as 'Anyone with the link → Viewer', or use "
            "File → Download → CSV and import the file instead."
        )
    if result.status != 200:
        raise DomainValidationError(f"Google returned HTTP {result.status} for this sheet")
    return rows_from_values(list(csv.reader(io.StringIO(result.text))))
