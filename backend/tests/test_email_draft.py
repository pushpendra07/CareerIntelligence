from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.company import Company, Contact
from app.models.job import Job
from app.models.profile import ProfessionalProfile, TargetProfile
from app.services.email_draft import build_draft, email_domain, short_company
from app.services.job_service import JobInput, ingest_job

MATCH = {"skills": [
    {"skill": "Kubernetes", "match": "MISSING", "importance": "REQUIRED"},
    {"skill": "GraphQL", "match": "EXACT_MATCH", "importance": "PREFERRED"},
    {"skill": "Magento 2", "match": "EXACT_MATCH", "importance": "REQUIRED"},
    {"skill": "PHP", "match": "EXACT_MATCH", "importance": "REQUIRED"},
    {"skill": "AWS", "match": "PARTIAL_MATCH", "importance": "REQUIRED"},
]}


def _job(**kw: object) -> Job:
    company = Company(name="Acme Commerce Private Limited", website="https://www.acme.example")
    defaults: dict[str, object] = {
        "title": "Magento Tech Lead", "location": "Pune, Maharashtra, India", "external_id": "R-77",
        "parsed_jd": {"domains": ["E-commerce", "Banking"]},
        "required_skills": ["Magento 2", "PHP", "Kubernetes"], "preferred_skills": ["GraphQL"],
        "original_jd": "Lead our Adobe Commerce (Magento 2) team.",
    }
    job = Job(company=company, **{**defaults, **kw})
    job.recruiter_contact = None
    return job


def _profile() -> ProfessionalProfile:
    return ProfessionalProfile(
        full_name="Test Person", email="test@example.com", phone="+00 000", linkedin_url=None,
        total_experience_years=Decimal("12.6"), leadership_experience_years=Decimal("8"),
        primary_roles=["Developer"], domains=["E-commerce"],
        leadership=["Mentoring", "Code Review"],
        companies=[{"title": "Senior Developer (Tech Lead responsibilities)", "company": "Shop Co",
                    "is_current": True}],
        certifications=["Adobe Certified Expert – Adobe Commerce Developer",
                        "AWS Cloud Practitioner"],
        projects=[
            {"name": "Blog", "skills": ["WordPress"], "highlights": ["Built a WordPress blog."]},
            {"name": "Grocer", "skills": ["Magento 2", "GraphQL", "PHP"], "highlights": [
                "Extended the Magento 2 GraphQL schema for checkout. Second sentence here.",
                "Cut PHP page render time by 40%."]},
        ],
        achievements=["Won an award."])


def test_draft_ties_job_needs_to_real_evidence() -> None:
    target = TargetProfile(preferred_locations=["Pune"], notice_period_days=30)
    d = build_draft(_job(), _profile(), MATCH, [], "https://jobs.acme.example/77", target)
    body = d["body"]
    assert body.startswith("Dear Hiring Team,")
    assert ("I'm Test Person, a Senior Developer at Shop Co with Tech Lead responsibilities and "
            "12+ years of experience in E-commerce.") in body
    assert "Magento Tech Lead role at Acme Commerce in Pune, Req. ID R-77." in body
    # Only exact matches are claimed: never the missing or partial ones.
    assert "The role asks for Magento 2 and PHP, which is my day-to-day work." in body
    assert "Kubernetes" not in body and "AWS" not in body.replace("AWS Cloud", "")
    # The most relevant project, in the first person, first sentence only.
    assert "Most recently, on Grocer, I extended the Magento 2 GraphQL schema for checkout." in body
    assert "Second sentence" not in body and "WordPress" not in body.split("What I'd")[0]
    assert "• Adobe Certified Expert – Adobe Commerce Developer" in body  # the JD's platform
    assert "Cloud Practitioner" not in body  # the job doesn't ask for AWS
    assert "• 8 years leading teams: mentoring and code review" in body  # a lead role
    assert "• Cut PHP page render time by 40%" in body
    assert "• Also experienced with GraphQL from your nice-to-haves" in body
    assert "Pune works well for me; I can join within 30 days." in body
    assert body.endswith("Test Person\nSenior Developer (Tech Lead responsibilities) | Shop Co\n"
                         "+00 000 · test@example.com")
    assert d["subjects"][0] == "Magento Tech Lead – 12+ yrs E-commerce | Test Person"
    assert "Adobe Certified Expert for your Magento Tech Lead role" in d["subjects"]
    assert d["company_domain"] == "acme.example" and d["to"] is None


def test_short_message_for_linkedin() -> None:
    d = build_draft(_job(), _profile(), MATCH, [], "https://jobs.acme.example/77")
    short = d["short"]
    assert short.startswith("Hello,")
    assert "I work hands-on with Magento 2, PHP and GraphQL." in short
    assert short.endswith("Thanks,\nTest")
    assert len(short) < 700


def test_draft_without_profile_or_match() -> None:
    d = build_draft(_job(external_id=None, location=None, title="Developer"), ProfessionalProfile(),
                    None, [], None)
    assert "What I'd bring" not in d["body"] and "Job posting" not in d["body"]
    assert "I'd like to apply for the Developer role at Acme Commerce." in d["body"]
    assert d["body"].endswith("Best regards,")
    assert d["subjects"] == ["Developer", "Application: Developer",
                             "Interested in the Developer role at Acme Commerce"]


def test_recruiter_is_greeted_and_addressed() -> None:
    job = _job()
    job.recruiter_contact = Contact(name="Asha Rao", email="asha@acme.example")
    other = Contact(name="Talent Team", email="jobs@acme.example", job_title="TA")
    d = build_draft(job, _profile(), MATCH, [other], None)
    assert d["body"].startswith("Hi Asha,") and d["short"].startswith("Hi Asha,")
    assert d["to"] == "asha@acme.example"
    assert [o["email"] for o in d["to_options"]] == ["asha@acme.example", "jobs@acme.example"]


def test_names_and_domains() -> None:
    assert short_company("Acme Technologies Private Limited") == "Acme Technologies"
    assert short_company("Foo Pvt. Ltd.") == "Foo"
    assert short_company("Tata Co") == "Tata Co"
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
    assert res.json()["short"]
    assert client.get("/api/v1/jobs/999999/email-draft").status_code == 404
