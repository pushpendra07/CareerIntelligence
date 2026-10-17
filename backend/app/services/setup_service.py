"""First-run setup ("Welcome" wizard): what a fresh install still needs, adding the first
companies by careers URL, and remembering that setup is finished.

A new install (no CVs and no jobs) opens the wizard; an install that already has data never
does. Finishing or skipping it stores `setup.completed_at` in the app settings row.
"""

import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError
from app.core.text import company_key
from app.models.app_settings import AppSettings
from app.models.company import Company
from app.models.cv import CV
from app.models.job import Job
from app.models.profile import TargetProfile
from app.scanner.providers import resolve_board
from app.scanner.service import board_for
from app.services import company_service

MAX_COMPANIES = 50


def _row(db: Session) -> AppSettings:
    row = db.get(AppSettings, 1)
    if row is None:
        row = AppSettings(id=1, data={})
        db.add(row)
        db.flush()
    return row


def status(db: Session) -> dict[str, Any]:
    cvs = db.scalar(select(func.count()).select_from(CV)) or 0
    jobs = db.scalar(select(func.count()).select_from(Job)) or 0
    scannable = sum(
        1 for c in db.scalars(select(Company).where(Company.job_search_enabled.is_(True)))
        if board_for(c)
    )
    target = db.scalar(select(TargetProfile).limit(1))
    completed_at = ((_row(db).data or {}).get("setup") or {}).get("completed_at")
    return {
        "needs_setup": completed_at is None and cvs == 0 and jobs == 0,
        "completed_at": completed_at,
        "steps": {
            "cv": cvs > 0,
            "targets": bool(target and target.target_titles),
            "companies": scannable > 0,
            "jobs": jobs > 0,
        },
        "counts": {"cvs": cvs, "jobs": jobs, "scannable_companies": scannable},
    }


def complete(db: Session) -> dict[str, Any]:
    row = _row(db)
    row.data = {**(row.data or {}), "setup": {"completed_at": datetime.now(UTC).isoformat()}}
    db.commit()
    return status(db)


def _name_from(url: str, slug: str | None) -> str:
    """A readable company name from a board slug or the site's domain (acme-labs → Acme Labs)."""
    raw = slug or (urlparse(url).hostname or "").removeprefix("www.").removeprefix("careers.")
    raw = raw.split(".")[0] if not slug else raw
    words = re.split(r"[-_\s]+", raw)
    return " ".join(w.capitalize() for w in words if w) or url


def add_companies(db: Session, items: list[dict[str, str | None]]) -> list[dict[str, Any]]:
    """Save each careers / job-board URL as a company with Job search on.

    Returns, per URL, the company and whether its job board can be scanned. A company that
    already exists (same name) gets the URL added and Job search turned on.
    """
    if not items:
        raise DomainValidationError("Add at least one careers page or job board URL")
    if len(items) > MAX_COMPANIES:
        raise DomainValidationError(f"At most {MAX_COMPANIES} companies at a time")
    out: list[dict[str, Any]] = []
    for item in items:
        url = (item.get("url") or "").strip()
        if not re.match(r"^https?://[^\s/]+\.[^\s]+", url):
            out.append({"url": url, "error": "Not a web address (start with https://)"})
            continue
        board = resolve_board(url)
        name = (item.get("name") or "").strip() or _name_from(url, board.slug if board else None)
        existing = db.scalar(select(Company).where(Company.name_key == company_key(name)))
        data: dict[str, Any] = {"careers_url": url, "job_search_enabled": True}
        if existing is None:
            company = company_service.create_company(db, {"name": name, **data})
        else:
            company = company_service.update_company(db, existing.id, data)
        found = board_for(company)
        out.append({
            "url": url, "company_id": company.id, "name": company.name,
            "created": existing is None,
            "board": {"provider": found.provider, "url": found.url} if found else None,
        })
    return out
