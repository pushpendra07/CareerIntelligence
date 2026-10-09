"""Deterministic job-description parser: free text -> ParsedJD.

The original JD is never modified; this only derives structure from it. Explicit fields the
user typed (experience, salary, skills...) always win over parsed values (see job_service).
"""

import re
from decimal import Decimal

from pydantic import BaseModel, Field

from app.cv.extract import normalize_text
from app.skills.catalog import CATALOG_VERSION, find_domains, find_skills

JD_PARSER_VERSION = "jd-parser/1"

SECTION_PATTERNS: dict[str, tuple[str, ...]] = {
    "responsibilities": (
        "responsibilities",
        "key responsibilities",
        "job responsibilities",
        "roles and responsibilities",
        "roles & responsibilities",
        "what you'll do",
        "what you will do",
        "your role",
        "the role",
        "duties",
        "job description",
        "role description",
        "day to day",
        "what you'll be doing",
    ),
    "required": (
        "requirements",
        "required skills",
        "qualifications",
        "must have",
        "must-have",
        "must haves",
        "what you need",
        "what we're looking for",
        "what we are looking for",
        "skills required",
        "who you are",
        "mandatory skills",
        "key skills",
        "skills",
        "technical skills",
        "desired profile",
        "candidate profile",
        "eligibility",
        "required qualifications",
        "minimum qualifications",
        "basic qualifications",
        "skills & experience",
        "skills and experience",
        "experience",
    ),
    "preferred": (
        "nice to have",
        "nice-to-have",
        "preferred",
        "preferred skills",
        "preferred qualifications",
        "good to have",
        "bonus",
        "bonus points",
        "plus",
        "added advantage",
        "desirable",
        "desired skills",
        "it would be great if",
    ),
    "benefits": ("benefits", "perks", "what we offer", "why join us", "compensation"),
    "about": ("about us", "about the company", "who we are", "company overview"),
}
_SECTION_LOOKUP = {a: k for k, aliases in SECTION_PATTERNS.items() for a in aliases}
DETAIL_LINE = re.compile(
    r"^\s*(?:•\s*)?(location|job location|salary|ctc|compensation|job type|employment type|"
    r"work mode|work model|workplace type|notice period|shift|openings|industry|"
    r"department)\s*:",
    re.IGNORECASE,
)

