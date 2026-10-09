"""Field-level provenance and deterministic company verification.

Every company field value is backed by one or more CompanyFieldSource rows. The company's
displayed value for a field is the best-supported one (verification status first, then
source strength, then recency). The company's verification status and 0-100 score are
derived from those rows — never typed in — except for an explicit user override.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.core.urls import (
    detect_source,
    ensure_scheme,
    is_http_url,
    is_linkedin_company_url,
    is_search_engine,
    normalize_url,
    registrable_domain,
)
from app.models.company import (
    SOURCE_RANK,
    Company,
    CompanyFieldSource,
    SourceKind,
    VerificationStatus,
)

VS = VerificationStatus

# Fields whose provenance is tracked, with their weight in the 0-100 verification score.
SCORE_WEIGHTS: dict[str, int] = {
    "website": 25,
    "careers_url": 25,
    "linkedin_url": 15,
    "india_presence": 15,
    "headquarters": 10,
    "industry": 5,
    "employee_range": 5,
}
TRACKED_FIELDS = (*SCORE_WEIGHTS, "legal_name", "company_type", "india_locations", "ats")
URL_FIELDS = {"website", "careers_url", "linkedin_url"}

STATUS_FACTOR: dict[str, float] = {
    VS.VERIFIED: 1.0,
    VS.PARTIALLY_VERIFIED: 0.6,
    VS.RESEARCHED: 0.3,
    VS.DISCOVERED: 0.1,
    VS.NEEDS_REVIEW: 0.1,
    VS.STALE: 0.3,
}
STATUS_RANK: dict[str, int] = {
    VS.VERIFIED: 5,
    VS.PARTIALLY_VERIFIED: 4,
    VS.STALE: 3,
    VS.RESEARCHED: 2,
    VS.NEEDS_REVIEW: 1,
    VS.DISCOVERED: 1,
}
UNUSABLE = {VS.INVALID, VS.REJECTED}
MANUAL_OVERRIDES = {VS.REJECTED, VS.INVALID, VS.NEEDS_REVIEW}
STALE_AFTER = timedelta(days=180)


@dataclass
class Claim:
    field: str
    value: str | None
    source_kind: SourceKind
    status: VerificationStatus
    source_name: str | None = None
    source_url: str | None = None
    verified_at: datetime | None = None
    note: str | None = None


def validate_claim(claim: Claim) -> Claim:
    """Normalize URL values and mark impossible ones INVALID (never silently trusted)."""
    if claim.value is None or claim.field not in URL_FIELDS:
        return claim
    value = ensure_scheme(claim.value)
    if not is_http_url(value):
        claim.status = VS.INVALID
        claim.note = (claim.note or "") + " Not a valid http(s) URL."
        return claim
    if is_search_engine(value):
        claim.status = VS.INVALID
        claim.note = (claim.note or "") + " A search-engine link is not an official page."
        return claim
    if claim.field == "linkedin_url":
        if not is_linkedin_company_url(value):
            claim.status = VS.INVALID
            claim.note = (claim.note or "") + " Not a linkedin.com/company/ URL."
            return claim
        claim.value = value.split("?")[0].rstrip("/")
        return claim
    claim.value = normalize_url(value)
    return claim


def add_claim(company: Company, claim: Claim) -> CompanyFieldSource | None:
    """Attach a claim unless an identical one exists; upgrade its status if stronger."""
    claim = validate_claim(claim)
    if claim.value is None:
        return None
    for src in company.sources:
        if (src.field, (src.value or "").lower(), src.source_kind, src.source_name) == (
            claim.field,
            claim.value.lower(),
            claim.source_kind.value,
            claim.source_name,
        ):
            if STATUS_RANK.get(claim.status, -1) > STATUS_RANK.get(src.verification_status, -1):
                src.verification_status = claim.status.value
                src.verified_at = claim.verified_at
            if claim.source_url and not src.source_url:
                src.source_url = claim.source_url
            return src
    src = CompanyFieldSource(
        field=claim.field,
        value=claim.value,
        source_kind=claim.source_kind.value,
        source_name=claim.source_name,
        source_url=claim.source_url,
        verification_status=claim.status.value,
        verified_at=claim.verified_at,
        note=(claim.note or "").strip() or None,
    )
    company.sources.append(src)
    return src


def _rank(src: CompanyFieldSource) -> tuple[int, int, float]:
    return (
        STATUS_RANK.get(src.verification_status, -1),
        -SOURCE_RANK.get(SourceKind(src.source_kind), 99),
        (src.verified_at or src.created_at or datetime.min.replace(tzinfo=UTC)).timestamp(),
    )


OFFICIAL_KINDS = {
    SourceKind.OFFICIAL_WEBSITE,
    SourceKind.OFFICIAL_CAREERS,
    SourceKind.OFFICIAL_LINKEDIN,
    SourceKind.OFFICIAL_ATS,
}


def _disproved_values(company: Company, field: str) -> set[str]:
    """Values an official check found invalid, unless a later check verified them again."""

    def when(s: CompanyFieldSource) -> datetime:
        return s.verified_at or s.created_at or datetime.min.replace(tzinfo=UTC)

    out = set()
    for s in company.sources:
        if (
            s.field == field
            and s.value
            and s.verification_status == VS.INVALID
            and SourceKind(s.source_kind) in OFFICIAL_KINDS
        ):
            later_ok = any(
                o.field == field
                and (o.value or "").lower() == s.value.lower()
                and o.verification_status == VS.VERIFIED
                and when(o) > when(s)
                for o in company.sources
            )
            if not later_ok:
                out.add(s.value.lower())
    return out


def _usable(company: Company, field: str) -> list[CompanyFieldSource]:
    disproved = _disproved_values(company, field)
    return [
        s
        for s in company.sources
        if s.field == field
        and s.value
        and s.verification_status not in UNUSABLE
        and s.value.lower() not in disproved
    ]


def best_source(company: Company, field: str) -> CompanyFieldSource | None:
    usable = _usable(company, field)
    return max(usable, key=_rank) if usable else None


def has_conflict(company: Company, field: str) -> bool:
    """Two different usable values with no VERIFIED one to settle it."""
    usable = _usable(company, field)
    if any(s.verification_status == VS.VERIFIED for s in usable):
        return False
    if field in URL_FIELDS:
        values = {registrable_domain(s.value or "") for s in usable}
    else:
        values = {(s.value or "").strip().lower() for s in usable}
    return len(values) > 1


def apply_best_values(company: Company) -> None:
    for field in (
        "website",
        "careers_url",
        "linkedin_url",
        "headquarters",
        "industry",
        "employee_range",
        "legal_name",
        "company_type",
    ):
        best = best_source(company, field)
        setattr(company, field, best.value if best else None)
    if company.website:
        company.domain = registrable_domain(company.website)
    presence = best_source(company, "india_presence")
    company.india_presence = None if presence is None else presence.value == "true"
    locations: list[str] = []
    for src in company.sources:
        if src.field == "india_locations" and src.verification_status not in UNUSABLE:
            for loc in (src.value or "").split(","):
                loc = loc.strip()
                if loc and loc.lower() not in {x.lower() for x in locations}:
                    locations.append(loc)
    company.india_locations = locations
    if company.india_locations and company.india_presence is None:
        company.india_presence = True
    if company.careers_url:
        detected = detect_source(company.careers_url)
        if detected.source.value not in ("COMPANY_CAREERS", "UNKNOWN"):
            company.ats_provider = detected.source.value
            company.ats_slug = detected.ats_slug or company.ats_slug


def recompute(company: Company, now: datetime | None = None) -> None:
    """Refresh displayed values, score, last_verified_at and derived status."""
    now = now or datetime.now(UTC)
    apply_best_values(company)
    statuses: dict[str, str] = {}
    score = 0.0
    for field, weight in SCORE_WEIGHTS.items():
        best = best_source(company, field)
        if best:
            statuses[field] = best.verification_status
            score += weight * STATUS_FACTOR.get(best.verification_status, 0)
    company.verification_score = round(score)
    verified_times = [
        s.verified_at
        for s in company.sources
        if s.verified_at and s.verification_status in (VS.VERIFIED, VS.PARTIALLY_VERIFIED)
    ]
    company.last_verified_at = max(verified_times) if verified_times else None

    if company.verification_override in MANUAL_OVERRIDES:
        company.verification_status = company.verification_override
        return
    if statuses.get("website") == VS.VERIFIED and statuses.get("careers_url") == VS.VERIFIED:
        stale = company.last_verified_at and now - company.last_verified_at > STALE_AFTER
        status = VS.STALE if stale else VS.VERIFIED
    elif any(s in (VS.VERIFIED, VS.PARTIALLY_VERIFIED) for s in statuses.values()):
        status = VS.PARTIALLY_VERIFIED
    elif any(has_conflict(company, f) for f in ("website", "careers_url", "linkedin_url")):
        status = VS.NEEDS_REVIEW
    elif any(s.source_url or s.verification_status == VS.RESEARCHED for s in company.sources):
        status = VS.RESEARCHED
    else:
        status = VS.DISCOVERED
    company.verification_status = status.value
