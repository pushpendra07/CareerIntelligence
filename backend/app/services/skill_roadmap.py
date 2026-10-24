"""Skill roadmap: which missing skills to learn, in what order, and what each one is worth.

Every open job is scored again by the same engine with one missing skill added to your profile.
A skill's worth is the number of jobs that would reach a good score (the Scoring "recommended"
threshold, where the advice is Apply) and the points those jobs gain. The roadmap is built step
by step: each step takes the skill that brings the most new good jobs on top of the steps before.
Read-only: nothing is saved, and the stored scores don't change.
"""

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.matching.config import ScoringConfig
from app.matching.engine import (
    GENERIC_SKILLS,
    SOFT_CATEGORIES,
    JobFacts,
    ProfileFacts,
    SkillMatch,
    TargetFacts,
    classify_skill,
    score_match,
)
from app.models.job import Job
from app.services import profile_service
from app.services.cv_advisor import ACTIVE, hidden_skills
from app.services.match_service import active_config, job_facts, profile_facts, target_facts
from app.skills.catalog import skill_category

CANDIDATES = 25  # most-asked missing skills that are tried
STEPS = 6  # roadmap length
PATH_POOL = 12  # skills the roadmap chooses from
EXAMPLES = 3


@dataclass
class _Skill:
    name: str
    required: int = 0
    preferred: int = 0
    strong: int = 0  # asked for by jobs that already score "consider" or more
    close_to: Counter[str] = field(default_factory=Counter)  # your skills that partly cover it
    jobs: set[int] = field(default_factory=set)  # jobs whose score this skill can change


class _Scorer:
    """Scores jobs with extra skills added to the profile; remembers every result."""

    def __init__(self, facts: dict[int, JobFacts], profile: ProfileFacts, target: TargetFacts,
                 cfg: ScoringConfig) -> None:
        self.facts, self.profile, self.target, self.cfg = facts, profile, target, cfg
        self._cache: dict[tuple[int, frozenset[str]], int] = {}

    def score(self, job_id: int, extra: frozenset[str]) -> int:
        key = (job_id, extra)
        if key not in self._cache:
            profile = self.profile.model_copy(update={
                "additional_skills": [*self.profile.additional_skills, *sorted(extra)]})
            self._cache[key] = score_match(self.facts[job_id], profile, self.target,
                                           self.cfg).score
        return self._cache[key]


def _learnable(skill: str) -> bool:
    return skill_category(skill) not in SOFT_CATEGORIES and skill not in GENERIC_SKILLS


