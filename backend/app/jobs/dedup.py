"""Job identity rules shared by manual entry and every importer."""

import re
from datetime import date
from difflib import SequenceMatcher
from urllib.parse import urlsplit

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


# Words that say nothing about *which* city: states, countries, work models.
_NOT_A_PLACE = {
    "india", "remote", "hybrid", "onsite", "on", "site", "office", "work", "from", "home", "wfh",
    "in", "and", "or", "the", "any", "anywhere", "pan", "global", "worldwide", "multiple",
    "locations", "location", "city", "district", "north", "south", "east", "west", "metro",
    "karnataka", "maharashtra", "gujarat", "tamil", "nadu", "haryana", "telangana", "kerala",
    "rajasthan", "uttar", "pradesh", "west bengal", "bengal", "punjab", "madhya", "ncr",
    "usa", "us", "uk", "united", "states", "kingdom",
}
_CITY_ALIASES = {"bangalore": "bengaluru", "gurgaon": "gurugram", "bombay": "mumbai",
                 "madras": "chennai", "calcutta": "kolkata", "new": "", "delhi": "delhi"}


def _places(values: list[str]) -> set[str]:
    words: set[str] = set()
    for value in values:
        for w in re.findall(r"[a-z]+", value.lower()):
            w = _CITY_ALIASES.get(w, w)
            if w and len(w) > 2 and w not in _NOT_A_PLACE:
                words.add(w)
    return words


def locations_compatible(a: list[str], b: list[str]) -> bool:
    """Same place, however it's written ("Pune / Ahmedabad" vs "Ahmedabad, Gujarat / Pune")."""
    if not a or not b:
        return True
    la, lb = {x.lower() for x in a}, {x.lower() for x in b}
    if la & lb:
        return True
    if _places(a) & _places(b):
        return True
    return any("remote" in x for x in la) and any("remote" in x for x in lb)


def dates_compatible(a: date | None, b: date | None) -> bool:
    return a is None or b is None or abs((a - b).days) <= DATE_WINDOW_DAYS


_LEVEL_WORDS = {
    "intern", "trainee", "junior", "jr", "associate", "senior", "sr", "lead", "staff",
    "principal", "head", "director", "manager", "chief", "vp", "i", "ii", "iii", "iv", "v",
    "1", "2", "3", "4",
}


def same_level(a: str, b: str) -> bool:
    """"Senior Engineer" and "Engineer", or "Engineer II" and "Engineer III", are different jobs."""
    def level(t: str) -> set[str]:
        return {w for w in re.findall(r"[a-z0-9]+", t.lower()) if w in _LEVEL_WORDS}
    return level(a) == level(b)


def title_words_contained(a: str, b: str) -> bool:
    """One title is the other with words dropped ("Software Engineer, Ecommerce" in
    "Software Engineer - Ecommerce SFCC"); a swapped word means a different job."""
    wa, wb = set(re.findall(r"[a-z0-9]+", a.lower())), set(re.findall(r"[a-z0-9]+", b.lower()))
    return bool(wa and wb) and (wa <= wb or wb <= wa)


_URL_ID_RE = re.compile(r"\d{6,}")


def url_ids(url: str | None) -> tuple[str, set[str]]:
    """(host, posting IDs) of a job link: digit runs of 6+ in its path and query
    (".../jobs/8551280-senior-..." -> 8551280, "..._ATCI-5814758-S2071747-1" -> both numbers)."""
    if not url:
        return "", set()
    parts = urlsplit(url if "://" in url else f"https://{url}")
    return (parts.hostname or "").removeprefix("www."), set(
        _URL_ID_RE.findall(f"{parts.path}?{parts.query}")
    )
