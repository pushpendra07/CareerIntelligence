from datetime import date, timedelta

from fastapi.testclient import TestClient

from tests.test_applications import setup


def test_offer_lifecycle(client: TestClient) -> None:
    job, _ = setup(client)
    app = client.post("/api/v1/applications", json={"job_id": job["id"]}).json()
    client.patch("/api/v1/preferences", json={"min_salary": 3000000, "target_salary": 4000000})
    expiry = date.today() + timedelta(days=10)
    r = client.post(
        "/api/v1/offers",
        json={
            "job_id": job["id"],
            "base_salary": 3600000,
            "variable_pay": 400000,
            "bonus": 200000,
            "currency": "inr",
            "expiry_date": str(expiry),
            "work_model": "REMOTE",
            "benefits": ["Health insurance"],
        },
    )
    assert r.status_code == 201, r.text
    offer = r.json()
    assert offer["total_ctc"] == "4200000.00" and offer["currency"] == "INR"
    assert offer["application_id"] == app["id"]
    assert client.get(f"/api/v1/applications/{app['id']}").json()["status"] == "OFFER"
    assert client.get(f"/api/v1/jobs/{job['id']}").json()["status"] == "OFFER"
    reminders = client.get("/api/v1/followups", params={"kind": "OFFER"}).json()["items"]
    assert reminders[0]["due_date"] == str(expiry - timedelta(days=2))

    neg = client.post(
        f"/api/v1/offers/{offer['id']}/negotiate",
        json={"note": "Asked for 45L fixed", "counter_ctc": 4500000},
    ).json()
    assert neg["status"] == "NEGOTIATING" and neg["negotiation_log"][0]["counter_ctc"] == "4500000"
    upd = client.patch(f"/api/v1/offers/{offer['id']}", json={"base_salary": 4000000}).json()
    assert upd["total_ctc"] == "4600000.00"  # recomputed from components

    cmp = client.get("/api/v1/offers/compare").json()
    assert cmp["offers"][0]["percent_of_target"] == 115.0

    done = client.post(
        f"/api/v1/offers/{offer['id']}/decision",
        json={"status": "ACCEPTED", "decision": "Joining on 1st"},
    ).json()
    assert done["status"] == "ACCEPTED" and done["decision_date"] == str(date.today())
    assert client.get(f"/api/v1/applications/{app['id']}").json()["status"] == "ACCEPTED"
    assert client.get(f"/api/v1/jobs/{job['id']}").json()["status"] == "ACCEPTED"
    assert client.get("/api/v1/followups", params={"kind": "OFFER"}).json()["total"] == 0
    assert (
        client.post(
            f"/api/v1/offers/{offer['id']}/negotiate", json={"note": "too late"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/v1/offers/{offer['id']}/decision", json={"status": "NEGOTIATING"}
        ).status_code
        == 422
    )
