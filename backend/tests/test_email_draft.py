from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.company import Company, Contact
from app.models.job import Job
from app.models.profile import ProfessionalProfile
from app.services.email_draft import build_draft, email_domain
from app.services.job_service import JobInput, ingest_job

MATCH = {"skills": [
    {"skill": "Kubernetes", "match": "MISSING", "importance": "REQUIRED"},
    {"skill": "GraphQL", "match": "EXACT_MATCH", "importance": "PREFERRED"},
    {"skill": "Magento 2", "match": "EXACT_MATCH", "importance": "REQUIRED"},
    {"skill": "PHP", "match": "EXACT_MATCH", "importance": "REQUIRED"},
    {"skill": "AWS", "match": "PARTIAL_MATCH", "importance": "REQUIRED"},
]}


def _job(**kw: object) -> Job:
    company = Company(name="Acme", website="https://www.acme.example")
    defaults: dict[str, object] = {
        "title": "Magento Lead", "location": "Pune", "external_id": "R-77",
        "parsed_jd": {"domains": ["E-commerce", "Banking"]},
    }
    job = Job(company=company, **{**defaults, **kw})
    job.recruiter_contact = None
    return job


def _profile() -> ProfessionalProfile:
    return ProfessionalProfile(
        full_name="Test Person", email="test@example.com", phone=None, linkedin_url=None,
        total_experience_years=Decimal("12.6"), leadership_experience_years=Decimal("8"),
        primary_roles=["Engineering Manager"], domains=["E-commerce"],
        achievements=["Cut checkout time by 40%."])


def test_draft_uses_only_real_facts() -> None:
    d = build_draft(_job(), _profile(), MATCH, [], "https://jobs.acme.example/77")
    body = d["body"]
    assert body.startswith("Hello Hiring Team,")
    assert "Magento Lead role at Acme (Pune)" in body
    assert "I'm an Engineering Manager with 12+ years of experience in E-commerce." in body
    # Exact matches only, required first; missing and partial skills are never claimed.
    assert "what the role asks for: Magento 2, PHP, GraphQL" in body
    assert "Kubernetes" not in body and "AWS" not in body
    assert "- Cut checkout time by 40%" in body
    assert "Job: Req. ID R-77 / https://jobs.acme.example/77" in body
    assert body.rstrip().endswith("Test Person\ntest@example.com")
    assert d["subjects"][0] == "Application for Magento Lead – Test Person"
    assert "Magento Lead at Acme – 12+ yrs, Magento 2" in d["subjects"]
    assert d["company_domain"] == "acme.example"
    assert d["to"] is None


def test_draft_without_profile_or_match() -> None:
    d = build_draft(_job(external_id=None, location=None), ProfessionalProfile(), None, [], None)
    assert "Why I'm a good fit" not in d["body"] and "Job:" not in d["body"]
    assert d["body"].rstrip().endswith("Best regards,")
    assert d["subjects"] == ["Application for Magento Lead", "Magento Lead at Acme",
                             "Interested in the Magento Lead role at Acme"]


def test_recruiter_is_greeted_and_addressed() -> None:
    job = _job()
    job.recruiter_contact = Contact(name="Asha Rao", email="asha@acme.example")
    other = Contact(name="Talent Team", email="jobs@acme.example", job_title="TA")
    d = build_draft(job, _profile(), MATCH, [other], None)
    assert d["body"].startswith("Hi Asha,")
    assert d["to"] == "asha@acme.example"
    assert [o["email"] for o in d["to_options"]] == ["asha@acme.example", "jobs@acme.example"]


def test_tidy_details() -> None:
    long = "Built a bulk catalog API for 20,000 SKUs per request " * 6 + ". Second sentence."
    profile = _profile()
    profile.achievements = [long]
    job = _job(external_id="77")  # the number already in the link
    job.company.name = "Acme Technologies Private Limited"
    d = build_draft(job, profile, MATCH, [], "https://jobs.acme.example/77")
    assert "role at Acme Technologies (Pune)" in d["body"]
    assert "Req. ID" not in d["body"] and "Second sentence" not in d["body"]
    point = next(line for line in d["body"].splitlines() if line.startswith("- Built"))
    assert len(point) < 230 and point.endswith("…")
    assert all("(77)" not in s for s in d["subjects"])


def test_email_domain() -> None:
    assert email_domain("https://www.acme.example/careers") == "acme.example"
    assert email_domain("acme.example") == "acme.example"
    assert email_domain(None) is None


def test_api(db: Session, client: TestClient) -> None:
    job = ingest_job(db, JobInput(title="Magento Lead", company_name="Acme",
                                  url="https://jobs.acme.example/77", origin="import")).job
    db.commit()
    res = client.get(f"/api/v1/jobs/{job.id}/email-draft")
    assert res.status_code == 200
    assert "Magento Lead role at Acme" in res.json()["body"]
    assert client.get("/api/v1/jobs/999999/email-draft").status_code == 404
