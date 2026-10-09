from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.deps import DB
from app.core.pagination import Page, PageParams, page_params
from app.models.job import WorkModel
from app.models.offer import Offer, OfferStatus
from app.services import offer_service as svc

router = APIRouter(tags=["offers"])


class OfferFields(BaseModel):
    offer_date: date | None = None
    expiry_date: date | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    base_salary: Decimal | None = Field(default=None, ge=0)
    variable_pay: Decimal | None = Field(default=None, ge=0)
    bonus: Decimal | None = Field(default=None, ge=0)
    equity: str | None = Field(default=None, max_length=300)
    equity_value: Decimal | None = Field(default=None, ge=0)
    total_ctc: Decimal | None = Field(default=None, ge=0)
    joining_date: date | None = None
    location: str | None = Field(default=None, max_length=300)
    work_model: WorkModel | None = None
    designation: str | None = Field(default=None, max_length=300)
    benefits: list[str] | None = None
    negotiation_notes: str | None = None

    @field_validator("currency")
    @classmethod
    def _cur(cls, v: str | None) -> str | None:
        return v.upper() if v else v


class OfferCreate(OfferFields):
    job_id: int
    application_id: int | None = None


class NegotiateIn(BaseModel):
    note: str = Field(min_length=1, max_length=5000)
    counter_ctc: Decimal | None = Field(default=None, ge=0)
    by: str = Field(default="me", pattern=r"^(me|company)$")


class DecisionIn(BaseModel):
    status: OfferStatus
    decision: str | None = None


class OfferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    job_title: str = ""
    application_id: int | None
    company_id: int
    company_name: str = ""
    offer_date: date
    expiry_date: date | None
    currency: str
    base_salary: Decimal | None
    variable_pay: Decimal | None
    bonus: Decimal | None
    equity: str | None
    equity_value: Decimal | None
    total_ctc: Decimal | None
    joining_date: date | None
    location: str | None
    work_model: str | None
    designation: str | None
    benefits: list[str]
    negotiation_notes: str | None
    negotiation_log: list[dict[str, Any]]
    status: str
    decision: str | None
    decision_date: date | None
    created_at: datetime
    updated_at: datetime


def out(o: Offer) -> OfferOut:
    r = OfferOut.model_validate(o)
    r.job_title, r.company_name = o.job.title, o.company.name
    return r


def _clean(data: dict[str, Any]) -> dict[str, Any]:
    if data.get("work_model") is not None:
        data["work_model"] = data["work_model"].value
    return {k: v for k, v in data.items() if not (k == "currency" and v is None)}


@router.post("/offers", response_model=OfferOut, status_code=201)
def create(db: DB, body: OfferCreate) -> OfferOut:
    data = _clean(body.model_dump(exclude_unset=True))
    data.setdefault("benefits", [])
    return out(svc.create_offer(db, data))


@router.get("/offers", response_model=Page[OfferOut])
def list_offers(
    db: DB, params: Annotated[PageParams, Depends(page_params)], status: str | None = None
) -> Page[OfferOut]:
    items, total = svc.list_offers(db, params, status)
    return Page(items=[out(o) for o in items], total=total, page=params.page, size=params.size)


@router.get("/offers/compare")
def compare(db: DB, ids: Annotated[list[int] | None, Query()] = None) -> dict[str, Any]:
    return svc.compare(db, ids)


@router.get("/offers/{offer_id}", response_model=OfferOut)
def get(db: DB, offer_id: int) -> OfferOut:
    return out(svc.get_offer(db, offer_id))


@router.patch("/offers/{offer_id}", response_model=OfferOut)
def update(db: DB, offer_id: int, body: OfferFields) -> OfferOut:
    return out(svc.update_offer(db, offer_id, _clean(body.model_dump(exclude_unset=True))))


@router.post("/offers/{offer_id}/negotiate", response_model=OfferOut)
def negotiate(db: DB, offer_id: int, body: NegotiateIn) -> OfferOut:
    return out(svc.negotiate(db, offer_id, body.note, body.counter_ctc, body.by))


@router.post("/offers/{offer_id}/decision", response_model=OfferOut)
def decide(db: DB, offer_id: int, body: DecisionIn) -> OfferOut:
    return out(svc.decide(db, offer_id, body.status, body.decision))
