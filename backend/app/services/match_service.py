"""Glue between the database and the pure matching engine."""

import logging
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.core.errors import NotFoundError
from app.matching.config import ENGINE_VERSION, ScoringConfig
from app.matching.engine import JobFacts, MatchResult, ProfileFacts, TargetFacts, score_match
from app.models.cv import CV
from app.models.job import Job
from app.models.match import JobMatch, ScoringConfigRow
from app.models.profile import ProfessionalProfile, TargetProfile
from app.services.activity import record_activity
from app.skills.catalog import CATALOG_VERSION, ancestors

logger = logging.getLogger(__name__)


# --- configuration --------------------------------------------------------------------------


def active_config(db: Session) -> tuple[ScoringConfigRow, ScoringConfig]:
    row = db.scalar(select(ScoringConfigRow).where(ScoringConfigRow.is_active))
    if row is None:
        row = ScoringConfigRow(
            version=1,
            config=ScoringConfig().model_dump(mode="json"),
            is_active=True,
            note="Default configuration",
        )
        db.add(row)
        db.flush()
    return row, ScoringConfig.model_validate(row.config)


def save_config(db: Session, config: ScoringConfig, note: str | None = None) -> ScoringConfigRow:
    current, current_cfg = active_config(db)
    if current_cfg == config:
        return current
    db.execute(update(ScoringConfigRow).where(ScoringConfigRow.is_active).values(is_active=False))
    db.flush()
    row = ScoringConfigRow(
        version=current.version + 1,
        config=config.model_dump(mode="json"),
        is_active=True,
        note=note,
    )
    db.add(row)
    db.flush()
    record_activity(
        db,
        "scoring.config_updated",
        "scoring_config",
        row.id,
        f"Scoring config v{row.version}",
        {"note": note},
    )
    mark_all_stale(db, f"scoring config v{row.version}")
    db.commit()
    return row


def config_history(db: Session) -> list[ScoringConfigRow]:
    return list(db.scalars(select(ScoringConfigRow).order_by(ScoringConfigRow.version.desc())))


# --- facts ----------------------------------------------------------------------------------


def _f(value: Any) -> float | None:
    return float(value) if value is not None else None


def job_facts(job: Job) -> JobFacts:
    parsed = job.parsed_jd or {}
    company = job.company
    return JobFacts(
        title=job.title,
        has_jd=bool(job.original_jd.strip()),
        required_skills=list(job.required_skills),
        preferred_skills=[s for s in job.preferred_skills if s not in job.required_skills],
        skill_years={s["skill"]: s["years"] for s in parsed.get("skills", []) if s.get("years")},
        responsibilities=list(job.responsibilities),
        domains=list(parsed.get("domains", [])),
        experience_min=_f(job.experience_min),
        experience_max=_f(job.experience_max),
        leadership_required=bool(parsed.get("leadership_required")),
        locations=list(job.locations),
        location_text=job.location,
        work_model=job.work_model,
        salary_min=_f(job.salary_min),
        salary_max=_f(job.salary_max),
        salary_currency=job.salary_currency,
        company_name=company.name if company else "",
        company_tier=company.tier if company else None,
        company_industry=company.industry if company else None,
        company_type=company.company_type if company else None,
        certifications=list(parsed.get("certifications", [])),
        constraints=list(parsed.get("constraints", [])),
    )


def profile_facts(p: ProfessionalProfile) -> ProfileFacts:
    return ProfileFacts(
        total_years=_f(p.total_experience_years),
        relevant_years=_f(p.relevant_experience_years),
        leadership_years=_f(p.leadership_experience_years),
        primary_roles=list(p.primary_roles),
        core_skills=list(p.core_skills),
        additional_skills=list(p.additional_skills),
        skill_years=dict(p.skill_years),
        domains=list(p.domains),
        leadership=list(p.leadership),
        certifications=list(p.certifications),
        has_degree=bool(p.education),
    )


def target_facts(t: TargetProfile) -> TargetFacts:
    from app.services.profile_service import effective_titles

    return TargetFacts(
        titles=effective_titles(t),
        include_architect=t.include_architect_roles,
        preferred_domains=list(t.preferred_domains),
        preferred_companies=list(t.preferred_companies),
        preferred_locations=list(t.preferred_locations),
        remote_ok=t.remote_ok,
        hybrid_ok=t.hybrid_ok,
        onsite_ok=t.onsite_ok,
        min_salary=_f(t.min_salary),
        target_salary=_f(t.target_salary),
        salary_currency=t.salary_currency,
        notice_period_days=t.notice_period_days,
        excluded_roles=list(t.excluded_roles),
        excluded_technologies=list(t.excluded_technologies),
        excluded_industries=list(t.excluded_industries),
    )


def score_version(cfg_row: ScoringConfigRow) -> str:
    return f"{ENGINE_VERSION}+{CATALOG_VERSION}+config/{cfg_row.version}"


# --- CV recommendation ------------------------------------------------------------------------


