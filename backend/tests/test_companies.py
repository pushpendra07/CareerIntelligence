import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.companies.checker import check_company
from app.companies.importers import read_career_ops_portals, read_myjob_db, read_research_csv
from app.companies.verification import Claim, add_claim, recompute
from app.core.http import FetchResult
from app.core.text import clean, company_key
from app.core.urls import JobSource, detect_source, normalize_url
from app.models.company import Company, SourceKind, VerificationStatus
from app.services.company_service import import_records

VS = VerificationStatus

RESEARCH_HEADER = (
    "Company ID,Company Name,Official Website,Official Domain,LinkedIn Company URL,Headquarters,"
    "India Locations,Countries of Operation,Company Type,Industry,Employee Size,"
    "Employee Size Source,Company Rating,Current Relevant Jobs,Official Careers Page,"
    "Verification Source 1,Verification Status,Priority,Last Verified Date,Notes\n"
)


def write_research_csv(path: Path) -> Path:
    path.write_text(
        RESEARCH_HEADER
        + "CO-1,Acme Commerce Pvt Ltd,https://www.acme.example,acme.example,Not verified,"
        '"Jaipur, Rajasthan, India",Jaipur; Pune,India,Magento Agency,E-commerce,201-500,,'
        "Not publicly available,Yes,https://acme.example/careers,https://partners.example/acme,"
        "Verified - Tier 2 (direct listing),A+,2026-09-01,Adobe partner\n"
        + "CO-2,Beta Labs,Not verified,,https://facebook.com/betalabs,"
        "India (city unconfirmed),Unconfirmed,India,PHP Agency,IT,Unknown,,Unknown,No,"
        "Not verified,,Verified - Tier 4 (single search summary),C,2026-09-01,\n",
        encoding="utf-8",
    )
    return path


def test_text_and_url_helpers() -> None:
    assert company_key("Codilar Technologies Private Limited") == company_key("Codilar")
    assert company_key("EY") == "ey"
    assert clean("Not verified") is None and clean(" Unknown ") is None
    assert (
        normalize_url("HTTPS://www.Example.com/jobs/1/?utm_source=x&gh_jid=5#apply")
        == "https://example.com/jobs/1?gh_jid=5"
    )
    d = detect_source("https://job-boards.greenhouse.io/vmlenterprisesolutions/jobs/123")
    assert d.source == JobSource.GREENHOUSE and d.ats_slug == "vmlenterprisesolutions"
    assert d.external_id == "123"
    assert (
        detect_source("https://www.linkedin.com/jobs/view/tech-lead-at-x-4012345678").external_id
        == "4012345678"
    )
    assert detect_source("https://acme.com/careers/tech-lead").source == JobSource.COMPANY_CAREERS
    assert (
        detect_source("https://www.naukri.com/job-listings-x-123456789012").source
        == JobSource.NAUKRI
    )


def test_research_csv_reader_and_invalid_linkedin(tmp_path: Path) -> None:
    recs = list(read_research_csv(write_research_csv(tmp_path / "r.csv")))
    acme, beta = recs
    fields = {c.field: c for c in acme.claims}
    assert fields["website"].status == VS.PARTIALLY_VERIFIED  # Tier 2 with evidence
    assert "linkedin_url" not in fields  # "Not verified" is a placeholder, not a value
    assert acme.tier and acme.tier.value == "TIER_A"
    assert acme.hiring_status and acme.hiring_status.value == "HIRING"
    beta_fields = {c.field: c for c in beta.claims}
    assert "headquarters" not in beta_fields  # "India (city unconfirmed)" is not data
    assert beta_fields["linkedin_url"].value == "https://facebook.com/betalabs"


def test_import_merges_sources_and_rejects_fake_linkedin(tmp_path: Path, db: Session) -> None:
    portals = tmp_path / "portals.yml"
    portals.write_text(
        "tracked_companies:\n"
        "  - name: Acme Commerce\n    careers_url: https://jobs.lever.co/acme\n    enabled: true\n"
        "  - name: Gamma\n    careers_url: https://job-boards.greenhouse.io/gamma\n"
        "    enabled: false\n"
        "search_queries:\n  - name: Not a company\n    query: x\n",
        encoding="utf-8",
    )
    dbfile = tmp_path / "jobs.db"
    with sqlite3.connect(dbfile) as con:
        con.execute(
            "CREATE TABLE companies (name TEXT, mnc TEXT, location TEXT, size TEXT, "
            "magento_work TEXT, rating TEXT, match_score TEXT, review TEXT, ats TEXT, "
            "slug TEXT, active INTEGER)"
        )
        con.execute(
            "INSERT INTO companies VALUES ('Beta Labs','No','India (Noida)','50-200',"
            "'Magento','4.0','80','ok','','',1)"
        )

    s1 = import_records(db, read_research_csv(write_research_csv(tmp_path / "r.csv")), "csv")
    s2 = import_records(db, read_career_ops_portals(portals), "portals")
    s3 = import_records(db, read_myjob_db(dbfile), "myjob")
    assert (s1.created, s2.created, s2.merged, s3.merged) == (2, 1, 1, 1)
    assert s1.invalid_claims == 1  # the Facebook "LinkedIn" URL

    acme = db.query(Company).filter_by(name_key=company_key("Acme Commerce")).one()
    assert acme.aliases == ["Acme Commerce"]
    assert acme.website == "https://acme.example"
    assert acme.india_locations == ["Jaipur", "Pune"] and acme.india_presence is True
    assert acme.job_search_enabled is True
    assert acme.verification_status == VS.PARTIALLY_VERIFIED

    beta = db.query(Company).filter_by(name_key=company_key("Beta Labs")).one()
    assert beta.linkedin_url is None  # INVALID evidence never becomes the value
    invalid = [s for s in beta.sources if s.verification_status == VS.INVALID]
    assert invalid and invalid[0].field == "linkedin_url"
    assert "Noida" in beta.india_locations

    gamma = db.query(Company).filter_by(name_key="gamma").one()
    assert gamma.job_search_enabled is False
    assert gamma.ats_provider == "GREENHOUSE"
    assert db.query(Company).filter_by(name_key=company_key("Not a company")).count() == 0


