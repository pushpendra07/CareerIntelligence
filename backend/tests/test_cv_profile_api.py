from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.storage.backend import LocalStorage
from tests.fixtures import SAMPLE_CV, SAMPLE_CV_V2, make_docx


def upload(
    client: TestClient, name: str = "Tech Lead CV", text: str = SAMPLE_CV, filename: str = "cv.txt"
) -> Any:
    r = client.post(
        "/api/v1/cvs",
        data={"name": name, "target_role": "Tech Lead"},
        files={"file": (filename, text.encode(), "text/plain")},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_upload_parses_and_stores_original(client: TestClient, storage: LocalStorage) -> None:
    cv = upload(client)
    assert cv["is_active"] is True  # first CV becomes active
    assert cv["versions"][0]["version_number"] == 1
    assert "PHP" in cv["top_skills"]
    vid = cv["current_version_id"]
    detail = client.get(f"/api/v1/cvs/{cv['id']}/versions/{vid}").json()
    assert detail["parsed"]["name"] == "Asha Verma"
    original = client.get(f"/api/v1/cvs/{cv['id']}/versions/{vid}/file")
    assert original.content == SAMPLE_CV.encode()
    assert original.headers["x-content-type-options"] == "nosniff"
    assert "attachment" in original.headers["content-disposition"]


def test_docx_upload(client: TestClient) -> None:
    r = client.post(
        "/api/v1/cvs",
        data={"name": "DOCX CV"},
        files={"file": ("cv.docx", make_docx(SAMPLE_CV), "application/octet-stream")},
    )
    assert r.status_code == 201, r.text
    assert "Magento 2" in r.json()["top_skills"]


def test_rejects_bad_files(client: TestClient) -> None:
    r = client.post(
        "/api/v1/cvs",
        data={"name": "x"},
        files={"file": ("cv.pdf", b"<html>not pdf</html>", "application/pdf")},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    r = client.post(
        "/api/v1/cvs", data={"name": "x"}, files={"file": ("payload.sh", b"echo hi", "text/plain")}
    )
    assert r.status_code == 422


def test_versions_compare_and_duplicates(client: TestClient) -> None:
    cv = upload(client)
    v1 = cv["current_version_id"]
    r = client.post(
        f"/api/v1/cvs/{cv['id']}/versions",
        data={"label": "with cloud"},
        files={"file": ("cv2.md", SAMPLE_CV_V2.encode(), "text/markdown")},
    )
    assert r.status_code == 201, r.text
    v2 = r.json()["id"]
    assert r.json()["version_number"] == 2
    assert client.get(f"/api/v1/cvs/{cv['id']}").json()["current_version_id"] == v2

    dup = client.post(
        f"/api/v1/cvs/{cv['id']}/versions",
        files={"file": ("same.md", SAMPLE_CV_V2.encode(), "text/markdown")},
    )
    assert dup.status_code == 409

    diff = client.get("/api/v1/cvs/compare", params={"left": v1, "right": v2}).json()
    assert diff["skills_added"] == ["AWS", "Kubernetes"]
    assert diff["skills_removed"] == []
    assert diff["summary_changed"] is True
    assert any(line.startswith("+Tools:") for line in diff["text_diff"])


def test_single_active_cv_and_archive_rules(client: TestClient) -> None:
    first = upload(client, "First")
    second = upload(client, "Second", SAMPLE_CV_V2)
    assert second["is_active"] is False
    activated = client.post(f"/api/v1/cvs/{second['id']}/activate").json()
    assert activated["is_active"] is True
    assert client.get(f"/api/v1/cvs/{first['id']}").json()["is_active"] is False

    r = client.patch(f"/api/v1/cvs/{second['id']}", json={"is_archived": True})
    assert r.status_code == 422  # can't archive the active CV
    r = client.patch(f"/api/v1/cvs/{first['id']}", json={"is_archived": True, "notes": "old"})
    assert r.json()["is_archived"] is True
    listed = client.get("/api/v1/cvs").json()
    assert [c["name"] for c in listed["items"]] == ["Second"]
    assert client.get("/api/v1/cvs", params={"include_archived": True}).json()["total"] == 2


def test_profile_import_merge_and_manual_edits(client: TestClient, db: Session) -> None:
    cv = upload(client)
    profile = client.get("/api/v1/profile").json()
    assert profile["version"] == 1 and profile["core_skills"] == []

    r = client.post(
        "/api/v1/profile/import-cv",
        json={"cv_version_id": cv["current_version_id"], "mode": "merge"},
    )
    profile = r.json()
    assert profile["full_name"] == "Asha Verma"
    assert profile["primary_roles"] == ["Technical Lead", "Senior PHP Developer"]
    assert {"PHP", "Magento 2", "MySQL"} <= set(profile["core_skills"])
    assert "Git" not in profile["core_skills"]  # tools are never "core"
    assert float(profile["total_experience_years"]) > 11
    assert profile["version"] == 2

    # Manual edit: normalized skills, version bump.
    r = client.patch(
        "/api/v1/profile",
        json={"core_skills": ["php", "magento2", "Python"], "summary": "My own words"},
    )
    assert r.json()["core_skills"] == ["PHP", "Magento 2", "Python"]
    assert r.json()["version"] == 3

    # Merge keeps manual edits and adds new items; replace overwrites CV-derived fields.
    merged = client.post(
        "/api/v1/profile/import-cv", json={"cv_version_id": cv["current_version_id"]}
    ).json()
    assert merged["summary"] == "My own words"
    assert merged["core_skills"][:3] == ["PHP", "Magento 2", "Python"]
    replaced = client.post(
        "/api/v1/profile/import-cv",
        json={"cv_version_id": cv["current_version_id"], "mode": "replace"},
    ).json()
    assert replaced["summary"].startswith("Technical Lead with 11+ years")

    actions = set(db.scalars(select(ActivityLog.action)))
    assert {"cv.uploaded", "profile.updated", "profile.imported_from_cv"} <= actions


def test_preferences_defaults_and_validation(client: TestClient) -> None:
    prefs = client.get("/api/v1/preferences").json()
    assert "Technical Lead" in prefs["target_titles"]
    assert prefs["include_architect_roles"] is False
    assert not any("Architect" in t for t in prefs["effective_titles"])
    assert "Jodhpur" in prefs["preferred_locations"]

    r = client.patch("/api/v1/preferences", json={"include_architect_roles": True})
    assert "Adobe Commerce Architect" in r.json()["effective_titles"]
    assert r.json()["version"] == 2

    r = client.patch(
        "/api/v1/preferences",
        json={
            "min_salary": 3000000,
            "target_salary": 4000000,
            "salary_currency": "inr",
            "required_skills": ["php", "magento 2"],
        },
    )
    body = r.json()
    assert body["salary_currency"] == "INR"
    assert body["required_skills"] == ["PHP", "Magento 2"]

    bad = client.patch("/api/v1/preferences", json={"min_salary": 5000000})
    assert bad.status_code == 422  # exceeds stored target_salary
    bad = client.patch(
        "/api/v1/preferences", json={"min_experience_years": 12, "max_experience_years": 8}
    )
    assert bad.status_code == 422


def test_unknown_resources(client: TestClient) -> None:
    assert client.get("/api/v1/cvs/999").status_code == 404
    assert client.post("/api/v1/profile/import-cv", json={"cv_version_id": 999}).status_code == 404
