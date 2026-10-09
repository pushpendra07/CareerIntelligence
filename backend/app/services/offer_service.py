from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import DomainValidationError, NotFoundError
from app.core.pagination import PageParams, paginate
from app.models.application import Application, ApplicationStatus, FollowUp, FollowUpKind
from app.models.job import Job, JobStatus
from app.models.offer import Offer, OfferStatus
from app.services.activity import record_activity

COMPONENTS = ("base_salary", "variable_pay", "bonus", "equity_value")


def compute_total(offer: Offer) -> Decimal | None:
    parts = [getattr(offer, c) for c in COMPONENTS if getattr(offer, c) is not None]
    return sum(parts, Decimal(0)) if parts else None


def _load(db: Session, offer_id: int) -> Offer:
    offer = db.scalar(
        select(Offer)
        .options(selectinload(Offer.job), selectinload(Offer.company))
        .where(Offer.id == offer_id)
    )
    if offer is None:
        raise NotFoundError(f"Offer {offer_id} not found")
    return offer


get_offer = _load


def _sync(db: Session, offer: Offer, app_status: ApplicationStatus, note: str) -> None:
    if offer.application_id:
        from app.services.application_service import change_status

        db.commit()
        change_status(db, offer.application_id, app_status, note)
    else:
        from app.services.job_service import set_status

        set_status(db, offer.job_id, JobStatus(app_status.value), note, commit=False)


def create_offer(db: Session, data: dict[str, Any]) -> Offer:
    job = db.get(Job, data["job_id"])
    if job is None:
        raise NotFoundError(f"Job {data['job_id']} not found")
    if data.get("application_id") is None:
        data["application_id"] = db.scalar(
            select(Application.id)
            .where(Application.job_id == job.id)
            .order_by(Application.id.desc())
            .limit(1)
        )
    offer = Offer(**{**data, "company_id": job.company_id})
    offer.offer_date = offer.offer_date or date.today()
    if offer.total_ctc is None:
        offer.total_ctc = compute_total(offer)
    db.add(offer)
    db.flush()
    if offer.expiry_date:
        db.add(
            FollowUp(
                kind=FollowUpKind.OFFER.value,
                title=f"Decide on offer: {job.title}",
                due_date=max(offer.offer_date, offer.expiry_date - timedelta(days=2)),
                job_id=job.id,
                company_id=job.company_id,
                application_id=offer.application_id,
                offer_id=offer.id,
            )
        )
    record_activity(
        db,
        "offer.received",
        "offer",
        offer.id,
        f"Offer: {job.title}",
        {"job_id": job.id, "total_ctc": str(offer.total_ctc), "currency": offer.currency},
    )
    _sync(db, offer, ApplicationStatus.OFFER, "offer received")
    db.commit()
    return _load(db, offer.id)


def update_offer(db: Session, offer_id: int, changes: dict[str, Any]) -> Offer:
    offer = _load(db, offer_id)
    if "status" in changes:
        raise DomainValidationError("Use the decision endpoint to change status")
    for k, v in changes.items():
        setattr(offer, k, v)
    if "total_ctc" not in changes and set(changes) & set(COMPONENTS):
        offer.total_ctc = compute_total(offer)
    record_activity(db, "offer.updated", "offer", offer.id, None, {"fields": sorted(changes)})
    db.commit()
    return _load(db, offer_id)


def negotiate(
    db: Session, offer_id: int, note: str, counter_ctc: Decimal | None, by: str = "me"
) -> Offer:
    offer = _load(db, offer_id)
    if offer.status in (OfferStatus.ACCEPTED, OfferStatus.DECLINED, OfferStatus.EXPIRED):
        raise DomainValidationError(f"Offer is already {offer.status}")
    offer.negotiation_log = [
        *offer.negotiation_log,
        {
            "at": datetime.now(UTC).isoformat(),
            "note": note,
            "by": by,
            "counter_ctc": str(counter_ctc) if counter_ctc is not None else None,
        },
    ]
    offer.status = OfferStatus.NEGOTIATING.value
    record_activity(
        db,
        "offer.negotiation",
        "offer",
        offer.id,
        note[:200],
        {"counter_ctc": str(counter_ctc) if counter_ctc else None, "by": by},
    )
    db.commit()
    return _load(db, offer_id)


def decide(db: Session, offer_id: int, status: OfferStatus, decision: str | None) -> Offer:
    if status not in (OfferStatus.ACCEPTED, OfferStatus.DECLINED, OfferStatus.EXPIRED):
        raise DomainValidationError("Decision must be ACCEPTED, DECLINED or EXPIRED")
    offer = _load(db, offer_id)
    offer.status = status.value
    offer.decision = decision
    offer.decision_date = date.today()
    for f in db.scalars(
        select(FollowUp).where(FollowUp.offer_id == offer.id, FollowUp.completed.is_(False))
    ):
        f.completed, f.completed_at = True, datetime.now(UTC)
    record_activity(
        db, f"offer.{status.value.lower()}", "offer", offer.id, decision, {"job_id": offer.job_id}
    )
    mapped = {
        OfferStatus.ACCEPTED: ApplicationStatus.ACCEPTED,
        OfferStatus.DECLINED: ApplicationStatus.WITHDRAWN,
        OfferStatus.EXPIRED: ApplicationStatus.CLOSED,
    }[status]
    _sync(db, offer, mapped, f"offer {status.value.lower()}")
    db.commit()
    return _load(db, offer_id)


def list_offers(
    db: Session, params: PageParams, status: str | None = None
) -> tuple[list[Offer], int]:
    stmt: Select[Any] = select(Offer).options(selectinload(Offer.job), selectinload(Offer.company))
    if status:
        stmt = stmt.where(Offer.status == status)
    return paginate(db, stmt.order_by(Offer.offer_date.desc(), Offer.id.desc()), params)


def compare(db: Session, offer_ids: list[int] | None = None) -> dict[str, Any]:
    from app.services.profile_service import get_target

    target = get_target(db)
    stmt = select(Offer).options(selectinload(Offer.job), selectinload(Offer.company))
    stmt = (
        stmt.where(Offer.id.in_(offer_ids))
        if offer_ids
        else stmt.where(
            Offer.status.in_([OfferStatus.RECEIVED.value, OfferStatus.NEGOTIATING.value])
        )
    )
    rows: list[dict[str, Any]] = []
    for o in db.scalars(stmt):
        vs_target = None
        if o.total_ctc is not None and o.currency == target.salary_currency:
            ref = target.target_salary or target.min_salary
            if ref:
                vs_target = round(float(o.total_ctc / ref * 100), 1)
        rows.append(
            {
                "id": o.id,
                "company": o.company.name,
                "job": o.job.title,
                "status": o.status,
                "currency": o.currency,
                "base_salary": o.base_salary,
                "variable_pay": o.variable_pay,
                "bonus": o.bonus,
                "equity": o.equity,
                "total_ctc": o.total_ctc,
                "fixed_share_pct": round(float(o.base_salary / o.total_ctc * 100), 1)
                if o.base_salary and o.total_ctc
                else None,
                "percent_of_target": vs_target,
                "joining_date": o.joining_date,
                "location": o.location,
                "work_model": o.work_model,
                "benefits": o.benefits,
                "expiry_date": o.expiry_date,
            }
        )
    rows.sort(key=lambda r: (r["total_ctc"] is None, -float(r["total_ctc"] or 0)))
    return {
        "target_salary": target.target_salary,
        "min_salary": target.min_salary,
        "currency": target.salary_currency,
        "offers": rows,
    }