def _company() -> Company:
    return Company(
        name="Acme",
        name_key="acme",
        aliases=[],
        india_locations=[],
        attributes={},
        sources=[],
        verification_override=None,
    )


def test_status_derivation_and_score() -> None:
    now = datetime(2026, 10, 1, tzinfo=UTC)
    c = _company()
    recompute(c, now)
    assert c.verification_status == VS.DISCOVERED and c.verification_score == 0

    add_claim(
        c,
        Claim(
            "website",
            "https://acme.example",
            SourceKind.IMPORT,
            VS.RESEARCHED,
            "csv",
            "https://dir.example/acme",
        ),
    )
    recompute(c, now)
    assert c.verification_status == VS.RESEARCHED

    add_claim(
        c,
        Claim(
            "website",
            "https://acme.example",
            SourceKind.OFFICIAL_WEBSITE,
            VS.VERIFIED,
            "manual",
            "https://acme.example",
            now,
        ),
    )
    add_claim(
        c,
        Claim(
            "careers_url",
            "https://jobs.lever.co/acme",
            SourceKind.OFFICIAL_ATS,
            VS.VERIFIED,
            "manual",
            "https://jobs.lever.co/acme",
            now,
        ),
    )
    recompute(c, now)
    assert c.verification_status == VS.VERIFIED
    assert c.verification_score == 50
    assert c.ats_provider == "LEVER" and c.ats_slug == "acme"

    recompute(c, now + timedelta(days=200))
    assert c.verification_status == VS.STALE

    c.verification_override = VS.REJECTED.value
    recompute(c, now)
    assert c.verification_status == VS.REJECTED


def test_conflicting_unverified_websites_need_review() -> None:
    c = _company()
    add_claim(c, Claim("website", "https://acme.example", SourceKind.IMPORT, VS.RESEARCHED, "a"))
    add_claim(
        c, Claim("website", "https://acme-other.example", SourceKind.IMPORT, VS.RESEARCHED, "b")
    )
    recompute(c)
    assert c.verification_status == VS.NEEDS_REVIEW


def test_checker_verifies_from_official_pages() -> None:
    c = _company()
    c.id = 1
    add_claim(c, Claim("website", "https://acme.example", SourceKind.IMPORT, VS.RESEARCHED, "x"))
    add_claim(
        c, Claim("careers_url", "https://jobs.lever.co/acme", SourceKind.IMPORT, VS.RESEARCHED, "x")
    )
    recompute(c)
    pages = {
        "https://acme.example": FetchResult("https://acme.example", 200, "<title>Acme</title>"),
        "https://jobs.lever.co/acme": FetchResult("https://jobs.lever.co/acme", 200, "jobs"),
    }
    report = check_company(c, lambda url: pages[url])
    assert report.results == {
        "https://acme.example": "VERIFIED",
        "https://jobs.lever.co/acme": "VERIFIED",
    }
    assert c.verification_status == VS.VERIFIED

    dead = _company()
    dead.id = 2
    add_claim(dead, Claim("website", "https://gone.example", SourceKind.IMPORT, VS.RESEARCHED, "x"))
    recompute(dead)
    check_company(dead, lambda url: FetchResult(url, 404, ""))
    assert dead.website is None  # the 404'd value is INVALID now, so it is no longer shown


