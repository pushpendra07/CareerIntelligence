"""Pipeline health, market and activity reports; findings; the executive summary."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.application import Application
from app.services.report_service import kpi, kpi_findings

JD = "Requirements\n- 10+ years\n- PHP, Magento 2, MySQL\nLocation: Pune, India"


def job(client: TestClient, title: str, company: str, **extra: Any) -> int:
    r = client.post("/api/v1/jobs", json={"title": title, "company": company, "jd": JD, **extra})
    assert r.status_code == 201, r.text
    return int(r.json()["job"]["id"])


def kpis(body: dict[str, Any]) -> dict[str, Any]:
    return {k["key"]: k["value"] for k in body["kpis"]}


def test_pipeline_conversion_ageing_and_cohorts(client: TestClient, db: Session) -> None:
    ids = [job(client, f"Lead {i}", f"Co {i}") for i in range(3)]
    apps = [client.post("/api/v1/applications", json={"job_id": i}).json()["id"] for i in ids]
    client.post(f"/api/v1/applications/{apps[0]}/status", json={"status": "SCREENING"})
    client.post(f"/api/v1/applications/{apps[1]}/status", json={"status": "INTERVIEW"})
    # One application nobody has touched for three weeks.
    db.execute(update(Application).where(Application.id == apps[2])
               .values(updated_at=datetime.now(UTC) - timedelta(days=21)))
    db.flush()

    body = client.get("/api/v1/reports/pipeline").json()
    k = kpis(body)
    assert k["active"] == 3 and k["answer_rate"] == 67 and k["iv_rate"] == 50
    assert k["stale"] == 1
    stages = next(c for c in body["charts"] if c["id"] == "stages")["data"]
    assert [s["value"] for s in stages] == [3, 2, 1, 0]
    assert stages[1]["label"] == "Got an answer · 67%"
    assert sum(r["apps"] for r in body["table"]["rows"]) == 3  # cohorts add up
    active = body["jobs"]["rows"]
    assert {r["stale"] for r in active} == {"Yes", "No"} and len(active) == 3
    assert any("no update for 14+ days" in f["text"] for f in body["findings"])


def test_market_pay_experience_and_seniority(client: TestClient) -> None:
    job(client, "Magento Architect", "Acme", salary_min=3000000, salary_max=4000000,
        salary_currency="INR", experience_min=10, work_model="REMOTE")
    job(client, "Tech Lead", "Acme", salary_min=2000000, salary_max=2400000,
        salary_currency="INR", experience_min=8)
    job(client, "Lead Developer", "Beta", salary_min=90000, salary_max=120000,
        salary_currency="USD")
    body = client.get("/api/v1/reports/market").json()
    k = kpis(body)
    assert k["jobs"] == 3 and k["companies"] == 2 and k["shown"] == 100
    assert k["lpa"] == 28.5  # medians of 35 and 22 LPA; the USD job is left out
    assert k["remote"] == 33 and k["exp"] == 10.0  # 10, 8 and 10 (from the JD)
    salary = next(c for c in body["charts"] if c["id"] == "salary")
    assert {d["label"]: d["value"] for d in salary["data"]} == {"20–30 LPA": 1, "30–40 LPA": 1}
    assert "1 job(s) in other currencies" in salary["note"]
    hiring = next(c for c in body["charts"] if c["id"] == "hiring")["data"]
    assert hiring[0] == {"label": "Acme", "code": "Acme", "value": 2}
    rows = {r["title"]: r for r in body["table"]["rows"]}
    assert rows["Magento Architect"]["salary_band"] == "30–40 LPA"
    assert rows["Lead Developer"]["salary_band"] == "Other currency"


def test_activity_counts_decisions_and_backlog(client: TestClient, db: Session) -> None:
    keep, drop, wait = (job(client, t, "Acme") for t in ("Lead", "Architect", "Manager"))
    client.post(f"/api/v1/jobs/{keep}/status", json={"status": "SHORTLISTED"})
    client.post(f"/api/v1/jobs/{drop}/status", json={"status": "NOT_RELEVANT"})
    body = client.get("/api/v1/reports/activity").json()
    k = kpis(body)
    assert k["reviewed"] == 2 and k["shortlisted"] == 1 and k["dismissed"] == 1
    assert k["backlog"] == 1 and [r["id"] for r in body["jobs"]["rows"]] == [wait]
    # The audit trail starts inside the previous period here, so nothing is compared.
    assert {x["key"]: x["previous"] for x in body["kpis"]}["reviewed"] is None
    flow = next(c for c in body["charts"] if c["id"] == "flow")
    assert sum(d["Found"] for d in flow["data"]) == 3
    assert sum(d["Reviewed"] for d in flow["data"]) == 2

    # With history from long before, the previous period is compared.
    db.add(ActivityLog(action="job.status_changed", entity_type="job", entity_id=None,
                       occurred_at=datetime.now(UTC) - timedelta(days=400), data={}))
    db.flush()
    again = client.get("/api/v1/reports/activity").json()
    assert {x["key"]: x["previous"] for x in again["kpis"]}["reviewed"] == 0


def test_findings_compare_only_real_changes() -> None:
    found = kpi_findings([
        kpi("Answer rate", "a", 20, 40, "%", sample=(30, 25)),  # -20 points: reported
        kpi("Interview rate", "i", 50, 10, "%", sample=(2, 30)),  # 2 cases: too few
        kpi("Applications", "n", 40, 20),  # +100%
        kpi("Jobs", "j", 21, 20),  # +5%: not notable
        kpi("Offers", "o", 4, 0),  # from none
        kpi("Dismissed", "d", 90, 30, better="none"),  # neutral
        kpi("Late", "l", 9, 3, better="down"),  # worse
    ], limit=10)
    texts = [f["text"] for f in found]
    assert texts == [
        "Answer rate: 20% against 40% in the previous period (−20 points).",
        "Applications: 40, up 100% on the previous period (20).",
        "Offers: 4, against none in the previous period.",
        "Dismissed: 90, up 200% on the previous period (30).",
        "Late: 9, against 3 in the previous period.",
    ]
    assert [f["tone"] for f in found] == ["bad", "good", "good", "info", "bad"]


def test_every_report_has_findings_and_a_section(client: TestClient) -> None:
    job(client, "Lead", "Acme")
    catalog = client.get("/api/v1/reports").json()
    assert {c["section"] for c in catalog} == {"Summary", "Pipeline", "Market", "Operations"}
    for c in catalog:
        body = client.get(f"/api/v1/reports/{c['key']}").json()
        assert isinstance(body["findings"], list) and body["section"] == c["section"]


def test_summary_puts_problems_first(client: TestClient) -> None:
    for i in range(3):
        job(client, f"Lead {i}", "Acme")
    s = client.get("/api/v1/reports/summary", params={"days": 7}).json()
    assert s["days"] == 7 and s["to"] == date.today().isoformat()
    keys = [(k["report"], k["key"]) for k in s["kpis"]]
    assert ("overview", "jobs") in keys and ("activity", "backlog") in keys
    assert next(k for k in s["kpis"] if k["key"] == "backlog")["value"] == 3
    tones = [f["tone"] for f in s["findings"]]
    assert tones == sorted(tones, key=["bad", "good", "info"].index)
    assert all(f["report"] for f in s["findings"])
    assert client.get("/api/v1/reports/summary", params={"days": 0}).status_code == 422
