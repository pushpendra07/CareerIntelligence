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
    other_title = client.post(
        "/api/v1/jobs",
        json={
            "title": "Senior Technical Lead - Adobe Commerce",
            "company": "Acme Commerce",
            "url": "https://acme.example/careers/jr-1003",
            "jd": JD,
        },
    ).json()
    assert other_title["created"] is True  # another level is another job


def test_same_job_in_another_city_is_one_job(client: TestClient) -> None:
    a = add(client, location="Pune", jd="Lead our PHP team.")["job"]
    other_city = client.post("/api/v1/jobs", json={
        "title": "Technical Lead - Adobe Commerce", "company": "Acme Commerce",
        "location": "Chennai", "url": "https://acme.example/careers/chennai", "jd": "PHP.",
    }).json()
    assert other_city["created"] is False and other_city["job"]["id"] == a["id"]
    assert other_city["duplicate_matched_by"] == "company_title"
    assert other_city["job"]["locations"] == ["Pune", "Chennai"]
    client.post(f"/api/v1/jobs/{a['id']}/status", json={"status": "NOT_RELEVANT"})
    # Rejected maybe for its city: the same title somewhere else is shown again.
    third = client.post("/api/v1/jobs", json={
        "title": "Technical Lead - Adobe Commerce", "company": "Acme Commerce",
        "location": "Kolkata", "url": "https://acme.example/careers/kolkata", "jd": "PHP.",
    }).json()
    assert third["created"] is True


def test_reposted_job_and_same_id_in_url(client: TestClient) -> None:
    body = ("Chalhoub Group's Capability Hub builds technology for luxury retail. We are "
            "hiring an engineer to build our ecommerce storefronts on Salesforce Commerce "
            "Cloud, own integrations with order management, and mentor developers. "
            "You have 5+ years of experience with SFCC, JavaScript and Node.js. ")
    applied = add(client, title="Software Engineer - Ecommerce SFCC", company="Chalhoub Group",
                  location="Bengaluru", jd=body + "Work from our Bengaluru office.",
                  url="https://careers.chalhoubgroup.com/jobs/8435470-se-ecommerce-sfcc")["job"]
    client.post(f"/api/v1/jobs/{applied['id']}/status", json={"status": "APPLIED"})
    repost = client.post("/api/v1/jobs", json={
        "title": "Software Engineer, Ecommerce", "company": "Chalhoub Group",
        "location": "Bengaluru", "jd": body + "Hybrid, three days a week in the office.",
        "url": "https://careers.chalhoubgroup.com/jobs/8550916-software-engineer-ecommerce",
    }).json()
    assert repost["created"] is False and repost["job"]["id"] == applied["id"]
    assert repost["duplicate_matched_by"] == "reposted"
    senior = client.post("/api/v1/jobs", json={
        "title": "Senior Software Engineer, Ecommerce", "company": "Chalhoub Group",
        "location": "Bengaluru", "jd": body,
        "url": "https://careers.chalhoubgroup.com/jobs/8551280-senior-software-engineer-ecommerce",
    }).json()
    assert senior["created"] is True  # a senior role is a different job
    renamed = client.post("/api/v1/jobs", json={  # same posting ID, reworded link and title
        "title": "Sr. Engineer (Ecommerce)", "company": "Chalhoub Group", "jd": "x",
        "url": "https://careers.chalhoubgroup.com/jobs/8551280-sr-engineer",
    }).json()
    assert renamed["created"] is False and renamed["duplicate_matched_by"] == "url_id"
    assert renamed["job"]["id"] == senior["job"]["id"]


