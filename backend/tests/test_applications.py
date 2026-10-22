import json
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


def test_chosen_applied_date(client: TestClient) -> None:
    job, _ = setup(client)
    tomorrow = date.today() + timedelta(days=1)
    url = "/api/v1/applications"
    future = client.post(url, json={"job_id": job["id"], "applied_on": str(tomorrow)})
    assert future.status_code == 422 and "future" in future.json()["error"]["message"]

    earlier = date.today() - timedelta(days=10)
    app = client.post(url, json={"job_id": job["id"], "applied_on": str(earlier)})
    assert app.status_code == 201
    assert app.json()["applied_on"] == str(earlier)
    assert app.json()["follow_up_date"] == str(earlier + timedelta(days=7))  # a week after
    assert client.get(f"/api/v1/jobs/{job['id']}").json()["status"] == "APPLIED"

    patch = client.patch(f"{url}/{app.json()['id']}", json={"applied_on": str(tomorrow)})
    assert patch.status_code == 422


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
    assert f["job_status"] == job["status"] and f["job_title"] == "Technical Lead"
    by_job = client.get("/api/v1/followups", params={"job_id": job["id"]}).json()
    assert [x["id"] for x in by_job["items"]] == [f["id"]]
    assert client.get("/api/v1/followups", params={"job_id": 999999}).json()["total"] == 0
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


def test_applied_jobs_always_have_an_application(client: TestClient, db: Session) -> None:
    from app.services.application_service import ensure_applications

    job, _ = setup(client)
    # Marked Applied from the status menu (not the Apply form): an application is recorded.
    client.post(f"/api/v1/jobs/{job['id']}/status", json={"status": "APPLIED"})
    apps = client.get("/api/v1/applications", params={"job_id": job["id"]}).json()["items"]
    assert len(apps) == 1 and apps[0]["status"] == "APPLIED"
    assert apps[0]["applied_on"] == str(date.today())
    assert "Recorded automatically" in (apps[0]["notes"] or "")
    assert apps[0]["origin"] == "auto"
    # Setting the real date makes it a normal (not approximate) record.
    real = str(date.today() - timedelta(days=5))
    fixed = client.patch(f"/api/v1/applications/{apps[0]['id']}", json={"applied_on": real})
    assert fixed.json()["applied_on"] == real and fixed.json()["origin"] == "manual"
    # Marked applied by hand, just now: the first follow-up is planned (bulk changes plan none).
    assert client.get("/api/v1/followups", params={"job_id": job["id"]}).json()["total"] == 1

    # Imported as applied (e.g. a sheet row): the background refresher records it.
    rows = [{"title": "Magento Architect", "company": "Beta", "status": "applied",
             "url": "https://jobs.lever.co/beta/1"}]
    upload = {"file": ("j.json", json.dumps(rows), "application/json")}
    r = client.post("/api/v1/import/jobs", files=upload)
    assert r.status_code == 200, r.text
    imported = client.get("/api/v1/jobs", params={"q": "Magento Architect"}).json()["items"][0]
    assert imported["status"] == "APPLIED"
    assert ensure_applications(db) == 1
    assert ensure_applications(db) == 0  # once only
    by_job = client.get("/api/v1/applications", params={"job_id": imported["id"]}).json()
    assert by_job["total"] == 1

    # Rejected is ambiguous (maybe your own decision), so it doesn't create one.
    new = {"title": "PHP Lead", "company": "Gamma", "jd": JD}
    other = client.post("/api/v1/jobs", json=new).json()["job"]
    client.post(f"/api/v1/jobs/{other['id']}/status", json={"status": "REJECTED"})
    assert client.get("/api/v1/applications", params={"job_id": other["id"]}).json()["total"] == 0


def test_job_status_changes_carry_to_the_application(client: TestClient) -> None:
    job, _ = setup(client)
    app = client.post("/api/v1/applications", json={"job_id": job["id"]}).json()
    assert client.get("/api/v1/followups", params={"job_id": job["id"]}).json()["total"] == 1
    client.post(f"/api/v1/jobs/{job['id']}/status", json={"status": "INTERVIEW"})
    assert client.get(f"/api/v1/applications/{app['id']}").json()["status"] == "INTERVIEW"
    client.post(f"/api/v1/jobs/{job['id']}/status", json={"status": "REJECTED"})
    assert client.get(f"/api/v1/applications/{app['id']}").json()["status"] == "REJECTED"
    # The search for this job is over: its reminders are closed.
    assert client.get("/api/v1/followups", params={"job_id": job["id"]}).json()["total"] == 0
    # On hold is about the job, not the application.
    client.post(f"/api/v1/jobs/{job['id']}/status", json={"status": "ON_HOLD"})
    assert client.get(f"/api/v1/applications/{app['id']}").json()["status"] == "REJECTED"


def test_applications_show_the_next_open_follow_up(client: TestClient) -> None:
    job, _ = setup(client)
    app = client.post("/api/v1/applications", json={"job_id": job["id"]}).json()
    for f in client.get("/api/v1/followups", params={"job_id": job["id"]}).json()["items"]:
        client.post(f"/api/v1/followups/{f['id']}/complete", json={"note": "-"})  # none open
    soon, later = date.today() - timedelta(days=2), date.today() + timedelta(days=5)
    first = client.post("/api/v1/followups", json={
        "title": "Ping", "due_date": str(soon), "application_id": app["id"]}).json()
    client.post("/api/v1/followups", json={
        "title": "Ask again", "due_date": str(later), "job_id": job["id"]})

    def listed() -> str | None:
        items = client.get("/api/v1/applications").json()["items"]
        out: str | None = next(a for a in items if a["id"] == app["id"])["next_follow_up"]
        return out

    assert listed() == str(soon)
    assert client.get(f"/api/v1/applications/{app['id']}").json()["next_follow_up"] == str(soon)
    client.post(f"/api/v1/followups/{first['id']}/complete", json={"note": "Sent"})
    assert listed() == str(later)  # linked through the job


def test_marking_applied_in_one_click_plans_a_follow_up(client: TestClient) -> None:
    job, _ = setup(client)
    client.post(f"/api/v1/jobs/{job['id']}/status", json={"status": "APPLIED"})
    open_ = client.get("/api/v1/followups", params={"job_id": job["id"]}).json()["items"]
    assert [f["due_date"] for f in open_] == [str(date.today() + timedelta(days=7))]
    app = client.get("/api/v1/applications", params={"job_id": job["id"]}).json()["items"][0]
    assert app["next_follow_up"] == str(date.today() + timedelta(days=7))


def test_bulk_applied_plans_no_follow_ups(client: TestClient) -> None:
    job, _ = setup(client)
    other = client.post("/api/v1/jobs", json={"title": "PHP Lead", "company": "Gamma", "jd": JD})
    ids = [job["id"], other.json()["job"]["id"]]
    r = client.post("/api/v1/jobs/bulk", json={"job_ids": ids, "action": "status",
                                               "status": "APPLIED"})
    assert r.status_code == 200, r.text
    assert client.get("/api/v1/applications").json()["total"] == 2
    assert client.get("/api/v1/followups").json()["total"] == 0  # catching up: no flood
