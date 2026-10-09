from decimal import Decimal
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError
from app.models.profile import ProfessionalProfile, TargetProfile
from app.services.activity import record_activity
from app.services.cv_service import get_version_by_id
from app.skills.catalog import skill_category

PROFILE_ID = 1


def _stale(db: Session, reason: str) -> None:
    from app.services.match_service import mark_all_stale

    mark_all_stale(db, reason)


DEFAULT_TARGET_TITLES = [
    "Senior Software Developer",
    "Senior PHP Developer",
    "Technical Lead",
    "Tech Lead",
    "Senior Adobe Commerce Developer",
    "Adobe Commerce Developer",
    "Lead Software Developer",
]
# Added to the effective target titles only when include_architect_roles is on.
ARCHITECT_TITLES = [
    "Adobe Commerce Architect",
    "Magento Architect",
    "Solution Architect",
    "Technical Architect",
]
DEFAULT_LOCATIONS = [
    "Remote India",
    "Jaipur",
    "Jodhpur",
    "Delhi",
    "Gurugram",
    "Noida",
    "Ahmedabad",
    "Pune",
    "Bengaluru",
    "Chennai",
    "Mumbai",
    "Chandigarh",
]


def get_profile(db: Session) -> ProfessionalProfile:
    profile = db.get(ProfessionalProfile, PROFILE_ID)
    if profile is None:
        profile = ProfessionalProfile(id=PROFILE_ID, version=1)
        db.add(profile)
        db.commit()
    return profile


def update_profile(db: Session, changes: dict[str, Any]) -> ProfessionalProfile:
    profile = get_profile(db)
    changed = [k for k, v in changes.items() if getattr(profile, k) != v]
    if not changed:
        return profile
    for key in changed:
        setattr(profile, key, changes[key])
    profile.version += 1
    _stale(db, f"profile v{profile.version}")
    record_activity(
        db,
        "profile.updated",
        "profile",
        PROFILE_ID,
        "Profile updated",
        {"fields": sorted(changed), "version": profile.version},
    )
    db.commit()
    return profile


TOOL_CATEGORIES = {"tool", "leadership", "practice"}


def profile_fields_from_parsed(parsed: dict[str, Any]) -> dict[str, Any]:
    """Map parser output to profile fields (deterministic)."""
    # JSONB does not preserve key order, so rank explicitly: most mentioned first.
    skills = dict(sorted(parsed.get("skills", {}).items(), key=lambda kv: (-kv[1], kv[0])))
    groups = list(parsed.get("skill_groups", {}).values())
    from app.skills.catalog import normalize_skill

    primary_group_skills = {n for g in groups[:2] for item in g if (n := normalize_skill(item))}
    tech = [s for s in skills if (skill_category(s) or "other") not in TOOL_CATEGORIES]
    core = [s for s in tech if skills[s] >= 3 or s in primary_group_skills]
    additional = [
        s for s in skills if s not in core and skill_category(s) not in {"leadership", "practice"}
    ]

    def years(key: str) -> Decimal | None:
        value = parsed.get(key)
        return Decimal(str(value)) if value is not None else None

    return {
        "full_name": parsed.get("name"),
        "headline": parsed.get("headline"),
        "email": parsed.get("email"),
        "phone": parsed.get("phone"),
        "linkedin_url": parsed.get("linkedin"),
        "location": parsed.get("location"),
        "summary": parsed.get("summary"),
        "total_experience_years": years("total_experience_years"),
        "relevant_experience_years": years("relevant_experience_years"),
        "leadership_experience_years": years("leadership_experience_years"),
        "primary_roles": parsed.get("roles", []),
        "core_skills": core,
        "additional_skills": additional,
        "domains": parsed.get("domains", []),
        "leadership": parsed.get("leadership", []),
        "companies": [
            {k: e.get(k) for k in ("company", "title", "location", "start", "end", "is_current")}
            for e in parsed.get("experience", [])
        ],
        "certifications": parsed.get("certifications", []),
        "education": parsed.get("education", []),
        "projects": [
            {
                "name": p["name"],
                "platform": p.get("platform"),
                "skills": p.get("skills", []),
                "highlights": p.get("bullets", [])[:3],
            }
            for p in parsed.get("projects", [])
        ],
        "achievements": parsed.get("achievements", []),
    }


