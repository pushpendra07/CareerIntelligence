"""Backups: one zip per backup in BACKUP_PATH (default backend/backups/, git-ignored).

Each zip holds
- `database.dump` — a full PostgreSQL dump (`pg_dump -Fc`; restore with
  `scripts/restore-backup.sh`), when pg_dump is available,
- `data.json` — every table the app exports, readable without PostgreSQL,
- `storage/…` — uploaded CVs and documents,
- `manifest.json` — when, which schema version, row counts, what's inside.

Automatic backups run every `every_hours` (Settings → Backup & import) while the app runs;
the newest `keep` zips are kept. Only one backup runs at a time.
"""

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.services import data_io

logger = logging.getLogger(__name__)

DEFAULTS: dict[str, Any] = {"enabled": True, "every_hours": 24, "keep": 14}
NAME_RE = re.compile(r"^career-backup-\d{8}-\d{6}\.zip$")
CHECK_EVERY_SECONDS = 600
_lock = threading.Lock()


def validate_settings(values: dict[str, Any]) -> dict[str, Any]:
    out = {**DEFAULTS, **values}
    if not isinstance(out["enabled"], bool):
        raise DomainValidationError("backups.enabled must be true or false")
    for key, lo, hi in (("every_hours", 1, 24 * 30), ("keep", 1, 365)):
        v = out[key]
        if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
            raise DomainValidationError(f"backups.{key} must be a whole number {lo}–{hi}")
    return out


def backup_dir(settings: Settings) -> Path:
    path = settings.backup_path
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path  # relative to backend/
    path.mkdir(parents=True, exist_ok=True)
    return path


def pg_dump_path() -> str | None:
    """pg_dump on PATH, else the one bundled with the embedded dev PostgreSQL."""
    if found := shutil.which("pg_dump"):
        return found
    try:
        import pgserver

        bundled = Path(pgserver.__file__).parent / "pginstall" / "bin" / "pg_dump"
        return str(bundled) if bundled.exists() else None
    except ImportError:
        return None


def _libpq_args(database_url: str) -> tuple[list[str], dict[str, str]]:
    url = make_url(database_url)
    args = ["-d", url.database or ""]
    host = url.host or str(url.query.get("host") or "")
    if host:
        args += ["-h", host]
    if url.port:
        args += ["-p", str(url.port)]
    if url.username:
        args += ["-U", url.username]
    env = {"PATH": os.environ.get("PATH", ""), "LANG": "C"}
    if url.password:
        env["PGPASSWORD"] = url.password
    return args, env


def _dump_database(settings: Settings, target: Path) -> str | None:
    """Write a pg_dump custom-format file; returns why not, or None when it worked."""
    exe = pg_dump_path()
    if not exe:
        return "pg_dump not found: only data.json and files were saved"
    args, env = _libpq_args(settings.database_url)
    proc = subprocess.run(  # noqa: S603 - fixed executable and arguments, no shell
        [exe, "-Fc", "--no-owner", "--no-privileges", "-f", str(target), *args],
        env=env, capture_output=True, text=True, timeout=600, check=False,
    )
    if proc.returncode != 0:
        return f"pg_dump failed: {proc.stderr.strip()[:300]}"
    return None


def _storage_dir(settings: Settings) -> Path:
    path = settings.storage_path
    return path if path.is_absolute() else Path(__file__).resolve().parents[2] / path


