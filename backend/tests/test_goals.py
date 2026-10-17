from datetime import UTC, date, datetime, timedelta

from fastapi.testclient import TestClient

from app.services.goals_service import week_of

JD = "Requirements\n- PHP, Magento 2"


def add_job(client: TestClient, title: str) -> int:
    r = client.post("/api/v1/jobs", json={"title": title, "company": "Acme", "jd": JD})
    return int(r.json()["job"]["id"])


def test_week_runs_monday_to_sunday() -> None:
    assert week_of(date(2026, 10, 16)) == (date(2026, 10, 12), date(2026, 10, 18))
    assert week_of(date(2026, 10, 12))[0] == date(2026, 10, 12)


def test_goals_count_what_you_did_this_week(client: TestClient) -> None:
    client.patch("/api/v1/settings/app", json={"goals": {"applications": 2, "reviewed": 2,
                                                         "followups": 1, "outreach": 1}})
    a, b, c = (add_job(client, t) for t in ("Tech Lead", "Architect", "PHP Lead"))
    client.post(f"/api/v1/jobs/{a}/status", json={"status": "SHORTLISTED"})  # reviewed
    client.post(f"/api/v1/jobs/{b}/status", json={"status": "NOT_RELEVANT"})  # reviewed
    client.post("/api/v1/applications", json={"job_id": a})  # applied (reviewed already)
    fu = client.post("/api/v1/followups", json={
        "kind": "OTHER", "title": "Ping HR", "due_date": date.today().isoformat(),
        "job_id": c}).json()
    client.post(f"/api/v1/followups/{fu['id']}/complete")
    rec = client.post("/api/v1/recruiters", json={"name": "Riya"}).json()
    client.patch(f"/api/v1/recruiters/{rec['id']}", json={"status": "CONTACTED"})

    week = client.get("/api/v1/goals/week").json()
    g = {x["key"]: x for x in week["goals"]}
    assert (g["applications"]["done"], g["applications"]["left"]) == (1, 1)
    assert g["reviewed"]["done"] == 2 and g["followups"]["done"] >= 1
    assert g["outreach"]["done"] == 1
    assert week["all_met"] is False and week["streak"] == 0
    assert 1 <= week["days_left"] <= 7

    client.post(f"/api/v1/jobs/{c}/status", json={"status": "APPLIED"})  # second application
    week = client.get("/api/v1/goals/week").json()
    assert week["all_met"] is True
    apps = next(x for x in week["goals"] if x["key"] == "applications")
    assert apps["approximate"] == 1  # recorded from the status change


def test_goal_settings_are_validated(client: TestClient) -> None:
    bad = client.patch("/api/v1/settings/app", json={"goals": {"applications": -1}})
    assert bad.status_code == 422
    ok = client.patch("/api/v1/settings/app", json={"goals": {"outreach": 0}}).json()
    assert ok["goals"]["outreach"] == 0 and ok["goals"]["applications"] == 10


def test_reminders_list_due_followups_and_interviews_tomorrow(client: TestClient) -> None:
    job = add_job(client, "Tech Lead")
    late = (date.today() - timedelta(days=2)).isoformat()
    later = (date.today() + timedelta(days=3)).isoformat()
    for title, due in (("Late one", late), ("Not yet", later)):
        client.post("/api/v1/followups", json={"kind": "OTHER", "title": title,
                                               "due_date": due, "job_id": job})
    soon = (datetime.now(UTC) + timedelta(hours=3)).isoformat()
    far = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    for when in (soon, far):
        client.post("/api/v1/interviews", json={"job_id": job, "round_type": "TECHNICAL",
                                                "scheduled_at": when})
    r = client.get("/api/v1/reminders").json()
    assert [f["title"] for f in r["followups"]] == ["Late one"]
    assert r["followups"][0]["late_days"] == 2
    assert len(r["interviews"]) == 1 and 170 <= r["interviews"][0]["minutes_until"] <= 180
    assert r["interviews"][0]["job_title"] == "Tech Lead"
