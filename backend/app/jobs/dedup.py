"""Job identity rules shared by manual entry and every importer."""

import re
from datetime import date
from difflib import SequenceMatcher

from app.core.text import title_key

REQ_ID_RE = re.compile(
    r"\b(?:job\s*id|posting\s*id|requisition(?:\s*id)?|req(?:\.|\s*id)?|jr|ref(?:erence)?)"
    r"\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]*\d[A-Z0-9_-]*)\b",
    re.IGNORECASE,
)
DATE_WINDOW_DAYS = 60


def location_key(locations: list[str] | None, location: str | None) -> str:
    values = [v.lower() for v in (locations or []) if v]
    if not values and location:
        values = [location.split(",")[0].strip().lower()]
    if not values:
        return ""
    return "remote" if all("remote" in v for v in values) else sorted(values)[0]


def dedup_key(
    company_id: int, title: str, locations: list[str] | None, location: str | None
) -> str:
    return f"{company_id}|{title_key(title)}|{location_key(locations, location)}"


def requisition_id(text: str | None) -> str | None:
    if not text:
        return None
    m = REQ_ID_RE.search(text)
    return m.group(1).upper() if m else None


def _shingles(text: str, n: int = 5) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {" ".join(words[i : i + n]) for i in range(max(0, len(words) - n + 1))}


def jd_similarity(a: str, b: str) -> float:
    sa, sb = _shingles(a[:20000]), _shingles(b[:20000])
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, title_key(a), title_key(b)).ratio()


def locations_compatible(a: list[str], b: list[str]) -> bool:
    if not a or not b:
        return True
    la, lb = {x.lower() for x in a}, {x.lower() for x in b}
    if la & lb:
        return True
    return any("remote" in x for x in la) and any("remote" in x for x in lb)


def dates_compatible(a: date | None, b: date | None) -> bool:
    return a is None or b is None or abs((a - b).days) <= DATE_WINDOW_DAYS