def test_company_api_flow(client: TestClient) -> None:
    r = client.post(
        "/api/v1/companies",
        json={
            "name": "Delta Commerce",
            "website": "delta.example",
            "tier": "TIER_B",
            "india_locations": ["Jaipur"],
            "source_url": "https://directory.example/delta",
        },
    )
    assert r.status_code == 201, r.text
    company = r.json()
    assert company["website"] == "https://delta.example"
    assert company["verification_status"] == "RESEARCHED"
    cid = company["id"]

    dup = client.post("/api/v1/companies", json={"name": "Delta Commerce Pvt Ltd"})
    assert dup.status_code == 409

    bad = client.post(
        f"/api/v1/companies/{cid}/evidence",
        json={
            "field": "website",
            "value": "https://delta.example",
            "source_kind": "OFFICIAL_WEBSITE",
            "verification_status": "VERIFIED",
        },
    )
    assert bad.status_code == 422  # verification without a source URL is refused

    ok = client.post(
        f"/api/v1/companies/{cid}/evidence",
        json={
            "field": "linkedin_url",
            "value": "https://www.facebook.com/delta",
            "source_kind": "OFFICIAL_LINKEDIN",
            "verification_status": "VERIFIED",
            "source_url": "https://www.facebook.com/delta",
        },
    ).json()
    assert ok["linkedin_url"] is None
    assert any(
        s["field"] == "linkedin_url" and s["verification_status"] == "INVALID"
        for s in ok["sources"]
    )

    listed = client.get("/api/v1/companies", params={"q": "delta", "tier": "TIER_B"}).json()
    assert listed["total"] == 1

    other = client.post("/api/v1/companies", json={"name": "Delta Digital Hub"}).json()
    contact = client.post(
        "/api/v1/recruiters",
        json={
            "name": "Riya Recruiter",
            "company_id": other["id"],
            "linkedin_url": "https://www.linkedin.com/in/riya-example",
            "email": "Riya@Delta.example",
        },
    ).json()
    assert contact["email"] == "riya@delta.example"
    merged = client.post(f"/api/v1/companies/{cid}/merge", json={"merge_id": other["id"]}).json()
    assert "Delta Digital Hub" in merged["aliases"]
    assert client.get(f"/api/v1/recruiters/{contact['id']}").json()["company_id"] == cid
    assert client.get(f"/api/v1/companies/{cid}").json()["stats"]["recruiters"] == 1

    exported = client.get("/api/v1/companies/export", params={"format": "csv"}).text
    assert exported.splitlines()[0].startswith("id,name,aliases")
    assert "Delta Commerce" in exported

    imported = client.post(
        "/api/v1/companies/import",
        files={
            "file": (
                "c.csv",
                b"name,website,tier,india_locations\nEpsilon,epsilon.example,TIER_A,Pune;Delhi\n"
                b"Delta Commerce,,,\n",
                "text/csv",
            )
        },
    ).json()
    assert imported["created"] == 1 and imported["merged"] == 1


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "x", "linkedin_url": "https://linkedin.com/company/x"},  # company URL, not profile
        {"name": "x", "email": "not-an-email"},
    ],
)
def test_recruiter_validation(client: TestClient, payload: dict[str, str]) -> None:
    assert client.post("/api/v1/recruiters", json=payload).status_code == 422


def test_recruiter_status_activity(client: TestClient, db: Session) -> None:
    from app.models.activity_log import ActivityLog

    c = client.post("/api/v1/recruiters", json={"name": "Sam", "company_name": "Zeta"}).json()
    assert c["company_name"] == "Zeta" and c["status"] == "NOT_CONTACTED"
    client.patch(f"/api/v1/recruiters/{c['id']}", json={"status": "CONTACTED"})
    assert db.query(ActivityLog).filter_by(action="recruiter.contacted").count() == 1


def test_company_job_counts_filter_and_sort(client: TestClient) -> None:
    acme = client.post("/api/v1/companies", json={"name": "Acme Jobs Co"}).json()
    client.post("/api/v1/companies", json={"name": "Quiet Co"})
    for i, title in enumerate(["Magento Lead", "PHP Developer"]):
        r = client.post("/api/v1/jobs", json={"title": title, "company": "Acme Jobs Co",
                                              "url": f"https://jobs.lever.co/acmejobs/{i}",
                                              "jd": f"{title}. PHP, Magento 2. Pune."})
        assert r.status_code == 201, r.text
    job = client.get("/api/v1/jobs", params={"company_id": acme["id"]}).json()["items"][0]
    client.post(f"/api/v1/jobs/{job['id']}/status", json={"status": "NOT_RELEVANT"})

    rows = {c["name"]: c for c in client.get("/api/v1/companies").json()["items"]}
    assert (rows["Acme Jobs Co"]["job_count"], rows["Acme Jobs Co"]["open_job_count"]) == (2, 1)
    assert rows["Quiet Co"]["job_count"] == 0
    with_jobs = client.get("/api/v1/companies", params={"has_jobs": True}).json()["items"]
    assert [c["name"] for c in with_jobs] == ["Acme Jobs Co"]
    without_rows = client.get("/api/v1/companies", params={"has_jobs": False}).json()["items"]
    without = {c["name"] for c in without_rows}
    assert "Quiet Co" in without and "Acme Jobs Co" not in without
    first = client.get("/api/v1/companies", params={"sort": "-jobs"}).json()["items"][0]
    assert first["name"] == "Acme Jobs Co"
    assert client.get(f"/api/v1/companies/{acme['id']}").json()["job_count"] == 2
