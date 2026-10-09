from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.core.pagination import PageParams, paginate
from app.models.application import (
    Application,
    ApplicationEvent,
    ApplicationStatus,
    FollowUp,
    FollowUpKind,
)
from app.models.company import Company, Contact
from app.models.cv import CV, CVVersion
from app.models.job import Job, JobStatus
from app.services.activity import record_activity

FIRST_FOLLOW_UP_DAYS = 7
OPEN_STATUSES = {
    ApplicationStatus.APPLIED,
    ApplicationStatus.RECRUITER_CONTACTED,
    ApplicationStatus.SCREENING,
    ApplicationStatus.INTERVIEW,
    ApplicationStatus.OFFER,
    ApplicationStatus.ON_HOLD,
}
# Career-Ops tracker state -> application status (initial import only).
CAREER_OPS_APPLICATION_STATUS = {
    "applied": ApplicationStatus.APPLIED,
    "responded": ApplicationStatus.RECRUITER_CONTACTED,
    "interview": ApplicationStatus.INTERVIEW,
    "offer": ApplicationStatus.OFFER,
    "hired": ApplicationStatus.ACCEPTED,
    "rejected": ApplicationStatus.REJECTED,
}


def _load(db: Session, application_id: int) -> Application:
    app = db.scalar(
        select(Application)
        .options(
            selectinload(Application.events),
            selectinload(Application.job),
            selectinload(Application.company),
            selectinload(Application.cv_version),
            selectinload(Application.recruiter),
            selectinload(Application.referral),
        )
        .where(Application.id == application_id)
    )
    if app is None:
        raise NotFoundError(f"Application {application_id} not found")
    return app


get_application = _load


def _sync_job_status(db: Session, job: Job, status: ApplicationStatus, note: str | None) -> None:
    from app.services.job_service import set_status

    set_status(db, job.id, JobStatus(status.value), note, commit=False)


def _default_cv_version(db: Session, job: Job) -> int | None:
    cv_id = job.recommended_cv_id
    if cv_id is None:
        cv_id = db.scalar(select(CV.id).where(CV.is_active))
    if cv_id is None:
        return None
    cv = db.get(CV, cv_id)
    return cv.current_version_id if cv else None


def _contact(db: Session, contact_id: int | None) -> None:
    if contact_id is not None and db.get(Contact, contact_id) is None:
        raise DomainValidationError(f"Contact {contact_id} not found")


def create_application(
    db: Session, job_id: int, data: dict[str, Any], *, origin: str = "manual", commit: bool = True
) -> Application:
    job = db.get(Job, job_id)
    if job is None:
        raise NotFoundError(f"Job {job_id} not found")
    open_existing = db.scalar(
        select(Application.id).where(
            Application.job_id == job_id, Application.status.in_([s.value for s in OPEN_STATUSES])
        )
    )
    if open_existing:
        raise ConflictError(f"Job {job_id} already has an open application ({open_existing})")
    cv_version_id = data.get("cv_version_id") or _default_cv_version(db, job)
    if cv_version_id is not None and db.get(CVVersion, cv_version_id) is None:
        raise DomainValidationError(f"CV version {cv_version_id} not found")
    _contact(db, data.get("recruiter_contact_id"))
    _contact(db, data.get("referral_contact_id"))
    applied_on = data.get("applied_on") or date.today()
    status = ApplicationStatus(data.get("status") or ApplicationStatus.APPLIED)
    follow_up = data.get("follow_up_date")
    if follow_up is None and status in OPEN_STATUSES and origin == "manual":
        follow_up = applied_on + timedelta(days=FIRST_FOLLOW_UP_DAYS)
    app = Application(
        job_id=job.id,
        company_id=job.company_id,
        applied_on=applied_on,
        method=data.get("method") or "OTHER",
        cv_version_id=cv_version_id,
        cover_letter=data.get("cover_letter"),
        recruiter_contact_id=data.get("recruiter_contact_id") or job.recruiter_contact_id,
        referral_contact_id=data.get("referral_contact_id"),
        referral_note=data.get("referral_note"),
        status=status.value,
        expected_salary=data.get("expected_salary"),
        salary_currency=data.get("salary_currency"),
        notice_period_days=data.get("notice_period_days"),
        follow_up_date=follow_up,
        notes=data.get("notes"),
        origin=origin,
    )
    db.add(app)
    db.flush()
    app.events.append(
        ApplicationEvent(event_type="CREATED", to_status=status.value, note=data.get("notes"))
    )
    if follow_up and status in OPEN_STATUSES:
        db.add(
            FollowUp(
                kind=FollowUpKind.APPLICATION.value,
                title=f"Follow up: {job.title}",
                due_date=follow_up,
                job_id=job.id,
                company_id=job.company_id,
                contact_id=app.recruiter_contact_id,
                application_id=app.id,
            )
        )
    _sync_job_status(db, job, status, "application created")
    record_activity(
        db,
        "application.created",
        "application",
        app.id,
        f"Applied: {job.title}",
        {"job_id": job.id, "cv_version_id": cv_version_id, "method": app.method, "origin": origin},
    )
    if commit:
        db.commit()
    return _load(db, app.id)


