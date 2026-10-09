from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from tests.test_applications import setup


def test_interview_flow_and_status_sync(client: TestClient) -> None:
    job, _ = setup(client)
    app = client.post("/api/v1/applications", json={"job_id": job["id"]}).json()
    when = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    r = client.post(
        "/api/v1/interviews",
        json={
            "job_id": job["id"],
            "round_type": "TECHNICAL",
            "mode": "VIDEO",
            "scheduled_at": when,
            "meeting_link": "meet.example.com/abc",
            "topics": ["Magento indexers"],
        },
    )
    assert r.status_code == 201, r.text
    iv = r.json()
    assert iv["application_id"] == app["id"] and iv["round_number"] == 1
    assert iv["meeting_link"] == "https://meet.example.com/abc"
    assert client.get(f"/api/v1/applications/{app['id']}").json()["status"] == "INTERVIEW"
    assert client.get(f"/api/v1/jobs/{job['id']}").json()["status"] == "INTERVIEW"

    second = client.post(
        "/api/v1/interviews", json={"job_id": job["id"], "round_type": "SYSTEM_DESIGN"}
    ).json()
    assert second["round_number"] == 2  # rounds are not forced, just numbered

    moved = client.patch(
        f"/api/v1/interviews/{iv['id']}",
        json={"scheduled_at": (datetime.now(UTC) + timedelta(days=3)).isoformat()},
    ).json()
    assert moved["status"] == "RESCHEDULED"
    done = client.post(
        f"/api/v1/interviews/{iv['id']}/complete",
        json={
            "result": "PASSED",
            "feedback": "Strong on Magento internals",
            "next_round": "System design",
        },
    ).json()
    assert (done["status"], done["result"]) == ("COMPLETED", "PASSED")
    upcoming = client.get("/api/v1/interviews", params={"upcoming": True}).json()
    assert upcoming["total"] == 0  # round 2 has no date; round 1 is completed
    assert client.get("/api/v1/interviews", params={"job_id": job["id"]}).json()["total"] == 2

    bad = client.post(
        "/api/v1/interviews",
        json={"job_id": job["id"], "round_type": "HR", "meeting_link": "javascript:alert(1)"},
    )
    assert bad.status_code == 422


def test_question_bank_and_prep(client: TestClient) -> None:
    job, _ = setup(client)
    q = client.post(
        "/api/v1/questions",
        json={
            "question": "Explain plugins vs observers vs preferences in Magento 2",
            "category": "magento 2",
            "technology": "magento2",
            "difficulty": "MEDIUM",
        },
    ).json()
    assert q["category"] == "Magento 2" and q["technology"] == "Magento 2"
    client.post(
        "/api/v1/questions",
        json={
            "question": "Tell me about a conflict you resolved",
            "category": "Behavioral",
            "confidence": 4,
        },
    )
    assert (
        client.post(
            "/api/v1/questions", json={"question": "x?", "category": "Astrology"}
        ).status_code
        == 422
    )
    practiced = client.post(
        f"/api/v1/questions/{q['id']}/practice",
        json={"confidence": 2, "my_answer": "Plugins wrap methods..."},
    ).json()
    assert practiced["times_practiced"] == 1 and practiced["confidence"] == 2
    weak = client.get("/api/v1/questions", params={"max_confidence": 3}).json()
    assert [x["id"] for x in weak["items"]] == [q["id"]]

    iv = client.post(
        "/api/v1/interviews", json={"job_id": job["id"], "round_type": "SYSTEM_DESIGN"}
    ).json()
    prep = client.get(f"/api/v1/interviews/{iv['id']}/prep").json()
    assert prep["interview"]["round_type"] == "SYSTEM_DESIGN"
    assert "PHP" in prep["matched_skills"]
    assert any("Scalability" in t for t in prep["likely_topics"])
    assert [x["id"] for x in prep["relevant_questions"]] == [q["id"]]
    assert prep["questions_to_ask"]
    assert prep["cv_highlights"]["total_experience_years"]
    assert prep["generated_with"] == "deterministic/1"
    assert client.get(f"/api/v1/jobs/{job['id']}/prep").status_code == 200
