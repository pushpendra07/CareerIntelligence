"""Deterministic CV parser: plain text -> structured ParsedCV.

No AI involved. It recognises common section headings, experience entries by their date
ranges, bullets, and skills/domains via the shared catalog. Anything it can't recognise is
simply left empty; the user edits the Professional Profile afterwards.
"""

import re
from datetime import date

from pydantic import BaseModel, Field

from app.skills.catalog import CATALOG_VERSION, find_domains, find_skills, skill_category

PARSER_VERSION = "cv-parser/1"

SECTION_ALIASES: dict[str, tuple[str, ...]] = {
    "summary": (
        "summary",
        "professional summary",
        "profile",
        "profile summary",
        "about",
        "about me",
        "career objective",
        "objective",
        "career summary",
    ),
    "skills": (
        "skills",
        "technical skills",
        "core competencies",
        "key skills",
        "technologies",
        "skills & tools",
        "technical expertise",
        "areas of expertise",
    ),
    "experience": (
        "experience",
        "professional experience",
        "work experience",
        "employment history",
        "career history",
        "work history",
    ),
    "projects": (
        "projects",
        "key projects",
        "project experience",
        "client projects",
        "selected projects",
    ),
    "certifications": (
        "certifications",
        "certificates",
        "licenses & certifications",
        "certification",
        "licenses and certifications",
    ),
    "education": ("education", "academic qualifications", "qualifications", "education & training"),
    "achievements": ("achievements", "awards", "accomplishments", "honors", "honours"),
}
_HEADING_LOOKUP = {alias: key for key, aliases in SECTION_ALIASES.items() for alias in aliases}

MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1
    )
}
_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_POINT = rf"(?:{_MONTH}\s*\d{{4}}|\d{{1,2}}/\d{{4}}|\d{{4}})"
_NOW = r"(?:present|current|now|till\s+date|to\s+date|ongoing)"
DATE_RANGE_RE = re.compile(rf"({_POINT})\s*(?:–|—|-|to)\s*({_POINT}|{_NOW})", re.IGNORECASE)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"\+?\d[\d\s().-]{8,}\d")
LINKEDIN_RE = re.compile(r"(?:https?://)?(?:[\w]+\.)?linkedin\.com/in/[\w%-]+/?", re.IGNORECASE)
STATED_YEARS_RE = re.compile(r"(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years|yrs)", re.IGNORECASE)
LEAD_TITLE_RE = re.compile(
    r"\b(lead|leader|head|manager|principal|architect|director|supervisor)\b", re.IGNORECASE
)
NON_TECH_CATEGORIES = {"leadership", "practice"}
# A quantified outcome: a percentage, a multiplier, or a number >= 10 that is not a year
# (so "Magento 2" or "PHP 8" do not make a bullet an achievement).
METRIC_RE = re.compile(
    r"\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?x\b|\b(?!(?:19|20)\d{2}\b)\d{1,3}(?:,\d{3})+\b"
    r"|\b(?!(?:19|20)\d{2}\b)\d{2,}\+?\b",
    re.IGNORECASE,
)


class ExperienceEntry(BaseModel):
    title: str | None = None
    company: str | None = None
    location: str | None = None
    start: str | None = None  # YYYY-MM
    end: str | None = None  # YYYY-MM, or None when current
    is_current: bool = False
    months: int = 0
    bullets: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    leadership: bool = False


class ProjectEntry(BaseModel):
    name: str
    header: str
    platform: str | None = None
    bullets: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)


class EducationEntry(BaseModel):
    degree: str
    institution: str | None = None
    start: str | None = None
    end: str | None = None


