from datetime import date, timedelta
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.integrations.career_ops import service as co_service
from app.models.application import Application
from tests.fixtures import SAMPLE_CV
from tests.test_career_ops import make_career_ops

JD = "Requirements\n- 10+ years\n- PHP, Magento 2, Adobe Commerce, MySQL\nLocation: Remote India"


def setup(client: TestClient) -> tuple[dict[str, Any], int]:
    client.post(
        "/api/v1/cvs",
        data={"name": "Tech Lead CV", "target_role": "Technical Lead"},
        files={"file": ("cv.txt", SAMPLE_CV.encode(), "text/plain")},
    )
    cv = client.get("/api/v1/cvs").json()["items"][0]
    client.post("/api/v1/profile/import-cv", json={"cv_version_id": cv["current_version_id"]})
    job = client.post(
        "/api/v1/jobs",
        json={
            "title": "Technical Lead",
            "company": "Acme",
            "jd": JD,
            "recruiter_name": "Riya",
            "recruiter_email": "riya@acme.example",
        },
    ).json()["job"]
    return job, cv["current_version_id"]


def test_application_lifecycle(client: TestClient) -> None:
    job, cv_version = setup(client)
    client.post(f"/api/v1/jobs/{job['id']}/status", json={"status": "SHORTLISTED"})
    r = client.post(
        "/api/v1/applications",
        json={
            "job_id": job["id"],
            "method": "COMPANY_SITE",
            "expected_salary": 4000000,
            "salary_currency": "inr",
            "notice_period_days": 60,
            "notes": "Applied on careers page",
        },
    )
    assert r.status_code == 201, r.text
    app = r.json()
    assert app["cv_version_id"] == cv_version  # recommended CV used by default
    assert app["cv_name"] == "Tech Lead CV v1"
    assert app["recruiter_name"] == "Riya"  # carried over from the job
    assert app["follow_up_date"] == str(date.today() + timedelta(days=7))
    assert app["salary_currency"] == "INR"
    assert client.get(f"/api/v1/jobs/{job['id']}").json()["status"] == "APPLIED"

    fus = client.get("/api/v1/followups").json()
    assert fus["total"] == 1 and fus["items"][0]["kind"] == "APPLICATION"

    dup = client.post("/api/v1/applications", json={"job_id": job["id"]})
    assert dup.status_code == 409  # one open application per job

    r = client.post(
        f"/api/v1/applications/{app['id']}/status",
        json={"status": "SCREENING", "note": "HR call booked"},
    )
    assert r.json()["status"] == "SCREENING"
    assert client.get(f"/api/v1/jobs/{job['id']}").json()["status"] == "SCREENING"
    r = client.post(f"/api/v1/applications/{app['id']}/notes", json={"note": "Sent portfolio"})
    events = [(e["event_type"], e["to_status"]) for e in r.json()["events"]]
    assert events == [("CREATED", "APPLIED"), ("STATUS_CHANGED", "SCREENING"), ("NOTE", None)]

    r = client.post(f"/api/v1/applications/{app['id']}/status", json={"status": "REJECTED"})
    assert r.json()["status"] == "REJECTED"
    assert client.get("/api/v1/followups").json()["total"] == 0  # closed with the application
    assert client.get("/api/v1/followups", params={"completed": True}).json()["total"] == 1

    listed = client.get("/api/v1/applications", params={"status": ["REJECTED"]}).json()
    assert listed["total"] == 1 and listed["items"][0]["job_title"] == "Technical Lead"
    assert client.get("/api/v1/jobs", params={"has_application": True}).json()["total"] == 1
    assert client.get("/api/v1/jobs", params={"has_application": False}).json()["total"] == 0
    # After rejection a new application is allowed again.
    assert client.post("/api/v1/applications", json={"job_id": job["id"]}).status_code == 201


def test_application_validation(client: TestClient) -> None:
    job, _ = setup(client)
    assert client.post("/api/v1/applications", json={"job_id": 999}).status_code == 404
    bad = client.post("/api/v1/applications", json={"job_id": job["id"], "cv_version_id": 999})
    assert bad.status_code == 422
    app = client.post("/api/v1/applications", json={"job_id": job["id"]}).json()
    r = client.patch(f"/api/v1/applications/{app['id']}", json={"status": "OFFER"})
    assert r.status_code in (200, 422)  # status is not a PATCH field
    assert client.get(f"/api/v1/applications/{app['id']}").json()["status"] == "APPLIED"


def test_followups_crud(client: TestClient) -> None:
    job, _ = setup(client)
    yesterday = date.today() - timedelta(days=1)
    r = client.post(
        "/api/v1/followups",
        json={
            "kind": "RECRUITER",
            "title": "Ping Riya",
            "due_date": str(yesterday),
            "job_id": job["id"],
        },
    )
    assert r.status_code == 201
    f = r.json()
    assert f["overdue"] is True and f["company_name"] == "Acme"
    assert (
        client.get("/api/v1/followups", params={"due_before": str(date.today())}).json()["total"]
        == 1
    )
    done = client.post(f"/api/v1/followups/{f['id']}/complete", json={"note": "Replied"}).json()
    assert done["completed"] is True and "Replied" in done["notes"]
    moved = client.patch(f"/api/v1/followups/{f['id']}", json={"due_date": str(date.today())})
    assert moved.json()["due_date"] == str(date.today())


def test_career_ops_applied_rows_become_applications(
    tmp_path: Path, db: Session, settings: Settings
) -> None:
    root = make_career_ops(tmp_path / "co")
    run = co_service.import_from_career_ops(
        db, settings.model_copy(update={"career_ops_path": root})
    )
    assert run.stats["applications"] == 1
    app = db.query(Application).one()
    assert app.origin == "career_ops" and app.status == "APPLIED"
    assert app.applied_on == date(2026, 10, 1)
    again = co_service.import_from_career_ops(
        db, settings.model_copy(update={"career_ops_path": root})
    )
    assert again.stats["applications"] == 0 and db.query(Application).count() == 1