def update_application(db: Session, application_id: int, changes: dict[str, Any]) -> Application:
    app = _load(db, application_id)
    if "status" in changes:
        raise DomainValidationError("Use the status endpoint to change status")
    if (
        "cv_version_id" in changes
        and changes["cv_version_id"] is not None
        and db.get(CVVersion, changes["cv_version_id"]) is None
    ):
        raise DomainValidationError("CV version not found")
    _contact(db, changes.get("recruiter_contact_id"))
    _contact(db, changes.get("referral_contact_id"))
    for key, value in changes.items():
        setattr(app, key, value)
    if "notes" in changes and changes["notes"]:
        app.events.append(ApplicationEvent(event_type="NOTE", note=changes["notes"]))
    record_activity(
        db, "application.updated", "application", app.id, None, {"fields": sorted(changes)}
    )
    db.commit()
    return _load(db, application_id)


def change_status(
    db: Session, application_id: int, status: ApplicationStatus, note: str | None = None
) -> Application:
    app = _load(db, application_id)
    if app.status == status.value:
        return app
    before = app.status
    app.status = status.value
    app.events.append(
        ApplicationEvent(
            event_type="STATUS_CHANGED", from_status=before, to_status=status.value, note=note
        )
    )
    if status not in OPEN_STATUSES:
        for f in db.scalars(
            select(FollowUp).where(FollowUp.application_id == app.id, FollowUp.completed.is_(False))
        ):
            f.completed, f.completed_at = True, datetime.now(UTC)
    _sync_job_status(db, app.job, status, note)
    action = (
        "recruiter.contacted"
        if status == ApplicationStatus.RECRUITER_CONTACTED
        else "status.changed"
    )
    record_activity(
        db,
        action,
        "application",
        app.id,
        f"{before} → {status.value}",
        {"from": before, "to": status.value, "job_id": app.job_id, "note": note},
    )
    db.commit()
    return _load(db, application_id)


def add_note(db: Session, application_id: int, note: str) -> Application:
    app = _load(db, application_id)
    app.events.append(ApplicationEvent(event_type="NOTE", note=note))
    db.commit()
    return _load(db, application_id)


@dataclass
class ApplicationFilters:
    q: str | None = None
    status: list[str] | None = None
    company_id: int | None = None
    job_id: int | None = None
    cv_version_id: int | None = None
    applied_after: date | None = None
    sort: str = "-applied_on"


def list_applications(
    db: Session, params: PageParams, f: ApplicationFilters
) -> tuple[list[Application], int]:
    stmt: Select[Any] = (
        select(Application)
        .join(Job, Application.job_id == Job.id)
        .join(Company, Application.company_id == Company.id)
        .options(
            selectinload(Application.job),
            selectinload(Application.company),
            selectinload(Application.cv_version),
            selectinload(Application.events),
            selectinload(Application.recruiter),
            selectinload(Application.referral),
        )
    )
    if f.q:
        like = f"%{f.q.strip()}%"
        stmt = stmt.where(or_(Job.title.ilike(like), Company.name.ilike(like)))
    if f.status:
        stmt = stmt.where(Application.status.in_(f.status))
    if f.company_id:
        stmt = stmt.where(Application.company_id == f.company_id)
    if f.job_id:
        stmt = stmt.where(Application.job_id == f.job_id)
    if f.cv_version_id:
        stmt = stmt.where(Application.cv_version_id == f.cv_version_id)
    if f.applied_after:
        stmt = stmt.where(Application.applied_on >= f.applied_after)
    order: dict[str, Any] = {
        "-applied_on": Application.applied_on.desc(),
        "applied_on": Application.applied_on.asc(),
        "company": Company.name.asc(),
        "-updated_at": Application.updated_at.desc(),
    }
    stmt = stmt.order_by(order.get(f.sort, Application.applied_on.desc()), Application.id.desc())
    return paginate(db, stmt, params)


