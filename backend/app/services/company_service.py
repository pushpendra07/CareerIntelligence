import csv
import io
import logging
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, String, cast, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.companies.importers import CompanyRecord
from app.companies.verification import Claim, add_claim, recompute
from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.core.pagination import PageParams, paginate
from app.core.text import company_key
from app.core.urls import registrable_domain
from app.models.company import (
    Company,
    CompanyFieldSource,
    Contact,
    HiringStatus,
    SourceKind,
    Tier,
    VerificationStatus,
)
from app.services.activity import record_activity

logger = logging.getLogger(__name__)
VS = VerificationStatus


# --- matching ------------------------------------------------------------------------------


class CompanyIndex:
    """In-memory lookup by name key, alias key and website domain (for bulk imports)."""

    def __init__(self, companies: Iterable[Company]) -> None:
        self.by_key: dict[str, Company] = {}
        self.by_domain: dict[str, list[Company]] = {}
        for c in companies:
            self.add(c)

    def add(self, company: Company) -> None:
        self.by_key.setdefault(company.name_key, company)
        for alias in company.aliases:
            self.by_key.setdefault(company_key(alias), company)
        if company.domain:
            bucket = self.by_domain.setdefault(company.domain, [])
            if company not in bucket:
                bucket.append(company)

    def find(self, name: str, website: str | None, aliases: Iterable[str] = ()) -> Company | None:
        domain = registrable_domain(website) if website else None
        if domain and len(self.by_domain.get(domain, [])) == 1:
            return self.by_domain[domain][0]
        for key in (company_key(name), *(company_key(a) for a in aliases)):
            if key and key in self.by_key:
                return self.by_key[key]
        return None


def load_index(db: Session) -> CompanyIndex:
    return CompanyIndex(db.scalars(select(Company).options(selectinload(Company.sources))))


@dataclass
class ImportSummary:
    source: str
    read: int = 0
    created: int = 0
    merged: int = 0
    skipped: int = 0
    invalid_claims: int = 0
    errors: list[str] = field(default_factory=list)


def _apply_record(company: Company, rec: CompanyRecord) -> int:
    invalid = 0
    for claim in rec.claims:
        src = add_claim(company, Claim(**vars(claim)))
        if src is not None and src.verification_status == VS.INVALID:
            invalid += 1
    for alias in [rec.name, *rec.aliases]:
        known = {company.name.lower(), *(a.lower() for a in company.aliases)}
        if alias.strip() and alias.lower() not in known:
            company.aliases = [*company.aliases, alias.strip()]
    if rec.tier and not company.tier:
        company.tier = rec.tier.value
    if rec.priority and not company.priority:
        company.priority = rec.priority
    if rec.hiring_status == HiringStatus.HIRING:
        company.hiring_status = HiringStatus.HIRING.value
    if rec.job_search_enabled:
        company.job_search_enabled = True
    if rec.notes:
        existing = company.notes or ""
        if rec.notes not in existing:
            company.notes = (
                existing + "\n" if existing else ""
            ) + f"[{rec.source_name}] {rec.notes}"
    if rec.attributes:
        company.attributes = {**company.attributes, rec.source_name: rec.attributes}
    recompute(company)
    return invalid


def import_records(db: Session, records: Iterable[CompanyRecord], source: str) -> ImportSummary:
    summary = ImportSummary(source)
    index = load_index(db)
    for rec in records:
        summary.read += 1
        website = next((c.value for c in rec.claims if c.field == "website"), None)
        company = index.find(rec.name, website, rec.aliases)
        if company is None:
            key = company_key(rec.name)
            if not key:
                summary.skipped += 1
                continue
            company = Company(
                name=rec.name,
                name_key=key,
                aliases=[],
                india_locations=[],
                attributes={},
                hiring_status=HiringStatus.UNKNOWN.value,
                job_search_enabled=False,
                verification_score=0,
                verification_status=VS.DISCOVERED.value,
            )
            db.add(company)
            summary.created += 1
        else:
            summary.merged += 1
        summary.invalid_claims += _apply_record(company, rec)
        index.add(company)
    record_activity(
        db,
        "companies.imported",
        "company",
        None,
        f"Imported companies from {source}",
        vars(summary),
    )
    db.commit()
    logger.info("company import finished", extra={"import_summary": vars(summary)})
    return summary


# --- queries ---------------------------------------------------------------------------------

