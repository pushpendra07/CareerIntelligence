from fastapi import APIRouter

from app.api.v1 import (
    advisor,
    ai_job_search,
    applications,
    apply,
    auth,
    career_ops,
    chat,
    companies,
    cv_tailor,
    cvs,
    dashboard,
    email,
    health,
    interviews,
    jobs,
    offers,
    profile,
    reminder_rules,
    reports,
    scanner,
    setup,
    sheets,
    system,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(cvs.router)
api_router.include_router(profile.router)
api_router.include_router(companies.router)
api_router.include_router(jobs.router)
api_router.include_router(cv_tailor.router)
api_router.include_router(apply.router)
api_router.include_router(applications.router)
api_router.include_router(email.router)
api_router.include_router(interviews.router)
api_router.include_router(offers.router)
api_router.include_router(reports.router)
api_router.include_router(career_ops.router)
api_router.include_router(ai_job_search.router)
api_router.include_router(scanner.router)
api_router.include_router(setup.router)
api_router.include_router(reminder_rules.router)
api_router.include_router(sheets.router)
api_router.include_router(advisor.router)
api_router.include_router(chat.router)
api_router.include_router(system.router)