def roadmap(db: Session) -> dict[str, Any]:
    _, cfg = active_config(db)
    target_row = profile_service.get_target(db)
    profile = profile_facts(profile_service.get_profile(db))
    target = target_facts(target_row)
    good, strong = cfg.thresholds.recommended, cfg.thresholds.consider
    in_search = {s.lower() for s in [*target_row.required_skills, *target_row.preferred_skills]}
    hidden = {s.lower() for s in hidden_skills(db)}

    jobs = {j.id: j for j in db.scalars(
        select(Job).options(selectinload(Job.company))
        .where(Job.status.in_(ACTIVE), Job.current_match_id.is_not(None)))}
    facts = {i: job_facts(j) for i, j in jobs.items()}
    scorer = _Scorer(facts, profile, target, cfg)
    none: frozenset[str] = frozenset()
    base = {i: scorer.score(i, none) for i in facts}

    have = {*profile.core_skills, *profile.additional_skills, *profile.leadership}
    skills: dict[str, _Skill] = {}
    for i, f in facts.items():
        for importance, names in (("REQUIRED", f.required_skills),
                                  ("PREFERRED", f.preferred_skills)):
            for name in names:
                match, via = classify_skill(name, have)
                if match == SkillMatch.EXACT_MATCH or not _learnable(name) \
                        or name.lower() in hidden:
                    continue
                s = skills.setdefault(name, _Skill(name))
                if i in s.jobs:
                    continue
                s.jobs.add(i)
                if importance == "REQUIRED":
                    s.required += 1
                else:
                    s.preferred += 1
                if base[i] >= strong:
                    s.strong += 1
                if via:
                    s.close_to[via] += 1
    ranked = sorted(skills.values(),
                    key=lambda s: (-s.required, -(s.required + s.preferred), s.name.lower()))
    pool = ranked[:CANDIDATES]
    # Learning a skill can also cover others (Magento 2 covers Magento): those jobs change too.
    now = {name: classify_skill(name, have)[0] for name in skills}
    for s in pool:
        for other in skills.values():
            if other is not s and classify_skill(other.name, have | {s.name})[0] != now[other.name]:
                s.jobs = s.jobs | other.jobs

    def gains(s: _Skill, extra: frozenset[str]) -> list[tuple[int, int, int]]:
        """(job, score before, score after) for jobs that reach a good score with this skill."""
        out = []
        for i in s.jobs:
            before = scorer.score(i, extra)
            after = scorer.score(i, extra | {s.name})
            if before < good <= after:
                out.append((i, before, after))
        return out

    def examples(rows: list[tuple[int, int, int]]) -> list[dict[str, Any]]:
        top = sorted(rows, key=lambda r: (-r[2], r[0]))[:EXAMPLES]
        return [{"id": i, "title": jobs[i].title, "company": jobs[i].company.name,
                 "before": b, "after": a} for i, b, a in top]

    strong_jobs = sum(1 for v in base.values() if v >= strong)
    out_skills: list[dict[str, Any]] = []
    for s in pool:
        rows = gains(s, none)
        lifts = [scorer.score(i, frozenset({s.name})) - base[i] for i in s.jobs]
        raised = [x for x in lifts if x > 0]
        out_skills.append({
            "skill": s.name,
            "required": s.required,
            "preferred": s.preferred,
            "jobs": s.required + s.preferred,
            "strong_share": round(100 * s.strong / strong_jobs) if strong_jobs else None,
            "new_good": len(rows),
            "jobs_raised": len(raised),
            "avg_gain": round(sum(raised) / len(raised), 1) if raised else 0,
            "close_to": s.close_to.most_common(1)[0][0] if s.close_to else None,
            "in_search": s.name.lower() in in_search,
            "examples": examples(rows),
        })
    out_skills.sort(key=lambda x: (-int(x["new_good"]), -int(x["jobs_raised"]),
                                   -int(x["required"]), str(x["skill"]).lower()))

    # Greedy path: each step adds the skill with the most new good jobs given the earlier steps.
    steps: list[dict[str, Any]] = []
    learned: frozenset[str] = none
    total = sum(1 for v in base.values() if v >= good)
    # Only skills that raise some job on their own, best first (keeps this to a few seconds).
    by_name = {s.name: s for s in pool}
    left = [by_name[x["skill"]] for x in out_skills if x["jobs_raised"]][:PATH_POOL]
    for _ in range(STEPS):
        best: tuple[int, int, str] | None = None
        best_rows: list[tuple[int, int, int]] = []
        for s in left:
            rows = gains(s, learned)
            moved = sum(1 for i in s.jobs if scorer.score(i, learned | {s.name})
                        > scorer.score(i, learned))
            key = (len(rows), moved, s.name)
            if moved and (best is None or (key[0], key[1]) > (best[0], best[1])):
                best, best_rows = key, rows
        if best is None:
            break
        learned = learned | {best[2]}
        total += len(best_rows)
        left = [s for s in left if s.name != best[2]]
        steps.append({"step": len(steps) + 1, "skill": best[2], "new_good": len(best_rows),
                      "jobs_raised": best[1], "total_good": total,
                      "examples": examples(best_rows)})

    return {
        "threshold": good,
        "strong_threshold": strong,
        "jobs_considered": len(facts),
        "good_now": sum(1 for v in base.values() if v >= good),
        "strong_now": strong_jobs,
        "skills": out_skills,
        "roadmap": steps,
        "hidden": sorted(hidden_skills(db), key=str.lower),
    }
