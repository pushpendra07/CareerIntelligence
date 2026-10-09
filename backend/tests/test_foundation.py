import json
import logging

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import NotFoundError
from app.core.logging import JsonFormatter
from app.core.pagination import PageParams, paginate
from app.models.activity_log import ActivityLog
from app.services.activity import record_activity


def test_liveness(client: TestClient) -> None:
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert r.headers["X-Request-ID"]


def test_request_id_is_propagated(client: TestClient) -> None:
    r = client.get("/api/v1/health", headers={"X-Request-ID": "abc123"})
    assert r.headers["X-Request-ID"] == "abc123"


def test_readiness_reports_migration(client: TestClient) -> None:
    r = client.get("/api/v1/health/ready")
    body = r.json()
    assert r.status_code == 200
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["migration"]


def test_unknown_route_uses_error_shape(client: TestClient) -> None:
    r = client.get("/api/v1/does-not-exist")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_app_error_and_unhandled_error_shapes(client: TestClient) -> None:
    router = APIRouter()

    @router.get("/boom-app")
    def boom_app() -> None:
        raise NotFoundError("Job 7 not found", {"id": 7})

    @router.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret internals")

    client.app.include_router(router)  # type: ignore[attr-defined]
    r = client.get("/boom-app")
    assert r.status_code == 404
    assert r.json() == {
        "error": {"code": "not_found", "message": "Job 7 not found", "details": {"id": 7}}
    }

    no_raise = TestClient(client.app, raise_server_exceptions=False)
    r = no_raise.get("/boom")
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "internal_error"
    assert "secret internals" not in r.text


def test_activity_log_and_pagination(db: Session) -> None:
    for i in range(5):
        record_activity(db, "job.scored", "job", i, summary=f"scored {i}", data={"score": 80 + i})
    db.flush()
    stmt = select(ActivityLog).order_by(ActivityLog.entity_id)
    rows, total = paginate(db, stmt, PageParams(page=2, size=2))
    assert total == 5
    assert [r.entity_id for r in rows] == [2, 3]
    assert rows[0].data == {"score": 82}


def test_cors_origins_from_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test")
    assert Settings().cors_origins == ["http://a.test", "http://b.test"]


def test_json_logs_redact_secrets() -> None:
    record = logging.makeLogRecord(
        {"msg": "calling provider", "levelname": "INFO", "name": "t", "ai_api_key": "sk-123"}
    )
    out = json.loads(JsonFormatter().format(record))
    assert out["ai_api_key"] == "***"
    assert out["msg"] == "calling provider"
