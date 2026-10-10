"""Built-in job scanner: board detection, connectors, filters and the scan pipeline (no network)."""

import json
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.html_text import html_to_text
from app.core.http import FetchResult
from app.models.job import Job
from app.models.scan import ScanRun
from app.scanner import service
from app.scanner.filters import ScanFilters, validate_scanner_settings
from app.scanner.providers import ScannedJob, resolve_board
from app.services.company_service import create_company

TODAY = date.today().isoformat()
MAGENTO_JD = "Lead our Adobe Commerce team. Magento 2, PHP 8, MySQL, GraphQL. 10+ years."


class FakeHttp:
    """Serves canned responses by URL prefix and records every call."""

    def __init__(self, routes: dict[str, Any]) -> None:
        self.routes = routes
        self.calls: list[tuple[str, str]] = []

    def __call__(self, method: str, url: str, json_body: object | None = None) -> FetchResult:
        self.calls.append((method, url))
        for prefix, body in self.routes.items():
            if url.startswith(prefix):
                if isinstance(body, int):
                    return FetchResult(url, body, "")
                text = body if isinstance(body, str) else json.dumps(body)
                return FetchResult(url, 200, text)
        return FetchResult(url, 404, "")


def greenhouse_board(*jobs: dict[str, Any]) -> dict[str, Any]:
    return {"jobs": [{"id": j.get("id", i), "title": j["title"],
                      "absolute_url": j.get("url", f"https://job-boards.greenhouse.io/acme/jobs/{i}"),
                      "location": {"name": j.get("location", "Bengaluru, India")},
                      "content": j.get("content", "&lt;p&gt;" + MAGENTO_JD + "&lt;/p&gt;"),
                      "first_published": j.get("posted", TODAY)}
                     for i, j in enumerate(jobs, start=100)]}


def company(db: Session, name: str, careers_url: str, enabled: bool = True) -> int:
    return create_company(db, {"name": name, "careers_url": careers_url,
                               "job_search_enabled": enabled}).id


# --- detection & parsing ---------------------------------------------------------------------

@pytest.mark.parametrize(("url", "provider", "slug"), [
    ("https://job-boards.greenhouse.io/dept", "GREENHOUSE", "dept"),
    ("https://boards.greenhouse.io/embed/job_board?for=knak", "GREENHOUSE", "knak"),
    ("https://job-boards.eu.greenhouse.io/valtech/jobs/123", "GREENHOUSE", "valtech"),
    ("https://jobs.lever.co/bounteous/abc", "LEVER", "bounteous"),
    ("https://jobs.ashbyhq.com/lazer", "ASHBY", "lazer"),
    ("https://jobs.smartrecruiters.com/Endava", "SMARTRECRUITERS", "Endava"),
    ("https://apply.workable.com/acme/", "WORKABLE", "acme"),
    ("https://acme.recruitee.com/o/dev", "RECRUITEE", "acme"),
    ("https://scandiweb.pinpointhq.com", "PINPOINT", "scandiweb"),
    ("https://onemagnify.wd5.myworkdayjobs.com/en-US/OneMagnify_Careers", "WORKDAY", "onemagnify"),
])
def test_resolve_board(url: str, provider: str, slug: str) -> None:
    board = resolve_board(url)
    assert board is not None
    assert (board.provider, board.slug) == (provider, slug)


def test_resolve_board_ignores_unsupported() -> None:
    assert resolve_board("https://www.acme.com/careers") is None
    assert resolve_board("https://app.teamtailor.com/assets/x.js") is None  # shared infrastructure
    assert resolve_board("https://tt.teamtailor.com/") is None
    assert resolve_board("https://apply.workable.com/j/AB12CD34/") is None  # one job, not a board
    assert resolve_board("https://www.linkedin.com/company/acme/jobs") is None
    workday = resolve_board("https://acme.wd3.myworkdayjobs.com/External/job/Pune/Dev_R1")
    assert workday is not None and workday.extra == {
        "host": "acme.wd3.myworkdayjobs.com", "site": "External"}


def test_html_to_text_handles_escaped_html() -> None:
    text = html_to_text("&lt;p&gt;Skills&lt;/p&gt;&lt;ul&gt;&lt;li&gt;PHP &amp;amp; Magento"
                        "&lt;/li&gt;&lt;li&gt;MySQL&lt;/li&gt;&lt;/ul&gt;")
    assert text == "Skills\n\n• PHP & Magento\n• MySQL"


# --- filters ---------------------------------------------------------------------------------

def _job(title: str, location: str | None = "Pune, India", **kw: Any) -> ScannedJob:
    return ScannedJob(title=title, url="https://x.test/1", location=location, **kw)


