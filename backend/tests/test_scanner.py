"""Built-in job scanner: board detection, connectors, filters and the scan pipeline (no network)."""

import json
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.html_text import html_to_text
from app.core.http import FetchResult
from app.models.company import Company
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
    ("https://wd3.myworkdaysite.com/en-US/recruiting/havas/GroupCareers", "WORKDAY", "havas"),
    ("https://silkcommerce.bamboohr.com/jobs", "BAMBOOHR", "silkcommerce"),
    ("https://bacancy.keka.com/careers", "KEKA", "bacancy"),
    ("https://keyvalue.zohorecruit.in/jobs/Careers", "ZOHO_RECRUIT", "keyvalue"),
])
def test_resolve_board(url: str, provider: str, slug: str) -> None:
    board = resolve_board(url)
    assert board is not None
    assert (board.provider, board.slug) == (provider, slug)


def test_hr_system_boards_bamboohr_keka_zoho_and_workday_site() -> None:
    from app.scanner.providers import DETAILS, PROVIDERS

    zoho_jobs = [{"id": "77", "Posting_Title": "Magento Lead", "City": "Kochi", "State": "Kerala",
                  "Country": "India", "Remote_Job": False, "Date_Opened": "2026-10-20",
                  "Job_Type": "Full time", "Work_Experience": "8+ years", "Publish": True,
                  "Job_Description": "<p>Adobe Commerce &amp; PHP</p>"},
                 {"id": "78", "Posting_Title": "Hidden", "Publish": False}]
    escaped = json.dumps(zoho_jobs).replace("&", "&amp;").replace('"', "&#34;")
    http = FakeHttp({
        "https://silk.bamboohr.com/careers/list": {"result": [
            {"id": "53", "jobOpeningName": "PHP Lead", "location": {"city": "Pune", "state": None},
             "atsLocation": {"country": "India"}, "employmentStatusLabel": "Full-Time"}]},
        "https://silk.bamboohr.com/careers/53/detail": {"result": {"jobOpening": {
            "description": "<p>Magento 2</p>", "datePosted": "2026-10-19"}}},
        "https://bacancy.keka.com/careers/api/jobs/default/active": [
            {"id": 5, "title": "Laravel Developer", "description": "<div>PHP</div>",
             "experience": "5+ Years", "publishedOn": "2026-10-21T05:25:41.123Z",
             "jobLocations": [{"name": "Remote", "city": "Ahmedabad", "state": "GJ",
                               "countryCode": "IN"}]}],
        "https://keyvalue.zohorecruit.in/jobs/Careers":
            f'<input type="hidden" value="{escaped}" id="jobs">',
        "https://wd3.myworkdaysite.com/wday/cxs/havas/Group/jobs": {
            "total": 1, "jobPostings": [{"title": "Dev", "externalPath": "/job/Pune/Dev_1"}]},
    })

    def run(url: str) -> list[ScannedJob]:
        board = resolve_board(url)
        assert board is not None
        return PROVIDERS[board.provider](board, http)

    [bamboo] = run("https://silk.bamboohr.com/jobs")
    DETAILS["BAMBOOHR"](bamboo, http)
    assert (bamboo.title, bamboo.location, bamboo.url) == (
        "PHP Lead", "Pune, India", "https://silk.bamboohr.com/careers/53")
    assert "Magento 2" in bamboo.description and bamboo.posted == date(2026, 10, 19)

    [keka] = run("https://bacancy.keka.com/careers")
    assert (keka.url, keka.location, keka.remote) == (
        "https://bacancy.keka.com/careers/jobdetails/5", "Ahmedabad, GJ, IN", True)
    assert keka.description.startswith("Experience: 5+ Years") and "PHP" in keka.description

    [zoho] = run("https://keyvalue.zohorecruit.in/careers")  # unpublished job left out
    assert (zoho.title, zoho.location, zoho.posted) == ("Magento Lead", "Kochi, Kerala, India",
                                                         date(2026, 10, 20))
    assert zoho.url == "https://keyvalue.zohorecruit.in/jobs/Careers/77"
    assert "Adobe Commerce & PHP" in zoho.description

    [wd] = run("https://wd3.myworkdaysite.com/en-US/recruiting/havas/Group")
    assert wd.url == "https://wd3.myworkdaysite.com/recruiting/havas/Group/job/Pune/Dev_1"