def recommend_cv(db: Session, job: Job, cvs: list[CV] | None = None) -> CV | None:
    """The CV whose skills best cover this job (ties: matching target role, then active CV)."""
    from app.core.text import title_key

    if cvs is None:
        cvs = list(
            db.scalars(
                select(CV)
                .options(selectinload(CV.current_version))
                .where(CV.is_archived.is_(False))
            )
        )
    wanted = [*job.required_skills, *job.preferred_skills]
    best: tuple[float, int, int, int] | None = None
    best_cv: CV | None = None
    for cv in cvs:
        if cv.current_version is None:
            continue
        have = set(cv.current_version.parsed.get("skills", {}))
        expanded = have | {a for h in have for a in ancestors(h)}
        coverage = (sum(1 for s in wanted if s in expanded) / len(wanted)) if wanted else 0.0
        role_hit = int(
            bool(cv.target_role) and title_key(cv.target_role or "") in title_key(job.title)
        )
        key = (round(coverage, 4), role_hit, int(cv.is_active), -cv.id)
        if best is None or key > best:
            best, best_cv = key, cv
    return best_cv


# --- analysis ---------------------------------------------------------------------------------


def _context(
    db: Session,
) -> tuple[ProfessionalProfile, TargetProfile, ScoringConfigRow, ScoringConfig]:
    from app.services.profile_service import get_profile, get_target

    row, cfg = active_config(db)
    return get_profile(db), get_target(db), row, cfg


def analyze_job(
    db: Session, job: Job, context: tuple[Any, ...] | None = None, cvs: list[CV] | None = None
) -> MatchResult:
    profile, target, row, cfg = context or _context(db)
    if job.company is None:
        db.refresh(job, ["company"])
    result = score_match(job_facts(job), profile_facts(profile), target_facts(target), cfg)
    current = db.get(JobMatch, job.current_match_id) if job.current_match_id else None
    cv = recommend_cv(db, job, cvs)
    if (
        current is not None
        and current.inputs_hash == result.inputs_hash
        and current.recommended_cv_id == (cv.id if cv else None)
    ):
        job.score_stale = False  # same inputs -> same score; nothing new to record
        return result
    rescore = job.analyzed_at is not None
    match = JobMatch(
        job_id=job.id,
        score=result.score,
        recommendation=result.recommendation.value,
        result=result.model_dump(mode="json"),
        score_version=score_version(row),
        profile_version=profile.version,
        target_version=target.version,
        config_version=row.version,
        inputs_hash=result.inputs_hash,
        recommended_cv_id=cv.id if cv else None,
    )
    db.add(match)
    db.flush()
    job.current_match_id = match.id
    job.match_score = result.score
    job.recommendation = result.recommendation.value
    job.score_version = match.score_version
    job.profile_version = profile.version
    job.target_version = target.version
    job.config_version = row.version
    job.analyzed_at = datetime.now(UTC)
    job.score_stale = False
    job.recommended_cv_id = match.recommended_cv_id
    record_activity(
        db,
        "job.rescored" if rescore else "job.scored",
        "job",
        job.id,
        f"{result.score}/100 {result.recommendation.value}",
        {"score": result.score, "score_version": match.score_version},
    )
    return result


def mark_all_stale(db: Session, reason: str) -> int:
    count = db.execute(update(Job).where(Job.score_stale.is_(False)).values(score_stale=True))
    n = int(getattr(count, "rowcount", 0) or 0)
    if n:
        logger.info("scores marked stale", extra={"jobs": n, "reason": reason})
    return n


def is_stale(
    job: Job, profile: ProfessionalProfile, target: TargetProfile, row: ScoringConfigRow
) -> bool:
    return (
        job.score_stale
        or job.analyzed_at is None
        or job.profile_version != profile.version
        or job.target_version != target.version
        or job.config_version != row.version
    )


def reanalyze(
    db: Session,
    *,
    only_stale: bool = True,
    job_ids: Iterable[int] | None = None,
    batch_size: int = 200,
) -> dict[str, int]:
    context = _context(db)
    cvs = list(
        db.scalars(
            select(CV).options(selectinload(CV.current_version)).where(CV.is_archived.is_(False))
        )
    )
    stmt = select(Job.id).order_by(Job.id)
    if job_ids is not None:
        stmt = stmt.where(Job.id.in_(list(job_ids)))
    elif only_stale:
        stmt = stmt.where(Job.score_stale.is_(True))
    ids = list(db.scalars(stmt))
    done = 0
    for start in range(0, len(ids), batch_size):
        chunk = ids[start : start + batch_size]
        jobs = db.scalars(select(Job).options(selectinload(Job.company)).where(Job.id.in_(chunk)))
        for job in jobs:
            try:
                analyze_job(db, job, context, cvs)
                done += 1
            except Exception:  # one bad job must not stop the batch
                logger.exception("scoring failed", extra={"job_id": job.id})
        db.commit()
    return {"requested": len(ids), "analyzed": done}


def current_match(db: Session, job: Job) -> JobMatch | None:
    return db.get(JobMatch, job.current_match_id) if job.current_match_id else None


def match_history(db: Session, job_id: int) -> list[JobMatch]:
    if db.get(Job, job_id) is None:
        raise NotFoundError(f"Job {job_id} not found")
    return list(
        db.scalars(
            select(JobMatch)
            .where(JobMatch.job_id == job_id)
            .order_by(JobMatch.analyzed_at.desc(), JobMatch.id.desc())
        )
    )
