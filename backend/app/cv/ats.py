"""ATS check: how well a CV's text covers one job's keywords (0-100), and what is missing.

Deterministic and keyword-based, like the applicant tracking systems it imitates: the job's
required and nice-to-have skills, its title and its minimum experience are looked for in the
CV text. A skill counts when the CV names it (any alias) or a more specific form of it
("Magento 2" covers "Magento"); a related skill ("MariaDB" for "MySQL") is only a hint.

Weights: required skills 50, nice-to-have 20, job title 15, experience 15. Parts the job
doesn't state (no nice-to-have skills, no minimum years) are left out and the rest scaled
to 100, so a job with only required skills can still reach 100.
"""

import re
from dataclasses import dataclass, field
from typing import Literal

from app.cv.parser import parse_cv
from app.skills.catalog import SKILLS_BY_NAME, ancestors, find_skills, related

Status = Literal["found", "implied", "related", "missing"]
WEIGHTS = {"required": 50, "preferred": 20, "title": 15, "experience": 15}
# An implied skill (the CV names a more specific form) still earns most of the credit: an ATS
# matching words may not see "Magento" in "Magento 2 developer".
IMPLIED_CREDIT = 0.75
_TITLE_NOISE = {
    "senior", "sr", "junior", "jr", "lead", "principal", "staff", "associate", "trainee",
    "intern", "i", "ii", "iii", "iv", "the", "and", "of", "for", "with", "a", "an", "to", "in",
    "remote", "hybrid", "onsite", "contract", "full", "time", "part", "immediate", "joiner",
}


@dataclass
class Keyword:
    skill: str
    importance: Literal["required", "preferred"]
    status: Status
    via: str | None = None  # the CV skill that implies / relates to it


@dataclass
class AtsReport:
    score: int
    parts: dict[str, dict[str, float]]  # part -> {"earned", "max"}
    keywords: list[Keyword]
    title: str | None
    title_words_missing: list[str]
    experience_required: float | None
    experience_found: float | None
    notes: list[str] = field(default_factory=list)


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9+#.]+", text.lower())


def _named_in(text: str, skill: str) -> bool:
    """A skill the catalog doesn't know: look for the words themselves."""
    return re.search(rf"(?<![\w+#]){re.escape(skill)}(?![\w+#])", text, re.IGNORECASE) is not None


def _status(skill: str, text: str, have: set[str]) -> tuple[Status, str | None]:
    if skill in have or (skill not in SKILLS_BY_NAME and _named_in(text, skill)):
        return "found", None
    for cv_skill in sorted(have):
        if skill in ancestors(cv_skill):
            return "implied", cv_skill
    for cv_skill in sorted(have):
        if cv_skill in related(skill):
            return "related", cv_skill
    return "missing", None


def _credit(status: Status) -> float:
    return 1.0 if status == "found" else IMPLIED_CREDIT if status == "implied" else 0.0


def title_words(title: str | None) -> list[str]:
    """The words of a job title that matter for matching ("Sr. PHP Developer" -> php, developer)."""
    out: list[str] = []
    for w in _words(title or ""):
        w = w.strip(".")
        if w and w not in _TITLE_NOISE and not w.isdigit() and w not in out:
            out.append(w)
    return out


def score_cv(text: str, title: str | None, required: list[str], preferred: list[str],
             experience_min: float | None) -> AtsReport:
    have = set(find_skills(text))
    keywords: list[Keyword] = []
    parts: dict[str, dict[str, float]] = {}
    for importance, skills in (("required", required), ("preferred", preferred)):
        unique = list(dict.fromkeys(s for s in skills if s))
        if not unique:
            continue
        earned = 0.0
        for skill in unique:
            status, via = _status(skill, text, have)
            keywords.append(Keyword(skill, importance, status, via))  # type: ignore[arg-type]
            earned += _credit(status)
        parts[importance] = {"earned": earned / len(unique) * WEIGHTS[importance],
                             "max": WEIGHTS[importance]}

    cv_words = set(w.strip(".") for w in _words(text))
    wanted = title_words(title)
    missing_words = [w for w in wanted if w not in cv_words]
    if wanted:
        share = (len(wanted) - len(missing_words)) / len(wanted)
        parts["title"] = {"earned": share * WEIGHTS["title"], "max": WEIGHTS["title"]}

    notes: list[str] = []
    found_years: float | None = None
    if experience_min:
        parsed = parse_cv(text)
        found_years = parsed.stated_experience_years or parsed.total_experience_years
        if found_years is None:
            notes.append("The CV doesn't state its years of experience (e.g. “12 years”), so an "
                         "ATS can't check the job's minimum.")
            share = 0.0
        else:
            share = min(1.0, found_years / experience_min)
        parts["experience"] = {"earned": share * WEIGHTS["experience"],
                               "max": WEIGHTS["experience"]}

    total_max = sum(p["max"] for p in parts.values())
    score = round(sum(p["earned"] for p in parts.values()) / total_max * 100) if total_max else 0
    for p in parts.values():
        p["earned"] = round(p["earned"], 1)
    return AtsReport(score, parts, keywords, title, missing_words, experience_min, found_years,
                     notes)
