from fastapi import APIRouter

from app.api.v1 import (
    applications,
    career_ops,
    companies,
    cvs,
    dashboard,
    health,
    interviews,
    jobs,
    offers,
    profile,
    scanner,
    system,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(dashboard.router)
api_router.include_router(cvs.router)
api_router.include_router(profile.router)
api_router.include_router(companies.router)
api_router.include_router(jobs.router)
api_router.include_router(applications.router)
api_router.include_router(interviews.router)
api_router.include_router(offers.router)
api_router.include_router(career_ops.router)
api_router.include_router(scanner.router)
api_router.include_router(system.router)