def test_similar_titles_with_other_posting_ids_stay_apart(client: TestClient) -> None:
    jd = JD + "\nDigital experience consulting for enterprise clients."
    a = add(client, title="Enterprise Architect (Digital Experience Strategy)", company="Adobe",
            url="https://careers.adobe.com/us/en/job/R169932/Enterprise-Architect", jd=jd)["job"]
    b = add(client, title="Enterprise Architect (Digital Experience Architecture)",
            company="Adobe", jd=jd,
            url="https://careers.adobe.com/us/en/job/R169933/Enterprise-Architect")
    assert b["created"] is True and b["job"]["id"] != a["id"]


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
    by_id = client.get("/api/v1/jobs", params={"q": f"#{java['job']['id']}"}).json()["items"]
    assert [j["id"] for j in by_id] == [java["job"]["id"]]
    assert client.get("/api/v1/jobs", params={"q": str(lead["id"])}).json()["items"][0]["id"] == (
        lead["id"])

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


def test_find_and_merge_existing_duplicates(client: TestClient) -> None:
    a = add(client, location="Pune", jd="Lead our PHP team in Pune.")["job"]
    b = add(client, title="Magento Lead", location="Pune, Maharashtra",
            url="https://acme.example/careers/magento-lead", jd="Different text.")["job"]
    other_role = add(client, title="QA Lead", url="https://acme.example/careers/qa",
                     jd="Testing.")["job"]
    assert b["id"] != a["id"] and other_role["id"] != a["id"]
    # Saved before the dedup rules caught it: the same posting under two IDs.
    client.patch(f"/api/v1/jobs/{b['id']}", json={"title": "Technical Lead - Adobe Commerce"})
    assert client.post("/api/v1/applications", json={"job_id": b["id"]}).status_code == 201

    dups = client.get("/api/v1/jobs/duplicates").json()
    assert dups["extra_jobs"] == 1
    assert [j["id"] for j in dups["groups"][0]] == [b["id"], a["id"]]  # applied copy first

    r = client.post("/api/v1/jobs/duplicates/merge", json={}).json()
    assert r == {"groups": 1, "jobs_removed": 1, "merged": [{"kept": b["id"], "merged": [a["id"]]}]}
    assert client.get(f"/api/v1/jobs/{a['id']}").status_code == 404
    kept = client.get(f"/api/v1/jobs/{b['id']}").json()
    assert set(kept["sources"]) == {"LINKEDIN", "COMPANY_CAREERS"}
    assert kept["status"] == "APPLIED"
    assert client.get("/api/v1/applications").json()["total"] == 1
    assert client.get(f"/api/v1/jobs/{other_role['id']}").status_code == 200
    assert client.get("/api/v1/jobs/duplicates").json()["extra_jobs"] == 0
    again = client.post("/api/v1/jobs", json={  # the LinkedIn link now belongs to the kept job
        "title": "Lead", "company": "Acme Commerce", "jd": "x",
        "url": "https://www.linkedin.com/jobs/view/4012345678",
    }).json()
    assert again["created"] is False and again["job"]["id"] == b["id"]


def test_dedup_finds_old_job_with_same_title(db: Session) -> None:
    first = ingest_job(db, JobInput(title="Magento Architect", company_name="Busy Co",
                                    location="Pune", origin="scan"), analyze=False, commit=False)
    for n in range(205):  # pushes the first job out of the 200 most recent
        ingest_job(db, JobInput(title=f"Role {n}", company_name="Busy Co", origin="scan"),
                   analyze=False, commit=False)
    again = ingest_job(db, JobInput(title="Magento Architect", company_name="Busy Co",
                                    location="Pune", origin="scan"), analyze=False, commit=False)
    assert again.created is False and again.job.id == first.job.id


def test_status_usage_counts_status_changes(client: TestClient) -> None:
    a = add(client)["job"]
    b = add(client, title="QA Lead", url="https://acme.example/careers/qa", jd="Testing.")["job"]
    changes = [(a["id"], "NOT_RELEVANT"), (b["id"], "NOT_RELEVANT"), (a["id"], "APPLIED")]
    for job_id, status in changes:
        r = client.post(f"/api/v1/jobs/{job_id}/status", json={"status": status})
        assert r.status_code == 200
    usage = client.get("/api/v1/jobs/status-usage").json()
    assert list(usage.items())[:2] == [("NOT_RELEVANT", 2), ("APPLIED", 1)]


