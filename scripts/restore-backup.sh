#!/usr/bin/env bash
# Restore a backup made by the app (Settings → Backup & import, or backend/backups/*.zip).
#
#   ./scripts/restore-backup.sh backend/backups/career-backup-20261017-090000.zip
#
# Replaces ALL data in the database with the backup's, and copies its uploaded files back
# into the storage folder. Stop the app first (./stop.sh --keep-db keeps the database running).
# Uses DATABASE_URL if set, otherwise the embedded dev database (scripts/devdb.py).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="${1:-}"
[[ -f "$ZIP" ]] || { echo "Usage: $0 <backup.zip>" >&2; exit 1; }
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"

if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${BACKEND_PORT:-8010}/api/v1/health"; then
  echo "The app is running. Stop it first: ./stop.sh --keep-db" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q "$ZIP" -d "$TMP"
[[ -f "$TMP/manifest.json" ]] || { echo "Not an app backup (no manifest.json)." >&2; exit 1; }
echo "Backup:"; sed -n '1,12p' "$TMP/manifest.json"
[[ -f "$TMP/database.dump" ]] || {
  echo "This backup has no database dump (pg_dump was missing). Import data.json instead:" >&2
  echo "Settings → Backup & import → Import a file (jobs, recruiters)." >&2
  exit 1
}

cd "$ROOT/backend"
URL="${DATABASE_URL:-$(uv run python scripts/devdb.py 2>/dev/null | tail -1)}"
read -r -p "Replace ALL current data with this backup? Type 'restore' to continue: " answer
[[ "$answer" == "restore" ]] || { echo "Cancelled."; exit 1; }

uv run python - "$URL" "$TMP" <<'PY'
import os, shutil, subprocess, sys
from pathlib import Path
from app.services.backup_service import _libpq_args, pg_dump_path

url, tmp = sys.argv[1], Path(sys.argv[2])
dump = pg_dump_path()
if not dump:
    sys.exit("pg_restore not found")
restore = str(Path(dump).with_name("pg_restore"))
args, env = _libpq_args(url)
proc = subprocess.run([restore, "--clean", "--if-exists", "--no-owner", "--no-privileges",
                       "--single-transaction", *args, str(tmp / "database.dump")],
                      env=env, capture_output=True, text=True)
if proc.returncode != 0:
    sys.exit(f"pg_restore failed:\n{proc.stderr[-2000:]}")
storage = Path(os.environ.get("STORAGE_PATH", "storage"))
if (tmp / "storage").is_dir():
    shutil.copytree(tmp / "storage", storage, dirs_exist_ok=True)
print("Restored. Start the app: ./start.sh")
PY