def test_careers_page_listing_links_and_headings() -> None:
    from app.scanner import htmljobs
    from app.scanner.providers import PROVIDERS, careers_listing_board

    links_page = """<nav><a href="/services/hire-magento-developers">Hire Magento Developers</a>
      <a href="/blog/how-to-become-a-developer">How to become a developer</a></nav>
      <a href="/careers/senior-magento-developer">Senior Magento Developer</a>
      <a href="https://other.example/jobs/x">PHP Developer</a>
      <a href="/careers/">Current Openings</a>"""
    assert htmljobs.job_links(links_page, "https://acme.example/careers") == [
        ("Senior Magento Developer", "https://acme.example/careers/senior-magento-developer")]

    # Card links: titled by their heading; ones marked closed are left out.
    cards = """<a href="/career/symfony-developer"><h4>Symfony Developer</h4>
      <span>Postion - Curruntly Closed</span><div>Surat, Gujarat</div></a>
      <a href="/career/seo-executive"><h4>SEO Executive</h4><div>Surat, Gujarat</div></a>
      <a href="/career/php-lead">PHP Lead (Position filled)</a>"""
    assert htmljobs.job_links(cards, "https://acme.example/career") == [
        ("SEO Executive", "https://acme.example/career/seo-executive")]

    headings_page = """<h2>Why join us?</h2><p>Great team.</p>
      <h3>Laravel Developer (3-5 yrs, Jaipur)</h3><p>PHP, Laravel, MySQL. Mail hr@acme.example</p>
      <h3>Representative Office</h3><p>Dubai</p><h3>Connect to an expert</h3>
      <h3>Software Tester</h3><p>Manual and Selenium.</p>
      <h3>QA Lead</h3><p>Currently closed. Manual testing.</p>"""
    found = htmljobs.job_headings(headings_page, "https://acme.example/careers")
    assert [h["title"] for h in found] == ["Laravel Developer (3-5 yrs, Jaipur)", "Software Tester"]
    assert found[0]["url"] == "https://acme.example/careers#job/laravel-developer-3-5-yrs-jaipur"
    assert "Laravel, MySQL" in found[0]["description"]

    http = FakeHttp({"https://acme.example/careers/senior-magento-developer":
                     "<header>Magento Shopify React</header><main><p>Own our Adobe Commerce stack."
                     "</p></main><footer>Laravel</footer>",
                     "https://acme.example/careers": links_page})
    [job] = PROVIDERS["CAREERS_HTML"](careers_listing_board("https://acme.example/careers"), http)
    assert (job.title, job.description) == ("Senior Magento Developer",
                                            "Own our Adobe Commerce stack.")


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


def test_a_broken_board_never_stops_the_scan(db: Session) -> None:
    company(db, "Broken Co", "https://jobs.lever.co/broken")
    company(db, "Acme Commerce", "https://job-boards.greenhouse.io/acme")
    ok = FakeHttp({"https://boards-api.greenhouse.io/v1/boards/acme/": greenhouse_board(
        {"title": "Magento Developer"})})

    def http(method: str, url: str, json_body: object | None = None) -> FetchResult:
        if "lever" in url:
            raise RuntimeError("parser bug")  # anything at all, not just network errors
        return ok(method, url, json_body)

    run = service.run_scan(db, http=http)
    assert run.status == "COMPLETED"
    assert (run.stats["errors"], run.stats["new"]) == (1, 1)
    broken = next(r for r in run.companies if r["company"] == "Broken Co")
    assert "parser bug" in broken["error"]


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


def test_board_marked_invalid_is_not_used_or_found_again(client: TestClient, db: Session) -> None:
    cid = company(db, "Plain Co", "https://plain.example.com/careers")
    page = '<a href="https://jobs.lever.co/plainco">Open roles</a>'
    service.detect_boards(db, [cid], fetch=lambda url: FetchResult(url, 200, page))
    assert service.scan_targets(db, [cid])
    res = client.post(f"/api/v1/companies/{cid}/evidence", json={
        "field": "careers_url", "value": "https://jobs.lever.co/plainco",
        "source_kind": "OFFICIAL_ATS", "verification_status": "INVALID",
        "note": "Another company's board"})
    assert res.status_code == 200
    db.expire_all()
    assert service.scan_targets(db, [cid]) == []
    run = service.detect_boards(db, [cid], fetch=lambda url: FetchResult(url, 200, page))
    assert run.stats["found"] == 0 and service.scan_targets(db, [cid]) == []


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