def _job_count() -> Any:
    from app.models.job import Job

    return (select(func.count(Job.id)).where(Job.company_id == Company.id)
            .correlate(Company).scalar_subquery())


# Jobs you're still pursuing: everything except closed / not relevant / rejected / withdrawn.
INACTIVE_JOB_STATUSES = ("CLOSED", "NOT_RELEVANT", "REJECTED", "WITHDRAWN")


def job_counts(db: Session, company_ids: list[int]) -> dict[int, tuple[int, int]]:
    """company id -> (all jobs in the app, open jobs) for these companies."""
    from app.models.job import Job

    if not company_ids:
        return {}
    open_ = func.count(Job.id).filter(Job.status.not_in(INACTIVE_JOB_STATUSES))
    rows = db.execute(select(Job.company_id, func.count(Job.id), open_)
                      .where(Job.company_id.in_(company_ids)).group_by(Job.company_id))
    return {cid: (int(total), int(op)) for cid, total, op in rows}


SORTS: dict[str, Any] = {
    "name": Company.name.asc(),
    "-verification_score": Company.verification_score.desc(),
    "tier": Company.tier.asc().nulls_last(),
    "-updated_at": Company.updated_at.desc(),
    "id": Company.id.asc(),
    "-id": Company.id.desc(),
}


def list_companies(
    db: Session,
    params: PageParams,
    *,
    q: str | None = None,
    tier: str | None = None,
    verification_status: str | None = None,
    india_presence: bool | None = None,
    job_search_enabled: bool | None = None,
    hiring_status: str | None = None,
    has_jobs: bool | None = None,
    sort: str = "name",
) -> tuple[list[Company], int]:
    stmt: Select[Any] = select(Company)
    if has_jobs is not None:
        stmt = stmt.where(_job_count() > 0 if has_jobs else _job_count() == 0)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Company.name.ilike(like),
                Company.domain.ilike(like),
                cast(Company.aliases, String).ilike(like),
            )
        )
    if tier:
        stmt = stmt.where(Company.tier == tier)
    if verification_status:
        stmt = stmt.where(Company.verification_status == verification_status)
    if india_presence is not None:
        stmt = stmt.where(Company.india_presence.is_(india_presence))
    if job_search_enabled is not None:
        stmt = stmt.where(Company.job_search_enabled.is_(job_search_enabled))
    if hiring_status:
        stmt = stmt.where(Company.hiring_status == hiring_status)
    order = _job_count().desc() if sort == "-jobs" else SORTS.get(sort, SORTS["name"])
    stmt = stmt.order_by(order, Company.name.asc(), Company.id)
    return paginate(db, stmt, params)


def get_company(db: Session, company_id: int) -> Company:
    company = db.scalar(
        select(Company).options(selectinload(Company.sources)).where(Company.id == company_id)
    )
    if company is None:
        raise NotFoundError(f"Company {company_id} not found")
    return company


def find_or_create_by_name(db: Session, name: str) -> Company:
    """Used by job entry: reuse a matching company, or create a DISCOVERED one."""
    key = company_key(name)
    if not key:
        raise DomainValidationError("Company name is required")
    company = db.scalar(select(Company).where(Company.name_key == key))
    if company is None:
        index = load_index(db)
        company = index.find(name, None)
    if company is None:
        company = Company(
            name=name.strip(),
            name_key=key,
            aliases=[],
            india_locations=[],
            attributes={},
            hiring_status=HiringStatus.UNKNOWN.value,
            job_search_enabled=False,
            verification_score=0,
            verification_status=VS.DISCOVERED.value,
        )
        db.add(company)
        db.flush()
        record_activity(
            db,
            "company.created",
            "company",
            company.id,
            f"Company '{company.name}' created from job entry",
        )
    return company


EDITABLE = {
    "name",
    "legal_name",
    "aliases",
    "tier",
    "priority",
    "hiring_status",
    "job_search_enabled",
    "notes",
    "verification_override",
}
CLAIM_FIELDS = {
    "website",
    "careers_url",
    "linkedin_url",
    "headquarters",
    "industry",
    "company_type",
    "employee_range",
    "india_locations",
    "india_presence",
}


