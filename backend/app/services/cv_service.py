import difflib
import logging
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.core.pagination import PageParams, paginate
from app.cv.extract import extract_text, validate_upload
from app.cv.parser import PARSER_VERSION, ParsedCV, parse_cv
from app.models.cv import CV, CVVersion
from app.schemas.cv import CVComparison
from app.services.activity import record_activity
from app.storage.backend import Storage

logger = logging.getLogger(__name__)


def _stale(db: Session, reason: str) -> None:
    """CV changes can change the recommended CV, so current scores need re-analysis."""
    from app.services.match_service import mark_all_stale

    mark_all_stale(db, reason)


def _parse_bytes(data: bytes, ext: str) -> tuple[str, ParsedCV]:
    try:
        text = extract_text(data, ext)
    except Exception as exc:
        logger.warning("CV text extraction failed", extra={"ext": ext, "error": str(exc)})
        raise DomainValidationError("Could not read text from this file") from exc
    parsed = parse_cv(text)
    if not text.strip():
        parsed.warnings.append(
            "No text could be extracted (scanned/image PDF?). OCR is not supported; "
            "upload a text-based PDF, DOCX or TXT."
        )
    return text, parsed


def _new_version(
    db: Session,
    storage: Storage,
    cv: CV,
    number: int,
    filename: str,
    data: bytes,
    max_bytes: int,
    label: str | None,
) -> CVVersion:
    meta = validate_upload(filename, data, max_bytes)
    text, parsed = _parse_bytes(data, meta.ext)
    key, digest = storage.put("cvs", data, meta.ext)
    version = CVVersion(
        cv=cv,
        version_number=number,
        label=label,
        original_filename=meta.filename,
        content_type=meta.content_type,
        file_ext=meta.ext,
        size_bytes=len(data),
        sha256=digest,
        storage_key=key,
        extracted_text=text,
        parsed=parsed.model_dump(mode="json"),
        parser_version=PARSER_VERSION,
    )
    db.add(version)
    db.flush()
    cv.current_version_id = version.id
    return version


def create_cv(
    db: Session,
    storage: Storage,
    *,
    name: str,
    filename: str,
    data: bytes,
    max_bytes: int,
    target_role: str | None = None,
    notes: str | None = None,
    label: str | None = None,
) -> CV:
    has_active = db.scalar(select(func.count()).select_from(CV).where(CV.is_active)) or 0
    cv = CV(name=name.strip(), target_role=target_role, notes=notes, is_active=not has_active)
    db.add(cv)
    db.flush()
    version = _new_version(db, storage, cv, 1, filename, data, max_bytes, label)
    _stale(db, "CV uploaded")
    record_activity(
        db,
        "cv.uploaded",
        "cv",
        cv.id,
        f"Uploaded CV '{cv.name}'",
        {"version_id": version.id, "filename": version.original_filename},
    )
    db.commit()
    logger.info("CV uploaded", extra={"cv_id": cv.id, "version_id": version.id})
    return get_cv(db, cv.id)


def add_version(
    db: Session,
    storage: Storage,
    cv_id: int,
    *,
    filename: str,
    data: bytes,
    max_bytes: int,
    label: str | None = None,
) -> CVVersion:
    cv = get_cv(db, cv_id)
    if any(v.sha256 == _sha(data) for v in cv.versions):
        raise ConflictError("This exact file is already a version of this CV")
    number = max((v.version_number for v in cv.versions), default=0) + 1
    version = _new_version(db, storage, cv, number, filename, data, max_bytes, label)
    _stale(db, "CV version added")
    record_activity(
        db,
        "cv.version_added",
        "cv",
        cv.id,
        f"Added version {number} to '{cv.name}'",
        {"version_id": version.id},
    )
    db.commit()
    return version