def test_list_shows_when_the_status_was_set(client: TestClient) -> None:
    job = add(client)["job"]
    client.post(f"/api/v1/jobs/{job['id']}/status", json={"status": "SHORTLISTED"})
    row = next(j for j in client.get("/api/v1/jobs").json()["items"] if j["id"] == job["id"])
    assert row["status"] == "SHORTLISTED"
    assert row["status_changed_at"]


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


def test_status_counts_for_tabs(client: TestClient) -> None:
    lead = add(client)["job"]
    other = add(client, title="Magento Developer", company="Beta Corp",
                url="https://jobs.lever.co/beta/1")["job"]
    client.post(f"/api/v1/jobs/{other['id']}/status", json={"status": "APPLIED"})
    counts = client.get("/api/v1/jobs/status-counts").json()
    assert counts == {lead["status"]: 1, "APPLIED": 1}
    # Same filters as the list (status/closed ignored so every tab gets its count).
    assert client.get("/api/v1/jobs/status-counts",
                      params={"q": "beta", "status": ["NEW"]}).json() == {"APPLIED": 1}


def test_sort_by_every_column_both_ways(client: TestClient) -> None:
    a = add(client)["job"]  # Technical Lead - Adobe Commerce @ Acme Commerce
    b = add(client, title="Backend Developer", company="Zeta Labs",
            url="https://jobs.lever.co/zeta/1")["job"]
    client.post(f"/api/v1/jobs/{b['id']}/status", json={"status": "APPLIED"})

    def ids(sort: str) -> list[int]:
        r = client.get("/api/v1/jobs", params={"sort": sort})
        assert r.status_code == 200, (sort, r.text)
        return [j["id"] for j in r.json()["items"]]

    assert ids("title") == [b["id"], a["id"]] and ids("-title") == [a["id"], b["id"]]
    assert ids("company") == [a["id"], b["id"]] and ids("-company") == [b["id"], a["id"]]
    assert ids("status") == [a["id"], b["id"]]  # New before Applied (pipeline order)
    assert ids("-status") == [b["id"], a["id"]]
    for sort in ("match_score", "-match_score", "location", "-location", "experience",
                 "-experience", "salary", "-salary", "posting_date", "-posting_date",
                 "created_at", "-created_at"):
        assert sorted(ids(sort)) == sorted([a["id"], b["id"]])
    assert client.get("/api/v1/jobs", params={"sort": "bogus"}).status_code == 422


def test_added_via_tag_and_filter(client: TestClient) -> None:
    manual = add(client)["job"]
    assert manual["added_via"] == ["manual"]
    sheet = client.post("/api/v1/sheets", json={
        "url": "https://docs.google.com/spreadsheets/d/1iE8Xn7duwizMkvnJJMbfHWLL-DRbIpRlumH_P8aa7Co/edit",
        "title": "Seen Jobs"}).json()
    rows = [{"title": "Magento Developer", "company": "Beta Corp", "job_url": "https://jobs.lever.co/beta/1"},
            # same posting as the manual job: merged, and now tagged with both
            {"title": "Technical Lead - Adobe Commerce", "company": "Acme Commerce",
             "job_url": "https://www.linkedin.com/jobs/view/4012345678/"}]
    client.post(f"/api/v1/sheets/{sheet['id']}/import-rows",
                json={"tabs": [{"tab": "T", "rows": rows}]})
    jobs = {j["title"]: j for j in client.get("/api/v1/jobs").json()["items"]}
    assert jobs["Magento Developer"]["added_via"] == ["sheet"]
    assert jobs["Technical Lead - Adobe Commerce"]["added_via"] == ["manual", "sheet"]

    def titles(via: str) -> set[str]:
        items = client.get("/api/v1/jobs", params={"added_via": via}).json()["items"]
        return {j["title"] for j in items}

    assert titles("sheet") == {"Magento Developer", "Technical Lead - Adobe Commerce"}
    assert titles("manual") == {"Technical Lead - Adobe Commerce"}
    assert titles("scanner") == set()
    assert client.get("/api/v1/jobs", params={"added_via": "bogus"}).status_code == 422