def test_search_every_company_switch(client: TestClient, db: Session) -> None:
    on = company(db, "On Co", "https://jobs.lever.co/onco")
    off = company(db, "Off Co", "https://jobs.lever.co/offco", enabled=False)
    db.commit()
    assert [c.id for c, _ in service.scan_targets(db)] == [on]
    assert {c.id for c, _ in service.scan_targets(db, all_companies=True)} == {on, off}

    status = client.get("/api/v1/scanner/status").json()
    assert status["search_all_companies"] is False
    assert [c["name"] for c in status["boards_not_searched"]] == ["Off Co"]

    saved = client.patch("/api/v1/settings/app", json={"scanner": {"search_all_companies": True}})
    assert saved.json()["scanner"]["search_all_companies"] is True
    status = client.get("/api/v1/scanner/status").json()
    assert status["search_all_companies"] is True and status["boards_not_searched"] == []
    assert status["scannable"] == 2
    # Each company's own flag is kept, so turning the switch off restores the old choice.
    assert client.get(f"/api/v1/companies/{off}").json()["job_search_enabled"] is False
    client.patch("/api/v1/settings/app", json={"scanner": {"search_all_companies": False}})
    assert client.get("/api/v1/scanner/status").json()["scannable"] == 1


def test_a_company_can_opt_out_of_search_every_company(client: TestClient, db: Session) -> None:
    keep = company(db, "Keep Co", "https://jobs.lever.co/keepco")
    skip = company(db, "Skip Co", "https://jobs.lever.co/skipco")
    db.commit()
    client.patch("/api/v1/settings/app", json={"scanner": {"search_all_companies": True}})

    out = client.patch(f"/api/v1/companies/{skip}", json={"scan_excluded": True}).json()
    assert out["scan_excluded"] is True
    assert {c.id for c, _ in service.scan_targets(db, all_companies=True)} == {keep}
    assert client.get("/api/v1/scanner/status").json()["scannable"] == 1
    # Scanning that one company by hand still works.
    assert [c.id for c, _ in service.scan_targets(db, [skip], all_companies=True)] == [skip]

    back = client.patch(f"/api/v1/companies/{skip}", json={"scan_excluded": False}).json()
    assert back["scan_excluded"] is False
    row = db.get(Company, skip)
    assert row is not None and "scan_excluded" not in row.attributes
    assert {c.id for c, _ in service.scan_targets(db, all_companies=True)} == {keep, skip}


def test_rate_limited_requests_are_retried_after_a_pause() -> None:
    answers = [429, 429, 200]
    pauses: list[float] = []

    def http(method: str, url: str, json_body: object | None = None) -> FetchResult:
        return FetchResult(url, answers.pop(0), "{}")

    res = service.polite(http, pauses=(1.0, 2.0, 3.0), sleep=pauses.append)("GET", "https://x.test/")
    assert res.status == 200 and pauses == [1.0, 2.0]
    answers[:] = [429, 429]
    gave_up = service.polite(http, pauses=(1.0,), sleep=pauses.append)("GET", "https://x.test/")
    assert gave_up.status == 429  # still limited after every retry: reported as before


def test_runs_left_running_by_a_restart_are_closed_at_startup(db: Session) -> None:
    from app.core.errors import ConflictError
    from app.scanner import runner

    stuck = ScanRun(kind="SCAN", trigger="manual", stats={"companies": 3}, companies=[])
    done = ScanRun(kind="SCAN", trigger="manual", stats={}, companies=[], status="COMPLETED")
    db.add_all([stuck, done])
    db.commit()
    with pytest.raises(ConflictError):  # a fresh RUNNING run blocks a new one
        runner.start_background(db, "SCAN")
    # The start lock is released even when the start is refused.
    # Only this database's locks: the running app shares the dev server and may hold its own.
    held = db.execute(text("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' "
                           "AND objid = :k AND database = (SELECT oid FROM pg_database "
                           "WHERE datname = current_database())"),
                      {"k": runner.START_LOCK_ID}).scalar()
    assert held == 0

    assert runner.close_interrupted(db) == 1
    assert stuck.status == "FAILED" and stuck.finished_at is not None
    assert stuck.stats == {"companies": 3, "error": runner.INTERRUPTED}
    assert done.status == "COMPLETED"
    assert runner.running_run(db) is None
