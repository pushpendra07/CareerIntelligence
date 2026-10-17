import json

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.jobs.jd_fetch import fetch_description, not_fetched_reason
from app.models.job import Job
from app.services import description_service
from app.services.job_service import JobInput, ingest_job
from tests.test_scanner import FakeHttp

GH_JOB = "https://job-boards.greenhouse.io/acme/jobs/42"
GH_API = "https://boards-api.greenhouse.io/v1/boards/acme/jobs/42"
LONG = "Lead our Magento 2 and Adobe Commerce team. PHP, MySQL, Laravel required. " * 6


def _job(db: Session, title: str, url: str) -> Job:
    return ingest_job(db, JobInput(title=title, company_name="Acme", url=url, origin="import")).job


def test_reads_job_boards_and_page_data() -> None:
    http = FakeHttp({
        GH_API: {"content": f"&lt;p&gt;{LONG}&lt;/p&gt;"},
        "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Careers/job/Pune/Lead_R1":
            {"jobPostingInfo": {"jobDescription": f"<p>{LONG}</p>"}},
        "https://careers.acme.example/job/7": (
            '<script type="application/ld+json">'
            + json.dumps({"@type": "JobPosting", "title": "Lead", "description": f"<p>{LONG}</p>"})
            + "</script>"),
        "https://careers.acme.example/job/8": "<html>No structured data</html>",
    })
    assert "Magento 2" in (fetch_description(GH_JOB, http) or "")
    workday_job = "https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Pune/Lead_R1"
    assert fetch_description(workday_job, http)
    assert fetch_description("https://careers.acme.example/job/7", http)
    assert fetch_description("https://careers.acme.example/job/8", http) is None
    assert not_fetched_reason("https://in.linkedin.com/jobs/view/1")
    assert not_fetched_reason("https://in.indeed.com/viewjob?jk=1")
    assert not_fetched_reason(GH_JOB) is None


def test_bulk_fetch_best_first_and_moves_on(db: Session, settings: Settings) -> None:
    ok = _job(db, "Magento Lead", GH_JOB)
    fails = _job(db, "PHP Lead", "https://careers.acme.example/job/8")
    linkedin = _job(db, "Tech Lead", "https://www.linkedin.com/jobs/view/123")
    db.commit()
    assert {ok.jd_status, fails.jd_status, linkedin.jd_status} == {"MISSING"}
    http = FakeHttp({GH_API: {"content": LONG},
                     "https://careers.acme.example/job/8": "<html></html>"})
    no_career_ops = settings.model_copy(update={"career_ops_path": None})

    run = description_service.start(db, wait=True, http=http, settings=no_career_ops)

    assert run.status == "COMPLETED"
    assert (run.stats["fetched"], run.stats["failed"], run.stats["not_allowed"]) == (1, 1, 1)
    assert run.stats["fetched_jobs"] == [{"id": ok.id, "title": "Magento Lead"}]
    db.refresh(ok), db.refresh(fails), db.refresh(linkedin)
    assert ok.jd_status == "OK" and "Magento 2" in ok.original_jd
    assert "Adobe Commerce" in ok.required_skills
    assert fails.jd_status == "FETCH_FAILED"  # not retried next time
    assert run.stats["failed_jobs"] == [{"id": fails.id, "title": "PHP Lead"}]
    # Re-parsing (e.g. after a skill-list update) keeps the "already tried" marker.
    from app.services import freshness
    fails.parsed_jd = {**fails.parsed_jd, "catalog_version": "old"}
    db.commit()
    freshness.refresh(db)
    db.refresh(fails)
    assert fails.jd_status == "FETCH_FAILED"
    db.refresh(linkedin)
    assert linkedin.jd_status == "PASTE_NEEDED"  # never fetched; the user pastes it
    assert not any("linkedin" in url for _, url in http.calls)
    status = description_service.status(db)
    assert status["missing"] == 0 and status["last_run"]["stats"]["fetched"] == 1


def test_uses_a_readable_link_when_the_first_is_linkedin(db: Session, settings: Settings) -> None:
    job = _job(db, "Magento Lead", "https://www.linkedin.com/jobs/view/123")
    same = _job(db, "Magento Lead", GH_JOB)  # the same job, also on the company's board
    assert same.id == job.id
    db.commit()
    http = FakeHttp({GH_API: {"content": LONG}})
    no_career_ops = settings.model_copy(update={"career_ops_path": None})
    run = description_service.start(db, wait=True, http=http, settings=no_career_ops)
    assert (run.stats["fetched"], run.stats["not_allowed"]) == (1, 0)
    db.refresh(job)
    assert job.jd_status == "OK"