def test_filters_titles_locations_and_age() -> None:
    f = ScanFilters.from_settings({})
    assert f.check(_job("Senior Magento Developer")) is None
    assert f.check(_job("Adobe Commerce Tech Lead", "Remote")) is None
    assert f.check(_job("Junior PHP Developer")) == "excluded_title"
    assert f.check(_job("Sales Manager")) == "excluded_title"
    assert f.check(_job("Data Analyst")) == "title"
    # Remote tied to another country is skipped; India + remote is kept.
    assert f.check(_job("Magento Developer", "United States - Remote")) == "location"
    assert f.check(_job("Magento Developer", "NY, US - Remote")) == "location"
    assert f.check(_job("Magento Developer", "India / Remote")) is None
    assert f.check(_job("Magento Developer", "Berlin")) == "location"
    assert f.check(_job("Magento Developer", None)) is None  # unknown location kept by default
    old = _job("Magento Developer", posted=date(2020, 1, 1))
    assert f.check(old) == "too_old"


def test_generic_titles_need_the_stack_in_the_jd() -> None:
    f = ScanFilters.from_settings({})
    lead = _job("Technical Lead", description="Java, Spring Boot, Kafka")
    assert f.check(lead) is None and lead.broad_title
    assert f.check_description(lead) == "jd_keywords"
    php_lead = _job("Technical Lead", description="Own our PHP/Laravel platform")
    assert f.check(php_lead) is None
    assert f.check_description(php_lead) is None
    specific = _job("Magento Architect", description="")
    assert f.check(specific) is None and f.check_description(specific) is None


def test_settings_validation() -> None:
    out = validate_scanner_settings({"title_include": "magento, php ,", "schedule_hours": "24"})
    assert out["title_include"] == ["magento", "php"]
    assert out["schedule_hours"] == 24
    with pytest.raises(Exception, match="between"):
        validate_scanner_settings({"schedule_hours": 9999})


# --- scan pipeline ---------------------------------------------------------------------------

def test_scan_imports_dedupes_and_scores(db: Session) -> None:
    cid = company(db, "Acme Commerce", "https://job-boards.greenhouse.io/acme")
    company(db, "Off Commerce", "https://job-boards.greenhouse.io/off", enabled=False)
    http = FakeHttp({
        "https://boards-api.greenhouse.io/v1/boards/acme/": greenhouse_board(
            {"title": "Adobe Commerce Technical Lead"},
            {"title": "Senior Software Engineer", "content": "<p>Go, Kubernetes</p>"},
            {"title": "Marketing Manager"},
            {"title": "Magento Developer", "location": "Austin, TX, US"},
        ),
    })
    run = service.run_scan(db, http=http)
    assert run.status == "COMPLETED"
    assert run.stats["companies"] == 1  # disabled company not scanned
    assert (run.stats["found"], run.stats["new"]) == (4, 1)
    assert run.stats["skipped"] == {"jd_keywords": 1, "excluded_title": 1, "location": 1}
    assert run.companies[0] | {"company_id": cid} == run.companies[0]

    job = db.scalar(select(Job).where(Job.title == "Adobe Commerce Technical Lead"))
    assert job is not None
    assert "Magento 2" in job.original_jd and job.jd_status == "OK"
    assert job.source == "GREENHOUSE"
    db.refresh(job)
    assert job.match_score is not None and not job.score_stale

    again = service.run_scan(db, http=http)
    assert (again.stats["new"], again.stats["updated"]) == (0, 1)
    assert db.scalar(select(Job.id).where(Job.title == "Adobe Commerce Technical Lead").offset(1)) \
        is None


def test_scan_records_board_errors_and_keeps_going(db: Session) -> None:
    company(db, "Gone Co", "https://jobs.lever.co/gone")
    company(db, "Acme Commerce", "https://job-boards.greenhouse.io/acme")
    http = FakeHttp({
        "https://api.lever.co/v0/postings/gone": 404,
        "https://boards-api.greenhouse.io/v1/boards/acme/": greenhouse_board(
            {"title": "Magento Developer"}),
    })
    run = service.run_scan(db, http=http)
    assert run.status == "COMPLETED"
    assert (run.stats["errors"], run.stats["new"]) == (1, 1)
    gone = next(r for r in run.companies if r["company"] == "Gone Co")
    assert "404" in gone["error"]


