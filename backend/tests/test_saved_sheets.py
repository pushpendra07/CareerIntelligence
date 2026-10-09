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
    assert r.status_code == 409 and "service account" in r.json()["error"]["message"]
    assert "private" in client.get("/api/v1/sheets").json()[0]["last_error"]

    csv_text = "job_url,title,company\nhttps://jobs.lever.co/acme/1,Magento Lead,Acme\n"
    monkeypatch.setattr(google_sheets, "safe_get",
                        lambda url, **kw: FetchResult(url, 200, csv_text))
    ok = client.post(f"/api/v1/sheets/{sheet['id']}/import").json()
    assert ok["last_result"]["via"] == "direct" and ok["last_result"]["created"] == 1
    assert ok["last_error"] is None


def test_rejects_non_sheet_urls(client: TestClient) -> None:
    assert client.post("/api/v1/sheets", json={"url": "https://example.com/x"}).status_code == 422


# --- private sheets through a Google service account ------------------------------------------


@pytest.fixture
def service_account(tmp_path, settings, client):  # type: ignore[no-untyped-def]
    import json

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    from app.core.config import get_settings

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    path = tmp_path / "sa.json"
    path.write_text(json.dumps({"type": "service_account", "private_key": pem,
                                "client_email": "reader@demo.iam.gserviceaccount.com",
                                "token_uri": "https://oauth2.googleapis.com/token"}))
    configured = settings.model_copy(update={"google_service_account_file": path})
    client.app.dependency_overrides[get_settings] = lambda: configured  # type: ignore[attr-defined]
    return key


def test_signed_assertion_is_valid_rs256(service_account) -> None:  # type: ignore[no-untyped-def]
    import base64
    import json

    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    from app.integrations.google_api import SCOPE, ServiceAccount, signed_assertion
    pem = service_account.private_bytes(serialization.Encoding.PEM,
                                        serialization.PrivateFormat.PKCS8,
                                        serialization.NoEncryption()).decode()
    jwt = signed_assertion(ServiceAccount("reader@demo.iam.gserviceaccount.com", pem), now=1000)
    head, body, sig = jwt.split(".")
    pad = lambda x: x + "=" * (-len(x) % 4)  # noqa: E731
    claims = json.loads(base64.urlsafe_b64decode(pad(body)))
    assert claims["scope"] == SCOPE and claims["exp"] == 4600
    service_account.public_key().verify(base64.urlsafe_b64decode(pad(sig)),
                                        f"{head}.{body}".encode(), padding.PKCS1v15(),
                                        hashes.SHA256())


def test_import_private_sheet_all_tabs(client: TestClient, service_account,  # type: ignore[no-untyped-def]
                                       monkeypatch: pytest.MonkeyPatch) -> None:
    import json

    from app.integrations import google_api

    monkeypatch.setattr(google_api, "access_token", lambda account: "tok")
    calls = []

    def fake(method, url, **kw):  # type: ignore[no-untyped-def]
        calls.append((url, kw["headers"]["Authorization"]))
        if "values:batchGet" in url:
            return FetchResult(url, 200, json.dumps({"valueRanges": [
                {"values": [["Job Title", "Company", "Application Link"],
                            ["Magento Lead", "Acme", "https://jobs.lever.co/acme/1"]]},
                {"values": [["Company Name", "Careers URL"],
                            ["Beta Commerce", "https://jobs.lever.co/beta"]]},
            ]}))
        return FetchResult(url, 200, json.dumps({"properties": {"title": "My Tracker"}, "sheets": [
            {"properties": {"title": "Job Tracker"}},
            {"properties": {"title": "Target Companies"}}]}))

    monkeypatch.setattr(google_api, "safe_request", fake)
    access = client.get("/api/v1/sheets/access").json()
    assert access["service_account"] == "reader@demo.iam.gserviceaccount.com"

    sheet = client.post("/api/v1/sheets", json={"url": URL}).json()
    done = client.post(f"/api/v1/sheets/{sheet['id']}/import").json()
    assert done["last_result"]["via"] == "google_api" and done["title"] == "My Tracker"
    tabs = {t["tab"]: t for t in done["last_result"]["tabs"]}
    assert tabs["Job Tracker"]["kind"] == "jobs" and tabs["Job Tracker"]["created"] == 1
    assert tabs["Target Companies"]["kind"] == "companies"
    assert "ranges=%27Job%20Tracker%27" in calls[1][0] and calls[1][1] == "Bearer tok"

    monkeypatch.setattr(google_api, "safe_request",
                        lambda method, url, **kw: FetchResult(url, 403, ""))
    r = client.post(f"/api/v1/sheets/{sheet['id']}/import")
    assert r.status_code == 409
    assert "add reader@demo.iam.gserviceaccount.com as Viewer" in r.json()["error"]["message"]
