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
    assert s["due_followups"] == 1  # overdue counts; the application one is due later
    assert s["upcoming_interviews"] == 1 and s["responses"] == 1  # interview = a response
    assert s["ready_to_apply"] == 0 and s["missing_jd_70_plus"] == 0

    client.post(f"/api/v1/jobs/{other['id']}/status", json={"status": "CLOSED"})
    closed = client.get("/api/v1/dashboard").json()["summary"]
    assert (closed["total_jobs"], closed["closed_jobs"]) == (1, 1)  # matches the Open/Closed tabs
    assert closed["new_this_week"] == 2 and closed["applied_this_week"] == 1
    client.post(f"/api/v1/jobs/{other['id']}/status", json={"status": "NOT_RELEVANT"})
    hidden = client.get("/api/v1/dashboard").json()["summary"]
    assert hidden["total_jobs"] == 1  # not-relevant (and applied/rejected) jobs aren't open
    kinds = [p["type"] for p in d["priorities"]]
    assert kinds[0] == "INTERVIEW" and "FOLLOW_UP" in kinds
    follow = next(p for p in d["priorities"] if p["type"] == "FOLLOW_UP")
    assert follow["title"] == "Follow up: Ping recruiter" and follow["overdue"]
    assert d["priorities"][0]["title"].startswith("Interview tomorrow — Acme")
    if other["match_score"] >= 70:
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
    quality = {q["label"]: q for q in charts["source_quality"]}
    assert sum(q["value"] for q in quality.values()) >= 2
    assert sum(q["applied"] for q in quality.values()) >= 1
    assert all(q["avg_score"] is not None for q in quality.values())

    analytics = client.get("/api/v1/dashboard/analytics").json()
    assert set(analytics["scores"]["average_component_factor"]) >= {"role", "skills"}

    found = client.get("/api/v1/search", params={"q": "acme"}).json()
    assert found["jobs"][0]["id"] == job["id"]
    assert found["companies"][0]["title"] == "Acme"
    assert found["applications"][0]["id"] == app["id"]
    skills = client.get("/api/v1/search", params={"q": "graph"}).json()["skills"]
    assert [x["title"] for x in skills] == ["GraphQL"]
    assert client.get("/api/v1/search", params={"q": "a"}).status_code == 422


def test_city_names_are_merged() -> None:
    from app.services.dashboard_service import city

    assert city("Bengaluru, Karnataka, India") == "Bengaluru"
    assert city("Bangalore") == "Bengaluru"
    assert city("Gurgaon, Haryana") == "Gurugram"
    assert city("United States (Remote)") == "United States (Remote)"


def test_score_bands_and_follow_up_summary(client: TestClient) -> None:
    job, _ = setup(client)
    client.post("/api/v1/applications", json={"job_id": job["id"]})
    for n in range(5):
        client.post(
            "/api/v1/followups",
            json={"title": f"Ping {n}", "kind": "RECRUITER",
                  "due_date": str(date.today() - timedelta(days=n + 1))},
        )
    bands = client.get("/api/v1/dashboard/analytics").json()["scores"]["interview_rate_by_score"]
    assert [b["label"] for b in bands] == [
        b for b in ["90-100", "80-89", "70-79", "60-69", "0-59"] if b in {x["label"] for x in bands}
    ]
    assert sum(b["applications"] for b in bands) == 1
    assert set(bands[0]) == {"label", "applications", "answers", "interviews"}

    d = client.get("/api/v1/dashboard").json()
    follow = [p for p in d["priorities"] if p["type"] == "FOLLOW_UP"]
    # Five due: three by name, then one line for the rest (application follow-up isn't due yet).
    assert [p["title"] for p in follow[:3]] == ["Follow up: Ping 4", "Follow up: Ping 3",
                                                 "Follow up: Ping 2"]
    assert follow[3]["title"] == "2 more follow-ups due"
    assert follow[3]["link"] == {"entity": "followup", "id": None} and follow[3]["due"] is None
    s = d["summary"]
    assert s["applied_last_week"] == 0 and s["new_last_week"] == 0
    assert "unapplied_70_plus" in s

    charts = client.get("/api/v1/dashboard/charts").json()
    assert all(c["value"] >= 1 and "id" in c for c in charts["top_companies"])
