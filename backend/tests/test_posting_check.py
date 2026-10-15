import json
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError
from app.core.http import FetchResult
from app.jobs.liveness import CLOSED, LIKELY_CLOSED, OPEN, UNKNOWN, check_posting
from app.services import job_service
from app.services.job_service import JobInput, ingest_job
from tests.test_scanner import FakeHttp

TODAY = date(2026, 10, 15)
GH_JOB = "https://job-boards.greenhouse.io/acme/jobs/42"
GH_API = "https://boards-api.greenhouse.io/v1/boards/acme/jobs/42"


def _ld(**posting: object) -> str:
    return ('<html><script type="application/ld+json">'
            + json.dumps({"@type": "JobPosting", "title": "Lead", **posting}) + "</script></html>")


def test_job_board_apis() -> None:
    http = FakeHttp({
        GH_API: {"id": 42},
        "https://api.lever.co/v0/postings/acme/": 404,
        "https://api.smartrecruiters.com/v1/companies/Acme/postings/1": {"active": False},
        "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Careers/job/Pune/Lead_R1":
            {"jobPostingInfo": {"canApply": True}},
        "https://api.ashbyhq.com/posting-api/job-board/acme": {"jobs": [{"id": "other"}]},
    })
    assert check_posting(GH_JOB, http, TODAY).state == OPEN
    removed = "https://job-boards.greenhouse.io/acme/jobs/9"  # 404
    assert check_posting(removed, http, TODAY).state == CLOSED
    lever = "https://jobs.lever.co/acme/0b5f6a8e-1111-2222-3333-444455556666"
    assert check_posting(lever, http, TODAY).state == CLOSED
    assert check_posting("https://jobs.smartrecruiters.com/Acme/1", http, TODAY).state == CLOSED
    workday = "https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Pune/Lead_R1"
    assert check_posting(workday, http, TODAY).state == OPEN
    ashby = "https://jobs.ashbyhq.com/acme/0b5f6a8e-1111-2222-3333-444455556666"
    assert check_posting(ashby, http, TODAY).state == CLOSED  # not on the board any more


def test_job_pages() -> None:
    http = FakeHttp({
        "https://careers.acme.example/job/open": _ld(validThrough="2026-12-31"),
        "https://careers.acme.example/job/expired": _ld(validThrough="2017-03-01"),
        "https://careers.acme.example/job/notice":
            "<h1>Sorry, this job is no longer available.</h1>",
        "https://careers.acme.example/job/plain": "<h1>Lead</h1><p>Apply now</p>",
        # A JS string mentioning 'page not found' doesn't count: only visible text is read.
        "https://careers.acme.example/job/script":
            "<script>var t='Page not found'</script><h1>Lead</h1>",
        "https://careers.acme.example/job/gone": 410,
    })
    check = lambda path: check_posting(f"https://careers.acme.example/job/{path}", http, TODAY)  # noqa: E731
    assert check("open").state == OPEN
    expired = check("expired")
    assert expired.state == CLOSED and expired.valid_through == date(2017, 3, 1)
    assert check("notice").state == CLOSED
    assert check("gone").state == CLOSED
    assert check("plain").state == UNKNOWN
    assert check("script").state == UNKNOWN


def test_redirect_to_job_list_and_blocked_sites() -> None:
    def http(method: str, url: str, json_body: object | None = None) -> FetchResult:
        return FetchResult("https://careers.acme.example/jobs/search?q=", 200, "<h1>All jobs</h1>")

    assert check_posting("https://careers.acme.example/job/123", http, TODAY).state == LIKELY_CLOSED
    linkedin = check_posting("https://www.linkedin.com/jobs/view/123", FakeHttp({}), TODAY)
    assert linkedin.state == UNKNOWN and "doesn't allow" in linkedin.reason


def test_check_is_saved_and_status_left_alone(
    db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = JobInput(title="Magento Lead", company_name="Acme", url=GH_JOB, origin="import")
    job = ingest_job(db, data).job
    db.commit()
    monkeypatch.setattr("app.scanner.service.default_http", FakeHttp({}))  # 404: removed

    res = client.post(f"/api/v1/jobs/{job.id}/check-posting")

    assert res.status_code == 200
    body = res.json()
    assert body["posting_check"]["state"] == CLOSED
    assert body["posting_check"]["checked_at"]
    assert body["status"] == job.status  # the user decides whether to close it
    assert any(a["action"] == "job.posting_checked" for a in body["activity"])


def test_job_without_link(db: Session) -> None:
    job = ingest_job(db, JobInput(title="Lead", company_name="Acme", origin="manual")).job
    db.commit()
    with pytest.raises(DomainValidationError, match="no link"):
        job_service.check_posting(db, job.id, http=FakeHttp({}), today=TODAY)
