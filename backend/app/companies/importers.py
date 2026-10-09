"""Readers that turn external company lists into source-attributed CompanyRecords.

Readers never touch the database and never write to their source files. Placeholder values
("Not verified", "Unknown", ...) become missing values, not data.
"""

import csv
import io
import json
import re
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from app.companies.verification import Claim
from app.core.text import clean, split_list
from app.models.company import HiringStatus, SourceKind, Tier, VerificationStatus

VS = VerificationStatus


@dataclass
class CompanyRecord:
    name: str
    source_name: str
    aliases: list[str] = field(default_factory=list)
    claims: list[Claim] = field(default_factory=list)
    tier: Tier | None = None
    priority: str | None = None
    hiring_status: HiringStatus | None = None
    job_search_enabled: bool | None = None
    notes: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)

    def claim(
        self,
        field_name: str,
        value: object,
        kind: SourceKind,
        status: VerificationStatus,
        source_url: str | None = None,
        verified_at: datetime | None = None,
        note: str | None = None,
    ) -> None:
        v = clean(value)
        if v is not None:
            self.claims.append(
                Claim(
                    field_name,
                    v,
                    kind,
                    status,
                    self.source_name,
                    clean(source_url),
                    verified_at,
                    note,
                )
            )


PRIORITY_TO_TIER = {
    "A+": Tier.TIER_A,
    "A": Tier.TIER_A,
    "B": Tier.TIER_B,
    "C": Tier.TIER_C,
    "D": Tier.TIER_C,
}


def tier_from_priority(priority: str | None) -> Tier | None:
    return PRIORITY_TO_TIER.get((priority or "").strip().upper())


def _date(value: object) -> datetime | None:
    s = clean(value)
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:10]).replace(tzinfo=UTC)
    except ValueError:
        return None


# --- jobsearch research CSV (45 columns) -------------------------------------------------


def read_research_csv(path: Path, source_name: str = "jobsearch_csv") -> Iterator[CompanyRecord]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            name = clean(row.get("Company Name"))
            if not name:
                continue
            rec = CompanyRecord(name=name, source_name=source_name)
            v_status = row.get("Verification Status") or ""
            strong = bool(re.search(r"Tier\s*[12]\b", v_status))
            status = VS.PARTIALLY_VERIFIED if strong else VS.RESEARCHED
            evidence = clean(row.get("Verification Source 1"))
            seen_at = _date(row.get("Last Verified Date"))
            note = f"Research status: {v_status}".strip() if v_status else None

            website = clean(row.get("Official Website"))
            rec.claim(
                "website",
                website.lower() if website else None,
                SourceKind.IMPORT,
                status,
                evidence,
                seen_at,
                note,
            )
            rec.claim(
                "careers_url",
                row.get("Official Careers Page"),
                SourceKind.IMPORT,
                status,
                evidence,
                seen_at,
                note,
            )
            rec.claim(
                "linkedin_url",
                row.get("LinkedIn Company URL"),
                SourceKind.IMPORT,
                VS.RESEARCHED,
                evidence,
                seen_at,
                note,
            )
            hq = clean(row.get("Headquarters"))
            if hq and "unconfirmed" not in hq.lower():
                rec.claim("headquarters", hq, SourceKind.IMPORT, VS.RESEARCHED, evidence, seen_at)
            rec.claim(
                "industry", row.get("Industry"), SourceKind.IMPORT, VS.RESEARCHED, evidence, seen_at
            )
            rec.claim(
                "company_type",
                row.get("Company Type"),
                SourceKind.IMPORT,
                VS.RESEARCHED,
                evidence,
                seen_at,
            )
            rec.claim(
                "employee_range",
                row.get("Employee Size"),
                SourceKind.IMPORT,
                VS.RESEARCHED,
                clean(row.get("Employee Size Source")) or evidence,
                seen_at,
            )
            locations = split_list(row.get("India Locations"))
            if locations:
                rec.claim(
                    "india_locations",
                    ", ".join(locations),
                    SourceKind.IMPORT,
                    status,
                    evidence,
                    seen_at,
                )
            countries = (row.get("Countries of Operation") or "").lower()
            if locations or "india" in countries or (hq and "india" in hq.lower()):
                rec.claim("india_presence", "true", SourceKind.IMPORT, status, evidence, seen_at)

            rec.priority = clean(row.get("Priority"))
            rec.tier = tier_from_priority(rec.priority)
            if (clean(row.get("Current Relevant Jobs")) or "").lower() == "yes":
                rec.hiring_status = HiringStatus.HIRING
            rec.notes = clean(row.get("Notes"))
            rec.attributes = {
                k: v
                for k, v in {
                    "research_id": clean(row.get("Company ID")),
                    "verification_label": clean(v_status),
                    "relevance": {
                        key: clean(row.get(f"{key} Relevance"))
                        for key in (
                            "PHP",
                            "Magento",
                            "Magento 2",
                            "Adobe Commerce",
                            "Adobe Commerce Cloud",
                            "Laravel",
                            "E-commerce",
                        )
                        if clean(row.get(f"{key} Relevance"))
                    },
                    "technologies": clean(row.get("Relevant Technologies")),
                    "magento_evidence": clean(row.get("Magento/Adobe Commerce Evidence")),
                    "php_evidence": clean(row.get("PHP/Laravel Evidence")),
                    "ecommerce_evidence": clean(row.get("E-commerce Evidence")),
                    "relevant_job_titles": clean(row.get("Relevant Job Titles")),
                    "relevant_job_url": clean(row.get("Relevant Job URL")),
                    "remote": clean(row.get("Remote Availability")),
                    "india_remote": clean(row.get("India Remote Eligibility")),
                    "rating": clean(row.get("Company Rating")),
                    "rating_source": clean(row.get("Rating Source")),
                    "job_relevance_score": clean(row.get("Job Relevance Score")),
                    "data_confidence_score": clean(row.get("Data Confidence Score")),
                    "evidence_urls": [
                        u
                        for u in (clean(row.get(f"Verification Source {i}")) for i in (1, 2, 3))
                        if u
                    ],
                }.items()
                if v
            }
            yield rec


