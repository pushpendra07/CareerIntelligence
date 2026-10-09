"""CV advice from the job search: which skills to add to the CV, and which ones you lack.

Built from the current match results of open jobs (each records the job's required/preferred
skills and whether you have them), your profile skills, and the text of your active CV.
"""

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError
from app.models.app_settings import AppSettings
from app.models.cv import CV
from app.models.job import Job, JobStatus
from app.models.match import JobMatch
from app.services import profile_service
from app.skills.catalog import find_skills, normalize_skill

# Jobs you're still pursuing (rejected/withdrawn/closed/not relevant don't count).
ACTIVE = [s.value for s in JobStatus if s not in (
    JobStatus.CLOSED, JobStatus.NOT_RELEVANT, JobStatus.REJECTED, JobStatus.WITHDRAWN)]
LIMIT = 25


@dataclass
class _Tally:
    skill: str
    required: int = 0
    preferred: int = 0
    score_sum: int = 0
    jobs: list[tuple[int, int, str, str]] = field(default_factory=list)  # score, id, title, co

    def add(self, importance: str, score: int, job: Job) -> None:
        if importance == "REQUIRED":
            self.required += 1
        else:
            self.preferred += 1
        self.score_sum += score
        self.jobs.append((score, job.id, job.title, job.company.name))

    def out(self, **extra: Any) -> dict[str, Any]:
        total = self.required + self.preferred
        top = sorted(self.jobs, key=lambda j: (-j[0], j[1]))[:3]
        return {
            "skill": self.skill,
            "jobs": total,
            "required": self.required,
            "preferred": self.preferred,
            "avg_job_score": round(self.score_sum / total, 1) if total else None,
            "examples": [{"id": i, "title": t, "company": c, "score": s} for s, i, t, c in top],
            **extra,
        }


def _settings(db: Session) -> AppSettings:
    row = db.get(AppSettings, 1)
    if row is None:
        row = AppSettings(id=1, data={})
        db.add(row)
        db.flush()
    return row


def hidden_skills(db: Session) -> list[str]:
    row = db.get(AppSettings, 1)
    return list(((row.data if row else {}).get("cv_advisor") or {}).get("hidden") or [])


def _active_cv_text(db: Session) -> tuple[str | None, str]:
    cv = db.scalar(select(CV).where(CV.is_active.is_(True), CV.is_archived.is_(False)).limit(1))
    if cv is None or cv.current_version is None:
        return None, ""
    return cv.name, cv.current_version.extracted_text or ""


def advice(db: Session) -> dict[str, Any]:
    profile = profile_service.get_profile(db)
    target = profile_service.get_target(db)
    have = {s.lower() for s in [*profile.core_skills, *profile.additional_skills,
                                *profile.leadership]}
    in_search = {s.lower() for s in [*target.required_skills, *target.preferred_skills]}
    cv_name, cv_text = _active_cv_text(db)
    cv_skills = {s.lower() for s in find_skills(cv_text)}
    lowered_text = cv_text.lower()
    hidden = {s.lower() for s in hidden_skills(db)}

    tallies: dict[str, _Tally] = {}
    missing: set[str] = set()
    rows = db.execute(
        select(Job, JobMatch)
        .join(JobMatch, Job.current_match_id == JobMatch.id)
        .where(Job.status.in_(ACTIVE))
    ).all()
    for job, match in rows:
        for entry in (match.result or {}).get("skills", []):
            name = entry.get("skill")
            if not name:
                continue
            t = tallies.setdefault(name.lower(), _Tally(name))
            t.add(entry.get("importance", "PREFERRED"), match.score, job)
            # Not an exact match: missing, or only covered by a related skill you have.
            if entry.get("match") in ("MISSING", "RELATED", "NICE_TO_HAVE"):
                missing.add(name.lower())

    def in_cv(skill: str) -> bool:
        return skill.lower() in cv_skills or (len(skill) > 3 and skill.lower() in lowered_text)

    add_to_cv, to_learn = [], []
    for key, t in tallies.items():
        if key in hidden:
            continue
        if key in have and not in_cv(t.skill) and cv_name:
            add_to_cv.append(t.out(in_search=key in in_search))
        elif key in missing and key not in have:
            to_learn.append(t.out(in_search=key in in_search))
    order = lambda x: (-x["required"], -x["jobs"], x["skill"].lower())  # noqa: E731
    return {
        "cv": cv_name,
        "jobs_considered": len(rows),
        "add_to_cv": sorted(add_to_cv, key=order)[:LIMIT],
        "missing": sorted(to_learn, key=order)[:LIMIT],
        "hidden": sorted(hidden_skills(db), key=str.lower),
    }


def act(db: Session, action: str, raw_skill: str) -> dict[str, Any]:
    """add-to-profile | add-to-search | hide | unhide. Profile/search changes re-score jobs."""
    skill = (normalize_skill(raw_skill) or raw_skill).strip()
    if not skill:
        raise DomainValidationError("Skill is required")
    rescored = 0
    if action == "add-to-profile":
        profile = profile_service.get_profile(db)
        current = [*profile.core_skills]
        if skill.lower() not in {s.lower() for s in [*current, *profile.additional_skills]}:
            profile_service.update_profile(db, {"core_skills": [*current, skill]})
            rescored = _rescore(db)
    elif action == "add-to-search":
        target = profile_service.get_target(db)
        if skill.lower() not in {s.lower() for s in [*target.required_skills,
                                                     *target.preferred_skills]}:
            profile_service.update_target(db, {"preferred_skills": [*target.preferred_skills,
                                                                    skill]})
            rescored = _rescore(db)
    elif action in ("hide", "unhide"):
        row = _settings(db)
        data = dict(row.data)
        advisor = dict(data.get("cv_advisor") or {})
        hidden = [s for s in advisor.get("hidden", []) if s.lower() != skill.lower()]
        if action == "hide":
            hidden.append(skill)
        advisor["hidden"] = hidden
        data["cv_advisor"] = advisor
        row.data = data
        db.commit()
    else:
        raise DomainValidationError(f"Unknown action '{action}'")
    return {"skill": skill, "action": action, "rescored": rescored}


def _rescore(db: Session) -> int:
    from app.services.match_service import reanalyze

    return int(reanalyze(db, only_stale=True)["analyzed"])