PREFERRED_MARKERS = re.compile(
    r"\b(nice to have|good to have|preferred|is a plus|a plus|bonus|added advantage|"
    r"desirable|familiarity with|exposure to|knowledge of .* (?:is|would be) (?:an )?"
    r"(?:advantage|plus)|optional)\b",
    re.IGNORECASE,
)
REQUIRED_MARKERS = re.compile(
    r"\b(must|required|mandatory|essential|strong|expert|proficien\w*|hands-on|deep|"
    r"solid|extensive|minimum)\b",
    re.IGNORECASE,
)
YEARS_RANGE = re.compile(
    r"(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:-|–|—|to)\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)",
    re.IGNORECASE,
)
YEARS_MIN = re.compile(
    r"(?:(?:minimum|min\.?|at least|over|more than)\s*(?:of\s*)?)?(\d{1,2}(?:\.\d)?)\s*"
    r"(\+|plus)?\s*(?:years?|yrs?)",
    re.IGNORECASE,
)
SALARY_LPA = re.compile(
    r"(?:₹|inr|rs\.?)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:l|lpa|lakhs?|lacs?)?\s*(?:-|–|to)\s*"
    r"(?:₹|inr|rs\.?)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?|l)\b\+?"
    r"(?:\s*(?:p\.?a\.?|per annum))?",
    re.IGNORECASE,
)
SALARY_LPA_SINGLE = re.compile(
    r"(?:ctc|salary|package|compensation)[^\n\d]{0,20}(?:₹|inr|rs\.?)?\s*(\d{1,3}(?:\.\d+)?)\s*"
    r"(?:lpa|lakhs?|lacs?)\b",
    re.IGNORECASE,
)
SALARY_AMOUNT = re.compile(
    r"(₹|inr|rs\.?|\$|usd|€|eur|£|gbp|aed|sgd)\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\s*"
    r"(?:-|–|to)\s*(?:₹|inr|rs\.?|\$|usd|€|eur|£|gbp|aed|sgd)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?"
    r"(?:\s*(per month|/month|pm|monthly|per annum|/year|pa|annually|per year))?",
    re.IGNORECASE,
)
CURRENCY = {
    "₹": "INR",
    "inr": "INR",
    "rs": "INR",
    "rs.": "INR",
    "$": "USD",
    "usd": "USD",
    "€": "EUR",
    "eur": "EUR",
    "£": "GBP",
    "gbp": "GBP",
    "aed": "AED",
    "sgd": "SGD",
}
EMPLOYMENT_TYPES = [
    ("Contract-to-hire", r"\b(contract[- ]to[- ]hire|c2h)\b"),
    ("Internship", r"\binternship\b"),
    ("Part-time", r"\bpart[- ]time\b"),
    ("Freelance", r"\bfreelanc\w*\b"),
    ("Contract", r"\b(contract(ual)?|fixed[- ]term|temporary)\b"),
    ("Full-time", r"\b(full[- ]time|permanent)\b"),
]
WORK_MODELS = [
    ("HYBRID", r"\bhybrid\b"),
    ("REMOTE", r"\b(remote|work from home|wfh|work from anywhere|fully distributed)\b"),
    ("ONSITE", r"\b(on[- ]?site|work from office|wfo|in[- ]office|office[- ]based)\b"),
]
CERT_RE = re.compile(
    r"\b((?:adobe|aws|azure|google|gcp|magento|scrum|pmi|oracle|salesforce|microsoft)"
    r"[\w\s-]{0,40}?(?:certified|certification|certificate)[\w\s-]{0,40}|"
    r"(?:certified)\s+[\w\s-]{3,50}|pmp|csm|psm)\b",
    re.IGNORECASE,
)
DEGREE_RE = re.compile(
    r"\b(b\.?\s?tech|b\.?e\b|bachelor'?s?|master'?s?|m\.?\s?tech|mca|bca|b\.?sc|m\.?sc|"
    r"degree|graduate|ph\.?d)\b",
    re.IGNORECASE,
)
INDIAN_CITIES = (
    "Bengaluru",
    "Bangalore",
    "Hyderabad",
    "Pune",
    "Mumbai",
    "Navi Mumbai",
    "Thane",
    "Chennai",
    "Delhi",
    "New Delhi",
    "Gurugram",
    "Gurgaon",
    "Noida",
    "Greater Noida",
    "Kolkata",
    "Ahmedabad",
    "Jaipur",
    "Jodhpur",
    "Udaipur",
    "Bikaner",
    "Chandigarh",
    "Mohali",
    "Indore",
    "Bhopal",
    "Kochi",
    "Cochin",
    "Coimbatore",
    "Vadodara",
    "Surat",
    "Nagpur",
    "Trivandrum",
    "Thiruvananthapuram",
    "Lucknow",
    "Mysore",
    "Mysuru",
    "Bhubaneswar",
    "Rajkot",
    "Dehradun",
)
CITY_ALIASES = {
    "bangalore": "Bengaluru",
    "gurgaon": "Gurugram",
    "cochin": "Kochi",
    "mysore": "Mysuru",
    "trivandrum": "Thiruvananthapuram",
    "new delhi": "Delhi",
}
SENIORITY = [
    ("EXECUTIVE", r"\b(cto|vp|vice president|director|head of)\b"),
    ("ARCHITECT", r"\barchitect\b"),
    ("PRINCIPAL", r"\b(principal|staff|distinguished)\b"),
    ("MANAGER", r"\b(manager|engineering manager)\b"),
    ("LEAD", r"\b(lead|team lead|tech lead|technical lead)\b"),
    ("SENIOR", r"\b(senior|sr\.?|snr)\b"),
    ("JUNIOR", r"\b(junior|jr\.?|fresher|entry[- ]level|trainee|intern)\b"),
    ("MID", r"\b(mid[- ]level|intermediate|associate|ii|iii)\b"),
]
CONSTRAINT_PATTERNS: list[tuple[str, str]] = [
    (
        "LANGUAGE",
        r"\b(fluent|fluency|proficien\w*|native)\b[^.\n]{0,40}\b(german|french|"
        r"arabic|japanese|spanish|dutch|mandarin|italian|korean|portuguese|russian)\b",
    ),
    (
        "WORK_AUTHORIZATION",
        r"\b(authori[sz]ed to work|work authori[sz]ation|right to work|"
        r"no (?:visa )?sponsorship|citizens? only|security clearance|"
        r"must hold (?:a )?valid (?:work )?(?:visa|permit))\b",
    ),
    (
        "LOCATION",
        r"\b(must (?:be )?(?:based|located|reside) in|willing(?:ness)? to relocate|"
        r"relocation (?:is )?(?:required|mandatory)|only candidates from)\b",
    ),
    (
        "NOTICE_PERIOD",
        r"\b(immediate joiners?|join(?:ing)? immediately|notice period (?:of )?"
        r"(?:less than|up to|maximum|max|<=?)?\s*\d+\s*days|serving notice)\b",
    ),
    (
        "CERTIFICATION",
        r"\b(certification|certified)\b[^.\n]{0,40}\b(required|mandatory|must)\b|"
        r"\b(must|required|mandatory)\b[^.\n]{0,40}\b(certification|certified)\b",
    ),
    ("TRAVEL", r"\b(travel (?:up to )?\d+%|extensive travel)\b"),
    ("SHIFT", r"\b(night shift|rotational shift|us shift|uk shift|24x7)\b"),
]


