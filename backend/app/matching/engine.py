"""The one matching engine: (job, profile, target, config) -> explainable 0-100 MatchResult.

Pure and deterministic: no database, no clock, no randomness, no AI. Every component returns a
factor in [0, 1] plus human-readable reasons; points = factor * weight. The same inputs and
config always produce the same result, which `inputs_hash` lets you prove.
"""

import hashlib
import json
import re
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum

from pydantic import BaseModel, Field

from app.core.text import title_key
from app.jobs.jd_parser import CITY_ALIASES, detect_seniority
from app.matching.config import ENGINE_VERSION, LABELS, ScoringConfig
from app.skills.catalog import (
    CATALOG_VERSION,
    DOMAINS_BY_NAME,
    SKILLS_BY_NAME,
    ancestors,
    find_domains,
    find_skills,
    related,
    skill_category,
)


class SkillMatch(StrEnum):
    EXACT_MATCH = "EXACT_MATCH"
    PARTIAL_MATCH = "PARTIAL_MATCH"
    RELATED = "RELATED"
    MISSING = "MISSING"
    NICE_TO_HAVE = "NICE_TO_HAVE"  # a preferred skill the candidate lacks


class Recommendation(StrEnum):
    HIGHLY_RECOMMENDED = "HIGHLY_RECOMMENDED"
    RECOMMENDED = "RECOMMENDED"
    CONSIDER = "CONSIDER"
    LOW_PRIORITY = "LOW_PRIORITY"
    NOT_RECOMMENDED = "NOT_RECOMMENDED"


# ---------------------------------------------------------------------- inputs


class JobFacts(BaseModel):
    title: str
    has_jd: bool = True
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    skill_years: dict[str, float] = Field(default_factory=dict)
    responsibilities: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    experience_min: float | None = None
    experience_max: float | None = None
    leadership_required: bool = False
    locations: list[str] = Field(default_factory=list)
    location_text: str | None = None
    work_model: str = "UNKNOWN"
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str | None = None
    company_name: str = ""
    company_tier: str | None = None
    company_industry: str | None = None
    company_type: str | None = None
    certifications: list[str] = Field(default_factory=list)
    constraints: list[dict[str, object]] = Field(default_factory=list)


class ProfileFacts(BaseModel):
    total_years: float | None = None
    relevant_years: float | None = None
    leadership_years: float | None = None
    primary_roles: list[str] = Field(default_factory=list)
    core_skills: list[str] = Field(default_factory=list)
    additional_skills: list[str] = Field(default_factory=list)
    skill_years: dict[str, float] = Field(default_factory=dict)
    domains: list[str] = Field(default_factory=list)
    leadership: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    has_degree: bool = False


class TargetFacts(BaseModel):
    titles: list[str] = Field(default_factory=list)
    include_architect: bool = False
    preferred_domains: list[str] = Field(default_factory=list)
    preferred_companies: list[str] = Field(default_factory=list)
    preferred_locations: list[str] = Field(default_factory=list)
    remote_ok: bool = True
    hybrid_ok: bool = True
    onsite_ok: bool = True
    min_salary: float | None = None
    target_salary: float | None = None
    salary_currency: str = "INR"
    notice_period_days: int | None = None
    excluded_roles: list[str] = Field(default_factory=list)
    excluded_technologies: list[str] = Field(default_factory=list)
    excluded_industries: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------- outputs


class ComponentScore(BaseModel):
    key: str
    label: str
    weight: float
    factor: float
    points: float
    reasons: list[str] = Field(default_factory=list)


class SkillDetail(BaseModel):
    skill: str
    importance: str  # REQUIRED | PREFERRED
    match: SkillMatch
    via: str | None = None  # the profile skill that satisfied it


class Blocker(BaseModel):
    type: str
    message: str
    severity: str = "SOFT"  # HARD when listed in config.hard_blockers


class MatchResult(BaseModel):
    score: int
    raw_score: float
    recommendation: Recommendation
    action: str
    components: list[ComponentScore]
    skills: list[SkillDetail]
    strong_matches: list[str]
    missing: list[str]
    blockers: list[Blocker]
    experience_fit: str
    salary_status: str
    location_fit: str
    confidence: str = "HIGH"  # HIGH | MEDIUM | LOW (how much of the job is known)
    engine_version: str = ENGINE_VERSION
    catalog_version: str = CATALOG_VERSION
    inputs_hash: str = ""


