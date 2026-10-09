"""Matching engine tests (spec §64-65). No predetermined final score is hard-coded for the
reference example: the test asserts it is high and that each component behaves."""

import pytest

from app.jobs.jd_parser import parse_jd
from app.matching.config import ScoringConfig
from app.matching.engine import (
    JobFacts,
    ProfileFacts,
    Recommendation,
    SkillMatch,
    TargetFacts,
    classify_skill,
    score_match,
)

CFG = ScoringConfig()

# Spec §65 candidate.
CANDIDATE = ProfileFacts(
    total_years=10,
    relevant_years=10,
    leadership_years=5,
    primary_roles=["Technical Lead", "Senior Software Developer"],
    core_skills=[
        "PHP",
        "Magento 2",
        "Adobe Commerce",
        "MySQL",
        "GraphQL",
        "REST",
        "Redis",
        "RabbitMQ",
        "Docker",
    ],
    domains=["E-commerce"],
    leadership=["Technical Leadership"],
)
TARGET = TargetFacts(
    titles=[
        "Senior Software Developer",
        "Senior PHP Developer",
        "Technical Lead",
        "Tech Lead",
        "Senior Adobe Commerce Developer",
        "Adobe Commerce Developer",
        "Lead Software Developer",
    ],
    preferred_domains=["E-commerce"],
    preferred_locations=["Remote India", "Jaipur", "Pune", "Bengaluru"],
)


def job_from_jd(title: str, jd: str, **extra: object) -> JobFacts:
    p = parse_jd(jd, title)
    data: dict[str, object] = {
        "title": title,
        "required_skills": p.required_skills,
        "preferred_skills": p.preferred_skills,
        "skill_years": {s.skill: s.years for s in p.skills if s.years},
        "domains": p.domains,
        "experience_min": p.experience_min,
        "experience_max": p.experience_max,
        "leadership_required": p.leadership_required,
        "locations": p.locations,
        "work_model": p.work_model or "UNKNOWN",
        "constraints": [c.model_dump() for c in p.constraints],
    }
    data.update(extra)
    return JobFacts.model_validate(data)


SPEC_JOB_JD = """Technical Lead
10+ years of experience
PHP
Magento 2
Adobe Commerce
MySQL
GraphQL
AWS
E-commerce
Remote India"""


def spec_job() -> JobFacts:
    return job_from_jd("Technical Lead", SPEC_JOB_JD)


def comp(result: object, key: str) -> float:
    return next(c.factor for c in result.components if c.key == key)  # type: ignore[attr-defined]


def test_spec_example_scores_high() -> None:
    job = spec_job()
    # The title "Technical Lead" also makes Technical Leadership a requirement.
    assert set(job.required_skills) == {
        "PHP",
        "Magento 2",
        "Adobe Commerce",
        "MySQL",
        "GraphQL",
        "AWS",
        "Technical Leadership",
    }
    result = score_match(job, CANDIDATE, TARGET, CFG)
    assert result.score >= 80
    assert result.recommendation in (Recommendation.RECOMMENDED, Recommendation.HIGHLY_RECOMMENDED)
    assert result.action.startswith("APPLY")
    assert set(result.strong_matches) >= {
        "PHP",
        "Magento 2",
        "Adobe Commerce",
        "MySQL",
        "GraphQL",
        "E-commerce",
        "Technical Leadership",
    }
    assert result.missing == ["AWS"]
    assert comp(result, "role") == 1.0
    assert comp(result, "experience") == 1.0
    assert comp(result, "location") == 1.0
    assert result.experience_fit == "GOOD_MATCH"
    assert result.salary_status == "UNKNOWN"
    # The breakdown adds up exactly to the raw score, and every weight is from config.
    assert round(sum(c.points for c in result.components), 2) == result.raw_score
    assert {c.key: c.weight for c in result.components} == CFG.weights