class SkillRequirement(BaseModel):
    skill: str
    importance: str  # REQUIRED | PREFERRED
    mentions: int
    years: float | None = None


class Constraint(BaseModel):
    type: str
    text: str
    mandatory: bool


class ParsedJD(BaseModel):
    parser_version: str = JD_PARSER_VERSION
    catalog_version: str = CATALOG_VERSION
    title: str | None = None
    seniority: str | None = None
    responsibilities: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)
    preferred: list[str] = Field(default_factory=list)
    skills: list[SkillRequirement] = Field(default_factory=list)
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    experience_min: float | None = None
    experience_max: float | None = None
    qualifications: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    work_model: str | None = None
    employment_type: str | None = None
    salary_min: Decimal | None = None
    salary_max: Decimal | None = None
    salary_currency: str | None = None
    salary_text: str | None = None
    constraints: list[Constraint] = Field(default_factory=list)
    leadership_required: bool = False
    warnings: list[str] = Field(default_factory=list)


def _heading(line: str) -> str | None:
    cleaned = re.sub(r"[*#_:]+", " ", line).strip().lower()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned or len(cleaned) > 45:
        return None
    if cleaned in _SECTION_LOOKUP:
        return _SECTION_LOOKUP[cleaned]
    for alias, key in _SECTION_LOOKUP.items():
        if cleaned.startswith(alias) and len(cleaned) <= len(alias) + 15:
            return key
    return None


def _items(lines: list[str]) -> list[str]:
    out = []
    for ln in lines:
        text = ln[2:].strip() if ln.startswith("• ") else ln.strip()
        if len(text) > 2:
            out.append(text)
    return out


