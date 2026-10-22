"""Ignored and Duplicate job statuses: finished, in Not pursuing, out of the open counts."""

from fastapi.testclient import TestClient


def test_ignored_and_duplicate_are_finished_statuses(client: TestClient) -> None:
    ids = []
    for title in ("Lead", "Architect", "Manager"):
        r = client.post("/api/v1/jobs", json={"title": title, "company": "Acme", "jd": "PHP"})
        ids.append(r.json()["job"]["id"])
    for jid, status in zip(ids, ("IGNORED", "DUPLICATE"), strict=False):
        r = client.post(f"/api/v1/jobs/{jid}/status", json={"status": status})
        assert r.status_code == 200 and r.json()["status"] == status, r.text
    counts = client.get("/api/v1/jobs/status-counts").json()
    assert counts.get("IGNORED") == 1 and counts.get("DUPLICATE") == 1
    summary = client.get("/api/v1/dashboard").json()["summary"]
    assert summary["total_jobs"] == 1  # only the job still in play
    listed = client.get("/api/v1/jobs", params={"status": ["IGNORED", "DUPLICATE"]}).json()
    assert {j["id"] for j in listed["items"]} == set(ids[:2])