def test_deterministic_same_inputs_same_score() -> None:
    a = score_match(spec_job(), CANDIDATE, TARGET, CFG)
    b = score_match(spec_job(), CANDIDATE.model_copy(), TARGET.model_copy(), ScoringConfig())
    assert a == b
    assert a.inputs_hash == b.inputs_hash
    changed = score_match(
        spec_job(),
        CANDIDATE.model_copy(update={"total_years": 6, "relevant_years": 6}),
        TARGET,
        CFG,
    )
    assert changed.inputs_hash != a.inputs_hash


def test_java_role_scores_poorly_for_php_profile() -> None:
    job = job_from_jd(
        "Senior Java Developer",
        "Requirements\n- 8+ years Java\n- Spring Boot, Microservices, Kafka\n"
        "- AWS\nLocation: Bengaluru (Hybrid)",
    )
    result = score_match(job, CANDIDATE, TARGET, CFG)
    assert comp(result, "role") <= 0.3
    assert result.score < 60
    assert result.recommendation == Recommendation.NOT_RECOMMENDED


def test_related_titles_score_well() -> None:
    for title in (
        "Technical Lead – Adobe Commerce",
        "Lead Software Developer",
        "Senior Software Developer – PHP",
    ):
        result = score_match(JobFacts(title=title, required_skills=["PHP"]), CANDIDATE, TARGET, CFG)
        assert comp(result, "role") >= 0.85, title


def test_architect_only_when_enabled() -> None:
    job = JobFacts(title="Adobe Commerce Architect", required_skills=["Adobe Commerce"])
    off = score_match(job, CANDIDATE, TARGET, CFG)
    on = score_match(
        job,
        CANDIDATE,
        TARGET.model_copy(
            update={
                "include_architect": True,
                "titles": [*TARGET.titles, "Adobe Commerce Architect"],
            }
        ),
        CFG,
    )
    assert comp(off, "role") < comp(on, "role")
    assert comp(on, "role") == 1.0


def test_skill_classification() -> None:
    have = {"Magento 2", "Adobe Commerce", "MySQL"}
    assert classify_skill("Magento", have)[0] == SkillMatch.EXACT_MATCH
    assert classify_skill("Adobe Commerce Cloud", have)[0] == SkillMatch.PARTIAL_MATCH
    assert classify_skill("MariaDB", have)[0] == SkillMatch.RELATED
    assert classify_skill("Kubernetes", have)[0] == SkillMatch.MISSING


def test_missing_required_hurts_more_than_missing_preferred() -> None:
    base = dict(title="Senior PHP Developer", experience_min=8)
    req_missing = JobFacts(**base, required_skills=["PHP", "Terraform"], preferred_skills=["MySQL"])
    pref_missing = JobFacts(
        **base, required_skills=["PHP", "MySQL"], preferred_skills=["Terraform"]
    )
    a = score_match(req_missing, CANDIDATE, TARGET, CFG)
    b = score_match(pref_missing, CANDIDATE, TARGET, CFG)
    assert comp(a, "skills") < comp(b, "skills")
    nice = [s for s in b.skills if s.skill == "Terraform"][0]
    assert nice.match == SkillMatch.NICE_TO_HAVE


@pytest.mark.parametrize(
    ("years", "lo", "hi", "fit"),
    [
        (10, 10, None, "GOOD_MATCH"),
        (12, 5, 8, "OVER_QUALIFIED"),
        (9.5, 10, None, "UNDER_QUALIFIED"),
        (12, None, None, "UNKNOWN"),
    ],
)
def test_experience_fit(years: float, lo: float | None, hi: float | None, fit: str) -> None:
    profile = CANDIDATE.model_copy(update={"total_years": years, "relevant_years": years})
    r = score_match(
        JobFacts(title="Tech Lead", experience_min=lo, experience_max=hi), profile, TARGET, CFG
    )
    assert r.experience_fit == fit


