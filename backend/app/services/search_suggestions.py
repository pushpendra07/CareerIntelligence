"""Suggestions for the job search form (Skills & targets), learned from what you did with jobs.

Jobs you went for (shortlisted, applied, interviewed… rejected included: you still applied) show
which titles and skills to look for; jobs you marked Not relevant or Ignored show what to leave
out — but only words that are rare in the jobs you went for, so a skill you use is never
suggested as one to ignore. Deterministic, from your own data only.
"""

import re
from collections import Counter
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.job import Job, JobStatus

WENT_FOR = [JobStatus.SHORTLISTED, JobStatus.READY_TO_APPLY, JobStatus.APPLIED,
            JobStatus.RECRUITER_CONTACTED, JobStatus.SCREENING, JobStatus.INTERVIEW,
            JobStatus.AWAITING_FEEDBACK, JobStatus.OFFER, JobStatus.ACCEPTED, JobStatus.REJECTED,
            JobStatus.WITHDRAWN]
TURNED_DOWN = [JobStatus.NOT_RELEVANT, JobStatus.IGNORED]
LIMIT = 8

_LEVEL = {"senior", "sr", "junior", "jr", "lead", "principal", "staff", "head", "associate",
          "chief", "i", "ii", "iii", "iv", "trainee", "intern"}
# Words every kind of job title has; they never tell a wanted job from an unwanted one.
_GENERIC = _LEVEL - {"trainee", "intern"} | {
    "developer", "developers", "engineer", "engineers", "manager", "specialist", "consultant",
    "executive", "analyst", "officer", "remote", "hybrid", "onsite", "india", "and", "or", "of",
    "the", "for", "with", "in", "at", "to", "a", "an", "job", "jobs", "position", "opening",
    "role", "team", "full", "time", "fulltime", "contract", "permanent", "urgent", "hiring",
    "immediate", "joiner", "joiners", "wfh", "work", "from", "home", "office", "years", "yrs",
    "experience", "exp", "location", "based"}
_SPLIT = re.compile(r"\s+[-–—|:@]\s+|\s*\(|,\s+|\s+/\s+")
_WORD = re.compile(r"[a-z][a-z0-9+#.]*[a-z0-9+#]|[a-z]")


def level(word: str) -> bool:
    return word.lower().rstrip(".") in _LEVEL


def _core_title(title: str) -> str:
    """"Sr. Magento Developer - Pune (Remote)" -> "Magento Developer"."""
    head = re.findall(r"[A-Za-z0-9+#.]+", _SPLIT.split(title.strip())[0])
    words = list(head)
    while words and level(words[0]):  # "Senior Magento Developer"
        words.pop(0)
    # "Magento Developer Lead", but "Technical Lead" / "Team Lead" are titles of their own.
    keeps_lead = ("technical", "tech", "team")
    if len(words) > 1 and level(words[-1]) and words[-2].lower() not in keeps_lead:
        words.pop()
    # "Technical Lead" or "Magento Lead": one word alone says too little, keep the title as it is.
    return " ".join((words if len(words) > 1 else head)[:5]).rstrip(".")


def _jobs(db: Session, statuses: list[JobStatus]) -> list[tuple[str, list[str]]]:
    rows = db.execute(select(Job.title, Job.required_skills, Job.preferred_skills)
                      .where(Job.status.in_([s.value for s in statuses]))
                      .order_by(Job.id.desc()).limit(3000)).all()
    return [(t, sorted({s for s in [*(r or []), *(p or [])] if s})) for t, r, p in rows]


def _ranked(counts: Counter[str], label: dict[str, str], keep: Any) -> list[dict[str, Any]]:
    out = [{"value": label[k], "count": n} for k, n in counts.most_common() if keep(k, n)]
    return out[:LIMIT]


def _phrase(word: str, titles: list[str]) -> str:
    """The two-word phrase a title word mostly appears in, when it does (60%+), else the word."""
    w = word.lower()
    pairs: Counter[str] = Counter()
    seen = 0
    for title in titles:
        tokens = _WORD.findall(title.lower())
        if w not in tokens:
            continue
        seen += 1
        i = tokens.index(w)
        for a, b in ((i - 1, i), (i, i + 1)):
            if a >= 0 and b < len(tokens) and not {tokens[a], tokens[b]} & _GENERIC:
                pairs[f"{tokens[a]} {tokens[b]}"] += 1
    if pairs and seen:
        best, n = pairs.most_common(1)[0]
        if n / seen >= 0.6:
            return " ".join(x.upper() if len(x) <= 3 else x.capitalize() for x in best.split())
    return word


def rate(count: int, total: int) -> float:
    return count / total if total else 0.0


def suggestions(db: Session) -> dict[str, Any]:
    went = _jobs(db, WENT_FOR)
    down = _jobs(db, TURNED_DOWN)
    n_went, n_down = len(went), len(down)

    # Skills, counted once per job.
    label: dict[str, str] = {}
    sk_went: Counter[str] = Counter()
    sk_down: Counter[str] = Counter()
    for counter, jobs in ((sk_went, went), (sk_down, down)):
        for _, skills in jobs:
            for s in skills:
                label.setdefault(s.lower(), s)
                counter[s.lower()] += 1
    must_have = _ranked(sk_went, label, lambda k, n: n >= 2 and rate(n, n_went) >= 0.2
                        and rate(sk_down[k], n_down) <= rate(n, n_went))
    ignore_skills = _ranked(sk_down, label, lambda k, n: n >= 3 and rate(n, n_down) >= 0.1
                            and rate(sk_went[k], n_went) <= 0.05)

    # Titles you went for, without level words ("Magento Developer").
    titles: Counter[str] = Counter()
    title_label: dict[str, str] = {}
    for title, _ in went:
        core = _core_title(title)
        if core:
            title_label.setdefault(core.lower(), core)
            titles[core.lower()] += 1
    target_titles = _ranked(titles, title_label, lambda k, n: n >= 2)

    # Title words common in jobs you turned down and rare in jobs you went for ("Sales", "Java").
    words_went: Counter[str] = Counter()
    words_down: Counter[str] = Counter()
    word_label: dict[str, str] = {}
    for counter, jobs in ((words_went, went), (words_down, down)):
        for title, _ in jobs:
            for w in set(_WORD.findall(title.lower())):
                if w not in _GENERIC and len(w) > 1:
                    word_label.setdefault(w, w.upper() if len(w) <= 3 else w.capitalize())
                    counter[w] += 1
    ignore_titles = _ranked(words_down, word_label, lambda k, n: n >= 3 and rate(n, n_down) >= 0.1
                            and rate(words_went[k], n_went) <= 0.05 and k not in sk_down)
    # "Solution" alone reads oddly: show the phrase it mostly comes in ("Solution Architect").
    phrases: dict[str, dict[str, Any]] = {}
    for item in ignore_titles:
        value = _phrase(item["value"], [t for t, _ in down])
        if value.lower() not in phrases:  # "solution" and "architect" -> one "Solution Architect"
            phrases[value.lower()] = {"value": value, "count": item["count"]}
    ignore_titles = list(phrases.values())
    return {
        "based_on": {"went_for": n_went, "turned_down": n_down},
        "target_titles": target_titles,
        "required_skills": must_have,
        "excluded_roles": ignore_titles,
        "excluded_technologies": ignore_skills,
    }
