"""Apply assistant: the kit for a job, saved answers, recording, and finding a job by its page."""

from fastapi.testclient import TestClient

JD = "Requirements\n- PHP, Magento 2\nLocation: Pune"


def job(client: TestClient, **extra: str) -> dict:  # type: ignore[type-arg]
    r = client.post("/api/v1/jobs", json={"title": "Magento Lead", "company": "Acme", "jd": JD,
                                          "url": "https://job-boards.greenhouse.io/acme/jobs/4012345",
                                          **extra})
    assert r.status_code == 201, r.text
    return r.json()["job"]  # type: ignore[no-any-return]


def test_kit_has_your_details_answers_and_the_hr_email(client: TestClient) -> None:
    client.patch("/api/v1/profile", json={"full_name": "Asha Verma", "email": "asha@example.com",
                                          "phone": "+91 90000 00000", "location": "Pune, India",
                                          "total_experience_years": 12})
    client.patch("/api/v1/preferences", json={"notice_period_days": 60,
                                              "target_salary": 3500000, "salary_currency": "INR"})
    saved = client.put("/api/v1/apply/answers", json={
        "current_ctc": "28 LPA", "relocate": "Yes",
        "answers": [{"question": "Why do you want to join us?", "answer": "Commerce at scale."},
                    {"question": " ", "answer": "dropped"}]}).json()
    assert saved["current_ctc"] == "28 LPA" and len(saved["answers"]) == 1

    j = job(client, recruiter_email="hr@acme.example", recruiter_name="Priya")
    kit = client.get(f"/api/v1/jobs/{j['id']}/apply-kit").json()
    you = kit["applicant"]
    assert (you["first_name"], you["last_name"], you["city"]) == ("Asha", "Verma", "Pune")
    assert you["total_experience"] == "12" and you["notice_period"] == "60 days"
    assert you["expected_ctc"] == "35 LPA" and you["current_ctc"] == "28 LPA"
    assert kit["answers"] == [{"question": "Why do you want to join us?",
                               "answer": "Commerce at scale."}]
    assert kit["job"]["url"].endswith("/jobs/4012345")
    assert kit["email"]["to"] == "hr@acme.example" and kit["email"]["subject"]
    assert "LinkedIn" in kit["missing"]  # nothing invented: missing values are listed
    assert client.get("/api/v1/apply/kit").json()["job"] is None


def test_record_marks_applied_once_with_a_follow_up(client: TestClient) -> None:
    j = job(client)
    first = client.post(f"/api/v1/jobs/{j['id']}/applied", json={"method": "COMPANY_SITE"}).json()
    assert first["created"] is True and first["status"] == "APPLIED" and first["follow_up_date"]
    again = client.post(f"/api/v1/jobs/{j['id']}/applied", json={}).json()
    assert again == {**first, "created": False}  # no second application
    assert client.get(f"/api/v1/jobs/{j['id']}").json()["status"] == "APPLIED"


def test_lookup_finds_the_job_from_its_posting_or_its_form(client: TestClient) -> None:
    j = job(client)
    for url in ("https://job-boards.greenhouse.io/acme/jobs/4012345",
                "https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=abc",
                "https://boards.greenhouse.io/acme/jobs/4012345/apply"):
        r = client.get("/api/v1/apply/lookup", params={"url": url})
        assert r.status_code == 200 and r.json()["id"] == j["id"], url
    missing = client.get("/api/v1/apply/lookup", params={"url": "https://example.com/careers/1"})
    assert missing.status_code == 404