def ensure_application_for_imported_job(db: Session, job: Job) -> bool:
    """Career-Ops tracked this job as applied: record the application once."""
    status = CAREER_OPS_APPLICATION_STATUS.get((job.career_ops_status or "").lower())
    if status is None:
        return False
    if db.scalar(select(Application.id).where(Application.job_id == job.id)):
        return False
    tracker = (job.career_ops_evaluation or {}).get("tracker") or {}
    applied_on = date.fromisoformat(tracker["date"]) if tracker.get("date") else date.today()
    create_application(
        db,
        job.id,
        {
            "applied_on": applied_on,
            "status": status.value,
            "method": "OTHER",
            "notes": f"Imported from Career-Ops tracker #{tracker.get('num')}: "
            f"{tracker.get('notes') or ''}".strip(),
        },
        origin="career_ops",
        commit=False,
    )
    return True


# --- follow-ups ----------------------------------------------------------------------------


def list_followups(
    db: Session,
    params: PageParams,
    *,
    completed: bool | None = False,
    due_before: date | None = None,
    kind: str | None = None,
    application_id: int | None = None,
) -> tuple[list[FollowUp], int]:
    stmt: Select[Any] = select(FollowUp).options(
        selectinload(FollowUp.job), selectinload(FollowUp.company), selectinload(FollowUp.contact)
    )
    if completed is not None:
        stmt = stmt.where(FollowUp.completed.is_(completed))
    if due_before:
        stmt = stmt.where(FollowUp.due_date <= due_before)
    if kind:
        stmt = stmt.where(FollowUp.kind == kind)
    if application_id:
        stmt = stmt.where(FollowUp.application_id == application_id)
    stmt = stmt.order_by(FollowUp.completed, FollowUp.due_date, FollowUp.id)
    return paginate(db, stmt, params)


def get_followup(db: Session, followup_id: int) -> FollowUp:
    f = db.get(FollowUp, followup_id)
    if f is None:
        raise NotFoundError(f"Follow-up {followup_id} not found")
    return f


def save_followup(db: Session, data: dict[str, Any], followup_id: int | None = None) -> FollowUp:
    if data.get("job_id"):
        job = db.get(Job, data["job_id"])
        if job is None:
            raise DomainValidationError("Job not found")
        data.setdefault("company_id", job.company_id)
    if followup_id is None:
        f = FollowUp(**data)
        db.add(f)
        db.flush()
        record_activity(
            db, "followup.created", "followup", f.id, f.title, {"due_date": str(f.due_date)}
        )
    else:
        f = get_followup(db, followup_id)
        for k, v in data.items():
            setattr(f, k, v)
        if data.get("completed") and f.completed_at is None:
            f.completed_at = datetime.now(UTC)
    db.commit()
    return get_followup(db, f.id)


def complete_followup(db: Session, followup_id: int, note: str | None = None) -> FollowUp:
    f = get_followup(db, followup_id)
    f.completed, f.completed_at = True, datetime.now(UTC)
    if note:
        f.notes = "\n".join(filter(None, [f.notes, note]))
    if f.application_id:
        db.add(
            ApplicationEvent(
                application_id=f.application_id, event_type="FOLLOW_UP", note=note or f.title
            )
        )
    record_activity(db, "followup.completed", "followup", f.id, f.title)
    db.commit()
    return f


def pending_followup_count(db: Session, by: date | None = None) -> int:
    stmt = select(func.count()).select_from(FollowUp).where(FollowUp.completed.is_(False))
    if by:
        stmt = stmt.where(FollowUp.due_date <= by)
    return db.scalar(stmt) or 0
