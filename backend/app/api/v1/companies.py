import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response

from app.api.deps import DB, AppSettings
from app.companies.checker import check_company
from app.companies.importers import parse_upload, records_from_rows
from app.companies.verification import Claim
from app.core.errors import DomainValidationError
from app.core.pagination import Page, PageParams, page_params
from app.models.company import Contact
from app.schemas.company import (
    CompanyCreate,
    CompanyDetail,
    CompanyOut,
    CompanyWrite,
    ContactBase,
    ContactCreate,
    ContactOut,
    EvidenceIn,
    MergeIn,
)
from app.services import company_service

router = APIRouter(tags=["companies"])


@router.get("/companies", response_model=Page[CompanyOut])
def list_companies(
    db: DB,
    params: Annotated[PageParams, Depends(page_params)],
    q: str | None = None,
    tier: str | None = None,
    verification_status: str | None = None,
    india_presence: bool | None = None,
    job_search_enabled: bool | None = None,
    hiring_status: str | None = None,
    has_jobs: bool | None = None,
    sort: Literal["name", "-verification_score", "tier", "-updated_at", "-jobs"] = "name",
) -> Page[CompanyOut]:
    items, total = company_service.list_companies(
        db,
        params,
        q=q,
        tier=tier,
        verification_status=verification_status,
        india_presence=india_presence,
        job_search_enabled=job_search_enabled,
        hiring_status=hiring_status,
        has_jobs=has_jobs,
        sort=sort,
    )
    counts = company_service.job_counts(db, [c.id for c in items])
    out = []
    for c in items:
        row = CompanyOut.model_validate(c)
        row.job_count, row.open_job_count = counts.get(c.id, (0, 0))
        out.append(row)
    return Page(
        items=out,
        total=total,
        page=params.page,
        size=params.size,
    )


@router.get("/companies/stats")
def stats(db: DB) -> dict[str, Any]:
    return company_service.company_stats(db)


@router.get("/companies/export")
def export(db: DB, format: Literal["csv", "json"] = "csv") -> Response:  # noqa: A002
    rows = company_service.export_rows(db)
    if format == "json":
        return Response(
            json.dumps({"items": rows}, default=str),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="companies.json"'},
        )
    return Response(
        company_service.to_csv(rows, company_service.EXPORT_COLUMNS),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="companies.csv"'},
    )


@router.post("/companies/import")
async def import_file(
    db: DB, settings: AppSettings, file: Annotated[UploadFile, File()]
) -> dict[str, Any]:
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise DomainValidationError("File is too large")
    name = file.filename or "upload.csv"
    if not name.lower().endswith((".csv", ".json")):
        raise DomainValidationError("Upload a .csv or .json file")
    try:
        rows = parse_upload(data, name)
    except (ValueError, UnicodeDecodeError) as exc:
        raise DomainValidationError(f"Could not read file: {exc}") from exc
    summary = company_service.import_records(db, records_from_rows(rows, "upload"), "upload")
    return vars(summary)


@router.post("/companies", response_model=CompanyDetail, status_code=201)
def create(db: DB, body: CompanyCreate) -> CompanyDetail:
    company = company_service.create_company(db, body.model_dump(exclude_unset=True))
    return CompanyDetail.model_validate(company)


@router.get("/companies/{company_id}", response_model=CompanyDetail)
def detail(db: DB, company_id: int) -> CompanyDetail:
    company = company_service.get_company(db, company_id)
    out = CompanyDetail.model_validate(company)
    out.stats = company_service.company_detail_stats(db, company_id)
    out.job_count, out.open_job_count = company_service.job_counts(db, [company_id]).get(
        company_id, (0, 0))
    return out


@router.patch("/companies/{company_id}", response_model=CompanyDetail)
def update(db: DB, company_id: int, body: CompanyWrite) -> CompanyDetail:
    company = company_service.update_company(db, company_id, body.model_dump(exclude_unset=True))
    return CompanyDetail.model_validate(company)


@router.post("/companies/{company_id}/evidence", response_model=CompanyDetail)
def add_evidence(db: DB, company_id: int, body: EvidenceIn) -> CompanyDetail:
    claim = Claim(
        body.field,
        body.value,
        body.source_kind,
        body.verification_status,
        "manual",
        body.source_url,
        None,
        body.note,
    )
    return CompanyDetail.model_validate(company_service.add_evidence(db, company_id, claim))


@router.post("/companies/{company_id}/check")
def run_checks(db: DB, company_id: int) -> dict[str, Any]:
    """Fetch the website/careers page and record what was verified (network access)."""
    company = company_service.get_company(db, company_id)
    report = check_company(company)
    db.commit()
    return {
        "company_id": company_id,
        "results": report.results,
        "verification_status": company.verification_status,
        "verification_score": company.verification_score,
    }


@router.post("/companies/{company_id}/merge", response_model=CompanyDetail)
def merge(db: DB, company_id: int, body: MergeIn) -> CompanyDetail:
    return CompanyDetail.model_validate(
        company_service.merge_companies(db, company_id, body.merge_id)
    )


def _contact_out(contact: Contact) -> ContactOut:
    out = ContactOut.model_validate(contact)
    out.company_name = contact.company.name if contact.company else None
    return out


@router.get("/recruiters", response_model=Page[ContactOut])
def list_contacts(
    db: DB,
    params: Annotated[PageParams, Depends(page_params)],
    q: str | None = None,
    company_id: int | None = None,
    status: str | None = None,
) -> Page[ContactOut]:
    items, total = company_service.list_contacts(
        db, params, q=q, company_id=company_id, status=status
    )
    return Page(
        items=[_contact_out(c) for c in items], total=total, page=params.page, size=params.size
    )


@router.post("/recruiters", response_model=ContactOut, status_code=201)
def create_contact(db: DB, body: ContactCreate) -> ContactOut:
    data = body.model_dump(exclude_unset=True)
    return _contact_out(company_service.save_contact(db, data))


@router.get("/recruiters/{contact_id}", response_model=ContactOut)
def get_contact(db: DB, contact_id: int) -> ContactOut:
    return _contact_out(company_service.get_contact(db, contact_id))


@router.patch("/recruiters/{contact_id}", response_model=ContactOut)
def update_contact(db: DB, contact_id: int, body: ContactBase) -> ContactOut:
    data = body.model_dump(exclude_unset=True)
    return _contact_out(company_service.save_contact(db, data, contact_id))