def _merge_value(current: Any, new: Any) -> Any:
    if isinstance(current, list) and isinstance(new, list):
        merged = list(current)
        seen = {repr(x).lower() for x in current}
        for item in new:
            if repr(item).lower() not in seen:
                merged.append(item)
                seen.add(repr(item).lower())
        return merged
    return current if current not in (None, "", [], {}) else new


def import_from_cv(
    db: Session, cv_version_id: int, mode: Literal["merge", "replace"] = "merge"
) -> ProfessionalProfile:
    """Populate the profile from a parsed CV.

    merge: keep everything already in the profile; only fill empty fields and add new list items.
    replace: overwrite every CV-derived field (skill_years and other manual-only fields stay).
    """
    version = get_version_by_id(db, cv_version_id)
    fields = profile_fields_from_parsed(version.parsed)
    profile = get_profile(db)
    changes = {}
    for key, value in fields.items():
        changes[key] = value if mode == "replace" else _merge_value(getattr(profile, key), value)
    changes["source_cv_version_id"] = version.id
    profile = update_profile(db, changes)
    record_activity(
        db,
        "profile.imported_from_cv",
        "profile",
        PROFILE_ID,
        f"Profile {mode}d from CV version {version.id}",
        {"cv_version_id": version.id, "mode": mode},
    )
    db.commit()
    return profile


def get_target(db: Session) -> TargetProfile:
    target = db.get(TargetProfile, PROFILE_ID)
    if target is None:
        target = TargetProfile(
            id=PROFILE_ID,
            version=1,
            target_titles=DEFAULT_TARGET_TITLES,
            include_architect_roles=False,
            preferred_domains=["E-commerce", "Adobe Commerce", "Enterprise Software"],
            preferred_locations=DEFAULT_LOCATIONS,
            remote_ok=True,
            hybrid_ok=True,
            onsite_ok=True,
            salary_currency="INR",
            employment_types=["Full-time"],
            excluded_roles=[],
            excluded_technologies=[],
            excluded_industries=[],
            required_skills=[],
            preferred_skills=[],
            preferred_companies=[],
        )
        db.add(target)
        db.commit()
    return target


def effective_titles(target: TargetProfile) -> list[str]:
    titles = list(target.target_titles)
    if target.include_architect_roles:
        titles += [t for t in ARCHITECT_TITLES if t not in titles]
    return titles


def update_target(db: Session, changes: dict[str, Any]) -> TargetProfile:
    target = get_target(db)
    merged = {
        k: changes.get(k, getattr(target, k))
        for k in ("min_experience_years", "max_experience_years", "min_salary", "target_salary")
    }
    if (
        merged["min_experience_years"] is not None
        and merged["max_experience_years"] is not None
        and merged["min_experience_years"] > merged["max_experience_years"]
    ):
        raise DomainValidationError("min_experience_years must not exceed max_experience_years")
    if (
        merged["min_salary"] is not None
        and merged["target_salary"] is not None
        and merged["min_salary"] > merged["target_salary"]
    ):
        raise DomainValidationError("min_salary must not exceed target_salary")
    changed = [k for k, v in changes.items() if getattr(target, k) != v]
    if not changed:
        return target
    for key in changed:
        setattr(target, key, changes[key])
    target.version += 1
    _stale(db, f"target v{target.version}")
    record_activity(
        db,
        "preferences.updated",
        "target_profile",
        PROFILE_ID,
        "Target profile updated",
        {"fields": sorted(changed), "version": target.version},
    )
    db.commit()
    return target
