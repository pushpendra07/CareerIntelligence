"""Local development PostgreSQL without installing anything system-wide.

Starts (or reuses) a PostgreSQL 16 server from the `pgserver` dev package, with its data in
backend/.devdb/, creates the requested database if missing, and prints a DATABASE_URL.

    uv run python scripts/devdb.py                 # prints the URL for career_intelligence
    uv run python scripts/devdb.py --db mytest     # another database
    uv run python scripts/devdb.py --stop          # stop the server

Only for development and tests; Docker Compose or any regular PostgreSQL works the same way.
"""

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pgserver

DATA_DIR = Path(__file__).resolve().parent.parent / ".devdb" / "pgdata"
DEFAULT_DB = "career_intelligence"


def start(db_name: str = DEFAULT_DB) -> str:
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", db_name):
        raise ValueError(f"invalid database name: {db_name!r}")
    DATA_DIR.parent.mkdir(parents=True, exist_ok=True)
    server = pgserver.get_server(DATA_DIR, cleanup_mode=None)
    # db_name is validated against a strict identifier regex above.
    exists = server.psql(f"SELECT 1 FROM pg_database WHERE datname = '{db_name}';")  # noqa: S608
    if "(1 row)" not in exists:
        server.psql(f"CREATE DATABASE {db_name};")
    host = parse_qs(urlparse(server.get_uri()).query)["host"][0]
    return f"postgresql+psycopg://postgres@/{db_name}?host={host}"


def stop() -> None:
    pgserver.get_server(DATA_DIR, cleanup_mode="stop").cleanup()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--stop", action="store_true")
    args = parser.parse_args()
    if args.stop:
        stop()
        print("stopped")
    else:
        print(start(args.db))
    return 0


if __name__ == "__main__":
    sys.exit(main())