def test_sort_by_job_id(client: TestClient) -> None:
    a = add(client)["job"]
    b = add(client, title="Magento Developer", company="Beta Corp",
            url="https://jobs.lever.co/beta/2")["job"]
    def ids(sort: str) -> list[int]:
        return [j["id"] for j in client.get("/api/v1/jobs", params={"sort": sort}).json()["items"]]

    assert ids("id") == [a["id"], b["id"]] and ids("-id") == [b["id"], a["id"]]


def test_job_comments(client: TestClient) -> None:
    job = add(client)["job"]
    url = f"/api/v1/jobs/{job['id']}/comments"
    first = client.post(url, json={"body": "  Called the recruiter, waiting to hear back  "})
    assert first.status_code == 201
    assert first.json()["body"] == "Called the recruiter, waiting to hear back"
    assert first.json()["created_at"]
    client.post(url, json={"body": "Second round next week"})
    assert client.post(url, json={"body": "   "}).status_code == 422

    comments = client.get(f"/api/v1/jobs/{job['id']}").json()["comments"]
    assert [c["body"] for c in comments] == [
        "Second round next week", "Called the recruiter, waiting to hear back"
    ]

    assert client.delete(f"{url}/{first.json()['id']}").status_code == 204
    assert client.delete(f"{url}/{first.json()['id']}").status_code == 404
    comments = client.get(f"/api/v1/jobs/{job['id']}").json()["comments"]
    assert [c["body"] for c in comments] == ["Second round next week"]
    assert client.post("/api/v1/jobs/999999/comments", json={"body": "x"}).status_code == 404


def test_cms_and_language_skills_detected() -> None:
    p = parse_jd("Drupal 10 or WordPress developer. PHP, Laravel and Python required.", "CMS Dev")
    assert {"Drupal", "WordPress", "PHP", "Laravel", "Python"} <= set(p.required_skills)


def test_bulk_status_and_delete(client: TestClient) -> None:
    def add(i: int) -> int:
        new = {"title": f"PHP Lead {i}", "company": f"Co{i}", "jd": "PHP and Magento 2 lead role"}
        return int(client.post("/api/v1/jobs", json=new).json()["job"]["id"])

    ids = [add(i) for i in range(3)]
    body = {"job_ids": ids[:2] + [999999], "action": "status", "status": "NOT_RELEVANT"}
    r = client.post("/api/v1/jobs/bulk", json=body)
    assert r.json() == {"updated": 2, "missing": [999999]}
    assert {client.get(f"/api/v1/jobs/{i}").json()["status"] for i in ids[:2]} == {"NOT_RELEVANT"}
    no_status = client.post("/api/v1/jobs/bulk", json={"job_ids": ids, "action": "status"})
    assert no_status.status_code == 422

    client.post("/api/v1/applications", json={"job_id": ids[2]})  # tracked: never bulk-deleted
    gone = client.post("/api/v1/jobs/bulk", json={"job_ids": ids, "action": "delete"}).json()
    assert gone["deleted"] == 2
    assert [s["id"] for s in gone["skipped"]] == [ids[2]]
    assert client.get(f"/api/v1/jobs/{ids[0]}").status_code == 404
    assert client.get(f"/api/v1/jobs/{ids[2]}").status_code == 200
    empty = client.post("/api/v1/jobs/bulk", json={"job_ids": [], "action": "delete"})
    assert empty.status_code == 422