def create_company(db: Session, data: dict[str, Any]) -> Company:
    key = company_key(data["name"])
    if db.scalar(select(Company.id).where(Company.name_key == key)):
        raise ConflictError(f"A company named like '{data['name']}' already exists")
    company = Company(
        name=data["name"].strip(),
        name_key=key,
        aliases=[],
        india_locations=[],
        attributes={},
        hiring_status=HiringStatus.UNKNOWN.value,
        job_search_enabled=False,
        verification_score=0,
        verification_status=VS.DISCOVERED.value,
    )
    db.add(company)
    db.flush()
    _apply_changes(company, data)
    record_activity(db, "company.created", "company", company.id, f"Created '{company.name}'")
    db.commit()
    return get_company(db, company.id)


def _apply_changes(company: Company, data: dict[str, Any]) -> None:
    source_url = data.pop("source_url", None)
    for key, value in data.items():
        if key in EDITABLE:
            if key == "name":
                company.name = value.strip()
                company.name_key = company_key(value)
            elif key in ("tier",) and value is not None:
                company.tier = Tier(value).value
            elif key == "hiring_status" and value is not None:
                company.hiring_status = HiringStatus(value).value
            elif key == "verification_override" and value is not None:
                company.verification_override = VerificationStatus(value).value
            else:
                setattr(company, key, value)
        elif key in CLAIM_FIELDS and value is not None:
            if key == "india_presence":
                value = "true" if value else "false"
            elif key == "india_locations":
                value = ", ".join(value)
            add_claim(
                company,
                Claim(
                    key,
                    str(value),
                    SourceKind.MANUAL,
                    VS.RESEARCHED if source_url else VS.DISCOVERED,
                    "manual",
                    source_url,
                ),
            )
    recompute(company)


def update_company(db: Session, company_id: int, data: dict[str, Any]) -> Company:
    company = get_company(db, company_id)
    if "name" in data and company_key(data["name"]) != company.name_key:
        clash = db.scalar(select(Company.id).where(Company.name_key == company_key(data["name"])))
        if clash:
            raise ConflictError("Another company already uses that name")
    _apply_changes(company, dict(data))
    record_activity(
        db,
        "company.updated",
        "company",
        company.id,
        f"Updated '{company.name}'",
        {"fields": sorted(data)},
    )
    db.commit()
    return get_company(db, company_id)


def add_evidence(db: Session, company_id: int, claim: Claim) -> Company:
    """Record evidence for a field (e.g. "verified on the official site at <url>")."""
    company = get_company(db, company_id)
    if claim.status in (VS.VERIFIED, VS.PARTIALLY_VERIFIED) and not claim.source_url:
        raise DomainValidationError("Verification needs a source_url")
    if claim.status == VS.VERIFIED and claim.verified_at is None:
        claim.verified_at = datetime.now(UTC)
    src = add_claim(company, claim)
    recompute(company)
    record_activity(
        db,
        "company.verified" if claim.status == VS.VERIFIED else "company.evidence",
        "company",
        company.id,
        f"{claim.field}: {claim.status.value}",
        {
            "field": claim.field,
            "source_kind": claim.source_kind.value,
            "source_url": claim.source_url,
            "stored_status": src.verification_status if src else None,
        },
    )
    db.commit()
    return get_company(db, company_id)


def merge_companies(db: Session, keep_id: int, merge_id: int) -> Company:
    if keep_id == merge_id:
        raise DomainValidationError("Cannot merge a company into itself")
    keep, other = get_company(db, keep_id), get_company(db, merge_id)
    for src in list(other.sources):
        add_claim(
            keep,
            Claim(
                src.field,
                src.value,
                SourceKind(src.source_kind),
                VerificationStatus(src.verification_status),
                src.source_name,
                src.source_url,
                src.verified_at,
                src.note,
            ),
        )
    keep.aliases = list(dict.fromkeys([*keep.aliases, other.name, *other.aliases]))
    keep.attributes = {**other.attributes, **keep.attributes}
    keep.tier = keep.tier or other.tier
    keep.priority = keep.priority or other.priority
    keep.job_search_enabled = keep.job_search_enabled or other.job_search_enabled
    if other.notes:
        keep.notes = "\n".join(filter(None, [keep.notes, other.notes]))
    _repoint_references(db, other.id, keep.id)
    db.delete(other)
    db.flush()
    recompute(keep)
    record_activity(
        db,
        "company.merged",
        "company",
        keep.id,
        f"Merged '{other.name}' into '{keep.name}'",
        {"merged_id": merge_id},
    )
    db.commit()
    return get_company(db, keep_id)


def _repoint_references(db: Session, old_id: int, new_id: int) -> None:
    """Move rows that reference a company (contacts, jobs, ...) to the surviving company."""
    for table in Company.metadata.sorted_tables:
        for column in table.columns:
            for fk in column.foreign_keys:
                if fk.column.table.name == "companies" and table.name != "company_field_sources":
                    db.execute(table.update().where(column == old_id).values({column.name: new_id}))


