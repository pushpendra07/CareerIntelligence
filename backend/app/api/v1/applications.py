from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.api.deps import DB
from app.core.pagination import Page, PageParams, page_params
from app.models.application import Application, FollowUp
from app.models.cv import CV
from app.schemas.application import (
    ApplicationCreate,
    ApplicationOut,
    ApplicationStatusIn,
    ApplicationUpdate,
    FollowUpIn,
    FollowUpOut,
    FollowUpUpdate,
    NoteIn,
)
from app.services import application_service as svc
from app.services.application_service import ApplicationFilters

router = APIRouter(tags=["applications"])


def app_out(db: DB, a: Application) -> ApplicationOut:
    out = ApplicationOut.model_validate(a)
    out.job_title = a.job.title
    out.match_score = a.job.match_score
    out.company_name = a.company.name
    if a.cv_version is not None:
        cv = db.get(CV, a.cv_version.cv_id)
        out.cv_name = f"{cv.name} v{a.cv_version.version_number}" if cv else None
    out.recruiter_name = a.recruiter.name if a.recruiter else None
    out.referral_name = a.referral.name if a.referral else None
    return out


@router.post("/applications", response_model=ApplicationOut, status_code=201)
def create(db: DB, body: ApplicationCreate) -> ApplicationOut:
    data = body.model_dump(exclude_unset=True, mode="python")
    job_id = data.pop("job_id")
    for key in ("method", "status"):
        if key in data:
            data[key] = data[key].value
    return app_out(db, svc.create_application(db, job_id, data))


@router.get("/applications", response_model=Page[ApplicationOut])
def list_apps(
    db: DB,
    params: Annotated[PageParams, Depends(page_params)],
    q: str | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    company_id: int | None = None,
    job_id: int | None = None,
    cv_version_id: int | None = None,
    applied_after: date | None = None,
    sort: Literal["-applied_on", "applied_on", "company", "-updated_at"] = "-applied_on",
) -> Page[ApplicationOut]:
    f = ApplicationFilters(
        q=q,
        status=status,
        company_id=company_id,
        job_id=job_id,
        cv_version_id=cv_version_id,
        applied_after=applied_after,
        sort=sort,
    )
    items, total = svc.list_applications(db, params, f)
    return Page(
        items=[app_out(db, a) for a in items], total=total, page=params.page, size=params.size
    )


@router.get("/applications/{application_id}", response_model=ApplicationOut)
def get(db: DB, application_id: int) -> ApplicationOut:
    return app_out(db, svc.get_application(db, application_id))


@router.patch("/applications/{application_id}", response_model=ApplicationOut)
def update(db: DB, application_id: int, body: ApplicationUpdate) -> ApplicationOut:
    changes = body.model_dump(exclude_unset=True)
    if changes.get("method") is not None:
        changes["method"] = changes["method"].value
    return app_out(db, svc.update_application(db, application_id, changes))


@router.post("/applications/{application_id}/status", response_model=ApplicationOut)
def set_status(db: DB, application_id: int, body: ApplicationStatusIn) -> ApplicationOut:
    return app_out(db, svc.change_status(db, application_id, body.status, body.note))


@router.post("/applications/{application_id}/notes", response_model=ApplicationOut)
def add_note(db: DB, application_id: int, body: NoteIn) -> ApplicationOut:
    return app_out(db, svc.add_note(db, application_id, body.note))


def fu_out(f: FollowUp) -> FollowUpOut:
    out = FollowUpOut.model_validate(f)
    out.job_title = f.job.title if f.job else None
    out.company_name = f.company.name if f.company else None
    out.contact_name = f.contact.name if f.contact else None
    out.overdue = not f.completed and f.due_date < date.today()
    return out


@router.get("/followups", response_model=Page[FollowUpOut])
def list_followups(
    db: DB,
    params: Annotated[PageParams, Depends(page_params)],
    completed: bool | None = False,
    due_before: date | None = None,
    kind: str | None = None,
    application_id: int | None = None,
) -> Page[FollowUpOut]:
    items, total = svc.list_followups(
        db,
        params,
        completed=completed,
        due_before=due_before,
        kind=kind,
        application_id=application_id,
    )
    return Page(items=[fu_out(f) for f in items], total=total, page=params.page, size=params.size)


@router.post("/followups", response_model=FollowUpOut, status_code=201)
def create_followup(db: DB, body: FollowUpIn) -> FollowUpOut:
    data = body.model_dump(exclude_unset=True)
    data["kind"] = body.kind.value
    return fu_out(svc.save_followup(db, data))


@router.patch("/followups/{followup_id}", response_model=FollowUpOut)
def update_followup(db: DB, followup_id: int, body: FollowUpUpdate) -> FollowUpOut:
    return fu_out(svc.save_followup(db, body.model_dump(exclude_unset=True), followup_id))


@router.post("/followups/{followup_id}/complete", response_model=FollowUpOut)
def complete(db: DB, followup_id: int, body: NoteIn | None = None) -> FollowUpOut:
    return fu_out(svc.complete_followup(db, followup_id, body.note if body else None))
