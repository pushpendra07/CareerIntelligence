"""A job's contact person: add, edit, reuse someone you already have, remove."""

from fastapi.testclient import TestClient

JD = "Requirements\n- PHP, Magento 2"


def add_job(client: TestClient, title: str = "Lead", **extra: str) -> dict:  # type: ignore[type-arg]
    r = client.post("/api/v1/jobs", json={"title": title, "company": "Acme", "jd": JD, **extra})
    assert r.status_code == 201, r.text
    return r.json()["job"]  # type: ignore[no-any-return]


def test_add_edit_and_remove_the_contact_person(client: TestClient) -> None:
    job = add_job(client)
    assert job["recruiter"] is None
    url = f"/api/v1/jobs/{job['id']}/contact"
    r = client.put(url, json={"name": "Priya Sharma", "job_title": "HR Manager",
                              "email": "Priya@Acme.example", "phone": "+91 98765 43210"})
    assert r.status_code == 200, r.text
    c = r.json()["recruiter"]
    assert (c["name"], c["job_title"], c["email"]) == ("Priya Sharma", "HR Manager",
                                                       "priya@acme.example")
    assert c["phone"]

    # Editing changes the same contact; an empty value clears that field.
    edited = client.put(url, json={"name": "Priya S.", "email": "priya@acme.example",
                                   "phone": "", "job_title": "Talent Lead"}).json()["recruiter"]
    assert edited["id"] == c["id"] and edited["name"] == "Priya S."
    assert edited["phone"] is None and edited["job_title"] == "Talent Lead"

    # The contact shows in Recruiters with the job's company.
    people = client.get("/api/v1/recruiters", params={"q": "priya"}).json()["items"]
    assert any(p["id"] == c["id"] for p in people)

    removed = client.delete(url).json()
    assert removed["recruiter"] is None
    assert client.get("/api/v1/recruiters", params={"q": "priya"}).json()["items"]  # kept


def test_someone_you_already_have_is_linked_not_added_twice(client: TestClient) -> None:
    first = add_job(client, "Lead", recruiter_name="Ravi", recruiter_email="ravi@acme.example")
    second = add_job(client, "Architect")
    linked = client.put(f"/api/v1/jobs/{second['id']}/contact",
                        json={"email": "RAVI@acme.example"}).json()["recruiter"]
    assert linked["id"] == first["recruiter"]["id"] and linked["name"] == "Ravi"


def test_contact_needs_something_and_valid_values(client: TestClient) -> None:
    job = add_job(client)
    url = f"/api/v1/jobs/{job['id']}/contact"
    assert client.put(url, json={"name": " ", "email": ""}).status_code == 422
    assert client.put(url, json={"email": "not-an-email"}).status_code == 422
    assert client.put(url, json={"linkedin_url": "https://example.com/x"}).status_code == 422
    assert client.put(url, json={"phone": "98765 43210"}).json()["recruiter"]["name"]
