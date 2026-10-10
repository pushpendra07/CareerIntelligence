"""Board discovery and the new connectors (SuccessFactors, Oracle, careers pages). No network."""

import json
from typing import Any

from sqlalchemy.orm import Session

from app.core.http import FetchResult
from app.scanner import discovery, service
from app.scanner.jsonld import job_links, job_postings, to_fields
from app.scanner.providers import (
    PROVIDERS,
    careers_page_board,
    oracle_board,
    resolve_board,
    successfactors_board,
)
from app.services.company_service import create_company


class Web:
    """Fake internet: (method, url-prefix) -> body (str/dict) or status code."""

    def __init__(self, routes: dict[str, Any]) -> None:
        self.routes, self.calls = routes, []

    def __call__(self, method: str, url: str, json_body: object | None = None) -> FetchResult:
        self.calls.append((method, url))
        for key, body in self.routes.items():
            m, prefix = key.split(" ", 1)
            if m == method and url.startswith(prefix):
                if isinstance(body, int):
                    return FetchResult(url, body, "")
                return FetchResult(url, 200, body if isinstance(body, str) else json.dumps(body))
        return FetchResult(url, 404, "")


POSTING = {"@context": "https://schema.org", "@type": "JobPosting", "title": "Magento Tech Lead",
           "description": "<p>Lead our <b>Magento 2</b> team. PHP, MySQL.</p>",
           "datePosted": "2026-10-01", "employmentType": "FULL_TIME",
           "jobLocation": {"@type": "Place", "address": {"addressLocality": "Pune",
                                                         "addressCountry": "IN"}},
           "url": "https://acme.example.com/careers/magento-tech-lead"}


def ld(*objs: Any) -> str:
    return "".join(f'<script type="application/ld+json">{json.dumps(o)}</script>' for o in objs)


def test_jsonld_parsing() -> None:
    html = ld({"@graph": [{"@type": "Organization"}, POSTING]})
    [p] = job_postings(html)
    f = to_fields(p, "https://acme.example.com/careers")
    assert f["title"] == "Magento Tech Lead" and "Magento 2" in f["description"]
    assert f["location"] == "Pune, IN" and str(f["posted"]) == "2026-10-01"
    links = job_links('<a href="/careers/php-dev">x</a><a href="https://other.com/jobs/1">y</a>'
                      '<a href="/about">z</a>', "https://acme.example.com/careers")
    assert links == ["https://acme.example.com/careers/php-dev"]


def test_resolve_oracle_and_successfactors() -> None:
    b = oracle_board("https://zensar.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2/jobs")
    assert b is not None and (b.provider, b.extra["site"]) == ("ORACLE", "CX_2")
    sf = resolve_board("https://career2.successfactors.eu/career?company=acme")
    assert sf is not None and sf.provider == "SUCCESSFACTORS"
    assert successfactors_board("https://careers.wipro.com/search/").extra["base"] == \
        "https://careers.wipro.com"


def test_careers_page_provider_follows_job_links() -> None:
    web = Web({
        "GET https://acme.example.com/careers/magento": ld(POSTING),
        "GET https://acme.example.com/careers": '<a href="/careers/magento">Magento Tech Lead</a>',
    })
    jobs = PROVIDERS["CAREERS_PAGE"](careers_page_board("https://acme.example.com/careers"), web)
    assert [j.title for j in jobs] == ["Magento Tech Lead"] and "PHP" in jobs[0].description


def test_successfactors_tiles_and_oracle() -> None:
    tile = ('<li class="job-tile job-id-77 x"><a class="jobTitle-link" href="#">Adobe Commerce Lead'
            '</a><div id="j-section-city-value">Noida</div>'
            '<span data-url="/job/Noida-Adobe-Commerce-Lead/77/"></span></li>')
    web = Web({"GET https://careers.acme.com/tile-search-results/?startrow=0": tile})
    [j] = PROVIDERS["SUCCESSFACTORS"](successfactors_board("https://careers.acme.com"), web)
    assert (j.title, j.location, j.url) == ("Adobe Commerce Lead", "Noida",
                                            "https://careers.acme.com/job/Noida-Adobe-Commerce-Lead/77/")
    board = oracle_board("https://acme.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1")
    assert board is not None
    web = Web({"GET https://acme.fa.em2.oraclecloud.com/hcmRestApi": {"items": [{
        "TotalJobsCount": 1, "requisitionList": [{
            "Id": "9", "Title": "PHP Architect", "PrimaryLocation": "Pune",
            "PostedDate": "2026-10-02"}]}]}})
    [o] = PROVIDERS["ORACLE"](board, web)
    assert (o.title, o.location, str(o.posted)) == ("PHP Architect", "Pune", "2026-10-02")
    assert o.url.endswith("/sites/CX_1/job/9")