# ---------------------------------------------------------------------- helpers

ROLE_FAMILIES: list[tuple[str, str]] = [
    ("ARCHITECT", r"\barchitect\b"),
    ("MANAGER", r"\b(manager|head|director|vp)\b"),
    ("LEAD", r"\b(lead|leader)\b"),
    ("CONSULTANT", r"\bconsultant\b"),
    ("DEVELOPER", r"\b(developer|engineer|programmer|sde|coder)\b"),
]
FAMILY_AFFINITY = {
    ("LEAD", "DEVELOPER"): 0.7,
    ("DEVELOPER", "LEAD"): 0.85,
    ("MANAGER", "LEAD"): 0.5,
    ("ARCHITECT", "LEAD"): 0.4,
    ("ARCHITECT", "DEVELOPER"): 0.3,
    ("CONSULTANT", "DEVELOPER"): 0.6,
    ("CONSULTANT", "LEAD"): 0.5,
    ("LEAD", "MANAGER"): 0.6,
}
LEVEL_ORDER = ["JUNIOR", "MID", "SENIOR", "LEAD", "PRINCIPAL", "ARCHITECT", "MANAGER", "EXECUTIVE"]
COUNTRY_HINTS = re.compile(
    r"\b(usa|united states|us only|u\.s\.|uk|united kingdom|europe|eu only|emea|germany|"
    r"canada|australia|latam|americas|singapore|uae|dubai)\b",
    re.IGNORECASE,
)
# Disciplines that make an otherwise generic "Lead"/"Engineer" title a different job.
DISCIPLINE_RE = re.compile(
    r"\b(quality|qa|test(?:ing)?|data|analytics|machine learning|ml|ai|security|"
    r"cryptograph\w*|devops|sre|network(?:ing)?|infrastructure|wireless|hardware|embedded|"
    r"mechanical|electrical|physical|mainframe|oracle|salesforce|servicenow|workday|"
    r"teamcenter|intune|hr|finance|f&a|sales|marketing|support|aem|workfront|ajo)\b",
    re.IGNORECASE,
)
NCR = {"delhi", "gurugram", "noida", "greater noida", "faridabad", "ghaziabad"}


def _family(title: str) -> str:
    for fam, pat in ROLE_FAMILIES:
        if re.search(pat, title, re.IGNORECASE):
            return fam
    return "OTHER"


def _canon_city(name: str) -> str:
    n = name.strip().lower()
    n = re.sub(r"\s*\(.*\)$", "", n)
    return CITY_ALIASES.get(n, n).lower() if n else n


def _cities(values: list[str]) -> set[str]:
    out: set[str] = set()
    for v in values:
        for part in re.split(r"[,/|;]| or ", v):
            c = _canon_city(part)
            if c in ("delhi ncr", "ncr"):
                out |= NCR
            elif c:
                out.add(c)
    return out


