from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.companies.importers import records_from_rows
from app.core.errors import DomainValidationError
from app.core.http import FetchResult
from app.core.urls import is_listing_url
from app.integrations import google_sheets
from app.models.company import Company
from app.models.job import Job
from app.services.company_service import import_records
from app.services.data_io import import_jobs, job_input_from_row

HEADER = [
    "Category",
    "Match Score",
    "Job Title",
    "Company",
    "Location",
    "Workplace Type",
    "Experience Req",
    "Salary / CTC",
    "Key Match Factors",
    "Posted Age",
    "Application Link",
    "Status",
]


def row(**over: str) -> dict[str, str]:
    base = dict(
        zip(
            HEADER,
            [
                "MUST APPLY",
                "96%",
                "Magento Technical Lead",
                "Aspire Systems",
                "Chennai, India",
                "Hybrid / On-site",
                "8–12 years",
                "₹28L – ₹42L+ INR / year",
                "Magento 2, PHP, Adobe Commerce, MySQL",
                "Active Opening (September 18, 2026 - 20 days ago)",
                "https://bebee.com/in/jobs/walk-in-aspire-systems-123",
                "New / To Apply",
            ],
            strict=True,
        )
    )
    base.update(over)
    return base


def test_row_mapping() -> None:
    data = job_input_from_row(row(), "Google Sheet · Job Tracker")
    assert data is not None
    assert (data.title, data.company_name, data.work_model) == (
        "Magento Technical Lead",
        "Aspire Systems",
        "HYBRID",
    )
    assert data.experience_text == "8–12 years"
    assert data.salary_text == "₹28L – ₹42L+ INR / year"
    assert data.posting_date == date(2026, 9, 18)
    assert data.status.value == "NEW"
    assert data.jd_text == ""  # key match factors are NOT treated as a job description
    assert "Key match factors" in (data.notes or "")
    assert data.raw["import"]["match_score"] == "96%"
    relative = job_input_from_row(row(**{"Posted Age": "4 days ago"}))
    assert relative is not None and relative.posting_date is None  # no reliable reference date
    hidden = job_input_from_row(row(**{"Salary / CTC": "Not publicly available"}))
    assert hidden is not None and hidden.salary_text is None
    assert job_input_from_row({"Job Title": "", "Company": "x"}) is None


def test_listing_urls_never_identify_jobs(db: Session) -> None:
    search = "https://in.indeed.com/q-magento-lead-jobs.html"
    assert is_listing_url(search)
    rows = [
        row(**{"Job Title": "Magento Lead", "Company": "Alpha", "Application Link": search}),
        row(**{"Job Title": "Adobe Commerce Lead", "Company": "Beta", "Application Link": search}),
        row(
            **{
                "Job Title": "PHP Lead",
                "Company": "Gamma",
                "Application Link": "https://www.jobleads.com/in/job/shared-123",
            }
        ),
        row(
            **{
                "Job Title": "Magento Architect",
                "Company": "Delta",
                "Application Link": "https://www.jobleads.com/in/job/shared-123",
            }
        ),
        row(),
        row(),  # exact duplicate row merges
    ]
    stats = import_jobs(db, rows, "Google Sheet · Job Tracker")
    assert (stats["created"], stats["merged"], stats["listing_urls"]) == (5, 1, 4)
    assert stats["scored"] == 5
    assert db.query(Job).count() == 5  # shared URLs did not merge different jobs
    job = db.query(Job).filter_by(title="Magento Technical Lead").one()
    assert job.status == "NEW" and job.work_model == "HYBRID"
    assert float(job.salary_max or 0) == 4200000 and float(job.experience_min or 0) == 8
    assert job.jd_status == "MISSING"
    assert job.source_links[0].detail == "Google Sheet · Job Tracker"
    alpha = db.query(Job).filter_by(title="Magento Lead").one()
    assert alpha.source_links[0].normalized_url is None
    assert alpha.source_links[0].original_url == search  # kept as provenance


def test_company_tab_rejects_search_links_and_placeholders(db: Session) -> None:
    rows = [
        {
            "Company Name": "Ranosys",
            "Careers URL": "https://www.google.com/search?q=Ranosys+careers",
            "ATS / Platform": "Careers Portal / ATS",
            "Location / Coverage": "Global, Singapore, India (Pune, Jaipur)",
            "Notes / Verification Status": "Adobe Commerce Gold Partner",
        },
        {
            "Company Name": "Vaimo",
            "Careers URL": "https://careers.vaimo.com/jobs",
            "ATS / Platform": "Teamtailor",
            "Location / Coverage": "Global Remote",
            "Notes / Verification Status": "Adobe Commerce solution partner",
        },
        {"Company Name": "[Additional 150+ companies from user spreadsheet]"},
    ]
    summary = import_records(db, records_from_rows(rows, "google_sheet"), "google_sheet")
    assert summary.created == 2 and summary.invalid_claims == 1
    ranosys = db.query(Company).filter_by(name="Ranosys").one()
    assert ranosys.careers_url is None  # a Google search link is not a careers page
    assert ranosys.india_locations == ["Pune", "Jaipur"]
    assert ranosys.attributes["google_sheet"]["ats_platform"] == "Careers Portal / ATS"
    vaimo = db.query(Company).filter_by(name="Vaimo").one()
    assert vaimo.careers_url == "https://careers.vaimo.com/jobs"


def test_google_sheet_fetch() -> None:
    url = (
        "https://docs.google.com/spreadsheets/d/10V63xnEfzlQ-sTVk9b9OGEgzu2s5KxeFi4Qpr3nap68"
        "/edit?gid=0#gid=0"
    )
    assert google_sheets.parse_sheet_url(url) == (
        "10V63xnEfzlQ-sTVk9b9OGEgzu2s5KxeFi4Qpr3nap68",
        "0",
    )
    private = lambda u: FetchResult(u, 401, "<!DOCTYPE html><html>sign in</html>")  # noqa: E731
    with pytest.raises(DomainValidationError, match="not public"):
        google_sheets.fetch_rows(url, private)
    csv_text = ",".join(HEADER) + "\n" + ",".join(f'"{v}"' for v in row().values()) + "\n\n"
    rows = google_sheets.fetch_rows(url, lambda u: FetchResult(u, 200, csv_text))
    assert len(rows) == 1 and rows[0]["Company"] == "Aspire Systems"
    assert google_sheets.detect_kind(rows) == "jobs"
    with pytest.raises(DomainValidationError):
        google_sheets.parse_sheet_url("https://example.com/sheet")


def test_google_sheet_endpoint(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.integrations.google_sheets.fetch_rows", lambda url: [row()])
    r = client.post(
        "/api/v1/import/google-sheet",
        json={
            "url": "https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit#gid=0",
            "label": "Jobs sheet",
        },
    ).json()
    assert r["kind"] == "jobs" and r["created"] == 1
    bad = client.post("/api/v1/import/google-sheet", json={"url": "https://example.com/x/y/z"})
    assert bad.status_code == 422
