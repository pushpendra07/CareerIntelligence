"""Test fixtures.

Tests run against real PostgreSQL. Set TEST_DATABASE_URL to use your own server; otherwise
the dev `pgserver` (scripts/devdb.py) starts a local one with a dedicated test database.
The schema is rebuilt with Alembic once per session; every test runs inside a transaction
that is rolled back.
"""

import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.main import create_app
from app.storage.backend import LocalStorage, get_storage

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _test_database_url() -> str:
    if url := os.environ.get("TEST_DATABASE_URL"):
        return url
    sys.path.insert(0, str(BACKEND_DIR / "scripts"))
    from devdb import start

    return start("career_intelligence_test")


@pytest.fixture(scope="session")
def database_url() -> str:
    return _test_database_url()


@pytest.fixture(scope="session")
def engine(database_url: str) -> Iterator[Engine]:
    engine = create_engine(database_url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")
    yield engine
    engine.dispose()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    with engine.connect() as conn:
        trans = conn.begin()
        session = Session(bind=conn, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            session.close()
            trans.rollback()


@pytest.fixture
def settings(database_url: str) -> Settings:
    # _env_file=None: tests must not depend on the developer's backend/.env.
    return Settings(  # type: ignore[call-arg]
        _env_file=None, environment="test", database_url=database_url, log_format="text"
    )


@pytest.fixture
def storage(tmp_path: Path) -> LocalStorage:
    return LocalStorage(tmp_path / "storage")


@pytest.fixture
def client(db: Session, settings: Settings, storage: LocalStorage) -> Iterator[TestClient]:
    app = create_app(settings)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True, scope="session")
def _verbose_logging() -> None:
    """Log at DEBUG during tests so every logger call (and its `extra`) is exercised."""
    from app.core.logging import configure_logging

    configure_logging("DEBUG", "text")
