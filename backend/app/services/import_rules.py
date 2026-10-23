"""Import rules: which new jobs may be saved at all.

Edited in My profile → Target roles → Which jobs to save.

Checked by `job_service.ingest_job` before a *new* job is created, for the sources the user
picked. A job that breaks a rule raises `FilteredJobError`; importers count it as skipped.
Jobs already in the app are never blocked (a second source only adds a link to them).

The rules can reuse the target profile's lists (`from_profile`), so the same words aren't kept
twice: target titles (a job title must fit one), required skills, excluded roles and excluded
technologies. Their own lists hold extra filter-only words.

Order: ignored role → ignored skill → required role → required skill. Skills are looked for in
the title, the job description and any skills the source sent; roles in the title only.
"""

import re
from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError

# JobInput.origin values, with the names shown in Settings.
SOURCES: dict[str, str] = {
    "scan": "Job board search",
    "career_ops": "Career-Ops",
    "ai_job_search": "AI Job Search",
    "sheet": "Google Sheets",
    "import": "CSV / JSON file",
    "agent": "AI search & Chrome extension",
    "manual": "Add Job (by hand)",
}

# Off with empty lists on a new install: never seed one user's preferences for everyone.
DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "required_skills": [],  # a new job must mention at least one (empty = no skill needed)
    "ignored_skills": [],  # a new job mentioning any of these is not saved
    "required_roles": [],  # the title must contain at least one (empty = any title)
    "ignored_roles": [],  # a title containing any of these is not saved
    # No description: True keeps the job when its title alone doesn't show a required skill
    # (many sheets and Career-Ops rows have no JD yet); False skips it.
    "keep_without_description": True,
    "sources": [k for k in SOURCES if k != "manual"],
    # The four lists above (extra words for filtering only) can be switched off on their own.
    "extras_enabled": True,
    # Target profile lists that also filter new jobs (off on a new install).
    "from_profile": {"target_titles": False, "required_skills": False, "excluded_roles": False,
                     "excluded_technologies": False},
}
_LISTS = ("required_skills", "ignored_skills", "required_roles", "ignored_roles")
PROFILE_LISTS = tuple(DEFAULTS["from_profile"])
# Level words a target title may carry that the job title needn't repeat.
_LEVEL_WORDS = {"senior", "sr", "junior", "jr", "lead", "principal", "staff", "head", "associate",
                "chief", "i", "ii", "iii", "iv", "of", "and", "the", "&", "-", "/", ","}
MAX_TERMS = 200


class FilteredJobError(DomainValidationError):
    """The new job breaks an import rule; it is not saved."""

    code = "job_filtered"

    def __init__(self, reason: str) -> None:
        super().__init__(f"Not saved by your import rules: {reason}")
        self.reason = reason


def validate_settings(values: dict[str, Any]) -> dict[str, Any]:
    out = {**DEFAULTS, **values}
    for key in _LISTS:
        raw = out[key]
        if isinstance(raw, str):
            raw = raw.split(",")
        if not isinstance(raw, list):
            raise DomainValidationError(f"'{key}' must be a list")
        seen: dict[str, str] = {}
        for item in raw:
            term = " ".join(str(item).split())
            if term and term.lower() not in seen:
                seen[term.lower()] = term
        if len(seen) > MAX_TERMS:
            raise DomainValidationError(f"'{key}' can hold at most {MAX_TERMS} entries")
        out[key] = list(seen.values())
    unknown = set(out["sources"]) - set(SOURCES)
    if not isinstance(out["sources"], list) or unknown:
        raise DomainValidationError(f"Unknown sources: {sorted(unknown)}")
    out["sources"] = [k for k in SOURCES if k in out["sources"]]
    linked = out.get("from_profile")
    if not isinstance(linked, dict):
        raise DomainValidationError("'from_profile' must be an object")
    out["from_profile"] = {k: bool(linked.get(k, False)) for k in PROFILE_LISTS}
    out["enabled"] = bool(out["enabled"])
    out["extras_enabled"] = bool(out["extras_enabled"])
    out["keep_without_description"] = bool(out["keep_without_description"])
    return {k: out[k] for k in DEFAULTS}


def get_rules(db: Session) -> dict[str, Any]:
    from app.models.app_settings import AppSettings

    row = db.get(AppSettings, 1)
    return {**DEFAULTS, **((row.data if row else {}).get("import_rules") or {})}


def _pattern(term: str) -> re.Pattern[str]:
    """Whole words, any case; a space also matches '-' or nothing ("magento 2" = "Magento2"),
    and a trailing plural is allowed ("developer" = "Developers")."""
    words = [re.escape(w) for w in term.lower().split()]
    body = r"[\s\-_/]*".join(words)
    return re.compile(rf"(?<![a-z0-9]){body}(?:s|es)?(?![a-z0-9])", re.IGNORECASE)


def _first(terms: list[str], text: str) -> str | None:
    return next((t for t in terms if t.strip() and _pattern(t).search(text)), None)


def title_fits(target: str, title: str) -> bool:
    """A job title fits a target title when it has all the target's words apart from level words:
    "Senior Magento Developer" fits "Magento 2 Developer" and "Lead Magento Developer (Remote)"."""
    words = [w for w in target.lower().split() if w not in _LEVEL_WORDS]
    if not words:
        return bool(_pattern(target).search(title))
    return all(_pattern(w).search(title) for w in words)


