from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.jobs import dedup
from app.jobs.jd_parser import parse_experience, parse_jd, parse_salary
from app.models.activity_log import ActivityLog
from app.models.job import Job
from app.services.job_service import JobInput, ingest_job
from tests.fixtures import SAMPLE_CV

JD = """About Acme
Acme builds e-commerce stores for global retailers.

Key Responsibilities
- Lead a team of Magento developers and mentor them
- Own Adobe Commerce Cloud architecture and code reviews

Requirements
- 10+ years of overall experience
- Strong PHP, Magento 2, Adobe Commerce, MySQL, GraphQL
- 3+ years of AWS experience
- B.Tech or MCA

Nice to have
- Hyva, Docker

Location: Remote (India)
CTC: 35 - 45 LPA, Full-time
"""


class TestJDParser:
    def test_sections_and_skills(self) -> None:
        p = parse_jd(JD, "Technical Lead - Adobe Commerce")
        assert {"PHP", "Magento 2", "Adobe Commerce", "MySQL", "GraphQL", "AWS"} <= set(
            p.required_skills
        )
        assert set(p.preferred_skills) == {"Hyvä", "Docker"}
        assert p.experience_min == 10 and p.experience_max is None
        assert {s.skill: s.years for s in p.skills if s.years} == {"AWS": 3}
        assert p.salary_min == Decimal("3500000") and p.salary_max == Decimal("4500000")
        assert p.salary_currency == "INR"
        assert p.locations == ["Remote India"] and p.work_model == "REMOTE"
        assert p.employment_type == "Full-time"
        assert p.qualifications == ["B.Tech or MCA"]
        assert len(p.responsibilities) == 2
        assert p.leadership_required and p.seniority == "LEAD"
        assert p.preferred == ["Hyva, Docker"]  # Location/CTC lines are not list items

    @pytest.mark.parametrize(
        ("text", "lo", "hi"),
        [
            ("5-8 years of experience", 5, 8),
            ("Minimum 7 years in software", 7, None),
            ("8+ yrs exp; 2+ years Kubernetes", 8, None),
            ("no years here", None, None),
        ],
    )
    def test_experience(self, text: str, lo: float | None, hi: float | None) -> None:
        assert parse_experience(text)[:2] == (lo, hi)

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("₹25-35 LPA", (2500000, 3500000, "INR")),
            ("Salary 18 to 24 lacs per annum", (1800000, 2400000, "INR")),
            ("$120k - $150k", (120000, 150000, "USD")),
            ("INR 1,50,000 - 2,00,000 per month", (1800000, 2400000, "INR")),
            ("competitive salary", (None, None, None)),
        ],
    )
    def test_salary(self, text: str, expected: tuple[Any, ...]) -> None:
        lo, hi, cur, _ = parse_salary(text)
        assert (lo, hi, cur) == expected

    def test_original_text_preserved(self) -> None:
        p = parse_jd("Must be fluent in German. PHP required.", "Dev")
        assert p.constraints[0].type == "LANGUAGE" and p.constraints[0].mandatory


class TestDedupRules:
    def test_requisition_ids(self) -> None:
        assert dedup.requisition_id("Job ID: JR-10423 Tech Lead") == "JR-10423"
        assert dedup.requisition_id("Req #88214") == "88214"
        assert dedup.requisition_id("no ids") is None

    def test_locations(self) -> None:
        assert dedup.locations_compatible(["Pune"], ["pune", "Mumbai"])
        assert dedup.locations_compatible([], ["Pune"])
        assert not dedup.locations_compatible(["Pune"], ["Chennai"])
        assert dedup.locations_compatible(["Remote India"], ["Remote"])

    def test_similarity(self) -> None:
        assert dedup.jd_similarity(JD, JD + "\nApply now!") > 0.9
        assert dedup.jd_similarity(JD, "Completely different text about Java") < 0.1


