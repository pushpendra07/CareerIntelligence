"""Add Job: company suggestions while typing, and linking the job to the chosen company."""

from fastapi.testclient import TestClient

JD = "Requirements\n- PHP, Magento 2\nLocation: Pune"


def company(client: TestClient, name: str) -> int:
    r = client.post("/api/v1/companies", json={"name": name})
    assert r.status_code == 201, r.text
    return int(r.json()["id"])


def test_suggest_lists_matches_with_the_one_a_job_would_link_to_first(client: TestClient) -> None:
    acme = company(client, "Acme Commerce")
    company(client, "Acme Labs")
    company(client, "Beta Acme")
    client.post("/api/v1/jobs", json={"title": "Lead", "company": "Acme Labs", "jd": JD})

    s = client.get("/api/v1/companies/suggest", params={"q": "acme commerce pvt ltd"}).json()
    assert s["match"]["id"] == acme  # legal suffixes don't matter
    assert s["items"][0]["id"] == acme and s["items"][0]["match"] is True

    typed = client.get("/api/v1/companies/suggest", params={"q": "Acme"}).json()
    names = [i["name"] for i in typed["items"]]
    assert names[:2] == ["Acme Labs", "Acme Commerce"]  # starts with it; most jobs first
    assert names[-1] == "Beta Acme"
    assert typed["items"][0]["jobs"] == 1

    new = client.get("/api/v1/companies/suggest", params={"q": "Zeta Systems"}).json()
    assert new == {"match": None, "items": []}  # a new company would be added
    assert client.get("/api/v1/companies/suggest", params={"q": "a"}).json()["items"] == []


def test_add_job_links_the_chosen_company_or_adds_a_new_one(client: TestClient) -> None:
    acme = company(client, "Acme Commerce")
    picked = client.post("/api/v1/jobs", json={
        "title": "Lead", "company": "Acme", "company_id": acme, "jd": JD}).json()
    assert picked["job"]["company"]["id"] == acme  # linked, though the text differs

    typed = client.post("/api/v1/jobs", json={
        "title": "Architect", "company": "Acme Commerce Pvt Ltd", "jd": JD}).json()
    assert typed["job"]["company"]["id"] == acme  # matched by name

    new = client.post("/api/v1/jobs", json={"title": "Lead", "company": "Zeta Systems",
                                            "jd": JD}).json()
    assert new["job"]["company"]["name"] == "Zeta Systems" and new["job"]["company"]["id"] != acme

    missing = client.post("/api/v1/jobs", json={"title": "QA", "company": "X", "company_id": 999999,
                                                "jd": JD})
    assert missing.status_code == 404