class ParsedCV(BaseModel):
    parser_version: str = PARSER_VERSION
    catalog_version: str = CATALOG_VERSION
    as_of: str
    name: str | None = None
    headline: str | None = None
    email: str | None = None
    phone: str | None = None
    linkedin: str | None = None
    location: str | None = None
    summary: str | None = None
    total_experience_years: float | None = None
    stated_experience_years: float | None = None
    relevant_experience_years: float | None = None
    leadership_experience_years: float | None = None
    companies: list[str] = Field(default_factory=list)
    job_titles: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    skills: dict[str, int] = Field(default_factory=dict)  # canonical -> mentions
    skill_groups: dict[str, list[str]] = Field(default_factory=dict)  # as written in the CV
    technologies: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    frameworks: list[str] = Field(default_factory=list)
    platforms: list[str] = Field(default_factory=list)
    databases: list[str] = Field(default_factory=list)
    cloud: list[str] = Field(default_factory=list)
    leadership: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    education: list[EducationEntry] = Field(default_factory=list)
    experience: list[ExperienceEntry] = Field(default_factory=list)
    projects: list[ProjectEntry] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def _heading_key(line: str) -> str | None:
    cleaned = line.strip().lstrip("#").strip().rstrip(":").strip().lower()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if len(cleaned) > 40:
        return None
    return _HEADING_LOOKUP.get(cleaned)


def split_sections(text: str) -> tuple[list[str], dict[str, list[str]]]:
    header: list[str] = []
    sections: dict[str, list[str]] = {}
    current: list[str] = header
    for line in text.split("\n"):
        key = _heading_key(line)
        if key:
            current = sections.setdefault(key, [])
            continue
        current.append(line)
    return header, sections


def _parse_point(raw: str, as_of: date, end: bool) -> date | None:
    s = raw.strip().lower().rstrip(".")
    if re.fullmatch(_NOW, s):
        return as_of
    if m := re.fullmatch(r"(\d{1,2})/(\d{4})", s):
        return date(int(m.group(2)), max(1, min(12, int(m.group(1)))), 1)
    if m := re.fullmatch(rf"({_MONTH})\s*(\d{{4}})", s):
        return date(int(m.group(2)), MONTHS[m.group(1)[:3]], 1)
    if re.fullmatch(r"\d{4}", s):
        return date(int(s), 12 if end else 1, 1)
    return None


def _months_between(start: date, end: date) -> int:
    return max(0, (end.year - start.year) * 12 + end.month - start.month)


def _merged_months(ranges: list[tuple[date, date]]) -> int:
    """Total months covered by possibly-overlapping ranges (overlaps counted once)."""
    total = 0
    cur_s: date | None = None
    cur_e: date | None = None
    for s, e in sorted(ranges):
        if cur_e is None or cur_s is None or s > cur_e:
            if cur_s is not None and cur_e is not None:
                total += _months_between(cur_s, cur_e)
            cur_s, cur_e = s, e
        else:
            cur_e = max(cur_e, e)
    if cur_s is not None and cur_e is not None:
        total += _months_between(cur_s, cur_e)
    return total


def _years(months: int) -> float:
    return round(months / 12, 1)


def _split_company(text: str) -> tuple[str | None, str | None]:
    text = text.strip(" |,–—-")
    if not text:
        return None, None
    company, _, location = text.partition(",")
    return company.strip() or None, location.strip() or None


def _bullet(line: str) -> str | None:
    return line[2:].strip() if line.startswith("• ") else None


def parse_experience(lines: list[str], as_of: date) -> list[ExperienceEntry]:
    entries: list[ExperienceEntry] = []
    pending_title: str | None = None
    current: ExperienceEntry | None = None
    for line in lines:
        bullet = _bullet(line)
        if bullet is not None:
            if current is not None:
                current.bullets.append(bullet)
            continue
        match = DATE_RANGE_RE.search(line)
        if not match:
            if current is not None and current.bullets:
                current = None
            pending_title = line.strip()
            continue
        before = line[: match.start()].strip(" |,–—-")
        title: str | None
        if pending_title:
            title = pending_title
            company, location = _split_company(before)
        else:
            parts = re.split(r"\s+(?:at|@|\||–|—|-)\s+", before, maxsplit=1)
            title = parts[0].strip() or None
            company, location = _split_company(parts[1]) if len(parts) > 1 else (None, None)
        start = _parse_point(match.group(1), as_of, end=False)
        end = _parse_point(match.group(2), as_of, end=True)
        is_current = bool(re.fullmatch(_NOW, match.group(2).strip().lower()))
        current = ExperienceEntry(
            title=title,
            company=company,
            location=location,
            start=start.strftime("%Y-%m") if start else None,
            end=None if is_current or not end else end.strftime("%Y-%m"),
            is_current=is_current,
            months=_months_between(start, end) if start and end else 0,
        )
        entries.append(current)
        pending_title = None
    for e in entries:
        text = " ".join([e.title or "", *e.bullets])
        e.skills = sorted(find_skills(text))
        e.leadership = bool(
            (e.title and LEAD_TITLE_RE.search(e.title))
            or re.search(r"\b(mentor\w*|led|lead\w*|team lead)\b", text, re.IGNORECASE)
        )
    return entries


