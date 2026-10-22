import csv
import io
import logging
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Float, Integer, Select, String, cast, func, or_, select, text
from sqlalchemy.orm import Session, selectinload

from app.companies.importers import CompanyRecord
from app.companies.verification import Claim, add_claim, recompute
from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.core.pagination import PageParams, paginate
from app.core.text import company_key, company_key_strict, same_company_name
from app.core.urls import normalize_url, portal_of, registrable_domain
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
    """In-memory lookup by name, alias, website domain and portal link (for bulk imports)."""

    def __init__(self, companies: Iterable[Company]) -> None:
        # name key -> (name or alias that gave it, company)
        self.by_key: dict[str, list[tuple[str, Company]]] = {}
        self.by_domain: dict[str, list[Company]] = {}
        self.by_link: dict[str, Company] = {}
        self.used_keys: set[str] = set()
        for c in companies:
            self.add(c)

    def add(self, company: Company) -> None:
        if company.name_key:
            self.used_keys.add(company.name_key)
        for name in (company.name, *company.aliases):
            entries = self.by_key.setdefault(company_key(name), [])
            if (name, company) not in entries:
                entries.append((name, company))
        if company.domain:
            bucket = self.by_domain.setdefault(company.domain, [])
            if company not in bucket:
                bucket.append(company)
        for link in company.extra_links or []:
            self.by_link.setdefault(normalize_url(link["url"]), company)

    def find(
        self,
        name: str,
        website: str | None,
        aliases: Iterable[str] = (),
        links: Iterable[str] = (),
    ) -> Company | None:
        for link in links:
            if found := self.by_link.get(normalize_url(link)):
                return found
        domain = registrable_domain(website) if website else None
        if domain and len(self.by_domain.get(domain, [])) == 1:
            return self.by_domain[domain][0]
        for candidate in (name, *aliases):
            for known, company in self.by_key.get(company_key(candidate), []):
                if same_company_name(candidate, known):
                    return company
        return None

    def free_key(self, name: str) -> str:
        """A unique name_key for a new company. "Aspire Software Solutions" gets
        "aspiresoftwaresolutions" when "Aspire Systems" already holds "aspire"."""
        for key in (company_key(name), company_key_strict(name)):
            if key and key not in self.used_keys:
                return key
        base, n = company_key_strict(name), 2
        while f"{base}{n}" in self.used_keys:
            n += 1
        return f"{base}{n}"


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
    add_extra_links(company, rec.extra_links, rec.source_name)
    recompute(company)
    return invalid


def add_extra_links(company: Company, urls: Iterable[str], source: str) -> None:
    """Adds job-portal company pages, once per URL (compared without tracking parameters)."""
    links = list(company.extra_links or [])
    known = {normalize_url(link["url"]) for link in links}
    for url in urls:
        if normalize_url(url) not in known:
            known.add(normalize_url(url))
            links.append({"portal": portal_of(url), "url": url, "source": source,
                          "added_at": datetime.now(UTC).isoformat()})
    if links != company.extra_links:
        company.extra_links = links


def set_extra_links(company: Company, urls: list[str]) -> None:
    """Replaces the list (edited by hand); links kept keep their source and date."""
    current = {normalize_url(link["url"]): link for link in company.extra_links or []}
    wanted = [normalize_url(u) for u in urls]
    company.extra_links = [current[k] for k in dict.fromkeys(wanted) if k in current]
    add_extra_links(company, [u for u in urls if normalize_url(u) not in current], "manual")