def test_experience_blocker_message() -> None:
    profile = CANDIDATE.model_copy(update={"total_years": 12, "relevant_years": 12})
    r = score_match(JobFacts(title="Tech Lead", experience_min=15), profile, TARGET, CFG)
    msgs = [b.message for b in r.blockers if b.type == "MINIMUM_EXPERIENCE"]
    assert msgs == ["Job requires 15+ years experience. Candidate has 12 years."]
    assert r.recommendation != Recommendation.NOT_RECOMMENDED or r.score < 60  # not auto-reject


def test_hard_blocker_rule_forces_not_recommended() -> None:
    profile = CANDIDATE.model_copy(update={"total_years": 12, "relevant_years": 12})
    cfg = ScoringConfig(hard_blockers=["MINIMUM_EXPERIENCE"])
    r = score_match(spec_job().model_copy(update={"experience_min": 15}), profile, TARGET, cfg)
    assert r.recommendation == Recommendation.NOT_RECOMMENDED
    assert r.blockers[0].severity == "HARD"


def test_domain_matching() -> None:
    ecommerce = score_match(
        JobFacts(title="Tech Lead", domains=["E-commerce"]), CANDIDATE, TARGET, CFG
    )
    retail = score_match(JobFacts(title="Tech Lead", domains=["Retail"]), CANDIDATE, TARGET, CFG)
    health = score_match(
        JobFacts(title="Tech Lead", domains=["Healthcare"]), CANDIDATE, TARGET, CFG
    )
    assert comp(ecommerce, "domain") == 1.0
    assert 0 < comp(retail, "domain") < 1.0  # related domain
    assert comp(health, "domain") == 0.0


@pytest.mark.parametrize(
    ("job", "expected"),
    [
        (dict(work_model="REMOTE", locations=["Remote India"]), "PREFERRED"),
        (dict(work_model="REMOTE", location_text="Remote - US only"), "RESTRICTED"),
        (dict(work_model="HYBRID", locations=["Pune"]), "PREFERRED"),
        (dict(work_model="HYBRID", locations=["Kolkata"]), "OTHER_CITY"),
        (dict(work_model="ONSITE", locations=["Bangalore"]), "PREFERRED"),
        (dict(locations=[]), "UNKNOWN"),
    ],
)
def test_location(job: dict[str, object], expected: str) -> None:
    r = score_match(JobFacts(title="Tech Lead", **job), CANDIDATE, TARGET, CFG)  # type: ignore[arg-type]
    assert r.location_fit == expected


def test_location_preferences_are_configurable() -> None:
    no_onsite = TARGET.model_copy(update={"onsite_ok": False})
    r = score_match(
        JobFacts(title="Tech Lead", work_model="ONSITE", locations=["Pune"]),
        CANDIDATE,
        no_onsite,
        CFG,
    )
    assert r.location_fit == "MODEL_NOT_PREFERRED"


def test_salary_unknown_is_not_strongly_penalized() -> None:
    target = TARGET.model_copy(update={"min_salary": 3_000_000, "target_salary": 4_000_000})
    unknown = score_match(JobFacts(title="Tech Lead"), CANDIDATE, target, CFG)
    above = score_match(
        JobFacts(title="Tech Lead", salary_max=4_500_000, salary_currency="INR"),
        CANDIDATE,
        target,
        CFG,
    )
    meets = score_match(
        JobFacts(title="Tech Lead", salary_max=3_200_000, salary_currency="INR"),
        CANDIDATE,
        target,
        CFG,
    )
    below = score_match(
        JobFacts(title="Tech Lead", salary_max=2_000_000, salary_currency="INR"),
        CANDIDATE,
        target,
        CFG,
    )
    assert unknown.salary_status == "UNKNOWN" and comp(unknown, "salary") == 0.6
    assert (above.salary_status, meets.salary_status, below.salary_status) == (
        "ABOVE_TARGET",
        "MEETS_MINIMUM",
        "BELOW_MINIMUM",
    )
    assert comp(below, "salary") < comp(unknown, "salary") < comp(meets, "salary")