def parse_projects(lines: list[str]) -> list[ProjectEntry]:
    projects: list[ProjectEntry] = []
    for line in lines:
        bullet = _bullet(line)
        if bullet is not None:
            if projects:
                projects[-1].bullets.append(bullet)
            continue
        header = line.strip()
        platform_match = re.search(r"\(([^)]+)\)\s*$", header)
        name = re.split(r",|\s[–—-]\s|\(", header, maxsplit=1)[0].strip()
        projects.append(
            ProjectEntry(
                name=name or header,
                header=header,
                platform=platform_match.group(1) if platform_match else None,
            )
        )
    for p in projects:
        p.skills = sorted(find_skills(" ".join([p.header, *p.bullets])))
    return projects


def parse_education(lines: list[str], as_of: date) -> list[EducationEntry]:
    out: list[EducationEntry] = []
    for line in lines:
        text = _bullet(line) or line.strip()
        if not text:
            continue
        match = DATE_RANGE_RE.search(text)
        body = text[: match.start()] if match else text
        degree, _, institution = re.split(r"\s+[|]\s+", body.strip(" |"))[0].partition(" – ")
        if not institution:
            degree, _, institution = degree.partition(" - ")
        start = _parse_point(match.group(1), as_of, False) if match else None
        end = _parse_point(match.group(2), as_of, True) if match else None
        out.append(
            EducationEntry(
                degree=degree.strip(),
                institution=institution.strip() or None,
                start=start.strftime("%Y-%m") if start else None,
                end=end.strftime("%Y-%m") if end else None,
            )
        )
    return out


def _split_items(text: str) -> list[str]:
    """Comma split that ignores commas inside parentheses."""
    items, depth, buf = [], 0, ""
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            items.append(buf.strip())
            buf = ""
        else:
            buf += ch
    items.append(buf.strip())
    return [i for i in items if i]


