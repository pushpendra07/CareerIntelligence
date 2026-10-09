from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def readiness(db: Annotated[Session, Depends(get_db)]) -> JSONResponse:
    """Database reachable + migrations applied; also reports the Career-Ops mount."""
    checks: dict[str, Any] = {}
    ok = True
    try:
        checks["database"] = "ok"
        checks["migration"] = db.scalar(text("SELECT version_num FROM alembic_version"))
    except SQLAlchemyError:
        ok = False
        checks["database"] = "unavailable"
    root = get_settings().career_ops_data_root
    checks["career_ops"] = (
        "not_configured" if root is None else ("ok" if root.is_dir() else "missing")
    )
    return JSONResponse(
        {"status": "ok" if ok else "degraded", "checks": checks}, status_code=200 if ok else 503
    )