# --- myjob portal SQLite (read-only) -----------------------------------------------------


def read_myjob_db(path: Path, source_name: str = "myjob_db") -> Iterator[CompanyRecord]:
    uri = f"file:{path.resolve()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT name, mnc, location, size, magento_work, rating, match_score, review, "
            "ats, slug, active FROM companies"
        ).fetchall()
    for row in rows:
        name = clean(row["name"])
        if not name:
            continue
        rec = CompanyRecord(name=name, source_name=source_name)
        location = clean(row["location"]) or ""
        if m := re.search(r"India\s*\(([^)]+)\)", location):
            rec.claim(
                "india_locations",
                ", ".join(split_list(m.group(1))),
                SourceKind.IMPORT,
                VS.DISCOVERED,
            )
        if "india" in location.lower():
            rec.claim("india_presence", "true", SourceKind.IMPORT, VS.DISCOVERED)
        rec.claim("employee_range", row["size"], SourceKind.IMPORT, VS.DISCOVERED)
        ats, slug = clean(row["ats"]), clean(row["slug"])
        if ats and slug:
            url = _ats_board_url(ats, slug)
            if url:
                rec.claim(
                    "careers_url",
                    url,
                    SourceKind.IMPORT,
                    VS.DISCOVERED,
                    note=f"Derived from myjob ats={ats} slug={slug}",
                )
        rec.job_search_enabled = True if (ats and slug) else None
        rec.attributes = {
            k: v
            for k, v in {
                "mnc": clean(row["mnc"]),
                "location_text": location or None,
                "magento_work": clean(row["magento_work"]),
                "rating": clean(row["rating"]),
                "match_score": clean(row["match_score"]),
                "review": clean(row["review"]),
            }.items()
            if v
        }
        yield rec


def _ats_board_url(ats: str, slug: str) -> str | None:
    return {
        "greenhouse": f"https://job-boards.greenhouse.io/{slug}",
        "lever": f"https://jobs.lever.co/{slug}",
        "ashby": f"https://jobs.ashbyhq.com/{slug}",
        "smartrecruiters": f"https://jobs.smartrecruiters.com/{slug}",
        "workable": f"https://apply.workable.com/{slug}",
    }.get(ats.lower())


# --- Career-Ops portals.yml (read-only) ---------------------------------------------------