def _sha(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()


def list_cvs(
    db: Session, params: PageParams, include_archived: bool = False
) -> tuple[list[CV], int]:
    stmt = select(CV).options(selectinload(CV.versions), selectinload(CV.current_version))
    if not include_archived:
        stmt = stmt.where(CV.is_archived.is_(False))
    stmt = stmt.order_by(CV.is_active.desc(), CV.updated_at.desc())
    return paginate(db, stmt, params)


def get_cv(db: Session, cv_id: int) -> CV:
    cv = db.scalar(
        select(CV)
        .options(selectinload(CV.versions), selectinload(CV.current_version))
        .where(CV.id == cv_id)
    )
    if cv is None:
        raise NotFoundError(f"CV {cv_id} not found")
    return cv


def get_version(db: Session, cv_id: int, version_id: int) -> CVVersion:
    version = db.get(CVVersion, version_id)
    if version is None or version.cv_id != cv_id:
        raise NotFoundError(f"CV version {version_id} not found")
    return version


def get_version_by_id(db: Session, version_id: int) -> CVVersion:
    version = db.get(CVVersion, version_id)
    if version is None:
        raise NotFoundError(f"CV version {version_id} not found")
    return version


def update_cv(db: Session, cv_id: int, changes: dict[str, Any]) -> CV:
    cv = get_cv(db, cv_id)
    if changes.get("is_archived") and cv.is_active:
        raise DomainValidationError("Activate another CV before archiving the active one")
    for key, value in changes.items():
        setattr(cv, key, value)
    record_activity(
        db, "cv.updated", "cv", cv.id, f"Updated CV '{cv.name}'", {"fields": sorted(changes)}
    )
    db.commit()
    return get_cv(db, cv_id)


def activate_cv(db: Session, cv_id: int) -> CV:
    cv = get_cv(db, cv_id)
    if cv.is_archived:
        raise DomainValidationError("Archived CVs cannot be activated")
    db.execute(update(CV).where(CV.id != cv_id, CV.is_active).values(is_active=False))
    db.flush()
    cv.is_active = True
    _stale(db, "active CV changed")
    record_activity(db, "cv.activated", "cv", cv.id, f"Activated CV '{cv.name}'")
    db.commit()
    return get_cv(db, cv_id)


def reparse_version(db: Session, storage: Storage, cv_id: int, version_id: int) -> CVVersion:
    """Re-run extraction + parsing on the stored original (e.g. after a parser upgrade)."""
    version = get_version(db, cv_id, version_id)
    text, parsed = _parse_bytes(storage.get(version.storage_key), version.file_ext)
    version.extracted_text = text
    version.parsed = parsed.model_dump(mode="json")
    version.parser_version = PARSER_VERSION
    record_activity(db, "cv.reparsed", "cv", cv_id, None, {"version_id": version_id})
    db.commit()
    return version


def compare_versions(db: Session, left_id: int, right_id: int) -> CVComparison:
    left = get_version_by_id(db, left_id)
    right = get_version_by_id(db, right_id)
    lp, rp = left.parsed, right.parsed
    ls, rs = set(lp.get("skills", {})), set(rp.get("skills", {}))
    lr, rr = set(lp.get("roles", [])), set(rp.get("roles", []))
    lproj = {p["name"] for p in lp.get("projects", [])}
    rproj = {p["name"] for p in rp.get("projects", [])}
    diff = list(
        difflib.unified_diff(
            left.extracted_text.splitlines(),
            right.extracted_text.splitlines(),
            fromfile=f"v{left.version_number}",
            tofile=f"v{right.version_number}",
            lineterm="",
            n=0,
        )
    )
    return CVComparison(
        left_version_id=left.id,
        right_version_id=right.id,
        skills_added=sorted(rs - ls),
        skills_removed=sorted(ls - rs),
        skills_common=sorted(ls & rs),
        roles_added=sorted(rr - lr),
        roles_removed=sorted(lr - rr),
        projects_added=sorted(rproj - lproj),
        projects_removed=sorted(lproj - rproj),
        summary_changed=(lp.get("summary") or "") != (rp.get("summary") or ""),
        experience_years={
            "left": lp.get("total_experience_years"),
            "right": rp.get("total_experience_years"),
        },
        text_diff=diff[:400],
    )


def cv_highlights(cv: CV) -> dict[str, Any]:
    parsed = cv.current_version.parsed if cv.current_version else {}
    return {
        "top_skills": list(parsed.get("technologies", []))[:10],
        "total_experience_years": parsed.get("total_experience_years"),
    }
