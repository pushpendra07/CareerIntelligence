from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.main import create_app


def test_fresh_install_needs_setup_until_finished(client: TestClient) -> None:
    s = client.get("/api/v1/setup").json()
    assert s["needs_setup"] is True and s["completed_at"] is None
    assert s["steps"] == {"cv": False, "targets": False, "companies": False, "jobs": False}

    client.patch("/api/v1/preferences", json={"target_titles": ["Backend Engineer"]})
    assert client.get("/api/v1/setup").json()["steps"]["targets"] is True

    done = client.post("/api/v1/setup/complete").json()
    assert done["needs_setup"] is False and done["completed_at"]


def test_an_install_with_jobs_never_opens_setup(client: TestClient) -> None:
    job = {"title": "Backend Engineer", "company": "Acme", "jd": "Build APIs in Python. " * 5}
    assert client.post("/api/v1/jobs", json=job).status_code in (200, 201)
    s = client.get("/api/v1/setup").json()
    assert s["needs_setup"] is False and s["steps"]["jobs"] is True


def test_add_companies_by_careers_url(client: TestClient) -> None:
    res = client.post("/api/v1/setup/companies", json={"companies": [
        {"url": "https://boards.greenhouse.io/acme-labs"},
        {"url": "https://jobs.lever.co/widgetco", "name": "Widget Co"},
        {"url": "https://www.example.org/careers"},
        {"url": "not a url"},
    ]})
    assert res.status_code == 200
    gh, lever, own, bad = res.json()
    assert gh["name"] == "Acme Labs" and gh["board"]["provider"] == "GREENHOUSE" and gh["created"]
    assert lever["name"] == "Widget Co" and lever["board"]["provider"] == "LEVER"
    assert own["name"] == "Example" and own["board"] is None  # saved, but not scannable yet
    assert "error" in bad
    company = client.get(f"/api/v1/companies/{gh['company_id']}").json()
    assert company["job_search_enabled"] is True
    assert client.get("/api/v1/setup").json()["counts"]["scannable_companies"] == 2

    # The same company again: updated, not duplicated.
    again = client.post("/api/v1/setup/companies", json={"companies": [
        {"url": "https://boards.greenhouse.io/acme-labs"}]}).json()
    assert again[0]["company_id"] == gh["company_id"] and again[0]["created"] is False
    assert client.post("/api/v1/setup/companies", json={"companies": []}).status_code == 422


def test_serves_the_built_ui_on_the_same_port(
    tmp_path: Path, settings: Settings, db: Session
) -> None:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<div id=root></div>")
    (tmp_path / "assets" / "app-1a2b.js").write_text("console.log(1)")
    settings.static_dir = tmp_path
    with TestClient(create_app(settings)) as c:
        home = c.get("/")
        assert home.text == "<div id=root></div>"
        assert home.headers["x-frame-options"] == "DENY"
        assert home.headers["x-content-type-options"] == "nosniff"
        page = c.get("/jobs/42")  # a page of the UI: index.html, the UI routes it
        assert page.text == "<div id=root></div>" and page.headers["cache-control"] == "no-cache"
        asset = c.get("/assets/app-1a2b.js")
        assert asset.text == "console.log(1)" and "immutable" in asset.headers["cache-control"]
        assert c.get("/api/v1/nope").status_code == 404
        assert c.get("/api/v1/nope").headers["content-type"].startswith("application/json")
        assert c.get("/../secret").text == "<div id=root></div>"  # never outside the folder
