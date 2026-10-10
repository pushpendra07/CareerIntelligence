from collections import Counter
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DB
from app.core.errors import NotFoundError
from app.models.company import Company
from app.models.scan import ScanRun
from app.scanner import runner, service
from app.scanner.providers import SUPPORTED

router = APIRouter(prefix="/scanner", tags=["scanner"])


def _run_out(run: ScanRun, full: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": run.id, "kind": run.kind, "trigger": run.trigger, "status": run.status,
        "started_at": run.started_at, "finished_at": run.finished_at, "stats": run.stats,
    }
    if full:
        out["companies"] = run.companies
    return out


class RunIn(BaseModel):
    company_ids: list[int] | None = None
    wait: bool = False  # run inside the request (used by tests and single-company scans)


@router.get("/status")
def status(db: DB) -> dict[str, Any]:
    """Which companies the scanner covers, and the latest runs."""
    disabled = db.scalars(select(Company).where(Company.job_search_enabled.is_(False)))
    ready_off = [c for c in disabled if service.board_for(c)]
    enabled = list(db.scalars(select(Company).where(Company.job_search_enabled.is_(True))))
    boards = {c.id: service.board_for(c) for c in enabled}
    by_provider = Counter(b.provider for b in boards.values() if b)
    last = db.scalar(select(ScanRun).where(ScanRun.kind == "SCAN")
                     .order_by(ScanRun.id.desc()).limit(1))
    running = runner.running_run(db) or runner.running_run(db, "DETECT")
    return {
        "supported_boards": SUPPORTED,
        "job_search_enabled": len(enabled),
        "scannable": sum(by_provider.values()),
        "by_provider": dict(by_provider.most_common()),
        "not_scannable": [{"id": c.id, "name": c.name, "careers_url": c.careers_url}
                          for c in enabled if not boards[c.id]],
        "running": _run_out(running) if running else None,
        "last_run": _run_out(last) if last else None,
        "settings": service.scanner_settings(db),
        # Companies whose job board is known but that aren't searched yet (Job search off).
        "boards_not_searched": [{"id": c.id, "name": c.name} for c in ready_off],
    }


@router.post("/enable-found")
def enable_found(db: DB) -> dict[str, Any]:
    """Turn on Job search for every company whose job board is known."""
    turned_on = []
    for c in db.scalars(select(Company).where(Company.job_search_enabled.is_(False))):
        if service.board_for(c):
            c.job_search_enabled = True
            turned_on.append(c.name)
    db.commit()
    return {"enabled": len(turned_on), "companies": turned_on}


@router.post("/run")
def run(db: DB, body: RunIn | None = None) -> dict[str, Any]:
    body = body or RunIn()
    if body.wait:
        return _run_out(service.run_scan(db, company_ids=body.company_ids), full=True)
    return _run_out(runner.start_background(db, "SCAN", body.company_ids))


@router.post("/detect-boards")
def detect(db: DB, body: RunIn | None = None) -> dict[str, Any]:
    """Look at careers pages for a linked Greenhouse/Lever/Workday/... board."""
    body = body or RunIn()
    if body.wait:
        return _run_out(service.detect_boards(db, body.company_ids), full=True)
    return _run_out(runner.start_background(db, "DETECT", body.company_ids))


@router.post("/companies/{company_id}/scan")
def scan_company(db: DB, company_id: int) -> dict[str, Any]:
    company = db.get(Company, company_id)
    if company is None:
        raise NotFoundError("Company not found")
    if service.board_for(company) is None:
        detected = service.detect_boards(db, [company_id])
        if not detected.stats.get("found"):
            return {"board": None, "run": _run_out(detected, full=True)}
    run = service.run_scan(db, company_ids=[company_id])
    board = service.board_for(company)
    return {"board": {"provider": board.provider, "url": board.url} if board else None,
            "run": _run_out(run, full=True)}


@router.get("/companies/{company_id}/board")
def company_board(db: DB, company_id: int) -> dict[str, Any] | None:
    company = db.get(Company, company_id)
    if company is None:
        raise NotFoundError("Company not found")
    board = service.board_for(company)
    return {"provider": board.provider, "url": board.url} if board else None


@router.get("/runs")
def runs(db: DB, limit: int = Query(20, ge=1, le=100)) -> list[dict[str, Any]]:
    rows = db.scalars(select(ScanRun).order_by(ScanRun.id.desc()).limit(limit))
    return [_run_out(r) for r in rows]


@router.get("/runs/{run_id}")
def run_detail(db: DB, run_id: int) -> dict[str, Any]:
    row = db.get(ScanRun, run_id)
    if row is None:
        raise NotFoundError("Scan run not found")
    return _run_out(row, full=True)