def test_edit_location_and_work_model(client: TestClient) -> None:
    job = add(client, location="Bengaluru", work_model="REMOTE")["job"]
    assert job["work_model"] == "REMOTE"
    r = client.patch(
        f"/api/v1/jobs/{job['id']}",
        json={"location": "  Pune, India ", "work_model": "HYBRID", "employment_type": "Contract"},
    )
    assert r.status_code == 200, r.text
    edited = r.json()
    assert edited["location"] == "Pune, India" and edited["locations"] == ["Pune, India"]
    assert edited["work_model"] == "HYBRID" and edited["employment_type"] == "Contract"
    assert {"location", "locations", "work_model"} <= set(edited["manual_fields"])
    # "Not stated" hands the work model back to the description.
    cleared = client.patch(f"/api/v1/jobs/{job['id']}", json={"work_model": None}).json()
    assert "work_model" not in cleared["manual_fields"]
    assert cleared["work_model"] in ("REMOTE", "HYBRID", "ONSITE", "UNKNOWN")
    blank = client.patch(f"/api/v1/jobs/{job['id']}", json={"location": ""}).json()
    assert blank["location"] is None and blank["locations"] == []


def test_agent_import_checks_then_adds_jobs_from_portals(client: TestClient) -> None:
    jd = "Senior PHP Developer. Magento 2, Laravel, MySQL. 6+ years. Hybrid in Pune."
    client.post("/api/v1/jobs", json={
        "title": "Magento Tech Lead", "company": "Acme", "location": "Pune, India",
        "url": "https://www.naukri.com/job-listings-magento-tech-lead-acme-pune-123456789012",
        "jd": "Magento tech lead. Magento 2, PHP. 8+ years."})
    deleted = client.post("/api/v1/jobs", json={
        "title": "WordPress Lead", "company": "Gone Co", "jd": "WordPress lead.",
        "url": "https://www.linkedin.com/jobs/view/4100000001/"}).json()["job"]["id"]
    client.delete(f"/api/v1/jobs/{deleted}")
    rows = [
        {"Job Title": "Senior PHP Developer", "Company": "Beta Labs", "Location": "Pune",
         "Workplace Type": "Hybrid", "Experience": "6+ years", "Salary": "25-30 LPA",
         "Posted": "3 days ago (2026-10-16)", "Portal": "LinkedIn", "description": jd,
         "link": "https://www.linkedin.com/jobs/view/4100000099/?trk=x"},
        {"title": "Magento Tech Lead", "company": "Acme", "location": "Bengaluru",  # same job
         "url": "https://www.linkedin.com/jobs/view/4100000100/"},
        {"title": "Senior PHP Developer", "company": "Beta Labs",  # same posting again
         "url": "https://www.linkedin.com/jobs/view/4100000099/"},
        {"title": "WordPress Lead", "company": "Gone Co",
         "url": "https://www.linkedin.com/jobs/view/4100000001/"},
        {"title": "", "company": "X"},
    ]
    check = client.post("/api/v1/jobs/agent-import", json={"jobs": rows, "dry_run": True}).json()
    assert [r["result"] for r in check["results"]] == [
        "new", "duplicate", "repeat", "deleted", "invalid"]
    assert check["counts"]["new"] == 1
    # a dry run saves nothing
    assert client.get("/api/v1/jobs", params={"q": "Beta Labs"}).json()["total"] == 0

    done = client.post("/api/v1/jobs/agent-import", json={"jobs": rows}).json()
    new_id = done["results"][0]["job_id"]
    job = client.get(f"/api/v1/jobs/{new_id}").json()
    assert job["added_via"] == ["ai_search"] and job["source"] == "LINKEDIN"
    assert job["work_model"] == "HYBRID" and job["posting_date"] == "2026-10-16"
    assert job["salary_text"] == "25-30 LPA" and job["match_score"] is not None
    assert "AI search · LinkedIn" in job["source_links"][0]["detail"]
    acme = client.get(f"/api/v1/jobs/{done['results'][1]['job_id']}").json()
    assert "ai_search" in acme["added_via"] and "Bengaluru" in acme["location"]
    listed = client.get("/api/v1/jobs", params={"added_via": "ai_search"}).json()
    assert listed["total"] == 2
    assert client.post("/api/v1/jobs/agent-import", json={"jobs": []}).status_code == 422
    assert done["results"][0]["score"] is not None and done["results"][0]["status"] == "NEW"
    again = client.post("/api/v1/jobs/agent-import",  # the user chose "Add anyway"
                        json={"jobs": [rows[3]], "allow_deleted": True}).json()
    assert again["results"][0]["result"] == "new"