def test_name_probe_needs_the_board_to_be_that_company() -> None:
    web = Web({"GET https://boards-api.greenhouse.io/v1/boards/radixweb/jobs":
                   {"jobs": [{"id": 1}]},
               "GET https://boards-api.greenhouse.io/v1/boards/radixweb": {"name": "Radixweb"},
               "GET https://boards-api.greenhouse.io/v1/boards/netsolutions": {"name": "Other Co"},
               # Workable's placeholder for any slug: name = slug, no jobs
               "GET https://apply.workable.com/api/v1/widget/accounts/walmart":
                   {"name": "walmart", "jobs": []},
               "GET https://boards-api.greenhouse.io/v1/boards/unified":
                   {"name": "Unified Life Insurance"}})
    found = discovery.probe_name("Radixweb", ["radixweb.com"], web)
    assert found is not None
    assert (found.board.provider, found.method) == ("GREENHOUSE", "name_probe")
    assert discovery.probe_name("Net Solutions", [], web) is None  # board belongs to someone else
    assert discovery.probe_name("Walmart", ["walmart.com"], web) is None  # empty placeholder
    assert discovery.probe_name("Unified Infotech", [], web) is None  # a different company
    assert discovery.names_match("Accenture", "Accenture India")
    assert discovery.names_match("Codilar Technologies Pvt Ltd", "Codilar")
    assert not discovery.names_match("Net Solutions", "Netsmartz")
    assert not discovery.names_match("Unified Infotech", "Unified Life Insurance")
    assert not discovery.names_match("Net Solutions", "Net")  # too short to trust
    assert discovery.resolve_board("https://x.successfactors.eu/verp/ui/jquery.js") is None


def test_detect_finds_careers_page_from_website_and_saves_board(db: Session) -> None:
    cid = create_company(db, {"name": "Acme Commerce", "website": "https://acme.example.com",
                              "job_search_enabled": True}).id
    web = Web({
        "GET https://acme.example.com/careers/magento": ld(POSTING),
        "GET https://acme.example.com/careers": '<a href="/careers/magento">Open role</a>',
        "GET https://acme.example.com": '<a href="/careers">Careers</a><a href="/about">About</a>',
    })
    run = service.detect_boards(db, [cid], http=web)
    assert (run.stats["found"], run.stats["careers_urls_found"]) == (1, 1)
    assert run.stats["by_method"] == {"job_posting_data": 1}
    [(company, board)] = service.scan_targets(db, [cid])
    assert board.provider == "CAREERS_PAGE" and company.careers_url == "https://acme.example.com/careers"
    scan = service.run_scan(db, company_ids=[cid], http=web)
    assert scan.stats["new"] == 1  # the Magento job is now in the app


def test_enable_job_search_for_found_boards(client: Any, db: Session) -> None:
    create_company(db, {"name": "Board Co", "careers_url": "https://jobs.lever.co/boardco"})
    create_company(db, {"name": "No Board Co"})
    status = client.get("/api/v1/scanner/status").json()
    assert [c["name"] for c in status["boards_not_searched"]] == ["Board Co"]
    r = client.post("/api/v1/scanner/enable-found").json()
    assert r == {"enabled": 1, "companies": ["Board Co"]}
    assert client.get("/api/v1/scanner/status").json()["boards_not_searched"] == []


def test_page_link_to_another_companys_board_is_ignored() -> None:
    careers, api = ("https://vinsol.example.com/careers",
                    "GET https://apply.workable.com/api/v1/widget/accounts/bystadium")
    web = Web({f"GET {careers}": '<a href="https://apply.workable.com/bystadium">x</a>',
               api: {"name": "Stadium"}})
    assert discovery.from_careers_page(careers, web, "Vinsol") is None
    web.routes[api] = {"name": "Vinsol"}
    found = discovery.from_careers_page(careers, web, "Vinsol")
    assert found is not None and found.board.slug == "bystadium"


def test_generic_word_difference_needs_evidence() -> None:
    # "Coalition Technologies" (agency) vs Greenhouse "Coalition, Inc." (insurer)
    assert discovery.names_match("Coalition Technologies", "Coalition, Inc.")
    assert not discovery.same_company("Coalition Technologies", "Coalition, Inc.",
                                      ["coalitiontechnologies.com"], ["Cyber insurance jobs"])
    assert discovery.same_company("Coalition Technologies", "Coalition, Inc.",
                                  ["coalitiontechnologies.com"],
                                  ["Join us at coalitiontechnologies.com"])
    assert discovery.same_company("Radixweb Pvt Ltd", "Radixweb", [], [])


def test_successfactors_link_must_list_jobs() -> None:
    careers = "https://acme.example.com/careers"
    web = Web({f"GET {careers}": '<a href="https://career5.successfactors.eu/career?company=acme">x</a>'})
    assert discovery.from_careers_page(careers, web, "Acme") is None  # 404 there: not saved
