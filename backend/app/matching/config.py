"""Scoring configuration: every number the engine uses lives here (nothing is hard-coded in
the scoring logic). Stored versioned in the database; changing it makes old scores stale."""

from typing import Self

from pydantic import BaseModel, Field, model_validator

ENGINE_VERSION = "match-engine/3"

COMPONENTS = (
    "role",
    "skills",
    "experience",
    "domain",
    "location",
    "seniority",
    "salary",
    "company",
    "other",
)
LABELS = {
    "role": "Role Match",
    "skills": "Core Skills Match",
    "experience": "Experience Match",
    "domain": "Domain Match",
    "location": "Location Match",
    "seniority": "Seniority Match",
    "salary": "Salary Match",
    "company": "Company Preference",
    "other": "Other Requirements",
}


class Thresholds(BaseModel):
    highly_recommended: int = 90
    recommended: int = 80
    consider: int = 70
    low_priority: int = 60

    @model_validator(mode="after")
    def _descending(self) -> Self:
        if not (
            100
            >= self.highly_recommended
            > self.recommended
            > self.consider
            > self.low_priority
            > 0
        ):
            raise ValueError("thresholds must be strictly descending and within 1-100")
        return self


class SkillFactors(BaseModel):
    exact: float = 1.0
    partial: float = 0.75
    related: float = 0.4
    missing: float = 0.0
    required_share: float = Field(0.8, ge=0, le=1)  # rest of the skills weight is preferred
    insufficient_years: float = 0.6  # has the skill but fewer years than the JD asks


class ExperienceFactors(BaseModel):
    unknown: float = 0.8
    under_1y: float = 0.75
    under_2y: float = 0.5
    under_4y: float = 0.25
    over_2y: float = 0.9
    over_5y: float = 0.7
    over_more: float = 0.5
    missing_leadership: float = 0.8


class LocationFactors(BaseModel):
    preferred: float = 1.0
    remote_restricted_elsewhere: float = 0.2
    hybrid_other_city: float = 0.4
    onsite_other_city: float = 0.3
    model_not_accepted: float = 0.15
    unknown_model_preferred_city: float = 0.8
    unknown: float = 0.5
    other_city: float = 0.4


class ScoringConfig(BaseModel):
    weights: dict[str, float] = Field(
        default_factory=lambda: {
            "role": 20.0,
            "skills": 25.0,
            "experience": 15.0,
            "domain": 10.0,
            "location": 10.0,
            "seniority": 5.0,
            "salary": 5.0,
            "company": 5.0,
            "other": 5.0,
        }
    )
    thresholds: Thresholds = Field(default_factory=Thresholds)
    skills: SkillFactors = Field(default_factory=SkillFactors)
    experience: ExperienceFactors = Field(default_factory=ExperienceFactors)
    location: LocationFactors = Field(default_factory=LocationFactors)
    tier_factors: dict[str, float] = Field(
        default_factory=lambda: {
            "TIER_A": 1.0,
            "TIER_B": 0.6,
            "TIER_C": 0.2,
            "UNKNOWN": 0.0,
        }
    )
    preferred_company_factor: float = 1.0
    unknown_salary_factor: float = 0.6
    unknown_domain_factor: float = 0.6
    unknown_seniority_factor: float = 0.6
    no_skills_factor: float = 0.5
    # Max skills factor when the job has no description (title-only evidence).
    no_jd_skills_cap: float = 0.5
    # Role factor multiplier when the title names a discipline outside your profile
    # ("Quality Engineering Lead", "Data Architect" for a commerce developer).
    foreign_discipline_factor: float = 0.4
    # Blocker types that force NOT_RECOMMENDED. Empty = blockers are shown, never auto-reject.
    hard_blockers: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> Self:
        if set(self.weights) != set(COMPONENTS):
            raise ValueError(f"weights must have exactly these keys: {list(COMPONENTS)}")
        if any(w < 0 for w in self.weights.values()):
            raise ValueError("weights must be non-negative")
        if round(sum(self.weights.values()), 6) != 100:
            raise ValueError("weights must add up to 100")
        return self


DEFAULT_CONFIG = ScoringConfig()
