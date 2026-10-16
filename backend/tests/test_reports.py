from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.services.report_service import BUILDERS, Range, default_group, periods

JD = "Requirements\n- 10+ years\n- PHP, Magento 2, MySQL\nLocation: Pune, India (Hybrid)"


def seed(client: TestClient) -> dict[str, int]:
    a = client.post("/api/v1/jobs", json={"title": "Tech Lead", "company": "Acme", "jd": JD}).json()
    b = client.post("/api/v1/jobs", json={"title": "Architect", "company": "Beta", "jd": JD,
                                          "work_model": "REMOTE"}).json()
    app = client.post("/api/v1/applications",
                      json={"job_id": a["job"]["id"], "method": "LINKEDIN"}).json()
    client.post(f"/api/v1/applications/{app['id']}/status", json={"status": "SCREENING"})
    client.post("/api/v1/interviews", json={
        "job_id": a["job"]["id"], "application_id": app["id"], "round_type": "TECHNICAL",
        "scheduled_at": f"{date.today().isoformat()}T10:00:00+05:30"})
    return {"a": a["job"]["id"], "b": b["job"]["id"], "app": app["id"]}


def test_catalog_and_every_report_has_the_same_shape(client: TestClient) -> None:
    seed(client)
    names = [r["key"] for r in client.get("/api/v1/reports").json()]
    assert names == list(BUILDERS)
    for name in names:
        r = client.get(f"/api/v1/reports/{name}")
        assert r.status_code == 200, (name, r.text)
        body = r.json()
        assert body["group"] == "week" and body["kpis"] and body["charts"], name
        assert {"columns", "rows", "total"} <= set(body["table"]), name
        for c in body["charts"]:
            assert c["kind"] in {"line", "bar", "stacked", "donut", "hbar"}, (name, c["id"])


def test_numbers_and_previous_period(client: TestClient) -> None:
    ids = seed(client)
    today = date.today().isoformat()
    ov = client.get("/api/v1/reports/overview", params={"from": today, "to": today}).json()
    k = {x["key"]: x for x in ov["kpis"]}
    assert k["jobs"]["value"] == 2 and k["jobs"]["previous"] == 0
    assert k["apps"]["value"] == 1 and k["answers"]["value"] == 1
    assert k["interviews"]["value"] == 1
    assert ov["group"] == "day" and len(ov["charts"][0]["data"]) == 1

    apps = client.get("/api/v1/reports/applications").json()
    row = apps["table"]["rows"][0]
    assert row["id"] == ids["a"] and row["status"] == "INTERVIEW" and row["answer_days"] == 0
    assert {x["key"]: x["value"] for x in apps["kpis"]}["answer_rate"] == 100

    jobs = client.get("/api/v1/reports/jobs").json()
    wm = next(c for c in jobs["charts"] if c["id"] == "work_model")
    assert {d["label"]: d["value"] for d in wm["data"]} == {"Hybrid": 1, "Remote": 1}
    assert {r["location"] for r in jobs["table"]["rows"]} <= {"Pune, India", None, "Pune"}

    # Last year has nothing.
    old = client.get("/api/v1/reports/jobs",
                     params={"from": "2020-01-01", "to": "2020-12-31"}).json()
    assert old["group"] == "month" and old["table"]["rows"] == []
    assert len(old["charts"][0]["data"]) == 12


def test_bad_requests(client: TestClient) -> None:
    assert client.get("/api/v1/reports/nope").status_code == 404
    bad = client.get("/api/v1/reports/jobs", params={"from": "2026-05-01", "to": "2026-04-01"})
    assert bad.status_code == 422


def test_periods() -> None:
    d = date(2026, 1, 28)
    assert default_group(d, d + timedelta(days=10)) == "day"
    assert periods(date(2026, 1, 15), date(2026, 3, 2), "month") == [
        date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]
    assert periods(date(2026, 10, 14), date(2026, 10, 20), "week") == [
        date(2026, 10, 12), date(2026, 10, 19)]
    r = Range(date(2026, 10, 1), date(2026, 10, 10), "day")
    assert (r.prev_start, r.prev_end) == (date(2026, 9, 21), date(2026, 9, 30))