def test_scan_fetches_details_for_list_only_boards(db: Session) -> None:
    company(db, "Endava", "https://jobs.smartrecruiters.com/Endava")
    ref = "https://api.smartrecruiters.com/v1/companies/Endava/postings/7"
    http = FakeHttp({
        "https://api.smartrecruiters.com/v1/companies/Endava/postings?": {
            "totalFound": 1, "content": [{
                "id": "7", "name": "Lead PHP Engineer", "ref": ref, "releasedDate": TODAY,
                "location": {"city": "Pune", "country": "in", "remote": False}}]},
        ref: {"postingUrl": "https://jobs.smartrecruiters.com/Endava/7-lead-php-engineer",
              "jobAd": {"sections": {"jobDescription": {"title": "Role",
                                                          "text": f"<p>{MAGENTO_JD}</p>"}}}},
    })
    run = service.run_scan(db, http=http)
    assert run.stats["new"] == 1
    job = db.scalar(select(Job).where(Job.title == "Lead PHP Engineer"))
    assert job is not None and "Magento 2" in job.original_jd
    assert job.source_url == "https://jobs.smartrecruiters.com/Endava/7-lead-php-engineer"


def test_workday_pages_past_the_first_page() -> None:
    from app.scanner.providers import workday

    board = resolve_board("https://acme.wd3.myworkdayjobs.com/External")
    assert board is not None
    pages = iter([
        {"total": 25, "jobPostings": [{"title": f"Dev {i}", "externalPath": f"/job/x/{i}"}
                                      for i in range(20)]},
        {"total": 0, "jobPostings": [{"title": f"Dev {i}", "externalPath": f"/job/x/{i}"}
                                     for i in range(20, 25)]},
    ])

    def http(method: str, url: str, json_body: object | None = None) -> FetchResult:
        return FetchResult(url, 200, json.dumps(next(pages)))

    assert len(workday(board, http)) == 25


def test_detect_boards_from_careers_page(db: Session) -> None:
    cid = company(db, "Plain Co", "https://plain.example.com/careers")
    page = '<a href="https://jobs.lever.co/plainco">Open roles</a>'
    run = service.detect_boards(db, [cid], fetch=lambda url: FetchResult(url, 200, page))
    assert (run.stats["checked"], run.stats["found"], run.stats["errors"]) == (1, 1, 0)
    assert run.stats["by_method"] == {"page_link": 1}
    target = service.scan_targets(db, [cid])
    assert [(b.provider, b.slug) for _, b in target] == [("LEVER", "plainco")]


# --- API -------------------------------------------------------------------------------------

def test_api_status_settings_and_run(client: TestClient, db: Session,
                                     monkeypatch: pytest.MonkeyPatch) -> None:
    company(db, "Acme Commerce", "https://job-boards.greenhouse.io/acme")
    company(db, "No Board Co", "https://noboard.example.com/careers")
    status = client.get("/api/v1/scanner/status").json()
    assert status["scannable"] == 1 and status["by_provider"] == {"GREENHOUSE": 1}
    assert [c["name"] for c in status["not_scannable"]] == ["No Board Co"]
    assert "GREENHOUSE" in status["supported_boards"]

    res = client.patch("/api/v1/settings/app", json={"scanner": {"max_age_days": 10}})
    assert res.status_code == 200 and res.json()["scanner"]["max_age_days"] == 10
    bad = client.patch("/api/v1/settings/app", json={"scanner": {"max_age_days": -1}})
    assert bad.status_code == 422

    http = FakeHttp({"https://boards-api.greenhouse.io/v1/boards/acme/": greenhouse_board(
        {"title": "Magento Tech Lead"})})
    monkeypatch.setattr(service, "default_http", http)
    run = client.post("/api/v1/scanner/run", json={"wait": True}).json()
    assert run["status"] == "COMPLETED" and run["stats"]["new"] == 1
    assert client.get(f"/api/v1/scanner/runs/{run['id']}").json()["companies"][0]["new"] == 1
    assert client.get("/api/v1/scanner/runs").json()[0]["id"] == run["id"]
    assert db.get(ScanRun, run["id"]) is not None
    jobs = client.get("/api/v1/jobs", params={"source": "GREENHOUSE"}).json()
    assert [j["title"] for j in jobs["items"]] == ["Magento Tech Lead"]


def test_detect_teamtailor_on_custom_domain(db: Session) -> None:
    cid = company(db, "Magebit", "https://careers.magebit.com/")
    page = '<script src="https://app.teamtailor.com/assets/careersite.js"></script>Teamtailor'
    service.detect_boards(db, [cid], fetch=lambda url: FetchResult(url, 200, page))
    [(_, board)] = service.scan_targets(db, [cid])
    assert (board.provider, board.extra["rss"]) == ("TEAMTAILOR", "https://careers.magebit.com/jobs.rss")
