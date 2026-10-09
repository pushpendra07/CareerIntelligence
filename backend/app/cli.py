"""Command-line tasks.

    uv run python -m app.cli import-companies --research-csv PATH --myjob-db PATH \
        --career-ops PATH
"""

import argparse
import json
import sys
from pathlib import Path

from app.companies.importers import read_career_ops_portals, read_myjob_db, read_research_csv
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import get_sessionmaker
from app.services.company_service import company_stats, import_records


def import_companies(args: argparse.Namespace) -> int:
    with get_sessionmaker()() as db:
        results = []
        if args.research_csv:
            results.append(
                import_records(db, read_research_csv(Path(args.research_csv)), "jobsearch_csv")
            )
        if args.career_ops:
            portals = Path(args.career_ops) / "portals.yml"
            results.append(
                import_records(db, read_career_ops_portals(portals), "career_ops_portals")
            )
        if args.myjob_db:
            results.append(import_records(db, read_myjob_db(Path(args.myjob_db)), "myjob_db"))
        for r in results:
            print(json.dumps(vars(r)))
        print(json.dumps(company_stats(db), default=str))
    return 0


def main(argv: list[str] | None = None) -> int:
    settings = get_settings()
    configure_logging("WARNING", settings.log_format)
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("import-companies", help="Import companies from local research sources")
    p.add_argument("--research-csv", help="jobsearch master CSV (45-column research format)")
    p.add_argument("--myjob-db", help="myjob portal SQLite file (read-only)")
    p.add_argument(
        "--career-ops",
        help="Career-Ops checkout (reads portals.yml)",
        default=str(settings.career_ops_data_root or "") or None,
    )
    p.set_defaults(func=import_companies)
    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result


if __name__ == "__main__":
    sys.exit(main())
