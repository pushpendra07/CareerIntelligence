#!/usr/bin/env python3
"""Work queue for researching every company (docs/prompts/update-company-details.md).

Reads all companies from the running app's API, works out what each one is missing, and keeps a
progress ledger so an agent can stop and resume across sessions without redoing companies.

    python3 scripts/company_queue.py next [--count 20]   # next companies to research
    python3 scripts/company_queue.py log ID OUTCOME "note"  # record a finished company
    python3 scripts/company_queue.py status              # totals: done, left, by status

OUTCOME is one of DONE (researched and saved), SKIPPED (couldn't identify the company or no
official source; say why), NEEDS_USER (the user must decide: acquired, closed, duplicate…).
Files (git-ignored): scratch/company-queue.tsv, scratch/company-progress.tsv.
Standard library only; never writes to the app.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

API = os.environ.get("API", "http://127.0.0.1:8010/api/v1")
ROOT = Path(__file__).resolve().parent.parent
SCRATCH = ROOT / "scratch"
QUEUE = SCRATCH / "company-queue.tsv"
LEDGER = SCRATCH / "company-progress.tsv"
LEDGER_HEAD = ["id", "name", "date", "before", "after", "score", "outcome", "note"]
OUTCOMES = {"DONE", "SKIPPED", "NEEDS_USER"}

FIELDS = ["website", "careers_url", "linkedin_url", "headquarters", "industry", "employee_range"]
# Worst first inside each priority group.
STATUS_ORDER = ["NEEDS_REVIEW", "STALE", "DISCOVERED", "RESEARCHED", "PARTIALLY_VERIFIED",
                "VERIFIED"]
NOT_TOUCHED = {"REJECTED", "INVALID"}  # set by the user


def get(path: str, **params: object) -> dict:
    url = f"{API}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    if not url.startswith(("http://", "https://")):
        sys.exit(f"API must be an http(s) URL, not {API}")
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 (checked above)
            return json.loads(resp.read())
    except OSError as exc:
        sys.exit(f"Can't reach the app at {API} ({exc}). Start it with ./start.sh --no-open")


def all_companies() -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        data = get("/companies", size=200, page=page, sort="id")
        out += data["items"]
        if not data["items"] or len(out) >= data["total"]:
            return out
        page += 1


def missing(c: dict) -> list[str]:
    gaps = [f for f in FIELDS if not c.get(f)]
    if c.get("india_presence") is None:
        gaps.append("india")
    return gaps


def group(c: dict) -> int:
    """0 = job search on, 1 = has jobs, 2 = tiered, 3 = everything else."""
    if c.get("job_search_enabled"):
        return 0
    if c.get("job_count"):
        return 1
    return 2 if c.get("tier") else 3


def read_ledger() -> dict[str, dict]:
    if not LEDGER.exists():
        return {}
    with LEDGER.open(newline="") as fh:
        return {row["id"]: row for row in csv.DictReader(fh, delimiter="\t")}


def build_queue() -> list[dict]:
    done = read_ledger()
    rows = []
    for c in all_companies():
        status = c["verification_status"]
        gaps = missing(c)
        if status in NOT_TOUCHED or str(c["id"]) in done:
            continue
        if status == "VERIFIED" and not gaps:
            continue  # nothing left to find
        rows.append({
            "id": c["id"], "name": c["name"], "status": status, "score": c["verification_score"],
            "group": group(c), "jobs": f"{c.get('open_job_count', 0)}/{c.get('job_count', 0)}",
            "tier": c.get("tier") or "-", "missing": ", ".join(gaps) or "nothing",
            "website": c.get("website") or "",
            # Verified companies only miss small details: they come after everything else.
            "_sort": (status == "VERIFIED", group(c), STATUS_ORDER.index(status)
                      if status in STATUS_ORDER else 0, -(c.get("open_job_count") or 0),
                      -(c.get("job_count") or 0), c["name"].lower()),
        })
    rows.sort(key=lambda r: r["_sort"])
    SCRATCH.mkdir(exist_ok=True)
    cols = ["id", "name", "status", "score", "group", "jobs", "tier", "missing", "website"]
    with QUEUE.open("w", newline="") as fh:
        w = csv.DictWriter(fh, cols, delimiter="\t", extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return rows


def cmd_next(count: int) -> None:
    rows = build_queue()
    shown = min(count, len(rows))
    print(f"{len(rows)} companies left (full list: {QUEUE.relative_to(ROOT)}). Next {shown}:")
    for r in rows[:count]:
        print(f"{r['id']} | {r['name']} | {r['status']} {r['score']} | jobs {r['jobs']} | "
              f"{r['tier']} | missing: {r['missing']} | {r['website'] or 'no website'}")


def cmd_log(company_id: int, outcome: str, note: str) -> None:
    outcome = outcome.upper()
    if outcome not in OUTCOMES:
        sys.exit(f"OUTCOME must be one of {sorted(OUTCOMES)}")
    if outcome != "DONE" and not note.strip():
        sys.exit("Say why in the note for SKIPPED / NEEDS_USER")
    before = ""
    if QUEUE.exists():
        with QUEUE.open(newline="") as fh:
            rows = csv.DictReader(fh, delimiter="\t")
            before = next((r["status"] for r in rows if r["id"] == str(company_id)), "")
    c = get(f"/companies/{company_id}")
    new = not LEDGER.exists()
    SCRATCH.mkdir(exist_ok=True)
    with LEDGER.open("a", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        if new:
            w.writerow(LEDGER_HEAD)
        w.writerow([company_id, c["name"], date.today().isoformat(), before,
                    c["verification_status"], c["verification_score"], outcome,
                    " ".join(note.split())])
    print(f"Logged {company_id} {c['name']}: {before or '?'} -> {c['verification_status']} "
          f"{c['verification_score']} ({outcome})")


def cmd_status() -> None:
    stats = get("/companies/stats")
    ledger = read_ledger()
    rows = build_queue()
    by_outcome: dict[str, int] = {}
    for r in ledger.values():
        by_outcome[r["outcome"]] = by_outcome.get(r["outcome"], 0) + 1
    print(f"Companies: {stats['total']} · by status: {stats['by_verification_status']}")
    print(f"Ledger: {len(ledger)} logged {by_outcome} · queue: {len(rows)} left")
    groups = ["job search on", "has jobs", "tiered", "other"]
    for g, label in enumerate(groups):
        print(f"  {label}: {sum(1 for r in rows if r['group'] == g)}")


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("next")
    n.add_argument("--count", type=int, default=20)
    lg = sub.add_parser("log")
    lg.add_argument("id", type=int)
    lg.add_argument("outcome")
    lg.add_argument("note", nargs="?", default="")
    sub.add_parser("status")
    args = ap.parse_args()
    if args.cmd == "next":
        cmd_next(args.count)
    elif args.cmd == "log":
        cmd_log(args.id, args.outcome, args.note)
    else:
        cmd_status()


if __name__ == "__main__":
    main()
