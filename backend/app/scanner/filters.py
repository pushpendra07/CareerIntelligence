"""Which scanned postings are worth keeping (configurable in Settings → Job scanner)."""

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from app.scanner.providers import ScannedJob

DEFAULT_SCANNER_SETTINGS: dict[str, Any] = {
    # A title with any of these is kept straight away.
    "title_include": [
        "magento", "adobe commerce", "php", "laravel", "symfony", "ecommerce", "e-commerce",
    ],
    # A generic title is kept only when its job description mentions a `jd_keywords` word.
    "title_broad": [
        "software engineer", "software developer", "full stack", "fullstack", "backend",
        "back-end", "lead engineer", "lead developer", "tech lead", "technical lead",
        "team lead", "architect", "engineering manager", "web developer",
    ],
    "jd_keywords": ["magento", "adobe commerce", "php", "laravel", "symfony"],
    "title_exclude": [
        "intern", "internship", "junior", "trainee", "fresher", "sales", "marketing", "recruiter",
        "talent acquisition", "designer", "accountant", "account manager", "finance",
        "quality assurance", "test engineer", "data scientist",
    ],
    "locations": [
        "india", "remote", "anywhere", "worldwide", "global", "apac", "asia",
        "bengaluru", "bangalore", "pune", "noida", "gurugram", "gurgaon", "delhi", "jaipur",
        "jodhpur", "ahmedabad", "chennai", "mumbai", "hyderabad", "chandigarh", "kochi",
        "kolkata", "indore",
    ],
    # Skipped unless a specific (non-"remote") `locations` word also matches,
    # so "United States - Remote" is dropped but "India / Remote" is kept.
    "location_exclude": [
        "united states", "usa", "us", "canada", "mexico", "united kingdom", "uk", "ireland",
        "europe", "emea", "germany", "france", "spain", "portugal", "netherlands", "poland",
        "ukraine", "romania", "latvia", "lithuania", "estonia", "bulgaria", "serbia",
        "croatia", "argentina", "brazil", "colombia", "chile", "latam", "australia",
        "new zealand", "singapore", "philippines", "vietnam", "japan", "uae", "dubai",
        "south africa", "ny", "ca", "tx", "il", "wa", "ma",
    ],
    "keep_unknown_location": True,
    "max_age_days": 45,
    "max_new_per_company": 50,
    "schedule_hours": 0,  # 0 = manual only; e.g. 24 = scan once a day while the app runs
}
_GENERIC_PLACES = {"remote", "anywhere", "worldwide", "global"}
_LIST_KEYS = ("title_include", "title_broad", "jd_keywords", "title_exclude", "locations",
              "location_exclude")


def _prefix_terms(values: list[str]) -> list[re.Pattern[str]]:
    """Match at a word start ("php" matches "PHP/Laravel", "lead developer" "Lead Developers")."""
    return [re.compile(rf"(?<![a-z0-9]){re.escape(v.strip().lower())}", re.IGNORECASE)
            for v in values if v and v.strip()]


def _word_terms(values: list[str]) -> list[re.Pattern[str]]:
    """Whole words only, for short place codes ("IN", "US", "CA")."""
    return [re.compile(rf"(?<![a-z0-9]){re.escape(v.strip().lower())}(?![a-z0-9])",
                       re.IGNORECASE) for v in values if v and v.strip()]


def _any(patterns: list[re.Pattern[str]], text: str) -> bool:
    return any(p.search(text) for p in patterns)


@dataclass
class ScanFilters:
    title_include: list[str] = field(default_factory=list)
    title_broad: list[str] = field(default_factory=list)
    jd_keywords: list[str] = field(default_factory=list)
    title_exclude: list[str] = field(default_factory=list)
    locations: list[str] = field(default_factory=list)
    location_exclude: list[str] = field(default_factory=list)
    keep_unknown_location: bool = True
    max_age_days: int | None = 45

    def __post_init__(self) -> None:
        self._include = _prefix_terms(self.title_include)
        self._broad = _prefix_terms(self.title_broad)
        self._jd = _prefix_terms(self.jd_keywords)
        self._exclude = _prefix_terms(self.title_exclude)
        self._places = _word_terms(self.locations)
        self._specific = _word_terms([v for v in self.locations
                                      if v.strip().lower() not in _GENERIC_PLACES])
        self._foreign = _word_terms(self.location_exclude)

    @classmethod
    def from_settings(cls, cfg: dict[str, Any]) -> "ScanFilters":
        merged = {**DEFAULT_SCANNER_SETTINGS, **(cfg or {})}
        return cls(**{k: list(merged[k]) for k in _LIST_KEYS},
                   keep_unknown_location=bool(merged["keep_unknown_location"]),
                   max_age_days=int(merged["max_age_days"]) if merged["max_age_days"] else None)

    def check(self, job: ScannedJob, today: date | None = None) -> str | None:
        """None if the job passes the title/location/age checks, else the reason it was skipped.

        A generic title that passes still needs `check_description` once its JD is known.
        """
        title = job.title
        if _any(self._exclude, title):
            return "excluded_title"
        job.broad_title = False
        if not self._include or not _any(self._include, title):
            if self._broad and _any(self._broad, title):
                job.broad_title = True
            elif self._include or self._broad:
                return "title"
        place = f"{job.location or ''} {'remote' if job.remote else ''}".strip()
        if place:
            if not _any(self._specific, place) and _any(self._foreign, place):
                return "location"
            if self._places and not _any(self._places, place):
                return "location"
        elif not self.keep_unknown_location:
            return "location"
        return self.check_age(job, today)

    def check_age(self, job: ScannedJob, today: date | None = None) -> str | None:
        """Re-run after a detail fetch: Workday only reveals the posting date there."""
        cutoff = (today or date.today()) - timedelta(days=self.max_age_days or 0)
        if self.max_age_days and job.posted and job.posted < cutoff:
            return "too_old"
        return None

    def check_description(self, job: ScannedJob) -> str | None:
        if not job.broad_title or not self._jd:
            return None
        text = f"{job.title}\n{job.description}"
        return None if _any(self._jd, text) else "jd_keywords"

def validate_scanner_settings(cfg: dict[str, Any]) -> dict[str, Any]:
    from app.core.errors import DomainValidationError

    out = {**DEFAULT_SCANNER_SETTINGS, **cfg}
    for key in _LIST_KEYS:
        values = out[key]
        if isinstance(values, str):
            values = values.split(",")
        if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
            raise DomainValidationError(f"scanner.{key} must be a list of words")
        out[key] = [v.strip() for v in values if v.strip()][:200]
    limits = {"max_age_days": (0, 365), "max_new_per_company": (1, 500),
              "schedule_hours": (0, 168)}
    for key, (lo, hi) in limits.items():
        try:
            value = int(out[key] or 0)
        except (TypeError, ValueError) as exc:
            raise DomainValidationError(f"scanner.{key} must be a number") from exc
        if not lo <= value <= hi:
            raise DomainValidationError(f"scanner.{key} must be between {lo} and {hi}")
        out[key] = value
    out["keep_unknown_location"] = bool(out["keep_unknown_location"])
    return {k: out[k] for k in DEFAULT_SCANNER_SETTINGS}
