from typing import Any

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import DB, AppSettings
from app.integrations.career_ops import service
from app.models.career_ops import CareerOpsImport
from app.services.job_service import get_job

router = APIRouter(prefix="/career-ops", tags=["career-ops"])


def _run_out(run: CareerOpsImport) -> dict[str, Any]:
    return {
        "id": run.id,
        "status": run.status,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "data_root": run.data_root,
        "career_ops_version": run.career_ops_version,
        "scan_triggered": run.scan_triggered,
        "scan_receipt": run.scan_receipt,
        "stats": run.stats,
        "errors": run.errors,
    }


@router.get("/status")
def status(db: DB, settings: AppSettings) -> dict[str, Any]:
    return service.status(db, settings)


@router.post("/import")
def import_now(db: DB, settings: AppSettings) -> dict[str, Any]:
    """Read Career-Ops' files (read-only) and import/refresh jobs and evaluations."""
    return _run_out(service.import_from_career_ops(db, settings, run_scan=False))


@router.post("/sync")
def sync(db: DB, settings: AppSettings) -> dict[str, Any]:
    """Run Career-Ops' own scanner (`node scan.mjs --json`), then import. Opt-in."""
    return _run_out(service.import_from_career_ops(db, settings, run_scan=True))


@router.get("/imports")
def imports(db: DB) -> list[dict[str, Any]]:
    rows = db.scalars(select(CareerOpsImport).order_by(CareerOpsImport.id.desc()).limit(50))
    return [_run_out(r) for r in rows]


@router.post("/jobs/{job_id}/fetch-jd")
def fetch_jd(db: DB, settings: AppSettings, job_id: int) -> dict[str, Any]:
    """Fetch a missing JD through Career-Ops' `fetch-jd.mjs` (public ATS APIs only)."""
    ok = service.fetch_missing_jd(db, settings, get_job(db, job_id))
    return {"job_id": job_id, "fetched": ok}