# --- export ----------------------------------------------------------------------------------

EXPORT_COLUMNS = [
    "id",
    "name",
    "aliases",
    "website",
    "careers_url",
    "linkedin_url",
    "ats_provider",
    "headquarters",
    "india_presence",
    "india_locations",
    "industry",
    "company_type",
    "employee_range",
    "priority",
    "tier",
    "hiring_status",
    "job_search_enabled",
    "verification_status",
    "verification_score",
    "last_verified_at",
    "notes",
]


def export_rows(db: Session) -> list[dict[str, Any]]:
    rows = []
    for c in db.scalars(select(Company).order_by(Company.name)):
        row = {col: getattr(c, col) for col in EXPORT_COLUMNS}
        row["aliases"] = "; ".join(c.aliases)
        row["india_locations"] = "; ".join(c.india_locations)
        row["last_verified_at"] = c.last_verified_at.isoformat() if c.last_verified_at else None
        rows.append(row)
    return rows


def to_csv(rows: list[dict[str, Any]], columns: list[str]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: _csv_safe(v) for k, v in row.items()})
    return buf.getvalue()


def _csv_safe(value: Any) -> Any:
    # Neutralize spreadsheet formula injection in exported text cells.
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value


def company_stats(db: Session) -> dict[str, Any]:
    by_status = dict(
        db.execute(
            select(Company.verification_status, func.count()).group_by(Company.verification_status)
        ).all()
    )
    by_tier = dict(db.execute(select(Company.tier, func.count()).group_by(Company.tier)).all())
    total = sum(by_status.values())
    return {
        "total": total,
        "by_verification_status": by_status,
        "by_tier": {k or "UNTIERED": v for k, v in by_tier.items()},
        "job_search_enabled": db.scalar(
            select(func.count()).select_from(Company).where(Company.job_search_enabled)
        )
        or 0,
        "invalid_claims": db.scalar(
            select(func.count())
            .select_from(CompanyFieldSource)
            .where(CompanyFieldSource.verification_status == VS.INVALID.value)
        )
        or 0,
    }


# --- contacts ---------------------------------------------------------------------------------


def list_contacts(
    db: Session,
    params: PageParams,
    *,
    q: str | None = None,
    company_id: int | None = None,
    status: str | None = None,
) -> tuple[list[Contact], int]:
    stmt: Select[Any] = select(Contact).options(selectinload(Contact.company))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Contact.name.ilike(like), Contact.email.ilike(like), Contact.job_title.ilike(like))
        )
    if company_id:
        stmt = stmt.where(Contact.company_id == company_id)
    if status:
        stmt = stmt.where(Contact.status == status)
    stmt = stmt.order_by(Contact.next_followup_at.asc().nulls_last(), Contact.name)
    return paginate(db, stmt, params)


def get_contact(db: Session, contact_id: int) -> Contact:
    contact = db.scalar(
        select(Contact).options(selectinload(Contact.company)).where(Contact.id == contact_id)
    )
    if contact is None:
        raise NotFoundError(f"Contact {contact_id} not found")
    return contact


def save_contact(db: Session, data: dict[str, Any], contact_id: int | None = None) -> Contact:
    if data.get("company_id"):
        get_company(db, data["company_id"])
    elif data.get("company_name"):
        data["company_id"] = find_or_create_by_name(db, data["company_name"]).id
    data.pop("company_name", None)
    if contact_id is None:
        contact = Contact(**data)
        db.add(contact)
        db.flush()
        action = "contact.created"
    else:
        contact = get_contact(db, contact_id)
        before = contact.status
        for k, v in data.items():
            setattr(contact, k, v)
        action = (
            "recruiter.contacted"
            if data.get("status") == "CONTACTED" and before != "CONTACTED"
            else "contact.updated"
        )
    record_activity(
        db,
        action,
        "contact",
        contact.id,
        contact.name,
        {"company_id": contact.company_id, "status": contact.status},
    )
    db.commit()
    return get_contact(db, contact.id)


def company_detail_stats(db: Session, company_id: int) -> dict[str, Any]:
    """Counts of related records shown on the company page."""
    return {
        "recruiters": db.scalar(
            select(func.count()).select_from(Contact).where(Contact.company_id == company_id)
        )
        or 0,
    }