def read_career_ops_portals(
    portals_path: Path, source_name: str = "career_ops_portals"
) -> Iterator[CompanyRecord]:
    doc = yaml.safe_load(portals_path.read_text(encoding="utf-8")) or {}
    for entry in doc.get("tracked_companies") or []:
        if not isinstance(entry, dict):
            continue
        name = clean(entry.get("name"))
        if not name:
            continue
        rec = CompanyRecord(name=name, source_name=source_name)
        careers = clean(entry.get("careers_url"))
        rec.claim(
            "careers_url",
            careers,
            SourceKind.IMPORT,
            VS.RESEARCHED,
            careers,
            note="Scanned by Career-Ops (portals.yml tracked_companies)",
        )
        enabled = entry.get("enabled", True) is not False
        rec.job_search_enabled = enabled
        rec.attributes = {
            k: v
            for k, v in {
                "career_ops_api": clean(entry.get("api")),
                "career_ops_provider": clean(entry.get("provider")),
                "career_ops_notes": clean(entry.get("notes")),
                "career_ops_enabled": enabled,
            }.items()
            if v is not None
        }
        yield rec


# --- Generic CSV / JSON import (spec §57) -------------------------------------------------

GENERIC_FIELDS = (
    "website",
    "careers_url",
    "linkedin_url",
    "headquarters",
    "industry",
    "company_type",
    "employee_range",
    "legal_name",
)


def records_from_rows(rows: list[dict[str, Any]], source_name: str) -> Iterator[CompanyRecord]:
    for raw in rows:
        row = {re.sub(r"[^a-z0-9]+", "_", str(k).lower()).strip("_"): v for k, v in raw.items()}
        name = clean(row.get("name") or row.get("company_name") or row.get("company"))
        if not name or name.startswith("["):  # "[Additional 150+ companies ...]" placeholders
            continue
        rec = CompanyRecord(name=name, source_name=source_name)
        url = clean(row.get("source_url"))
        status = VS.RESEARCHED if url else VS.DISCOVERED
        row.setdefault("careers_url", row.get("careers_page"))
        for f in GENERIC_FIELDS:
            rec.claim(f, row.get(f), SourceKind.IMPORT, status, url)
        coverage = clean(row.get("location_coverage") or row.get("location"))
        if coverage and not row.get("india_locations"):
            if m := re.search(r"India\s*\(([^)]+)\)", coverage):
                row["india_locations"] = m.group(1)
            elif "india" in coverage.lower():
                parts = [
                    x
                    for x in split_list(coverage, r"[/,;]")
                    if x.lower() not in ("india", "global", "remote")
                    and not x.lower().startswith(("global", "remote"))
                ]
                row["india_locations"] = ", ".join(parts) or None
                rec.claim("india_presence", "true", SourceKind.IMPORT, status, url)
        locations = row.get("india_locations")
        if isinstance(locations, list):
            locations = ", ".join(str(x) for x in locations)
        if loc_list := split_list(locations, r"[;,|]"):
            rec.claim("india_locations", ", ".join(loc_list), SourceKind.IMPORT, status, url)
            rec.claim("india_presence", "true", SourceKind.IMPORT, status, url)
        aliases = row.get("aliases")
        rec.aliases = aliases if isinstance(aliases, list) else split_list(aliases, r"[;|]")
        tier = clean(row.get("tier"))
        rec.tier = (
            Tier(tier)
            if tier and tier in Tier.__members__
            else tier_from_priority(clean(row.get("priority")))
        )
        rec.priority = clean(row.get("priority"))
        rec.notes = clean(row.get("notes") or row.get("notes_verification_status"))
        extra = {k: clean(row.get(k)) for k in ("ats_platform", "location_coverage")}
        if any(extra.values()):
            rec.attributes = {k: v for k, v in extra.items() if v}
        if (enabled := clean(row.get("job_search_enabled"))) is not None:
            rec.job_search_enabled = enabled.lower() in ("1", "true", "yes", "y")
        yield rec


def parse_upload(data: bytes, filename: str) -> list[dict[str, Any]]:
    text = data.decode("utf-8-sig")
    if filename.lower().endswith(".json"):
        parsed = json.loads(text)
        items = parsed.get("items", parsed) if isinstance(parsed, dict) else parsed
        if not isinstance(items, list):
            raise ValueError('JSON must be a list of objects or {"items": [...]}')
        return [i for i in items if isinstance(i, dict)]
    return list(csv.DictReader(io.StringIO(text)))
