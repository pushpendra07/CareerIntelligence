"""Automated verification checks against official sources.

- Website: reachable (2xx), stays on the same registrable domain, and the page mentions the
  company name -> VERIFIED (OFFICIAL_WEBSITE). Reachable but no name match -> PARTIALLY_VERIFIED.
- Careers URL: reachable on a known ATS host -> VERIFIED (OFFICIAL_ATS); reachable on the
  company's own domain -> VERIFIED (OFFICIAL_CAREERS); reachable elsewhere -> PARTIALLY_VERIFIED.
- LinkedIn: never fetched (LinkedIn blocks automated access); only its shape is validated.
Failures never delete data: a 404 adds an INVALID claim, network errors add nothing.
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.companies.verification import Claim, _rank, _usable, add_claim, recompute
from app.core.http import BlockedURLError, Fetcher, safe_get
from app.core.text import fold
from app.core.urls import detect_source, registrable_domain
from app.models.company import Company, SourceKind, VerificationStatus

logger = logging.getLogger(__name__)
VS = VerificationStatus


@dataclass
class CheckReport:
    company_id: int
    results: dict[str, str] = field(default_factory=dict)


def _mentions(name: str, html: str) -> bool:
    text = fold(html).lower()
    tokens = [t for t in re.split(r"[^a-z0-9]+", fold(name).lower()) if len(t) > 2]
    return bool(tokens) and all(t in text for t in tokens[:2])


def check_company(company: Company, fetch: Fetcher = safe_get) -> CheckReport:
    report = CheckReport(company.id)
    now = datetime.now(UTC)

    def get(url: str) -> tuple[int, str, str] | None:
        try:
            res = fetch(url)
            return res.status, res.url, res.text
        except (BlockedURLError, OSError, ValueError) as exc:
            report.results[url] = f"error: {exc}"
            logger.info("verification fetch failed", extra={"url": url, "error": str(exc)})
            return None

    def candidates(field_name: str) -> list[str]:
        """Distinct usable values for a field, best-supported first (max 3)."""
        ranked = sorted(_usable(company, field_name), key=_rank, reverse=True)
        return list(dict.fromkeys(s.value for s in ranked if s.value))[:3]

    def record(
        field_name: str,
        value: str,
        kind: SourceKind,
        verdict: VerificationStatus,
        final: str,
        note: str | None = None,
    ) -> None:
        add_claim(company, Claim(field_name, value, kind, verdict, "auto_check", final, now, note))
        report.results[value] = verdict.value

    for value in candidates("website"):
        got = get(value)
        if not got:
            continue
        status, final, body = got
        if 200 <= status < 300 and registrable_domain(final) == registrable_domain(value):
            verdict = VS.VERIFIED if _mentions(company.name, body) else VS.PARTIALLY_VERIFIED
            record("website", value, SourceKind.OFFICIAL_WEBSITE, verdict, final)
            if verdict == VS.VERIFIED:
                break
        elif status in (404, 410):
            record(
                "website", value, SourceKind.OFFICIAL_WEBSITE, VS.INVALID, final, f"HTTP {status}"
            )
        else:
            report.results[value] = f"inconclusive (HTTP {status})"
    recompute(company, now)

    for value in candidates("careers_url"):
        got = get(value)
        if not got:
            continue
        status, final, _ = got
        if 200 <= status < 300:
            if detect_source(final).source.value not in ("COMPANY_CAREERS", "UNKNOWN"):
                kind, verdict = SourceKind.OFFICIAL_ATS, VS.VERIFIED
            elif company.domain and registrable_domain(final) == company.domain:
                kind, verdict = SourceKind.OFFICIAL_CAREERS, VS.VERIFIED
            else:
                kind, verdict = SourceKind.SECONDARY, VS.PARTIALLY_VERIFIED
            record("careers_url", value, kind, verdict, final)
            if verdict == VS.VERIFIED:
                break
        elif status in (404, 410):
            record(
                "careers_url",
                value,
                SourceKind.OFFICIAL_CAREERS,
                VS.INVALID,
                final,
                f"HTTP {status}",
            )
        else:
            report.results[value] = f"inconclusive (HTTP {status})"
    recompute(company, now)
    return report
