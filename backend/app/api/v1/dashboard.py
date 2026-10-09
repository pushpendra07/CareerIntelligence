from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.api.deps import DB
from app.services import dashboard_service as svc

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
def dashboard(db: DB) -> dict[str, Any]:
    return {
        "summary": svc.summary(db),
        "priorities": svc.priorities(db),
        "funnels": svc.funnels(db),
    }


@router.get("/dashboard/summary")
def summary(db: DB) -> dict[str, int]:
    return svc.summary(db)


@router.get("/dashboard/charts")
def charts(db: DB) -> dict[str, Any]:
    return svc.charts(db)


@router.get("/dashboard/funnels")
def funnels(db: DB) -> dict[str, Any]:
    return svc.funnels(db)


@router.get("/dashboard/priorities")
def priorities(db: DB) -> list[dict[str, Any]]:
    return svc.priorities(db)


@router.get("/dashboard/analytics")
def analytics(db: DB) -> dict[str, Any]:
    return {
        "scores": svc.score_analytics(db),
        "skill_gaps": svc.skill_gaps(db, 25),
        "top_requested_skills": svc.top_requested_skills(db, 25),
    }


@router.get("/search")
def search(db: DB, q: Annotated[str, Query(min_length=2, max_length=100)]) -> dict[str, Any]:
    return svc.global_search(db, q)
