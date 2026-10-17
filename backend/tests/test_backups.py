import json
import zipfile
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.services import backup_service


def test_backup_now_list_download_and_settings(
    client: TestClient, settings: Settings, tmp_path: Path
) -> None:
    settings.backup_path = tmp_path / "backups"
    client.post("/api/v1/jobs", json={"title": "Tech Lead", "company": "Acme", "jd": "PHP"})
    made = client.post("/api/v1/backups")
    assert made.status_code == 201, made.text
    b = made.json()
    assert backup_service.NAME_RE.match(b["name"]) and b["trigger"] == "manual"
    # Without pg_dump the zip still holds data.json and says why there's no dump.
    assert b["database_dump"] is True or "pg_dump" in (b["note"] or "")

    status = client.get("/api/v1/backups").json()
    assert [x["name"] for x in status["backups"]] == [b["name"]]
    assert status["settings"] == {"enabled": True, "every_hours": 24, "keep": 14}

    zipped = client.get(f"/api/v1/backups/{b['name']}")
    assert zipped.status_code == 200
    with zipfile.ZipFile(BytesIO(zipped.content)) as z:
        names = set(z.namelist())
        assert {"data.json", "manifest.json"} <= names
        data = json.loads(z.read("data.json"))
        assert [j["title"] for j in data["jobs"]] == ["Tech Lead"]
        assert json.loads(z.read("manifest.json"))["rows"]["jobs"] == 1
    assert client.get("/api/v1/backups/..%2F..%2Fsecret.zip").status_code == 404
    assert client.get("/api/v1/backups/other.zip").status_code == 404

    ok = client.patch("/api/v1/settings/app", json={"backups": {"every_hours": 6, "keep": 3}})
    assert ok.json()["backups"] == {"enabled": True, "every_hours": 6, "keep": 3}
    bad = client.patch("/api/v1/settings/app", json={"backups": {"keep": 0}})
    assert bad.status_code == 422


def test_prune_keeps_the_newest(settings: Settings, tmp_path: Path) -> None:
    settings.backup_path = tmp_path
    for stamp in ("20261001-010000", "20261002-010000", "20261003-010000"):
        (tmp_path / f"career-backup-{stamp}.zip").write_bytes(b"x")
    (tmp_path / "notes.txt").write_text("not a backup")
    removed = backup_service.prune(settings, keep=2)
    assert removed == ["career-backup-20261001-010000.zip"]
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "career-backup-20261002-010000.zip", "career-backup-20261003-010000.zip", "notes.txt"]


def test_libpq_args_from_url() -> None:
    args, env = backup_service._libpq_args(
        "postgresql+psycopg://career:s3cret@db.local:5433/career_intelligence")
    assert args == ["-d", "career_intelligence", "-h", "db.local", "-p", "5433", "-U", "career"]
    assert env["PGPASSWORD"] == "s3cret"
    args, _ = backup_service._libpq_args("postgresql+psycopg://postgres@/ci?host=/var/run/postgresql")
    assert args == ["-d", "ci", "-h", "/var/run/postgresql", "-U", "postgres"]
