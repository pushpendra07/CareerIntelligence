"""First-run setup (the Welcome wizard): status, first companies, finish."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import DB
from app.services import setup_service

router = APIRouter(prefix="/setup", tags=["setup"])


class CompanyUrl(BaseModel):
    url: str = Field(max_length=500)
    name: str | None = Field(default=None, max_length=200)


class CompaniesIn(BaseModel):
    companies: list[CompanyUrl]


@router.get("")
def get_status(db: DB) -> dict[str, Any]:
    return setup_service.status(db)


@router.post("/companies")
def add_companies(db: DB, body: CompaniesIn) -> list[dict[str, Any]]:
    return setup_service.add_companies(db, [c.model_dump() for c in body.companies])


@router.post("/complete")
def complete(db: DB) -> dict[str, Any]:
    return setup_service.complete(db)