def import_records(db: Session, records: Iterable[CompanyRecord], source: str) -> ImportSummary:
    summary = ImportSummary(source)
    index = load_index(db)
    for rec in records:
        summary.read += 1
        website = next((c.value for c in rec.claims if c.field == "website"), None)
        company = index.find(rec.name, website, rec.aliases, rec.extra_links)
        if company is None:
            key = index.free_key(rec.name) if company_key(rec.name) else ""
            if not key:
                summary.skipped += 1
                continue
            company = Company(
                name=rec.name,
                name_key=key,
                aliases=[],
                india_locations=[],
                extra_links=[],
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


# "Best rated" weighs the rating by its number of reviews (a Bayesian average pulled towards
# 3.5 with the weight of 20 reviews), so one 5-star review doesn't beat 4.3 from 2,000.
_STARS = cast(Company.attributes["naukri"]["rating"].astext, Float)
_REVIEWS = func.coalesce(cast(Company.attributes["naukri"]["reviews"].astext, Float), 0)
_RATING = (_STARS * _REVIEWS + 3.5 * 20) / (_REVIEWS + 20)
# Smallest number in the employee range ("1,001-5,000" -> 1001); sizes are written many ways.
_SIZE_LOW = cast(
    func.substring(func.regexp_replace(Company.employee_range, ",", "", "g"), "([0-9]+)"), Integer
)
SIZE_BANDS: dict[str, tuple[int, int]] = {
    "1-50": (0, 50), "51-200": (51, 200), "201-1000": (201, 1000),
    "1001-5000": (1001, 5000), "5001+": (5001, 10**9),
}

SORTS: dict[str, Any] = {
    "name": Company.name.asc(),
    "-verification_score": Company.verification_score.desc(),
    "tier": Company.tier.asc().nulls_last(),
    "-updated_at": Company.updated_at.desc(),
    "id": Company.id.asc(),
    "-id": Company.id.desc(),
    "-created_at": Company.created_at.desc(),
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
    portal: str | None = None,
    industry: str | None = None,
    company_size: str | None = None,
    sort: str = "name",
) -> tuple[list[Company], int]:
    stmt: Select[Any] = select(Company)
    if portal == "any":
        stmt = stmt.where(func.jsonb_array_length(Company.extra_links) > 0)
    elif portal:
        stmt = stmt.where(Company.extra_links.contains([{"portal": portal}]))
    if industry:
        stmt = stmt.where(Company.industry.ilike(f"%{industry.strip()}%"))
    if company_size in SIZE_BANDS:
        low, high = SIZE_BANDS[company_size]
        stmt = stmt.where(_SIZE_LOW.between(low, high))
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
    order = (_job_count().desc() if sort == "-jobs"
             else _RATING.desc().nulls_last() if sort == "-rating"
             else SORTS.get(sort, SORTS["name"]))
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
    # The strict key first: a company saved under it ("aspiresoftwaresolutions") is a closer
    # match than the one holding the shared key ("aspire" = Aspire Systems).
    company = db.scalar(select(Company).where(Company.name_key == company_key_strict(name)))
    if company is None:
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
    excluded = data.pop("scan_excluded", None)
    if (links := data.pop("extra_links", None)) is not None:
        set_extra_links(company, links)
    if excluded is not None:  # kept in attributes: no column needed
        rest = {k: v for k, v in (company.attributes or {}).items() if k != "scan_excluded"}
        company.attributes = {**rest, "scan_excluded": True} if excluded else rest
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
    known = {normalize_url(link["url"]) for link in keep.extra_links}
    keep.extra_links = [
        *keep.extra_links,
        *(link for link in other.extra_links if normalize_url(link["url"]) not in known),
    ]
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


def facets(db: Session) -> dict[str, Any]:
    """Values to filter the list by: industries and sizes in use, portals with links."""
    industries = db.execute(
        select(Company.industry, func.count()).where(Company.industry.is_not(None))
        .group_by(Company.industry).order_by(func.count().desc()).limit(40)
    ).all()
    sizes = {
        band: db.scalar(select(func.count()).where(_SIZE_LOW.between(low, high))) or 0
        for band, (low, high) in SIZE_BANDS.items()
    }
    portals = db.execute(text(
        "SELECT link->>'portal', count(DISTINCT c.id) FROM companies c,"
        " jsonb_array_elements(c.extra_links) AS link GROUP BY 1"
    )).all()
    return {
        "industries": [{"value": v, "count": n} for v, n in industries],
        "company_sizes": [{"value": band, "count": n} for band, n in sizes.items()],
        "portals": [{"value": v, "count": n} for v, n in sorted(portals, key=lambda r: -r[1])],
    }


# --- possible duplicates -----------------------------------------------------------------------


def possible_duplicates(db: Session) -> list[dict[str, Any]]:
    """Groups of companies that may be one company: names equal once generic words
    (Technologies, Solutions, Global...) are dropped, or the same website domain. Groups the
    user marked "not duplicates" are left out."""
    companies = list(db.scalars(select(Company).order_by(Company.id)))
    by_key: dict[str, list[Company]] = {}
    by_domain: dict[str, list[Company]] = {}
    for c in companies:
        if c.name_key:
            by_key.setdefault(company_key(c.name), []).append(c)
        if c.domain:
            by_domain.setdefault(c.domain, []).append(c)
    groups: list[tuple[str, list[Company]]] = [
        *(("same website", cs) for cs in by_domain.values() if len(cs) > 1),
        *(("similar name", cs) for cs in by_key.values() if len(cs) > 1),
    ]
    seen: set[tuple[int, ...]] = set()
    out = []
    for reason, cs in groups:
        ids = tuple(c.id for c in cs)
        if ids in seen or _dismissed(cs):
            continue
        seen.add(ids)
        out.append({"reason": reason, "company_ids": list(ids)})
    return out


def _dismissed(companies: list[Company]) -> bool:
    return all(
        {o.id for o in companies if o.id != c.id} <= set(c.attributes.get("not_duplicates", []))
        for c in companies
    )


def dismiss_duplicates(db: Session, company_ids: list[int]) -> None:
    """Remember that these companies are different, so they are not suggested again."""
    companies = [get_company(db, i) for i in dict.fromkeys(company_ids)]
    for c in companies:
        others = {o.id for o in companies if o.id != c.id}
        known = set(c.attributes.get("not_duplicates", []))
        c.attributes = {**c.attributes, "not_duplicates": sorted(known | others)}
    db.commit()


# --- bulk actions ------------------------------------------------------------------------------


def _references(db: Session, company_id: int) -> int:
    """Rows elsewhere (jobs, recruiters, applications...) that point at this company."""
    total = 0
    for table in Company.metadata.sorted_tables:
        if table.name == "company_field_sources":
            continue
        for column in table.columns:
            if any(fk.column.table.name == "companies" for fk in column.foreign_keys):
                total += db.scalar(
                    select(func.count()).select_from(table).where(column == company_id)
                ) or 0
    return total


def bulk_update(
    db: Session, company_ids: list[int], action: str, tier: str | None = None
) -> dict[str, Any]:
    """Job search on/off, set tier, or delete for many companies. Companies that jobs,
    recruiters or applications point at are never deleted (merge them instead)."""
    companies = list(db.scalars(select(Company).where(Company.id.in_(company_ids))))
    updated, deleted, skipped = 0, 0, []
    for c in companies:
        if action == "delete":
            if _references(db, c.id):
                skipped.append({"id": c.id, "name": c.name,
                                "reason": "has jobs, recruiters or applications"})
                continue
            db.delete(c)
            deleted += 1
            continue
        if action in ("job_search_on", "job_search_off"):
            c.job_search_enabled = action == "job_search_on"
        elif action == "tier":
            c.tier = Tier(tier).value if tier else None
        updated += 1
    record_activity(db, f"companies.bulk_{action}", "company", None,
                    f"{action} for {len(companies)} companies",
                    {"updated": updated, "deleted": deleted, "skipped": len(skipped)})
    db.commit()
    return {"updated": updated, "deleted": deleted, "skipped": skipped}


# --- export ----------------------------------------------------------------------------------

EXPORT_COLUMNS = [
    "id",
    "name",
    "aliases",
    "website",
    "careers_url",
    "linkedin_url",
    "extra_links",
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
    "created_at",
]


def export_rows(db: Session) -> list[dict[str, Any]]:
    rows = []
    for c in db.scalars(select(Company).order_by(Company.name)):
        row = {col: getattr(c, col) for col in EXPORT_COLUMNS}
        row["aliases"] = "; ".join(c.aliases)
        row["india_locations"] = "; ".join(c.india_locations)
        row["last_verified_at"] = c.last_verified_at.isoformat() if c.last_verified_at else None
        row["extra_links"] = "; ".join(link["url"] for link in c.extra_links)
        row["created_at"] = c.created_at.isoformat() if c.created_at else None
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
