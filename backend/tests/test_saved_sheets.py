"""Saved Google Sheets: one-click import, connector rows, no duplicates (no network)."""

import pytest
from fastapi.testclient import TestClient

from app.core.http import FetchResult
from app.integrations import google_sheets

URL = "https://docs.google.com/spreadsheets/d/1iE8Xn7duwizMkvnJJMbfHWLL-DRbIpRlumH_P8aa7Co/edit"
ROWS = [
    {"job_url": "https://to.indeed.com/aa4czk4k6bj4", "title": "Magento Technical Lead",
     "company": "Valuewing Consultancy Services", "location": "Chennai, Tamil Nadu",
     "date_posted": "2026-10-08", "match_score": "78", "base_resume": "A",
     "tailored_resume_link": "https://docs.google.com/document/d/abc/edit",
     "status": "resume-ready", "apply_contact / notes": "Email resume to HR"},
    {"job_url": "https://to.indeed.com/aatzdxj9m8pq", "title": "Magento / eCommerce Developer",
     "company": "Option Designs", "location": "Gurugram, Haryana",
     "status": "skipped-low-score", "apply_contact / notes": "Apply via Indeed listing"},
]


def test_save_import_rows_and_no_duplicates(client: TestClient) -> None:
    sheet = client.post("/api/v1/sheets", json={"url": URL, "title": "Seen Jobs"}).json()
    assert client.post("/api/v1/sheets", json={"url": URL}).status_code == 409  # saved once

    body = {"tabs": [{"tab": "Seen Jobs", "rows": ROWS}]}
    first = client.post(f"/api/v1/sheets/{sheet['id']}/import-rows", json=body).json()
    assert first["last_result"]["via"] == "connector"
    assert (first["last_result"]["created"], first["last_result"]["merged"]) == (2, 0)
    again = client.post(f"/api/v1/sheets/{sheet['id']}/import-rows", json=body).json()
    assert (again["last_result"]["created"], again["last_result"]["merged"]) == (0, 2)
    assert client.get("/api/v1/jobs").json()["total"] == 2  # no duplicates

    jobs = {j["title"]: j for j in client.get("/api/v1/jobs").json()["items"]}
    assert jobs["Magento Technical Lead"]["status"] == "READY_TO_APPLY"
    assert jobs["Magento / eCommerce Developer"]["status"] == "NOT_RELEVANT"
    detail = client.get(f"/api/v1/jobs/{jobs['Magento Technical Lead']['id']}").json()
    assert "Email resume to HR" in detail["notes"]
    assert "Tailored resume: https://docs.google.com/document/d/abc/edit" in detail["notes"]

    listed = client.get("/api/v1/sheets").json()
    assert [s["title"] for s in listed] == ["Seen Jobs"]
    assert client.delete(f"/api/v1/sheets/{sheet['id']}").status_code == 204
    assert client.get("/api/v1/sheets").json() == []


def test_direct_import_private_and_public(client: TestClient,
                                          monkeypatch: pytest.MonkeyPatch) -> None:
    sheet = client.post("/api/v1/sheets", json={"url": URL}).json()
    monkeypatch.setattr(google_sheets, "safe_get",
                        lambda url, **kw: FetchResult(url, 401, "<!DOCTYPE html>"))
    r = client.post(f"/api/v1/sheets/{sheet['id']}/import")
    assert r.status_code == 409 and "Ask Claude to import it" in r.json()["error"]["message"]
    assert "private" in client.get("/api/v1/sheets").json()[0]["last_error"]

    csv_text = "job_url,title,company\nhttps://jobs.lever.co/acme/1,Magento Lead,Acme\n"
    monkeypatch.setattr(google_sheets, "safe_get",
                        lambda url, **kw: FetchResult(url, 200, csv_text))
    ok = client.post(f"/api/v1/sheets/{sheet['id']}/import").json()
    assert ok["last_result"]["via"] == "direct" and ok["last_result"]["created"] == 1
    assert ok["last_error"] is None


def test_rejects_non_sheet_urls(client: TestClient) -> None:
    assert client.post("/api/v1/sheets", json={"url": "https://example.com/x"}).status_code == 422