def test_company_tier_preference() -> None:
    a = score_match(JobFacts(title="Tech Lead", company_tier="TIER_A"), CANDIDATE, TARGET, CFG)
    c = score_match(JobFacts(title="Tech Lead", company_tier="TIER_C"), CANDIDATE, TARGET, CFG)
    u = score_match(JobFacts(title="Tech Lead"), CANDIDATE, TARGET, CFG)
    assert comp(a, "company") > comp(c, "company") > comp(u, "company") == 0.0
    pref = score_match(
        JobFacts(title="Tech Lead", company_name="Acme"),
        CANDIDATE,
        TARGET.model_copy(update={"preferred_companies": ["Acme"]}),
        CFG,
    )
    assert comp(pref, "company") == 1.0


def test_blockers_detected() -> None:
    jd = (
        "Requirements\n- Adobe Certified Expert certification is mandatory\n"
        "- Must be fluent in German\n- Only immediate joiners\n- PHP"
    )
    job = job_from_jd("Senior PHP Developer", jd)
    target = TARGET.model_copy(update={"notice_period_days": 60})
    r = score_match(job, CANDIDATE, target, CFG)
    types = {b.type for b in r.blockers}
    assert {"CERTIFICATION", "LANGUAGE", "NOTICE_PERIOD"} <= types
    certified = CANDIDATE.model_copy(
        update={"certifications": ["Adobe Certified Expert – Adobe Commerce Developer"]}
    )
    r2 = score_match(job, certified, target, CFG)
    assert "CERTIFICATION" not in {b.type for b in r2.blockers}


def test_weights_and_thresholds_are_configurable() -> None:
    cfg = ScoringConfig(
        weights={
            "role": 50,
            "skills": 50,
            "experience": 0,
            "domain": 0,
            "location": 0,
            "seniority": 0,
            "salary": 0,
            "company": 0,
            "other": 0,
        }
    )
    r = score_match(spec_job(), CANDIDATE, TARGET, cfg)
    assert {c.key: c.weight for c in r.components}["role"] == 50
    with pytest.raises(ValueError, match="add up to 100"):
        ScoringConfig(weights={**CFG.weights, "role": 30})
    with pytest.raises(ValueError, match="descending"):
        ScoringConfig.model_validate({"thresholds": {"highly_recommended": 70, "recommended": 80}})


def test_other_discipline_leads_score_lower() -> None:
    dev_lead = score_match(JobFacts(title="Software Engineering Lead"), CANDIDATE, TARGET, CFG)
    qa_lead = score_match(JobFacts(title="Quality Engineering Lead"), CANDIDATE, TARGET, CFG)
    data_lead = score_match(
        JobFacts(title="Technical Lead - Data and Analytics"), CANDIDATE, TARGET, CFG
    )
    assert comp(qa_lead, "role") < comp(dev_lead, "role")
    assert comp(data_lead, "role") < 0.5
    assert any("Different discipline" in r for c in qa_lead.components for r in c.reasons)


def test_confidence_without_jd() -> None:
    no_jd = score_match(JobFacts(title="Technical Lead", has_jd=False), CANDIDATE, TARGET, CFG)
    assert no_jd.confidence == "LOW" and no_jd.action == "ADD_JD_TO_CONFIRM"
    assert score_match(spec_job(), CANDIDATE, TARGET, CFG).confidence == "HIGH"


def test_title_only_jobs_cannot_score_like_full_jds() -> None:
    title_only = JobFacts(
        title="Senior Magento Developer", required_skills=["Magento"], has_jd=False
    )
    with_jd = title_only.model_copy(update={"has_jd": True})
    capped = score_match(title_only, CANDIDATE, TARGET, CFG)
    full = score_match(with_jd, CANDIDATE, TARGET, CFG)
    assert comp(capped, "skills") == CFG.no_jd_skills_cap < comp(full, "skills")
    assert capped.score < full.score and capped.confidence == "LOW"