def _round_half_up(x: float) -> int:
    return int(Decimal(str(x)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _profile_skill_set(profile: ProfileFacts) -> set[str]:
    return {*profile.core_skills, *profile.additional_skills, *profile.leadership}


def classify_skill(skill: str, have: set[str]) -> tuple[SkillMatch, str | None]:
    if skill in have:
        return SkillMatch.EXACT_MATCH, skill
    # Having a more specific skill satisfies the general one (Magento 2 => Magento).
    for h in sorted(have):
        if skill in ancestors(h):
            return SkillMatch.EXACT_MATCH, h
    # Having the general skill partially covers the specific one (Adobe Commerce => ... Cloud),
    # as does a sibling under the same parent (Magento 1 vs Magento 2).
    skill_anc = ancestors(skill)
    for h in sorted(have):
        if h in skill_anc:
            return SkillMatch.PARTIAL_MATCH, h
        h_skill = SKILLS_BY_NAME.get(h)
        s_skill = SKILLS_BY_NAME.get(skill)
        if h_skill and s_skill and h_skill.parent and h_skill.parent == s_skill.parent:
            return SkillMatch.PARTIAL_MATCH, h
    rel = related(skill)
    for h in sorted(have):
        if h in rel or any(a in rel for a in ancestors(h)):
            return SkillMatch.RELATED, h
    return SkillMatch.MISSING, None


# ---------------------------------------------------------------------- components


def _role(
    job: JobFacts,
    profile: ProfileFacts,
    target: TargetFacts,
    cfg: ScoringConfig,
    skill_have: set[str],
    blockers: list[Blocker],
) -> tuple[float, list[str]]:
    reasons: list[str] = []
    jt = title_key(job.title)
    for ex in target.excluded_roles:
        if ex and title_key(ex) and title_key(ex) in jt:
            blockers.append(Blocker(type="EXCLUDED_ROLE", message=f"Role '{ex}' is excluded"))
            return 0.0, [f"Matches excluded role '{ex}'"]
    titles = list(target.titles) + list(profile.primary_roles)
    exact = [t for t in titles if title_key(t) and (title_key(t) == jt or title_key(t) in jt)]
    job_family = _family(job.title)
    target_families = {_family(t) for t in titles} - {"OTHER"}
    if not target.include_architect:
        target_families.discard("ARCHITECT")
    if job_family in target_families:
        family_factor = 1.0
        reasons.append(f"Role type {job_family.lower()} is targeted")
    else:
        family_factor = max(
            (FAMILY_AFFINITY.get((job_family, f), 0.0) for f in target_families), default=0.0
        )
        if job_family == "ARCHITECT" and not target.include_architect:
            reasons.append("Architect roles are not enabled in your target profile")
        else:
            reasons.append(f"Role type {job_family.lower()} is not one of your targets")

    title_skills = [
        s for s in find_skills(job.title) if skill_category(s) not in ("leadership", "practice")
    ]
    if title_skills:
        matches = [classify_skill(s, skill_have)[0] for s in title_skills]
        tech = sum(
            {
                SkillMatch.EXACT_MATCH: 1.0,
                SkillMatch.PARTIAL_MATCH: 0.75,
                SkillMatch.RELATED: 0.3,
            }.get(m, 0.0)
            for m in matches
        ) / len(matches)
        if tech == 0:
            reasons.append(f"Title technology ({', '.join(title_skills)}) is not in your profile")
        else:
            reasons.append(f"Title technology ({', '.join(title_skills)}) matches your profile")
    else:
        tech = 0.75  # generic title, technology judged by the Skills component
    if exact and tech > 0 and not DISCIPLINE_RE.search(job.title):
        reasons.insert(0, f"Title matches target '{exact[0]}'")
        return 1.0, reasons
    factor = family_factor * (0.6 + 0.4 * tech)
    if title_skills and tech == 0:
        factor = min(factor, 0.3)  # e.g. "Senior Java Developer" for a PHP/Magento profile
    own = " ".join([*titles, *profile.core_skills, *profile.domains]).lower()
    foreign = [
        m.group(0) for m in DISCIPLINE_RE.finditer(job.title) if m.group(0).lower() not in own
    ]
    if foreign:
        factor *= cfg.foreign_discipline_factor
        reasons.append(f"Different discipline in title: {', '.join(foreign)}")
    return factor, reasons


def _skills(
    job: JobFacts,
    profile: ProfileFacts,
    cfg: ScoringConfig,
    have: set[str],
    details: list[SkillDetail],
    blockers: list[Blocker],
) -> tuple[float, list[str]]:
    f = cfg.skills
    factor_of = {
        SkillMatch.EXACT_MATCH: f.exact,
        SkillMatch.PARTIAL_MATCH: f.partial,
        SkillMatch.RELATED: f.related,
        SkillMatch.MISSING: f.missing,
        SkillMatch.NICE_TO_HAVE: f.missing,
    }

    def evaluate(skills: list[str], importance: str) -> float | None:
        if not skills:
            return None
        total = 0.0
        for s in skills:
            match, via = classify_skill(s, have)
            if match == SkillMatch.MISSING and importance == "PREFERRED":
                match = SkillMatch.NICE_TO_HAVE
            value = factor_of[match]
            need = job.skill_years.get(s)
            got = profile.skill_years.get(via or s) if via else None
            if need and got is not None and got < need and value > 0:
                value *= f.insufficient_years
            details.append(SkillDetail(skill=s, importance=importance, match=match, via=via))
            total += value
        return total / len(skills)

    required = evaluate(job.required_skills, "REQUIRED")
    preferred = evaluate(job.preferred_skills, "PREFERRED")
    reasons = []
    if required is None and preferred is None:
        return cfg.no_skills_factor, ["No skills detected in the job; neutral score"]
    if required is None:
        factor = preferred or 0.0
    elif preferred is None:
        factor = required
    else:
        factor = f.required_share * required + (1 - f.required_share) * preferred
    req = [d for d in details if d.importance == "REQUIRED"]
    if req:
        hit = sum(1 for d in req if d.match == SkillMatch.EXACT_MATCH)
        reasons.append(f"{hit}/{len(req)} required skills matched exactly")
    pref = [d for d in details if d.importance == "PREFERRED"]
    if pref:
        hit = sum(1 for d in pref if d.match != SkillMatch.NICE_TO_HAVE)
        reasons.append(f"{hit}/{len(pref)} preferred skills covered")
    return factor, reasons


def _experience(
    job: JobFacts, profile: ProfileFacts, cfg: ScoringConfig, blockers: list[Blocker]
) -> tuple[float, list[str], str]:
    e = cfg.experience
    years = profile.relevant_years if profile.relevant_years is not None else profile.total_years
    if years is None:
        return e.unknown, ["Your experience is not set in the profile"], "UNKNOWN"
    lo, hi = job.experience_min, job.experience_max
    reasons: list[str] = []
    if lo is None and hi is None:
        factor, fit = e.unknown, "UNKNOWN"
        reasons.append("Job does not state required experience")
    elif lo is not None and years < lo:
        gap = lo - years
        factor = (
            e.under_1y if gap <= 1 else e.under_2y if gap <= 2 else e.under_4y if gap <= 4 else 0.0
        )
        fit = "UNDER_QUALIFIED"
        reasons.append(f"Job asks {lo:g}+ years; you have {years:g}")
        if gap > 1:
            blockers.append(
                Blocker(
                    type="MINIMUM_EXPERIENCE",
                    message=f"Job requires {lo:g}+ years experience. "
                    f"Candidate has {years:g} years.",
                )
            )
    elif hi is not None and years > hi:
        over = years - hi
        factor = e.over_2y if over <= 2 else e.over_5y if over <= 5 else e.over_more
        fit = "GOOD_MATCH" if over <= 2 else "OVER_QUALIFIED"
        reasons.append(f"Job range {lo or 0:g}-{hi:g} years; you have {years:g}")
    else:
        factor, fit = 1.0, "GOOD_MATCH"
        reasons.append(
            f"{years:g} years meets the {lo or 0:g}"
            f"{'-' + format(hi, 'g') if hi else '+'} years asked"
        )
    if job.leadership_required and not (profile.leadership_years or profile.leadership):
        factor *= e.missing_leadership
        reasons.append("Role needs leadership experience not shown in your profile")
    return factor, reasons, fit


def _domain(
    job: JobFacts,
    profile: ProfileFacts,
    target: TargetFacts,
    cfg: ScoringConfig,
    blockers: list[Blocker],
) -> tuple[float, list[str]]:
    company_text = " ".join(filter(None, [job.company_industry, job.company_type]))
    for ex in target.excluded_industries:
        if ex and ex.lower() in company_text.lower():
            blockers.append(
                Blocker(type="EXCLUDED_INDUSTRY", message=f"Industry '{ex}' is excluded")
            )
            return 0.0, [f"Company industry matches excluded '{ex}'"]
    job_domains = list(dict.fromkeys([*job.domains, *find_domains(company_text)]))
    if not job_domains:
        return cfg.unknown_domain_factor, ["No domain information in the job; neutral score"]
    mine = {*profile.domains}
    matched, related_hits = [], []
    for d in job_domains:
        if d in mine:
            matched.append(d)
        elif set(DOMAINS_BY_NAME[d].related if d in DOMAINS_BY_NAME else ()) & mine:
            related_hits.append(d)
    coverage = (len(matched) + 0.5 * len(related_hits)) / len(job_domains)
    preferred = bool(set(job_domains) & set(target.preferred_domains))
    factor = min(1.0, 0.7 * coverage + 0.3 * (1.0 if preferred else coverage))
    reasons = []
    if matched:
        reasons.append(f"Domain experience: {', '.join(matched)}")
    if related_hits:
        reasons.append(f"Related domain: {', '.join(related_hits)}")
    if not matched and not related_hits:
        reasons.append(f"No experience in {', '.join(job_domains)}")
    if preferred:
        reasons.append("Matches a preferred domain")
    return factor, reasons


def _location(
    job: JobFacts, target: TargetFacts, cfg: ScoringConfig, blockers: list[Blocker]
) -> tuple[float, list[str], str]:
    lf = cfg.location
    text = " ".join([*job.locations, job.location_text or ""])
    job_cities = _cities(
        [loc for loc in job.locations if "remote" not in loc.lower()]
        or ([job.location_text] if job.location_text else [])
    )
    job_cities.discard("remote")
    pref_cities = _cities([p for p in target.preferred_locations if "remote" not in p.lower()])
    prefers_remote = target.remote_ok or any(
        "remote" in p.lower() for p in target.preferred_locations
    )
    model = job.work_model
    if model == "UNKNOWN" and re.search(r"\bremote\b", text, re.IGNORECASE):
        model = "REMOTE"
    in_pref_city = bool(job_cities & pref_cities)
    if model == "REMOTE":
        if not prefers_remote:
            return (
                lf.model_not_accepted,
                ["Remote role but remote is not in your preferences"],
                "MODEL_NOT_PREFERRED",
            )
        if COUNTRY_HINTS.search(text) and not re.search(r"\bindia\b", text, re.IGNORECASE):
            blockers.append(
                Blocker(
                    type="LOCATION", message=f"Remote role may be restricted to: {text.strip()}"
                )
            )
            return (
                lf.remote_restricted_elsewhere,
                ["Remote, but appears limited to another country"],
                "RESTRICTED",
            )
        return lf.preferred, ["Remote role (India-eligible)"], "PREFERRED"
    if model in ("HYBRID", "ONSITE"):
        accepted = target.hybrid_ok if model == "HYBRID" else target.onsite_ok
        label = model.lower()
        if not accepted:
            return (
                lf.model_not_accepted,
                [f"{label.title()} work is not in your preferences"],
                "MODEL_NOT_PREFERRED",
            )
        if in_pref_city:
            return lf.preferred, [f"{label.title()} in a preferred city"], "PREFERRED"
        if not job_cities:
            return lf.unknown, [f"{label.title()}, city not stated"], "UNKNOWN"
        other = lf.hybrid_other_city if model == "HYBRID" else lf.onsite_other_city
        return (
            other,
            [f"{label.title()} in {', '.join(sorted(job_cities))} (not a preferred city)"],
            "OTHER_CITY",
        )
    if in_pref_city:
        return (
            lf.unknown_model_preferred_city,
            ["Preferred city; work model not stated"],
            "PREFERRED",
        )
    if job_cities:
        return lf.other_city, [f"Located in {', '.join(sorted(job_cities))}"], "OTHER_CITY"
    return lf.unknown, ["Location not stated"], "UNKNOWN"


def _seniority(
    job: JobFacts, profile: ProfileFacts, target: TargetFacts, cfg: ScoringConfig
) -> tuple[float, list[str]]:
    level = detect_seniority(job.title)
    if level is None:
        return cfg.unknown_seniority_factor, ["Seniority not stated in the title"]
    wanted = {lvl for t in target.titles if (lvl := detect_seniority(t))}
    if target.include_architect:
        wanted.add("ARCHITECT")
    if not wanted:
        wanted = {"SENIOR"}
    if level in wanted:
        return 1.0, [f"{level.title()} level is targeted"]
    idx = LEVEL_ORDER.index(level)
    distance = min(abs(idx - LEVEL_ORDER.index(w)) for w in wanted)
    if level == "JUNIOR":
        return 0.0, ["Junior level is below your experience"]
    factor = {1: 0.6, 2: 0.3}.get(distance, 0.1)
    return factor, [f"{level.title()} level is {distance} step(s) from your targets"]


def _salary(job: JobFacts, target: TargetFacts, cfg: ScoringConfig) -> tuple[float, list[str], str]:
    if job.salary_max is None and job.salary_min is None:
        return cfg.unknown_salary_factor, ["Salary not disclosed"], "UNKNOWN"
    if target.min_salary is None and target.target_salary is None:
        return cfg.unknown_salary_factor, ["Set your salary targets to score salary"], "UNKNOWN"
    if job.salary_currency and job.salary_currency != target.salary_currency:
        return (
            cfg.unknown_salary_factor,
            [f"Salary in {job.salary_currency}; your target is in {target.salary_currency}"],
            "UNKNOWN",
        )
    top = job.salary_max if job.salary_max is not None else job.salary_min
    assert top is not None
    if target.target_salary is not None and top >= target.target_salary:
        return 1.0, ["Pays at or above your target"], "ABOVE_TARGET"
    if target.min_salary is not None and top >= target.min_salary:
        return 0.7, ["Meets your minimum, below target"], "MEETS_MINIMUM"
    return 0.1, ["Below your minimum salary"], "BELOW_MINIMUM"


def _company(job: JobFacts, target: TargetFacts, cfg: ScoringConfig) -> tuple[float, list[str]]:
    if any(
        title_key(c) and title_key(c) == title_key(job.company_name)
        for c in target.preferred_companies
    ):
        return cfg.preferred_company_factor, ["One of your preferred companies"]
    tier = job.company_tier or "UNKNOWN"
    factor = cfg.tier_factors.get(tier, cfg.tier_factors.get("UNKNOWN", 0.0))
    label = tier.replace("TIER_", "Tier ") if tier != "UNKNOWN" else "Untiered company"
    return factor, [label]


def _cert_satisfied(text: str, certs: list[str]) -> bool:
    words = {w for w in re.findall(r"[a-z]{3,}", text.lower())} - {
        "certification",
        "certified",
        "certificate",
        "required",
        "mandatory",
        "must",
        "with",
        "and",
        "the",
        "for",
        "have",
        "should",
        "preferred",
        "plus",
    }
    for c in certs:
        cw = set(re.findall(r"[a-z]{3,}", c.lower()))
        if words and len(words & cw) >= min(2, len(words)):
            return True
    return False


def _other(
    job: JobFacts, profile: ProfileFacts, target: TargetFacts, blockers: list[Blocker]
) -> tuple[float, list[str]]:
    factor = 1.0
    reasons: list[str] = []
    for c in job.constraints:
        ctype, text, mandatory = str(c.get("type")), str(c.get("text")), bool(c.get("mandatory"))
        if ctype == "CERTIFICATION":
            if _cert_satisfied(text, profile.certifications):
                reasons.append("Required certification: you hold it")
                continue
            if mandatory:
                factor -= 0.5
                blockers.append(Blocker(type="CERTIFICATION", message=text))
            else:
                factor -= 0.1
            reasons.append(f"Certification: {text}")
        elif ctype in ("LANGUAGE", "WORK_AUTHORIZATION"):
            factor -= 0.5 if mandatory else 0.1
            if mandatory:
                blockers.append(Blocker(type=ctype, message=text))
            reasons.append(f"{ctype.replace('_', ' ').title()}: {text}")
        elif ctype == "NOTICE_PERIOD":
            notice = target.notice_period_days
            if notice is not None and notice > 30 and re.search(r"immediate", text, re.I):
                factor -= 0.3 if mandatory else 0.1
                if mandatory:
                    blockers.append(
                        Blocker(
                            type="NOTICE_PERIOD", message=f"{text} (your notice: {notice} days)"
                        )
                    )
                reasons.append(f"Notice period: {text}")
        elif ctype == "LOCATION" and mandatory:
            factor -= 0.2
            reasons.append(f"Location requirement: {text}")
        elif ctype in ("TRAVEL", "SHIFT"):
            factor -= 0.1
            reasons.append(f"{ctype.title()}: {text}")
    for tech in target.excluded_technologies:
        if tech in job.required_skills:
            factor -= 0.5
            blockers.append(
                Blocker(type="EXCLUDED_TECHNOLOGY", message=f"Requires excluded technology {tech}")
            )
            reasons.append(f"Requires excluded technology {tech}")
    if not reasons:
        reasons.append("No special requirements detected")
    return max(0.0, factor), reasons


# ---------------------------------------------------------------------- entry point


def inputs_hash(
    job: JobFacts, profile: ProfileFacts, target: TargetFacts, cfg: ScoringConfig
) -> str:
    payload = json.dumps(
        {
            "job": job.model_dump(mode="json"),
            "profile": profile.model_dump(mode="json"),
            "target": target.model_dump(mode="json"),
            "config": cfg.model_dump(mode="json"),
            "engine": ENGINE_VERSION,
            "catalog": CATALOG_VERSION,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def recommendation_for(score: int, cfg: ScoringConfig) -> Recommendation:
    t = cfg.thresholds
    if score >= t.highly_recommended:
        return Recommendation.HIGHLY_RECOMMENDED
    if score >= t.recommended:
        return Recommendation.RECOMMENDED
    if score >= t.consider:
        return Recommendation.CONSIDER
    if score >= t.low_priority:
        return Recommendation.LOW_PRIORITY
    return Recommendation.NOT_RECOMMENDED


ACTIONS = {
    Recommendation.HIGHLY_RECOMMENDED: "APPLY",
    Recommendation.RECOMMENDED: "APPLY",
    Recommendation.CONSIDER: "CONSIDER",
    Recommendation.LOW_PRIORITY: "REVIEW",
    Recommendation.NOT_RECOMMENDED: "SKIP",
}


def score_match(
    job: JobFacts, profile: ProfileFacts, target: TargetFacts, cfg: ScoringConfig
) -> MatchResult:
    blockers: list[Blocker] = []
    details: list[SkillDetail] = []
    have = _profile_skill_set(profile)
    w = cfg.weights

    parts: dict[str, tuple[float, list[str]]] = {}
    parts["role"] = _role(job, profile, target, cfg, have, blockers)
    parts["skills"] = _skills(job, profile, cfg, have, details, blockers)
    if not job.has_jd and parts["skills"][0] > cfg.no_jd_skills_cap:
        # Without a job description, skills inferred from the title alone are not evidence.
        parts["skills"] = (
            cfg.no_jd_skills_cap,
            [
                *parts["skills"][1],
                "No job description: skills judged from the "
                "title only (capped until a JD is added)",
            ],
        )
    exp_factor, exp_reasons, exp_fit = _experience(job, profile, cfg, blockers)
    parts["experience"] = (exp_factor, exp_reasons)
    parts["domain"] = _domain(job, profile, target, cfg, blockers)
    loc_factor, loc_reasons, loc_fit = _location(job, target, cfg, blockers)
    parts["location"] = (loc_factor, loc_reasons)
    parts["seniority"] = _seniority(job, profile, target, cfg)
    sal_factor, sal_reasons, sal_status = _salary(job, target, cfg)
    parts["salary"] = (sal_factor, sal_reasons)
    parts["company"] = _company(job, target, cfg)
    parts["other"] = _other(job, profile, target, blockers)

    components = []
    for key, (factor, reasons) in parts.items():
        factor = max(0.0, min(1.0, factor))
        points = round(w[key] * factor, 2)
        components.append(
            ComponentScore(
                key=key,
                label=LABELS[key],
                weight=w[key],
                factor=round(factor, 4),
                points=points,
                reasons=reasons,
            )
        )
    raw = round(sum(c.points for c in components), 2)
    score = max(0, min(100, _round_half_up(raw)))

    for d in details:
        if (
            d.importance == "REQUIRED"
            and d.match == SkillMatch.MISSING
            and (d.skill in find_skills(job.title) or job.skill_years.get(d.skill))
        ):
            blockers.append(
                Blocker(
                    type="MANDATORY_TECHNOLOGY",
                    message=f"Required {d.skill} is missing from your profile",
                )
            )
    for b in blockers:
        if b.type in cfg.hard_blockers:
            b.severity = "HARD"
    rec = recommendation_for(score, cfg)
    if any(b.severity == "HARD" for b in blockers):
        rec = Recommendation.NOT_RECOMMENDED
    known_skills = len(job.required_skills) + len(job.preferred_skills)
    if not job.has_jd or known_skills == 0:
        confidence = "LOW"
    elif known_skills < 3 or (job.experience_min is None and job.work_model == "UNKNOWN"):
        confidence = "MEDIUM"
    else:
        confidence = "HIGH"
    action = ACTIONS[rec]
    if blockers and action == "APPLY":
        action = "APPLY_AFTER_REVIEWING_BLOCKERS"
    if confidence == "LOW" and rec != Recommendation.NOT_RECOMMENDED:
        action = "ADD_JD_TO_CONFIRM"

    strong = [d.skill for d in details if d.match == SkillMatch.EXACT_MATCH]
    domain_reason = parts["domain"][1]
    for r in domain_reason:
        if r.startswith("Domain experience: "):
            strong += r.split(": ", 1)[1].split(", ")
    missing = [d.skill for d in details if d.match in (SkillMatch.MISSING, SkillMatch.NICE_TO_HAVE)]
    missing += [d.skill for d in details if d.match == SkillMatch.RELATED]
    return MatchResult(
        score=score,
        raw_score=raw,
        recommendation=rec,
        action=action,
        components=components,
        skills=details,
        strong_matches=list(dict.fromkeys(strong)),
        missing=list(dict.fromkeys(missing)),
        blockers=blockers,
        experience_fit=exp_fit,
        salary_status=sal_status,
        location_fit=loc_fit,
        confidence=confidence,
        inputs_hash=inputs_hash(job, profile, target, cfg),
    )