def add(client: TestClient, **over: Any) -> dict[str, Any]:
    body = {
        "title": "Technical Lead - Adobe Commerce",
        "company": "Acme Commerce",
        "url": "https://www.linkedin.com/jobs/view/technical-lead-at-acme-4012345678/"
        "?trk=public_jobs",
        "jd": JD,
    }
    body.update(over)
    r = client.post("/api/v1/jobs", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def setup_profile(client: TestClient) -> None:
    client.post(
        "/api/v1/cvs",
        data={"name": "Tech Lead CV", "target_role": "Technical Lead"},
        files={"file": ("cv.txt", SAMPLE_CV.encode(), "text/plain")},
    )
    cv = client.get("/api/v1/cvs").json()["items"][0]
    client.post("/api/v1/profile/import-cv", json={"cv_version_id": cv["current_version_id"]})


def test_manual_job_is_parsed_scored_and_logged(client: TestClient, db: Session) -> None:
    setup_profile(client)
    out = add(client, recruiter_name="Riya", recruiter_email="riya@acme.example")
    job = out["job"]
    assert out["created"] is True
    assert job["sources"] == ["LINKEDIN"]
    assert job["external_id"] == "4012345678"
    assert (
        job["source_links"][0]["normalized_url"]
        == "https://linkedin.com/jobs/view/technical-lead-at-acme-4012345678"
    )
    assert job["original_jd"] == JD  # original preserved verbatim
    assert job["work_model"] == "REMOTE"
    assert float(job["experience_min"]) == 10
    assert job["match_score"] is not None and job["score_stale"] is False
    assert job["match"]["components"][0]["key"] == "role"
    assert job["recommended_cv"]["name"] == "Tech Lead CV"
    assert job["recruiter"]["email"] == "riya@acme.example"
    assert job["company"]["verification_status"] == "DISCOVERED"
    actions = {a["action"] for a in job["activity"]}
    assert {"job.manually_added", "job.scored"} <= actions
    assert db.query(ActivityLog).filter_by(action="contact.created").count() == 1


def test_manual_fields_beat_parsed_values(client: TestClient) -> None:
    job = add(
        client,
        experience="5-8 years",
        salary="20-25 LPA",
        work_model="HYBRID",
        location="Pune",
        required_skills=["php", "laravel"],
    )["job"]
    assert (float(job["experience_min"]), float(job["experience_max"])) == (5, 8)
    assert float(job["salary_max"]) == 2500000
    assert job["work_model"] == "HYBRID" and job["location"] == "Pune"
    assert job["required_skills"] == ["PHP", "Laravel"]
    assert {"experience_min", "salary_max", "work_model", "required_skills"} <= set(
        job["manual_fields"]
    )
    # Re-parsing keeps manual values.
    again = client.post(f"/api/v1/jobs/{job['id']}/reparse").json()
    assert again["required_skills"] == ["PHP", "Laravel"] and again["work_model"] == "HYBRID"


def test_dedup_same_url_and_cross_source(client: TestClient) -> None:
    first = add(client)["job"]
    same = client.post(
        "/api/v1/jobs",
        json={
            "title": "Technical Lead - Adobe Commerce",
            "company": "Acme Commerce Pvt Ltd",
            "url": "https://linkedin.com/jobs/view/4012345678",
            "jd": JD,
        },
    ).json()
    assert same["created"] is False and same["job"]["id"] == first["id"]

    naukri = client.post(
        "/api/v1/jobs",
        json={
            "title": "Technical Lead – Adobe Commerce",
            "company": "ACME COMMERCE",
            "url": "https://www.naukri.com/job-listings-technical-lead-acme-pune-100823001234",
            "jd": JD,
            "location": "Remote India",
        },
    ).json()
    assert naukri["created"] is False
    assert naukri["duplicate_matched_by"] == "company_title_location"
    assert naukri["job"]["sources"] == ["LINKEDIN", "NAUKRI"]

    manual = client.post(
        "/api/v1/jobs",
        json={
            "title": "Technical Lead - Adobe Commerce",
            "company": "Acme Commerce",
            "jd": "Referral from a friend: " + JD,
            "source": "REFERRAL",
        },
    ).json()
    assert manual["job"]["id"] == first["id"]
    assert set(manual["job"]["sources"]) == {"LINKEDIN", "NAUKRI", "REFERRAL"}


def test_dedup_keeps_distinct_openings(client: TestClient) -> None:
    a = add(client, jd=JD + "\nJob ID: JR-1001")["job"]
    b = client.post(
        "/api/v1/jobs",
        json={
            "title": "Technical Lead - Adobe Commerce",
            "company": "Acme Commerce",
            "url": "https://acme.example/careers/jr-1002",
            "jd": JD + "\nJob ID: JR-1002",
        },
    ).json()
    assert b["created"] is True and b["job"]["id"] != a["id"]  # different requisitions
    other_city = client.post(
        "/api/v1/jobs",
        json={
            "title": "Technical Lead - Adobe Commerce",
            "company": "Acme Commerce",
            "location": "Chennai",
            "work_model": "ONSITE",
            "url": "https://acme.example/careers/chennai",
            "jd": "Onsite in Chennai. PHP.",
        },
    ).json()
    assert other_city["created"] is True


def test_preview_does_not_save(client: TestClient, db: Session) -> None:
    r = client.post(
        "/api/v1/jobs/preview",
        json={
            "url": "https://boards.greenhouse.io/acme/jobs/12345",
            "jd": JD,
            "title": "Tech Lead",
        },
    )
    body = r.json()
    assert body["source"] == "GREENHOUSE" and body["external_id"] == "12345"
    assert body["is_aggregator"] is False
    assert "PHP" in body["parsed"]["required_skills"]
    assert db.query(Job).count() == 0


def test_validation(client: TestClient) -> None:
    r = client.post(
        "/api/v1/jobs", json={"title": "x", "company": "y", "jd": "z", "url": "javascript:alert(1)"}
    )
    assert r.status_code == 422
    r = client.post("/api/v1/jobs", json={"title": "x", "company": "y", "jd": ""})
    assert r.status_code == 422


def test_filters_sorting_and_status(client: TestClient) -> None:
    setup_profile(client)
    lead = add(client)["job"]
    java = client.post(
        "/api/v1/jobs",
        json={
            "title": "Senior Java Developer",
            "company": "Beta Corp",
            "jd": "Requirements\n- 8+ years Java, Spring Boot\nLocation: Chennai (Onsite)",
        },
    ).json()
    assert java["job"]["match_score"] < lead["match_score"]
    listed = client.get("/api/v1/jobs").json()
    assert [j["id"] for j in listed["items"]] == [lead["id"], java["job"]["id"]]
    assert client.get("/api/v1/jobs", params={"technology": "magento2"}).json()["total"] == 1
    assert client.get("/api/v1/jobs", params={"work_model": "REMOTE"}).json()["total"] == 1
    assert (
        client.get("/api/v1/jobs", params={"min_score": lead["match_score"]}).json()["total"] == 1
    )
    assert client.get("/api/v1/jobs", params={"source": "LINKEDIN"}).json()["total"] == 1
    assert client.get("/api/v1/jobs", params={"q": "beta"}).json()["total"] == 1

    r = client.post(f"/api/v1/jobs/{lead['id']}/status", json={"status": "SHORTLISTED"})
    assert r.json()["status"] == "SHORTLISTED"
    assert any(a["action"] == "job.shortlisted" for a in r.json()["activity"])
    assert client.get("/api/v1/jobs", params={"status": ["SHORTLISTED"]}).json()["total"] == 1

    client.post(f"/api/v1/jobs/{java['job']['id']}/status", json={"status": "CLOSED"})
    open_jobs = client.get("/api/v1/jobs", params={"closed": False}).json()
    assert [j["id"] for j in open_jobs["items"]] == [lead["id"]]
    closed = client.get("/api/v1/jobs", params={"closed": True}).json()
    assert [j["id"] for j in closed["items"]] == [java["job"]["id"]]
    assert client.get("/api/v1/jobs").json()["total"] == 2  # no filter: everything


def test_stale_scores_and_reanalysis(client: TestClient) -> None:
    setup_profile(client)
    job = add(client)["job"]
    assert job["score_stale"] is False
    client.patch(
        "/api/v1/preferences", json={"preferred_locations": ["Chennai"], "remote_ok": False}
    )
    stale = client.get(f"/api/v1/jobs/{job['id']}").json()
    assert stale["score_stale"] is True  # never silently treated as current
    assert client.get("/api/v1/jobs", params={"stale": True}).json()["total"] == 1
    result = client.post(
        "/api/v1/matches/reanalyze", json={"only_stale": True}, params={"wait": True}
    ).json()
    assert result == {"requested": 1, "analyzed": 1}
    fresh = client.get(f"/api/v1/jobs/{job['id']}").json()
    assert fresh["score_stale"] is False
    assert fresh["match_score"] < job["match_score"]  # remote no longer preferred
    history = client.get(f"/api/v1/matches/jobs/{job['id']}/history").json()
    assert len(history) == 2 and history[0]["target_version"] > history[1]["target_version"]
    # Same inputs again: no new history row (deterministic, idempotent).
    client.post(f"/api/v1/matches/jobs/{job['id']}")
    assert len(client.get(f"/api/v1/matches/jobs/{job['id']}/history").json()) == 2


def test_scoring_config_versioning(client: TestClient) -> None:
    job = add(client)["job"]
    cfg = client.get("/api/v1/settings/scoring").json()
    assert cfg["version"] == 1 and cfg["config"]["weights"]["skills"] == 25
    new = cfg["config"]
    new["weights"]["skills"], new["weights"]["role"] = 30, 15
    r = client.put("/api/v1/settings/scoring", json={"config": new, "note": "skills heavier"})
    assert r.json()["version"] == 2
    assert client.get(f"/api/v1/jobs/{job['id']}").json()["score_stale"] is True
    bad = dict(new, weights={**new["weights"], "role": 99})
    assert client.put("/api/v1/settings/scoring", json={"config": bad}).status_code == 422


def test_merge_and_add_source(client: TestClient) -> None:
    a = add(client)["job"]
    b = client.post(
        "/api/v1/jobs",
        json={
            "title": "Adobe Commerce Tech Lead",
            "company": "Acme Commerce",
            "url": "https://jobs.lever.co/acme/8f8e8d8c-1111-2222-3333-444455556666",
            "jd": "Different words entirely about a lead role.",
        },
    ).json()["job"]
    assert b["id"] != a["id"]
    merged = client.post(f"/api/v1/jobs/{a['id']}/merge", json={"merge_id": b["id"]}).json()
    assert set(merged["sources"]) == {"LINKEDIN", "LEVER"}
    assert client.get(f"/api/v1/jobs/{b['id']}").status_code == 404
    clash = client.post(
        f"/api/v1/jobs/{a['id']}/sources", json={"url": "https://indeed.com/viewjob?jk=abc123"}
    ).json()
    assert "INDEED" in clash["sources"]


def test_ingest_service_for_importers(db: Session) -> None:
    result = ingest_job(
        db,
        JobInput(
            title="Senior PHP Developer",
            company_name="Gamma",
            url="https://gamma.example/jobs/1",
            jd_text="PHP, Laravel. 5+ years.",
            posting_date=date(2026, 9, 1),
            origin="career_ops",
            raw={"career_ops": {"score": 4.2}},
        ),
    )
    assert result.created and result.job.source == "COMPANY_CAREERS"
    assert result.job.source_links[0].raw == {"career_ops": {"score": 4.2}}


def test_work_model_from_imported_location(db: Session) -> None:
    result = ingest_job(
        db,
        JobInput(
            title="Adobe Commerce Technical Lead",
            company_name="Bosch",
            origin="career_ops",
            location="Bengaluru, India (Hybrid)",
            jd_text="PHP, Magento 2. 8-10 years.",
        ),
    )
    assert result.job.work_model == "HYBRID"


def test_single_paragraph_jd_is_classified_per_sentence() -> None:
    p = parse_jd(
        "Requirements: 10+ years experience. Strong PHP, Magento 2, MySQL. "
        "Good to have: AWS, Docker. Location: Pune (Hybrid). Only immediate joiners.",
        "Tech Lead",
    )
    assert set(p.required_skills) >= {"PHP", "Magento 2", "MySQL"}
    assert set(p.preferred_skills) == {"AWS", "Docker"}
    notice = [c for c in p.constraints if c.type == "NOTICE_PERIOD"]
    assert notice and notice[0].text == "Only immediate joiners." and notice[0].mandatory


def test_delete_job_and_imports_skip_it(client: TestClient, db: Session) -> None:
    from app.services.job_service import DeletedJobError, JobInput, ingest_job

    job = add(client)["job"]
    r = client.delete(f"/api/v1/jobs/{job['id']}")
    assert r.status_code == 200 and r.json()["deleted"] == job["id"]
    assert client.get(f"/api/v1/jobs/{job['id']}").status_code == 404

    # A scan/import finding the same posting (same URL) does not bring it back...
    with pytest.raises(DeletedJobError):
        ingest_job(db, JobInput(
            title="Technical Lead - Adobe Commerce", company_name="Acme Commerce",
            url="https://www.linkedin.com/jobs/view/4012345678/", origin="scan"))
    # ...nor does a file import row without a URL (matched on company + title).
    with pytest.raises(DeletedJobError):
        ingest_job(db, JobInput(title="technical lead - adobe commerce",
                                company_name="ACME Commerce", origin="import"))
    # Adding it again by hand works, and imports may update it from then on.
    again = add(client)["job"]
    assert again["id"] != job["id"]
    assert ingest_job(db, JobInput(title="Technical Lead - Adobe Commerce",
                                   company_name="Acme Commerce", origin="import")).job.id \
        == again["id"]


def test_delete_job_with_application_needs_confirmation(client: TestClient) -> None:
    job = add(client)["job"]
    assert client.post("/api/v1/applications", json={"job_id": job["id"]}).status_code == 201
    r = client.delete(f"/api/v1/jobs/{job['id']}")
    assert r.status_code == 409
    assert r.json()["error"]["details"]["applications"] == 1
    assert "1 application" in r.json()["error"]["message"]
    assert client.delete(f"/api/v1/jobs/{job['id']}", params={"force": True}).status_code == 200
    assert client.get("/api/v1/applications").json()["total"] == 0


def test_locations_compare_by_city() -> None:
    from app.jobs.dedup import locations_compatible as same

    assert same(["Ahmedabad, Gujarat / Pune, Maharashtra, India"], ["Pune / Ahmedabad"])
    assert same(["Bangalore"], ["Bengaluru, Karnataka"])
    assert not same(["Pune, Maharashtra"], ["Mumbai, Maharashtra"])  # same state, other city
    assert not same(["Chennai, Tamil Nadu"], ["Coimbatore, Tamil Nadu"])