def parse_skill_groups(lines: list[str]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    last: str | None = None
    prev_ended_item = True
    for line in lines:
        text = _bullet(line) or line.strip()
        if ":" in text and len(text.split(":", 1)[0]) <= 40:
            label, raw_items = text.split(":", 1)
            last = label.strip()
            groups[last] = _split_items(raw_items)
        else:
            key = last or "Skills"
            items = _split_items(text)
            target = groups.setdefault(key, [])
            if items and target and not prev_ended_item:
                target[-1] = f"{target[-1]} {items.pop(0)}"  # an item wrapped onto this line
            target.extend(items)
        prev_ended_item = text.rstrip().endswith(",")
    return groups


def derive_roles(titles: list[str]) -> list[str]:
    """Job titles -> distinct role names, splitting "Senior Dev (Tech Lead responsibilities)"."""
    roles: list[str] = []
    for title in titles:
        base = re.sub(r"\s*\(.*?\)\s*", " ", title).strip()
        extra = re.findall(r"\(([^)]*)\)", title)
        for candidate in [base, *extra]:
            candidate = re.sub(r"\b(responsibilities|role|duties)\b", "", candidate, flags=re.I)
            candidate = re.sub(r"\s+", " ", candidate).strip(" -–")
            keep = candidate == base or bool(LEAD_TITLE_RE.search(candidate))
            if candidate and keep and candidate.lower() not in {r.lower() for r in roles}:
                roles.append(candidate)
    return roles


def _header_fields(header: list[str], text: str) -> dict[str, str | None]:
    lines = [ln.strip() for ln in header if ln.strip()]
    email = EMAIL_RE.search(text)
    linkedin = LINKEDIN_RE.search(text)
    phone_match = PHONE_RE.search("\n".join(lines))
    name = lines[0] if lines and not EMAIL_RE.search(lines[0]) else None
    headline = None
    location = None
    for ln in lines[1:]:
        if EMAIL_RE.search(ln) or PHONE_RE.search(ln):
            for part in (p.strip() for p in ln.split("|")):
                if (
                    part
                    and not EMAIL_RE.search(part)
                    and not PHONE_RE.search(part)
                    and not LINKEDIN_RE.search(part)
                    and location is None
                ):
                    location = part
        elif headline is None:
            headline = ln
    return {
        "name": name,
        "headline": headline,
        "email": email.group(0) if email else None,
        "phone": re.sub(r"\s+", " ", phone_match.group(0)).strip() if phone_match else None,
        "linkedin": linkedin.group(0) if linkedin else None,
        "location": location,
    }


def parse_cv(text: str, as_of: date | None = None) -> ParsedCV:
    as_of = as_of or date.today()
    header, sections = split_sections(text)
    result = ParsedCV(as_of=as_of.isoformat(), **_header_fields(header, text))

    summary_lines = [ln for ln in sections.get("summary", []) if ln.strip()]
    result.summary = " ".join(summary_lines) or None
    if m := STATED_YEARS_RE.search(result.summary or text[:2000]):
        result.stated_experience_years = float(m.group(1))

    result.experience = parse_experience(sections.get("experience", []), as_of)
    result.projects = parse_projects(sections.get("projects", []))
    result.education = parse_education(sections.get("education", []), as_of)
    result.skill_groups = parse_skill_groups(sections.get("skills", []))
    result.certifications = [
        _bullet(ln) or ln.strip() for ln in sections.get("certifications", []) if ln.strip()
    ]

    result.skills = dict(sorted(find_skills(text).items(), key=lambda kv: (-kv[1], kv[0])))
    by_cat: dict[str, list[str]] = {}
    for name in result.skills:
        by_cat.setdefault(skill_category(name) or "other", []).append(name)
    result.languages = by_cat.get("language", [])
    result.frameworks = by_cat.get("framework", [])
    result.platforms = by_cat.get("platform", [])
    result.databases = (
        by_cat.get("database", []) + by_cat.get("cache", []) + by_cat.get("search", [])
    )
    result.cloud = by_cat.get("cloud", [])
    result.leadership = by_cat.get("leadership", [])
    result.technologies = [
        n for n in result.skills if (skill_category(n) or "other") not in NON_TECH_CATEGORIES
    ]
    result.domains = [
        d for d, _ in sorted(find_domains(text).items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    result.companies = list(dict.fromkeys(e.company for e in result.experience if e.company))
    result.job_titles = list(dict.fromkeys(e.title for e in result.experience if e.title))
    result.roles = derive_roles(result.job_titles)
    result.responsibilities = [b for e in result.experience for b in e.bullets]
    bullets = result.responsibilities + [b for p in result.projects for b in p.bullets]
    bullets += [_bullet(ln) or ln for ln in sections.get("achievements", []) if ln.strip()]
    result.achievements = [b for b in bullets if METRIC_RE.search(b)]

    ranges = []
    for e in result.experience:
        if e.start:
            s = date.fromisoformat(e.start + "-01")
            end = date.fromisoformat(e.end + "-01") if e.end else as_of.replace(day=1)
            ranges.append((s, end, e))
    if ranges:
        result.total_experience_years = _years(_merged_months([(s, e) for s, e, _ in ranges]))
        top = [n for n in result.technologies[:5]]
        relevant = [(s, e) for s, e, entry in ranges if set(entry.skills) & set(top)]
        result.relevant_experience_years = _years(_merged_months(relevant))
        lead = [(s, e) for s, e, entry in ranges if entry.leadership]
        result.leadership_experience_years = _years(_merged_months(lead))
    else:
        result.total_experience_years = result.stated_experience_years
        result.warnings.append("No dated experience entries found; using stated years if any.")
    if not result.name:
        result.warnings.append("Could not detect the candidate name.")
    if not result.skills:
        result.warnings.append("No known skills detected.")
    return result
