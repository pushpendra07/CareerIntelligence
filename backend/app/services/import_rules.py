"""Import rules: which new jobs may be saved at all (Settings → Import rules).

Checked by `job_service.ingest_job` before a *new* job is created, for the sources the user
picked. A job that breaks a rule raises `FilteredJobError`; importers count it as skipped.
Jobs already in the app are never blocked (a second source only adds a link to them).

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
}
_LISTS = ("required_skills", "ignored_skills", "required_roles", "ignored_roles")
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
    out["enabled"] = bool(out["enabled"])
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


def check(rules: dict[str, Any], title: str, description: str = "",
          skills: list[str] | None = None) -> str | None:
    """Why this job may not be saved, or None when it passes. Ignores `enabled` / `sources`."""
    has_description = bool((description or "").strip())
    text = "\n".join([title, description or "", ", ".join(skills or [])])
    if hit := _first(rules.get("ignored_roles") or [], title):
        return f"ignored role “{hit}”"
    if hit := _first(rules.get("ignored_skills") or [], text):
        return f"ignored skill “{hit}”"
    roles = [r for r in rules.get("required_roles") or [] if r.strip()]
    if roles and not _first(roles, title):
        shown = ", ".join(roles[:5]) + ("…" if len(roles) > 5 else "")
        return f"title has none of your roles to keep ({shown})"
    required = [s for s in rules.get("required_skills") or [] if s.strip()]
    if required and not _first(required, text):
        if not has_description and not skills and rules.get("keep_without_description", True):
            return None
        return "none of your required skills" + ("" if has_description else " (no description)")
    return None


def applies(rules: dict[str, Any], origin: str) -> bool:
    return bool(rules.get("enabled")) and origin in (rules.get("sources") or [])


def explain(rules: dict[str, Any], title: str, description: str = "") -> dict[str, Any]:
    """For the Settings tester: the decision and which terms were found."""
    text = f"{title}\n{description}"
    reason = check(rules, title, description)
    return {
        "saved": reason is None,
        "reason": reason,
        "found_skills": [t for t in rules.get("required_skills") or [] if _pattern(t).search(text)],
        "found_ignored_skills": [t for t in rules.get("ignored_skills") or []
                                 if _pattern(t).search(text)],
        "found_roles": [t for t in rules.get("required_roles") or [] if _pattern(t).search(title)],
        "found_ignored_roles": [t for t in rules.get("ignored_roles") or []
                                if _pattern(t).search(title)],
    }
