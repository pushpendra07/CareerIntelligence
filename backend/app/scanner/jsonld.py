"""Job postings published as schema.org `JobPosting` JSON-LD (what search engines read).

Many company career pages and job-detail pages embed this, so jobs can be read without any job
board. Only data the page itself declares is used.
"""

import json
import re
from datetime import date
from typing import Any
from urllib.parse import urljoin, urlsplit

from app.core.html_text import html_to_text

LD_RE = re.compile(r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
                   re.IGNORECASE | re.DOTALL)
HREF_RE = re.compile(r"""href=["']([^"'#]+)["']""", re.IGNORECASE)
# Links that look like a single job / opening page.
JOB_LINK_RE = re.compile(
    r"/(?:jobs?|careers?|openings?|current-openings|positions?|vacanc(?:y|ies)|join-us|"
    r"work-with-us|opportunit(?:y|ies)|apply)/[^?#]*[a-z0-9]", re.IGNORECASE)


def _walk(node: Any) -> list[dict[str, Any]]:
    """Every JobPosting object in a JSON-LD document (handles @graph, lists, ItemList)."""
    found: list[dict[str, Any]] = []
    if isinstance(node, list):
        for item in node:
            found += _walk(item)
    elif isinstance(node, dict):
        kind = node.get("@type")
        kinds = kind if isinstance(kind, list) else [kind]
        if "JobPosting" in kinds:
            found.append(node)
        for key in ("@graph", "itemListElement", "item", "mainEntity"):
            if key in node:
                found += _walk(node[key])
    return found


def job_postings(html: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in LD_RE.findall(html or ""):
        try:
            out += _walk(json.loads(raw.strip()))
        except (json.JSONDecodeError, ValueError):
            continue
    return out


def _text(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("@value") or "")
    return str(value or "")


def _location(posting: dict[str, Any]) -> str | None:
    locs = posting.get("jobLocation")
    parts: list[str] = []
    for loc in locs if isinstance(locs, list) else [locs]:
        if not isinstance(loc, dict):
            continue
        addr = loc.get("address") or {}
        if isinstance(addr, str):
            parts.append(addr)
            continue
        place = ", ".join(x for x in (_text(addr.get("addressLocality")),
                                      _text(addr.get("addressRegion")),
                                      _text(addr.get("addressCountry"))) if x)
        if place:
            parts.append(place)
    return " / ".join(dict.fromkeys(parts)) or None


def _date(value: Any) -> date | None:
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(value or ""))
    try:
        return date.fromisoformat(m.group(1)) if m else None
    except ValueError:
        return None


def to_fields(posting: dict[str, Any], page_url: str) -> dict[str, Any]:
    """title, url, location, remote, description, posted, employment_type, external_id."""
    remote = str(posting.get("jobLocationType", "")).upper() == "TELECOMMUTE"
    employment = posting.get("employmentType")
    if isinstance(employment, list):
        employment = ", ".join(str(e) for e in employment)
    ident = posting.get("identifier")
    ext = _text(ident.get("value") if isinstance(ident, dict) else ident) or None
    url = str(posting.get("url") or page_url)
    return {
        "title": html_to_text(_text(posting.get("title"))).strip(),
        "url": urljoin(page_url, url),
        "location": _location(posting),
        "remote": remote or None,
        "description": html_to_text(str(posting.get("description") or "")),
        "posted": _date(posting.get("datePosted")),
        "employment_type": str(employment) if employment else None,
        "external_id": ext,
    }


def job_links(html: str, page_url: str, limit: int = 30) -> list[str]:
    """Links on a careers page that look like individual job pages, on the same site."""
    host = urlsplit(page_url).hostname or ""
    site = ".".join(host.split(".")[-2:])
    seen: dict[str, None] = {}
    for href in HREF_RE.findall(html or ""):
        url = urljoin(page_url, href.strip())
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            continue
        if not parts.hostname.endswith(site) or url.rstrip("/") == page_url.rstrip("/"):
            continue
        if JOB_LINK_RE.search(parts.path) and not re.search(r"\.(pdf|jpe?g|png|svg|css|js)$",
                                                            parts.path, re.IGNORECASE):
            seen.setdefault(url.split("#")[0], None)
        if len(seen) >= limit:
            break
    return list(seen)