def test_extension_adds_one_job_once_across_portals(client: TestClient) -> None:
    """The Job collector adds the job the user is looking at; seen again (same link with other
    tracking, or the same job on another portal) it is matched, never added twice."""
    shine = {"title": "Magento Developer", "company": "Delta Retail Pvt Ltd", "location": "Jaipur",
             "portal": "Shine", "description": "Adobe Commerce, PHP, MySQL.",
             "url": "https://www.shine.com/jobs/magento-developer/delta-retail-pvt-ltd/17654321"}
    first = client.post("/api/v1/jobs/agent-import", json={"jobs": [shine]}).json()["results"][0]
    assert first["result"] == "new"
    tracked = {**shine, "url": shine["url"] + "?utm_source=mail&utm_medium=x"}
    naukri = {**shine, "portal": "Naukri", "location": "Jaipur, Rajasthan",
              "url": "https://www.naukri.com/job-listings-magento-developer-delta-retail-jaipur-231024500777"}
    for row, how in ((tracked, "url"), (naukri, "company_title_location")):
        r = client.post("/api/v1/jobs/agent-import", json={"jobs": [row]}).json()["results"][0]
        assert (r["result"], r["job_id"], r["matched_by"]) == ("duplicate", first["job_id"], how)
    job = client.get(f"/api/v1/jobs/{first['job_id']}").json()
    assert len(job["source_links"]) == 2  # the Naukri link was added to the same job


def test_extension_download_is_set_up_for_this_app(client: TestClient) -> None:
    import io
    import zipfile

    r = client.get("/api/v1/extension.zip", params={"app": "http://127.0.0.1:5173/jobs"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    assert "career-intelligence-extension/manifest.json" in names
    assert "career-intelligence-extension/icons/icon-48.png" in names
    settings = zf.read("career-intelligence-extension/settings.js").decode()
    assert 'apiUrl: "http://testserver", appUrl: "http://127.0.0.1:5173"' in settings
    assert client.get("/api/v1/extension.zip", params={"app": "javascript:x"}).status_code == 422


def test_search_finds_jobs_by_skill(client: TestClient, db: Session) -> None:
    def add(title: str, url: str, required: list[str], preferred: list[str]) -> int:
        job = ingest_job(db, JobInput(title=title, company_name="Skill Co", url=url,
                                      origin="import", required_skills=required,
                                      preferred_skills=preferred)).job
        return job.id

    m2 = add("Backend Developer", "https://skill.example/1", ["Magento 2", "PHP"], [])
    gql = add("Platform Engineer", "https://skill.example/2", ["Java"], ["GraphQL"])
    other = add("Frontend Developer", "https://skill.example/3", ["React"], [])
    db.commit()

    def found(**params: str) -> set[int]:
        items = client.get("/api/v1/jobs", params={**params, "size": "100"}).json()["items"]
        return {j["id"] for j in items} & {m2, gql, other}

    assert found(q="magento2") == {m2}  # an alias finds the skill's canonical name
    assert found(q="graphql") == {gql}  # nice-to-have skills count too
    assert found(q="php") == {m2}  # not in any title: found through the skills
    assert found(technology="magento2") == {m2}