def split_sections(text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {"intro": []}
    current = "intro"
    for line in text.split("\n"):
        if DETAIL_LINE.match(line):
            # "Location: Pune" / "Salary: 30 LPA" are job details, not part of the
            # surrounding list (and they don't end the current section).
            sections.setdefault("details", []).append(line)
            continue
        key = _heading(line)
        if key:
            current = key
            sections.setdefault(current, [])
            # "Experience: 5+ years" style headings carry content on the same line.
            rest = line.split(":", 1)[1].strip() if ":" in line else ""
            if rest:
                sections[current].append(rest)
            continue
        sections.setdefault(current, []).append(line)
    return sections


def _to_float(s: str) -> float:
    return float(s)


def parse_experience(text: str) -> tuple[float | None, float | None, dict[str, float]]:
    """Overall min/max years, plus per-skill years ("3+ years of AWS")."""
    per_skill: dict[str, float] = {}
    overall_min: list[float] = []
    overall_max: list[float] = []
    for line in text.split("\n"):
        for m in YEARS_RANGE.finditer(line):
            lo, hi = _to_float(m.group(1)), _to_float(m.group(2))
            if lo <= hi <= 40:
                tail = line[m.end() : m.end() + 60]
                skills = find_skills(tail)
                if skills and not re.match(
                    r"\s*(of\s+)?(overall|total|relevant|professional|"
                    r"industry|it|software)?\s*experience",
                    tail,
                    re.I,
                ):
                    for s in skills:
                        per_skill[s] = lo
                else:
                    overall_min.append(lo)
                    overall_max.append(hi)
        for m in YEARS_MIN.finditer(YEARS_RANGE.sub(" ", line)):
            years = _to_float(m.group(1))
            if years > 40:
                continue
            tail = line[m.end() : m.end() + 60]
            skills = find_skills(tail)
            if skills and not re.match(
                r"\s*(of\s+)?(overall|total|relevant|professional|"
                r"industry|it|software)?\s*experience",
                tail,
                re.I,
            ):
                for s in skills:
                    per_skill.setdefault(s, years)
            else:
                overall_min.append(years)
    result_lo: float | None = (
        max(overall_min) if overall_min else (max(per_skill.values()) if per_skill else None)
    )
    result_hi: float | None = max(overall_max) if overall_max else None
    if result_hi is not None and result_lo is not None and result_hi < result_lo:
        result_hi = None
    return result_lo, result_hi, per_skill


def parse_salary(text: str) -> tuple[Decimal | None, Decimal | None, str | None, str | None]:
    if m := SALARY_LPA.search(text):
        lo, hi = Decimal(m.group(1)), Decimal(m.group(2))
        return lo * 100000, hi * 100000, "INR", m.group(0).strip()
    if m := SALARY_LPA_SINGLE.search(text):
        v = Decimal(m.group(1)) * 100000
        return v, v, "INR", m.group(0).strip()
    if m := SALARY_AMOUNT.search(text):
        cur = CURRENCY.get(
            m.group(1).lower().rstrip(".") if m.group(1) not in "₹$€£" else m.group(1)
        ) or CURRENCY.get(m.group(1).lower())
        mult = {"k": 1000, "m": 1000000}

        def amount(num: str, suffix: str | None) -> Decimal:
            return Decimal(num.replace(",", "")) * mult.get((suffix or "").lower(), 1)

        lo = amount(m.group(2), m.group(3) or m.group(5))
        hi = amount(m.group(4), m.group(5))
        period = (m.group(6) or "").lower()
        if period in ("per month", "/month", "pm", "monthly"):
            lo, hi = lo * 12, hi * 12
        if lo > hi:
            lo, hi = hi, lo
        if hi < 1000:  # "₹ 5 - 8" without units is not a salary we can trust
            return None, None, None, None
        return lo, hi, cur, m.group(0).strip()
    return None, None, None, None


def detect_locations(text: str) -> list[str]:
    found: list[str] = []
    for city in INDIAN_CITIES:
        if re.search(rf"\b{re.escape(city)}\b", text, re.IGNORECASE):
            name = CITY_ALIASES.get(city.lower(), city)
            if name not in found:
                found.append(name)
    if re.search(
        r"\bremote\b[^.\n]{0,20}\bindia\b|\bindia\b[^.\n]{0,10}\bremote\b|"
        r"\bremote \(india\)",
        text,
        re.IGNORECASE,
    ):
        found.insert(0, "Remote India")
    return found


def detect_work_model(text: str) -> str | None:
    hits = [model for model, pat in WORK_MODELS if re.search(pat, text, re.IGNORECASE)]
    if "HYBRID" in hits:
        return "HYBRID"
    if "REMOTE" in hits and "ONSITE" not in hits:
        return "REMOTE"
    if "ONSITE" in hits and "REMOTE" not in hits:
        return "ONSITE"
    return "REMOTE" if "REMOTE" in hits else None


def detect_seniority(title: str | None, text: str = "") -> str | None:
    for level, pat in SENIORITY:
        if title and re.search(pat, title, re.IGNORECASE):
            return level
    return None


# Sentence boundary: punctuation + space + a capital/bullet (so "e.g. php" or "B.Tech" stay whole).
SENTENCE_SPLIT = re.compile(r"(?<=[.;!?])\s+(?=[A-Z•])")


def sentences(line: str) -> list[str]:
    """A JD pasted as one paragraph still needs per-sentence classification."""
    return [s for s in SENTENCE_SPLIT.split(line) if s.strip()]


def _classify_skills(sections: dict[str, list[str]], title: str | None) -> list[SkillRequirement]:
    required: dict[str, int] = {}
    preferred: dict[str, int] = {}

    def add(target: dict[str, int], found: dict[str, int]) -> None:
        for k, v in found.items():
            target[k] = target.get(k, 0) + v

    for key, lines in sections.items():
        if key in ("benefits", "about"):
            continue
        for line in (sentence for ln in lines for sentence in sentences(ln)):
            found = find_skills(line)
            if not found:
                continue
            if key == "preferred" or PREFERRED_MARKERS.search(line):
                add(preferred, found)
            else:
                add(required, found)
    if title:
        add(required, find_skills(title))
    out = [
        SkillRequirement(skill=s, importance="REQUIRED", mentions=n)
        for s, n in sorted(required.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    out += [
        SkillRequirement(skill=s, importance="PREFERRED", mentions=n)
        for s, n in sorted(preferred.items(), key=lambda kv: (-kv[1], kv[0]))
        if s not in required
    ]
    return out


def _constraints(text: str) -> list[Constraint]:
    out: list[Constraint] = []
    for line in (sentence for ln in text.split("\n") for sentence in sentences(ln)):
        for ctype, pat in CONSTRAINT_PATTERNS:
            if re.search(pat, line, re.IGNORECASE):
                mandatory = bool(
                    re.search(
                        r"\b(must|mandatory|required|only|essential|"
                        r"immediate)\b",
                        line,
                        re.IGNORECASE,
                    )
                ) and not PREFERRED_MARKERS.search(line)
                snippet = line[2:].strip() if line.startswith("• ") else line.strip()
                out.append(Constraint(type=ctype, text=snippet[:300], mandatory=mandatory))
    return out


def parse_jd(raw_text: str, title: str | None = None) -> ParsedJD:
    text = normalize_text(raw_text or "")
    sections = split_sections(text)
    result = ParsedJD(title=title)
    result.responsibilities = _items(sections.get("responsibilities", []))
    result.requirements = _items(sections.get("required", []))
    result.preferred = _items(sections.get("preferred", []))

    result.skills = _classify_skills(sections, title)
    lo, hi, per_skill = parse_experience(text)
    result.experience_min, result.experience_max = lo, hi
    for s in result.skills:
        if s.skill in per_skill:
            s.years = per_skill[s.skill]
    result.required_skills = [s.skill for s in result.skills if s.importance == "REQUIRED"]
    result.preferred_skills = [s.skill for s in result.skills if s.importance == "PREFERRED"]

    relevant = "\n".join(
        line
        for key, lines in sections.items()
        if key not in ("about", "benefits")
        for line in lines
    )
    result.domains = list(find_domains((title or "") + "\n" + relevant))
    result.salary_min, result.salary_max, result.salary_currency, result.salary_text = parse_salary(
        text
    )
    result.locations = detect_locations(text)
    result.work_model = detect_work_model(text)
    for name, pat in EMPLOYMENT_TYPES:
        if re.search(pat, text, re.IGNORECASE):
            result.employment_type = name
            break
    result.certifications = list(
        dict.fromkeys(re.sub(r"\s+", " ", m.group(0)).strip(" -") for m in CERT_RE.finditer(text))
    )[:10]
    req_lines = result.requirements or _items(sections.get("intro", []))
    result.qualifications = [ln for ln in req_lines if DEGREE_RE.search(ln)][:10]
    result.constraints = _constraints(text)
    result.seniority = detect_seniority(title, text)
    result.leadership_required = bool(
        (title and re.search(r"\b(lead|manager|head|principal|architect)\b", title, re.I))
        or re.search(
            r"\b(lead (?:a|the) team|mentor\w*|people management|team leadership|"
            r"manage (?:a )?team)\b",
            text,
            re.I,
        )
    )
    if not text.strip():
        result.warnings.append("Job description is empty.")
    elif not result.skills:
        result.warnings.append("No known skills detected in the job description.")
    return result
