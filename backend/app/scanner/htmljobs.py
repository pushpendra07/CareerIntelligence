"""Openings on a company's own careers page that has no job board and no JobPosting data.

Two shapes are common on small companies' sites:
- a list of links to one page per job ("Senior Magento Developer" -> /careers/magento-developer),
- the openings written on the careers page itself as headings, applied to by email.

Only text that reads like a job title counts; services pages ("Hire Magento Developers"),
blog posts and menu items are left out. Whatever is found still goes through the scanner's
title, location and age filters. No AI, no guessing beyond what the page shows.
"""

import re
from html import unescape
from urllib.parse import urljoin, urlsplit

from app.core.html_text import html_to_text

ANCHOR_RE = re.compile(r"<a\b[^>]*?href=[\"']([^\"'#]+)[\"'][^>]*>(.*?)</a>",
                       re.IGNORECASE | re.DOTALL)
HEADING_RE = re.compile(r"<(h[2-5])\b[^>]*>(.*?)</\1>", re.IGNORECASE | re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")
# Words that make a short phrase a job title.
ROLE_RE = re.compile(
    r"\b(developer|engineer|architect|programmer|lead|manager|analyst|designer|consultant|"
    r"specialist|tester|qa|sdet|executive|intern|internship|trainee|administrator|admin|"
    r"scientist|devops|sre|head|director|officer|associate|expert|strategist|writer|"
    r"coordinator|representative|recruiter|accountant|technician|support)\b", re.IGNORECASE)
# Phrases that look like a title but are services, content or navigation.
NOT_A_JOB_RE = re.compile(
    r"^(hire|hiring a|why|how|what|when|top|best|our|meet|about|join|life at|view|see|read|"
    r"apply|learn|explore|contact|connect|talk|speak|get|become|benefits|perks)\b|"
    r"\b(services?|solutions?|offices?|headquarters|"
    r"company|agency|companies|development company|blog|guide|tips|cost|vs\.?|case stud(y|ies)|"
    r"testimonials?|portfolio|pricing|faq|we are hiring|current openings|open positions|"
    r"all jobs|careers?)\b|[?!]", re.IGNORECASE)
JOB_PATH_RE = re.compile(
    r"/(?:jobs?|careers?|openings?|current-openings|positions?|vacanc(?:y|ies)|"
    r"opportunit(?:y|ies)|job-details?|jobdetails)/", re.IGNORECASE)
SKIP_EXT_RE = re.compile(r"\.(pdf|jpe?g|png|svg|gif|css|js|zip|docx?)$", re.IGNORECASE)


def _clean(fragment: str) -> str:
    return re.sub(r"\s+", " ", unescape(TAG_RE.sub(" ", fragment))).strip(" -–|:• ")


def looks_like_job_title(text: str) -> bool:
    words = text.split()
    return (2 <= len(words) <= 12 and len(text) <= 90 and bool(ROLE_RE.search(text))
            and not NOT_A_JOB_RE.search(text))


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def job_links(html: str, page_url: str, limit: int = 40) -> list[tuple[str, str]]:
    """(title, url) for links on the same site whose text is a job title."""
    host = urlsplit(page_url).hostname or ""
    site = ".".join(host.split(".")[-2:])
    out: dict[str, str] = {}
    for href, inner in ANCHOR_RE.findall(html or ""):
        title = _clean(inner)
        if not looks_like_job_title(title):
            continue
        url = urljoin(page_url, href.strip())
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not (parts.hostname or "").endswith(site):
            continue
        if url.rstrip("/") == page_url.rstrip("/") or SKIP_EXT_RE.search(parts.path):
            continue
        # A link to another kind of page (a service, a blog post) needs a job-like path.
        if not JOB_PATH_RE.search(parts.path + "/"):
            continue
        out.setdefault(url.split("#")[0], title)
        if len(out) >= limit:
            break
    return [(t, u) for u, t in out.items()]


def job_headings(html: str, page_url: str, limit: int = 40) -> list[dict[str, str]]:
    """Openings written on the page as headings: title, url (page#job/<slug>), description."""
    matches = list(HEADING_RE.finditer(html or ""))
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    base = page_url.split("#")[0]
    for i, m in enumerate(matches):
        title = _clean(m.group(2))
        if not looks_like_job_title(title) or title.lower() in seen:
            continue
        seen.add(title.lower())
        end = matches[i + 1].start() if i + 1 < len(matches) else min(len(html), m.end() + 6000)
        out.append({"title": title, "url": f"{base}#job/{_slug(title)}",
                    "description": html_to_text(html[m.end():end])[:6000]})
        if len(out) >= limit:
            break
    return out