def create_backup(db: Session, settings: Settings, trigger: str = "manual") -> dict[str, Any]:
    if not _lock.acquire(blocking=False):
        raise ConflictError("A backup is already running")
    try:
        now = datetime.now(UTC)
        name = f"career-backup-{now.astimezone().strftime('%Y%m%d-%H%M%S')}.zip"
        out = backup_dir(settings) / name
        data = data_io.export_all(db)
        counts = {e: len(rows) for e, rows in json.loads(data).items()}
        schema = db.scalar(text("select version_num from alembic_version limit 1"))
        with tempfile.TemporaryDirectory() as tmp:
            dump = Path(tmp) / "database.dump"
            problem = _dump_database(settings, dump)
            files = 0
            with zipfile.ZipFile(out.with_suffix(".part"), "w", zipfile.ZIP_DEFLATED) as z:
                if problem is None:
                    z.write(dump, "database.dump")
                z.writestr("data.json", data)
                storage = _storage_dir(settings)
                if storage.is_dir():
                    for f in sorted(storage.rglob("*")):
                        if f.is_file():
                            z.write(f, f"storage/{f.relative_to(storage)}")
                            files += 1
                manifest = {
                    "created_at": now.isoformat(), "trigger": trigger, "schema_version": schema,
                    "database_dump": problem is None, "note": problem, "files": files,
                    "rows": counts,
                }
                z.writestr("manifest.json", json.dumps(manifest, indent=2))
        out.with_suffix(".part").rename(out)
        out.chmod(0o600)  # holds your CVs and data: readable by you only
        logger.info("backup written", extra={"backup": name, "trigger": trigger})
        prune(settings, int(current_settings(db)["keep"]))
        return describe(out)
    finally:
        _lock.release()


def describe(path: Path) -> dict[str, Any]:
    manifest: dict[str, Any] = {}
    try:
        with zipfile.ZipFile(path) as z:
            manifest = json.loads(z.read("manifest.json"))
    except (KeyError, zipfile.BadZipFile, json.JSONDecodeError):
        pass
    return {
        "name": path.name, "size": path.stat().st_size,
        "created_at": manifest.get("created_at")
        or datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(),
        "trigger": manifest.get("trigger"), "database_dump": manifest.get("database_dump"),
        "note": manifest.get("note"), "files": manifest.get("files"),
        "rows": sum((manifest.get("rows") or {}).values()) or None,
    }


def list_backups(settings: Settings) -> list[dict[str, Any]]:
    paths = sorted((p for p in backup_dir(settings).iterdir() if NAME_RE.match(p.name)),
                   key=lambda p: p.name, reverse=True)
    return [describe(p) for p in paths]


def backup_file(settings: Settings, name: str) -> Path:
    if not NAME_RE.match(name):  # also blocks ../ paths
        raise NotFoundError("No such backup")
    path = backup_dir(settings) / name
    if not path.is_file():
        raise NotFoundError("No such backup")
    return path


def prune(settings: Settings, keep: int) -> list[str]:
    old = [b["name"] for b in list_backups(settings)][keep:]
    for name in old:
        (backup_dir(settings) / name).unlink(missing_ok=True)
    return old


def current_settings(db: Session) -> dict[str, Any]:
    from app.models.app_settings import AppSettings as AppSettingsRow

    row = db.get(AppSettingsRow, 1)
    return {**DEFAULTS, **((row.data if row else {}).get("backups") or {})}


def status(db: Session, settings: Settings) -> dict[str, Any]:
    backups = list_backups(settings)
    cfg = current_settings(db)
    last = backups[0]["created_at"] if backups else None
    due = None
    if cfg["enabled"]:
        due = (datetime.fromisoformat(last) + timedelta(hours=cfg["every_hours"])).isoformat() \
            if last else datetime.now(UTC).isoformat()
    return {"settings": cfg, "folder": str(backup_dir(settings)),
            "pg_dump": pg_dump_path() is not None, "last": last, "next_due": due,
            "running": _lock.locked(), "backups": backups}


def _due(db: Session, settings: Settings) -> bool:
    cfg = current_settings(db)
    if not cfg["enabled"]:
        return False
    backups = list_backups(settings)
    if not backups:
        return True
    last = datetime.fromisoformat(backups[0]["created_at"])
    return last < datetime.now(UTC) - timedelta(hours=int(cfg["every_hours"]))


def _loop(stop: threading.Event, settings: Settings) -> None:
    from app.db.session import get_sessionmaker

    # Check soon after start (a backup missed while the app was closed), then every 10 min.
    wait = 60.0
    while not stop.wait(wait):
        wait = CHECK_EVERY_SECONDS
        try:
            with get_sessionmaker()() as db:
                if _due(db, settings):
                    create_backup(db, settings, trigger="schedule")
        except ConflictError:
            pass
        except Exception:
            logger.exception("scheduled backup failed")


def start_scheduler(settings: Settings) -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=_loop, args=(stop, settings), name="backup-scheduler",
                     daemon=True).start()
    return stop
