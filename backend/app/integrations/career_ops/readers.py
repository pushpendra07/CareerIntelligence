"""Read-only parsers for Career-Ops' user-layer files (its documented data contract).

Never writes anything. Tolerant by design: Career-Ops evolves its formats additively
(append-only TSV columns, localized headers, new report sections), so unknown/missing
pieces are skipped rather than treated as errors.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from app.core.text import clean

# Same order as lib/scan-history-columns.mjs (append-only upstream).
SCAN_HISTORY_COLUMNS = (
    "url",
    "first_seen",
    "portal",
    "title",
    "company",
    "status",
    "location",
    "fingerprint",
    "posted_at",
    "trust_score",
    "trust_flags",
    "normalized_company",
    "requisition_id",
    "language",
)
# Header aliases from tracker-aliases.json (localized trackers).
TRACKER_ALIASES = {
    "#": "num",
    "num": "num",
    "date": "date",
    "fecha": "date",
    "datum": "date",
    "data": "date",
    "dato": "date",
    "tanggal": "date",
    "company": "company",
    "empresa": "company",
    "firma": "company",
    "virksomhed": "company",
    "perusahaan": "company",
    "via": "via",
    "role": "role",
    "puesto": "role",
    "rolle": "role",
    "rola": "role",
    "vaga": "role",
    "location": "location",
    "ort": "location",
    "score": "score",
    "status": "status",
    "pdf": "pdf",
    "materials": "pdf",
    "report": "report",
    "apply link": "applylink",
    "apply": "applylink",
    "follow-up": "followup",
    "follow up": "followup",
    "followup": "followup",
    "notes": "notes",
    "url": "url",
}
PENDING_HEADINGS = {"pending", "pendientes", "pendentes", "ausstehend", "en attente"}
PROCESSED_HEADINGS = {
    "processed",
    "procesadas",
    "procesados",
    "processadas",
    "verarbeitet",
    "traitées",
    "traites",
}


def resolve_data_root(code_root: Path | None, data_root: Path | None) -> Path | None:
    """Same precedence as Career-Ops: explicit data root, then .career-ops-data marker."""
    if data_root:
        return data_root
    if code_root is None:
        return None
    marker = code_root / ".career-ops-data"
    if marker.is_file():
        target = Path(marker.read_text(encoding="utf-8").strip())
        return target if target.is_absolute() else (code_root / target).resolve()
    return code_root


def _date(value: str | None) -> date | None:
    v = clean(value)
    if not v:
        return None
    try:
        return date.fromisoformat(v[:10])
    except ValueError:
        return None


# --- scan-history.tsv ---------------------------------------------------------------------


def read_scan_history(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        cells = line.split("\t")
        if cells[0] == "url":
            continue  # header (may be shorter than newer rows)
        rows.append(
            {
                name: (cells[i] if i < len(cells) else "")
                for i, name in enumerate(SCAN_HISTORY_COLUMNS)
            }
        )
    return rows


# --- pipeline.md --------------------------------------------------------------------------


@dataclass
class PipelineItem:
    url: str
    state: str  # PENDING | PROCESSED | EXPIRED | SKIPPED | BLOCKED
    company: str | None = None
    title: str | None = None
    location: str | None = None
    salary: str | None = None
    posted: date | None = None
    note: str | None = None
    report_num: str | None = None
    score: str | None = None


URL_RE = re.compile(r"https?://\S+")


def _pipe_fields(text: str) -> list[str]:
    return [p.strip() for p in text.split("|")]


def read_pipeline(path: Path) -> list[PipelineItem]:
    if not path.is_file():
        return []
    items: list[PipelineItem] = []
    section = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("#"):
            heading = line.lstrip("#").strip().lower()
            section = (
                "PENDING"
                if heading in PENDING_HEADINGS
                else "PROCESSED"
                if heading in PROCESSED_HEADINGS
                else section
            )
            continue
        m = re.match(r"^- \[([ xX!])\]\s*(.+)$", line)
        if not m or section is None:
            continue
        mark, body = m.group(1), m.group(2)
        url_m = URL_RE.search(body)
        if not url_m:
            continue
        if mark == "!":
            items.append(
                PipelineItem(
                    url=url_m.group(0).rstrip("~|"),
                    state="BLOCKED",
                    note=body.split("—", 1)[-1].strip(),
                )
            )
            continue
        if section == "PENDING" and mark == " ":
            parts = _pipe_fields(body)
            item = PipelineItem(url=parts[0], state="PENDING")
            rest = parts[1:]
            if rest:
                item.company = clean(rest[0])
            if len(rest) > 1:
                item.title = clean(rest[1])
            for extra in rest[2:]:
                low = extra.lower()
                if low.startswith("posted:"):
                    item.posted = _date(extra.split(":", 1)[1])
                elif low.startswith("note:"):
                    item.note = extra.split(":", 1)[1].strip()
                elif re.search(r"\d{4,}.*\b(inr|usd|eur|gbp|aed|sgd)\b|\$\d", extra, re.I):
                    item.salary = extra
                elif item.location is None:
                    item.location = clean(extra)
            items.append(item)
            continue
        # Processed variants.
        if "~~" in body:
            inner = body.split("~~")[1]
            parts = _pipe_fields(inner)
            items.append(
                PipelineItem(
                    url=parts[0],
                    state="EXPIRED",
                    company=clean(parts[1]) if len(parts) > 1 else None,
                    title=clean(parts[2]) if len(parts) > 2 else None,
                    note=body.split("~~")[-1].strip(" —-"),
                )
            )
            continue
        parts = _pipe_fields(body)
        num = parts[0].lstrip("#") if parts[0].startswith("#") else None
        if num == "--" or "skipped" in body.lower():
            items.append(
                PipelineItem(
                    url=url_m.group(0), state="SKIPPED", note=parts[-1] if len(parts) > 2 else None
                )
            )
            continue
        url_idx = next((i for i, p in enumerate(parts) if p.startswith("http")), 0)
        after = parts[url_idx + 1 :]
        items.append(
            PipelineItem(
                url=parts[url_idx],
                state="PROCESSED",
                report_num=num,
                company=clean(after[0]) if after else None,
                title=clean(after[1]) if len(after) > 1 else None,
                score=next((p for p in after if re.match(r"^\d(\.\d)?/5$", p)), None),
            )
        )
    return items


# --- applications.md ----------------------------------------------------------------------


@dataclass
class TrackerRow:
    num: str | None
    date: date | None
    company: str | None
    role: str | None
    score: str | None
    status: str | None
    report_path: str | None
    report_num: str | None
    notes: str | None
    url: str | None
    via: str | None
    location: str | None


def resolve_tracker(data_root: Path) -> Path:
    canonical = data_root / "data" / "applications.md"
    return canonical if canonical.is_file() else data_root / "applications.md"


def _cells(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def read_tracker(path: Path) -> list[TrackerRow]:
    if not path.is_file():
        return []
    columns: list[str] | None = None
    rows: list[TrackerRow] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = _cells(line)
        if columns is None:
            columns = [TRACKER_ALIASES.get(c.lower(), c.lower()) for c in cells]
            continue
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        rec = {columns[i]: cells[i] for i in range(min(len(columns), len(cells)))}
        report = rec.get("report") or ""
        link = re.search(r"\[(\w+)\]\(([^)]+)\)", report)
        rows.append(
            TrackerRow(
                num=clean(rec.get("num")),
                date=_date(rec.get("date")),
                company=clean(rec.get("company")),
                role=clean(rec.get("role")),
                score=clean(rec.get("score")),
                status=clean(rec.get("status")),
                report_path=link.group(2) if link else None,
                report_num=link.group(1) if link else None,
                notes=clean(rec.get("notes")),
                url=clean(rec.get("url")),
                via=clean(rec.get("via")),
                location=clean(rec.get("location")),
            )
        )
    return rows


# --- reports/*.md -------------------------------------------------------------------------


@dataclass
class Report:
    path: Path
    num: str | None
    company: str | None
    role: str | None
    date: date | None
    url: str | None
    score: float | None
    score_text: str | None
    archetype: str | None
    legitimacy: str | None
    work_auth: str | None
    via: str | None
    machine_summary: dict[str, Any] = field(default_factory=dict)
    jd_text: str | None = None
    jd_pointer: str | None = None


HEADER_RE = re.compile(r"^\*\*([^*:]+):\*\*\s*(.*)$")


def read_report(path: Path) -> Report:
    text = path.read_text(encoding="utf-8")
    num_m = re.match(r"^(\d+)-", path.name)
    title = re.search(
        r"^#\s+(?:Evaluation|Evaluaci[oó]n|Bewertung|[ÉE]valuation)?:?\s*(.+)$", text, re.MULTILINE
    )
    company = role = None
    if title:
        parts = re.split(r"\s+[—–-]\s+", title.group(1).strip(), maxsplit=1)
        company = parts[0].strip()
        role = parts[1].strip() if len(parts) > 1 else None
    headers: dict[str, str] = {}
    for line in text.splitlines()[:40]:
        if m := HEADER_RE.match(line.strip()):
            headers[m.group(1).strip().lower()] = m.group(2).strip()
    score_text = headers.get("score")
    score = None
    if score_text and (m := re.search(r"(\d+(?:\.\d+)?)\s*/\s*5", score_text)):
        score = float(m.group(1))
    summary: dict[str, Any] = {}
    ms = re.search(
        r"^## Machine Summary\s*\n.*?```ya?ml\s*\n(.*?)\n```", text, re.MULTILINE | re.DOTALL
    )
    if ms:
        try:
            loaded = yaml.safe_load(ms.group(1))
            # YAML may contain dates; keep the summary JSON-safe for storage.
            summary = (
                json.loads(json.dumps(loaded, default=str)) if isinstance(loaded, dict) else {}
            )
        except yaml.YAMLError:
            summary = {"_error": "Machine Summary YAML could not be parsed"}
    jd_text = jd_pointer = None
    jd = re.search(
        r"^## Job Description \(archived verbatim\)\s*\n(.*?)(?=^## |\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    if jd:
        body = jd.group(1).strip()
        if m := re.fullmatch(r"See (jds/\S+) for the full archive.*", body):
            jd_pointer = m.group(1)
        elif body:
            jd_text = body
    url = clean(headers.get("url"))
    return Report(
        path=path,
        num=num_m.group(1) if num_m else None,
        company=clean(summary.get("company")) or company,
        role=clean(summary.get("role")) or role,
        date=_date(headers.get("date")),
        url=url if url and url.startswith("http") else None,
        score=score,
        score_text=score_text,
        archetype=clean(headers.get("archetype")),
        legitimacy=clean(headers.get("legitimacy")),
        work_auth=clean(headers.get("work auth")),
        via=clean(headers.get("via")),
        machine_summary=summary,
        jd_text=jd_text,
        jd_pointer=jd_pointer,
    )


def read_reports(data_root: Path) -> list[Report]:
    folder = data_root / "reports"
    if not folder.is_dir():
        return []
    return [read_report(p) for p in sorted(folder.glob("*.md"))]


# --- jds/ captures ------------------------------------------------------------------------


def _slug_tokens(text: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", text.lower()) if len(t) > 2}


def find_jd_capture(
    data_root: Path,
    report: Report | None = None,
    company: str | None = None,
    role: str | None = None,
) -> tuple[str, str] | None:
    """(relative path, text) of the best jds/ capture for a report or company+role."""
    folder = data_root / "jds"
    if not folder.is_dir():
        return None
    files = [
        p
        for p in sorted(folder.iterdir())
        if p.is_file() and p.suffix in (".md", ".txt") and not p.name.startswith(".")
    ]
    if report and report.jd_pointer:
        p = data_root / report.jd_pointer
        if p.is_file() and p.resolve().is_relative_to(folder.resolve()):
            return report.jd_pointer, p.read_text(encoding="utf-8")
    if report and report.num:
        for p in files:
            if re.match(rf"^0*{int(report.num)}-", p.name):
                return f"jds/{p.name}", p.read_text(encoding="utf-8")
    company = company or (report.company if report else None)
    role = role or (report.role if report else None)
    if not company:
        return None
    ctoks = _slug_tokens(company)
    rtoks = _slug_tokens(role or "")
    best: tuple[int, Path] | None = None
    for p in files:
        name = _slug_tokens(p.stem)
        if not (name & ctoks):
            continue
        overlap = len(name & rtoks)
        if overlap >= 1 and (best is None or overlap > best[0]):
            best = (overlap, p)
    if best:
        return f"jds/{best[1].name}", best[1].read_text(encoding="utf-8")
    return None


def read_version(code_root: Path | None) -> str | None:
    if code_root and (code_root / "VERSION").is_file():
        return (code_root / "VERSION").read_text(encoding="utf-8").split("#")[0].strip()
    return None
