from datetime import date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError
from app.services import reminder_service
from app.services.reminder_service import Cron


def add_job(client: TestClient, title: str, company: str = "Acme") -> int:
    r = client.post("/api/v1/jobs", json={"title": title, "company": company,
                                          "location": "Pune", "jd": "Build PHP APIs. " * 5})
    return int(r.json()["job"]["id"])


def test_cron_schedules() -> None:
    t = datetime(2026, 10, 19, 10, 30)  # a Monday
    assert Cron("*/5 * * * *").matches(t) and not Cron("*/7 * * * *").matches(t)
    assert Cron("30 9-18 * * 1-5").matches(t)
    assert not Cron("30 9-18 * * 6,0").matches(t)  # weekend only
    assert Cron("30 10 * * 7").matches(datetime(2026, 10, 25, 10, 30))  # 7 = Sunday
    assert Cron("0 10-20/2 * * 1-6").next_after(t) == datetime(2026, 10, 19, 12, 0)
    assert Cron("0 9 1 * *").next_after(t) == datetime(2026, 11, 1, 9, 0)
    assert reminder_service.describe("*/15 * * * *") == "every 15 minutes"
    assert reminder_service.describe("0 */2 * * *") == "every 2 hours"
    for bad in ("* * * *", "61 * * * *", "*/0 * * * *", "a b c d e", "5-1 * * * *"):
        with pytest.raises(DomainValidationError):
            Cron(bad)


def test_rules_can_be_changed_and_tested(client: TestClient) -> None:
    rules = client.get("/api/v1/reminder-rules").json()
    assert [r["id"] for r in rules["rules"]] == ["check-portals", "apply", "follow-up"]
    assert all(r["next_run"] for r in rules["rules"] if r["enabled"])

    body: dict[str, Any] = {"desktop": False, "rules": [
        {"id": "check-portals", "kind": "check_portals", "enabled": True, "label": "Check portals",
         "cron": "*/5 * * * *", "portals": ["LinkedIn", "Naukri"]},
        {"id": "water", "kind": "custom", "enabled": False, "label": "Break",
         "cron": "0 * * * *", "message": "Stretch and drink water"},
    ]}
    saved = client.put("/api/v1/reminder-rules", json=body).json()
    assert saved["rules"][0]["schedule"] == "every 5 minutes"
    assert saved["rules"][1]["next_run"] is None  # off

    bad = {**body, "rules": [{**body["rules"][0], "cron": "every 5 min"}]}
    assert client.put("/api/v1/reminder-rules", json=bad).status_code == 422

    event = client.post("/api/v1/reminder-rules/check-portals/test").json()
    assert event["test"] is True and "LinkedIn, Naukri" in event["body"]
    assert event["url"] == "/jobs/new"
    assert client.post("/api/v1/reminder-rules/nope/test").status_code == 404
    listed = client.get("/api/v1/reminder-events").json()
    assert listed[0]["id"] == event["id"]
    assert client.get("/api/v1/reminder-events", params={"after": event["id"]}).json() == []


def test_scheduler_fires_once_per_matching_minute(client: TestClient, db: Session) -> None:
    client.put("/api/v1/reminder-rules", json={"desktop": False, "rules": [
        {"id": "portals", "kind": "check_portals", "enabled": True, "cron": "*/5 * * * *"},
        {"id": "apply", "kind": "apply", "enabled": True, "cron": "*/5 * * * *",
         "only_when_needed": True},
    ]})
    fired: dict[str, str] = {}
    at = datetime(2026, 10, 19, 10, 5, 10).astimezone()
    first = reminder_service.run_due(db, at, fired)
    # "apply" only fires when something is shortlisted: nothing is yet.
    assert [e.rule_id for e in first] == ["portals"]
    assert reminder_service.run_due(db, at + timedelta(seconds=30), fired) == []  # same minute
    assert reminder_service.run_due(db, at + timedelta(minutes=1), fired) == []  # 10:06: no match

    job = add_job(client, "Backend Lead")
    client.post(f"/api/v1/jobs/{job}/status", json={"status": "SHORTLISTED"})
    later = reminder_service.run_due(db, at + timedelta(minutes=5), fired)
    assert {e.rule_id for e in later} == {"portals", "apply"}
    apply = next(e for e in later if e.rule_id == "apply")
    assert apply.body.startswith("1 shortlisted job waiting") and apply.url == "/jobs?tab=pending"


def test_bell_details_jobs_companies_and_applied(client: TestClient) -> None:
    new = add_job(client, "Platform Engineer", "Globex")
    short = add_job(client, "Tech Lead", "Initech")
    client.post(f"/api/v1/jobs/{short}/status", json={"status": "SHORTLISTED"})
    applied = add_job(client, "Backend Lead", "Umbrella")
    client.post("/api/v1/applications", json={"job_id": applied})
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    client.post("/api/v1/followups", json={"kind": "OTHER", "title": "Follow up: Backend Lead",
                                           "job_id": applied, "due_date": yesterday})
    r = client.get("/api/v1/reminders").json()
    assert [(j["job_id"], j["company"], j["applied"]) for j in r["new_jobs"]] == [
        (new, "Globex", False)]
    assert [(j["job_id"], j["company"], j["job_status"]) for j in r["apply_pending"]] == [
        (short, "Initech", "SHORTLISTED")]
    late = next(f for f in r["followups"] if f["job_id"] == applied)
    assert late["company"] == "Umbrella" and late["applied"] is True
    assert late["applied_on"] == date.today().isoformat()
    assert late["application_status"] == "APPLIED"
    assert late["location"] == "Pune" and late["late_days"] == 1