def profile_terms(db: Session, rules: dict[str, Any]) -> dict[str, list[str]]:
    """The target profile lists the rules reuse (empty when that list isn't linked)."""
    from app.services.profile_service import effective_titles, get_target

    linked = rules.get("from_profile") or {}
    if not any(linked.values()):
        return {k: [] for k in PROFILE_LISTS}
    target = get_target(db)
    values = {"target_titles": effective_titles(target), "required_skills": target.required_skills,
              "excluded_roles": target.excluded_roles,
              "excluded_technologies": target.excluded_technologies}
    return {k: list(values[k] or []) if linked.get(k) else [] for k in PROFILE_LISTS}


def check(rules: dict[str, Any], title: str, description: str = "",
          skills: list[str] | None = None,
          profile: dict[str, list[str]] | None = None) -> str | None:
    """Why this job may not be saved, or None when it passes. Ignores `enabled` / `sources`.

    `profile`: the linked target profile lists (`profile_terms`)."""
    p = profile or {}
    if not rules.get("extras_enabled", True):
        rules = {**rules, **{k: [] for k in _LISTS}}
    has_description = bool((description or "").strip())
    text = "\n".join([title, description or "", ", ".join(skills or [])])
    if hit := _first(rules.get("ignored_roles") or [], title):
        return f"ignored role “{hit}”"
    if hit := _first(p.get("excluded_roles") or [], title):
        return f"excluded role “{hit}” (target profile)"
    if hit := _first(rules.get("ignored_skills") or [], text):
        return f"ignored skill “{hit}”"
    if hit := _first(p.get("excluded_technologies") or [], text):
        return f"excluded technology “{hit}” (target profile)"
    roles = [r for r in rules.get("required_roles") or [] if r.strip()]
    targets = [t for t in p.get("target_titles") or [] if t.strip()]
    fits = _first(roles, title) or any(title_fits(t, title) for t in targets)
    if (roles or targets) and not fits:
        names = [*targets, *roles]
        shown = ", ".join(names[:5]) + ("…" if len(names) > 5 else "")
        if not targets:
            return f"title has none of your roles to keep ({shown})"
        return f"title fits none of your target titles or roles to keep ({shown})"
    required = [s for s in [*(rules.get("required_skills") or []),
                            *(p.get("required_skills") or [])] if s.strip()]
    if required and not _first(required, text):
        if not has_description and not skills and rules.get("keep_without_description", True):
            return None
        return "none of your required skills" + ("" if has_description else " (no description)")
    return None


def applies(rules: dict[str, Any], origin: str) -> bool:
    return bool(rules.get("enabled")) and origin in (rules.get("sources") or [])


def explain(rules: dict[str, Any], title: str, description: str = "",
            profile: dict[str, list[str]] | None = None) -> dict[str, Any]:
    """For the tester: the decision and which terms were found."""
    p = profile or {}
    text = f"{title}\n{description}"
    reason = check(rules, title, description, profile=p)
    if not rules.get("extras_enabled", True):
        rules = {**rules, **{k: [] for k in _LISTS}}

    def found(terms: list[str], where: str) -> list[str]:
        return [t for t in terms if t.strip() and _pattern(t).search(where)]

    return {
        "saved": reason is None,
        "reason": reason,
        "found_skills": found([*(rules.get("required_skills") or []),
                               *(p.get("required_skills") or [])], text),
        "found_ignored_skills": found([*(rules.get("ignored_skills") or []),
                                       *(p.get("excluded_technologies") or [])], text),
        "found_roles": [*found(rules.get("required_roles") or [], title),
                        *[t for t in p.get("target_titles") or [] if title_fits(t, title)]],
        "found_ignored_roles": found([*(rules.get("ignored_roles") or []),
                                      *(p.get("excluded_roles") or [])], title),
    }


IMPACT_SAMPLE = 3000


def impact(db: Session, rules: dict[str, Any], profile: dict[str, list[str]]) -> dict[str, Any]:
    """What these rules would have done to the open jobs you have now (nothing is changed):
    how many would not have been saved, the most common reasons, and a few examples."""
    from sqlalchemy import select

    from app.models.job import Job, JobStatus

    finished = [JobStatus.CLOSED, JobStatus.NOT_RELEVANT, JobStatus.IGNORED, JobStatus.DUPLICATE,
                JobStatus.REJECTED, JobStatus.WITHDRAWN]
    jobs = db.execute(
        select(Job.id, Job.title, Job.original_jd, Job.match_score)
        .where(Job.status.notin_([s.value for s in finished]))
        .order_by(Job.id.desc()).limit(IMPACT_SAMPLE)
    ).all()
    blocked: list[tuple[float, dict[str, Any]]] = []
    reasons: dict[str, int] = {}
    for job_id, title, jd, score in jobs:
        if reason := check(rules, title, jd or "", profile=profile):
            blocked.append((float(score or 0),
                            {"id": job_id, "title": title, "score": score, "reason": reason}))
            key = reason.split(" (")[0] if reason.startswith("title ") else reason
            reasons[key] = reasons.get(key, 0) + 1
    blocked.sort(key=lambda b: -b[0])  # good jobs it would lose come first
    return {
        "checked": len(jobs),
        "blocked": len(blocked),
        "reasons": [{"reason": r, "count": n}
                    for r, n in sorted(reasons.items(), key=lambda kv: -kv[1])[:8]],
        "examples": [b for _, b in blocked[:8]],
        "high_scoring_blocked": sum(1 for score, _ in blocked if score >= 70),
    }
