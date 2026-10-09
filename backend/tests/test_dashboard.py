from datetime import UTC, date, datetime, timedelta

from fastapi.testclient import TestClient

from tests.test_applications import JD, setup


def test_dashboard_priorities_funnels_and_search(client: TestClient) -> None:
    job, _ = setup(client)
    other = client.post(
        "/api/v1/jobs", json={"title": "Senior PHP Developer", "company": "Beta", "jd": JD}
    ).json()["job"]
    app = client.post("/api/v1/applications", json={"job_id": job["id"]}).json()
    client.post(
        "/api/v1/interviews",
        json={
            "job_id": job["id"],
            "round_type": "TECHNICAL",
            "scheduled_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        },
    )
    client.post(
        "/api/v1/followups",
        json={
            "title": "Ping recruiter",
            "kind": "RECRUITER",
            "due_date": str(date.today() - timedelta(days=1)),
        },
    )

    d = client.get("/api/v1/dashboard").json()
    s = d["summary"]
    assert (s["total_jobs"], s["applications"], s["interviews"]) == (2, 1, 1)
    assert s["pending_followups"] == 2 and s["overdue_followups"] == 1
    kinds = [p["type"] for p in d["priorities"]]
    assert kinds[0] == "INTERVIEW" and "FOLLOW_UP" in kinds
    assert d["priorities"][0]["title"].startswith("Interview tomorrow — Acme")
    if other["match_score"] >= 80:
        assert any(p["type"] == "APPLY" and p["link"]["id"] == other["id"] for p in d["priorities"])
    assert not any(
        p["type"] == "APPLY" and p["link"]["id"] == job["id"] for p in d["priorities"]
    )  # already applied
    funnel = {f["stage"]: f["value"] for f in d["funnels"]["application"]}
    assert funnel["Applied"] == 1 and funnel["Interview"] == 1

    charts = client.get("/api/v1/dashboard/charts").json()
    assert sum(b["value"] for b in charts["jobs_by_score"]) == 2
    assert {"label": "INTERVIEW", "value": 1} in charts["applications_by_status"]
    assert any(x["label"] == "PHP" for x in charts["top_requested_skills"])
    assert charts["interviews_over_time"][0]["value"] == 1

    analytics = client.get("/api/v1/dashboard/analytics").json()
    assert set(analytics["scores"]["average_component_factor"]) >= {"role", "skills"}

    found = client.get("/api/v1/search", params={"q": "acme"}).json()
    assert found["jobs"][0]["id"] == job["id"]
    assert found["companies"][0]["title"] == "Acme"
    assert found["applications"][0]["id"] == app["id"]
    skills = client.get("/api/v1/search", params={"q": "graph"}).json()["skills"]
    assert [x["title"] for x in skills] == ["GraphQL"]
    assert client.get("/api/v1/search", params={"q": "a"}).status_code == 422
