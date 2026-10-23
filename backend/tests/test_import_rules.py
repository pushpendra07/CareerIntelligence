from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.job import Job
from app.services import import_rules
from app.services.data_io import import_jobs

STACK = ["php", "magento", "magento 2", "adobe commerce"]


def rules(**kw: Any) -> dict[str, Any]:
    return import_rules.validate_settings({"enabled": True, "required_skills": STACK, **kw})


def save(client: TestClient, **kw: Any) -> None:
    r = client.patch("/api/v1/settings/app", json={"import_rules": {"enabled": True, **kw}})
    assert r.status_code == 200, r.text


def test_check_skills_and_roles() -> None:
    r = rules(ignored_skills=["java", ".net"], ignored_roles=["intern", "sales"],
              required_roles=["developer", "lead", "architect"])
    assert import_rules.check(r, "Senior PHP Developer") is None
    assert import_rules.check(r, "Tech Lead", "Build stores on Magento2 and Hyvä.") is None
    assert import_rules.check(r, "Solution Architect", "Adobe-Commerce cloud") is None
    assert import_rules.check(r, "Lead Developers", "Laravel and PHP") is None  # plural
    # "java" is a whole word: JavaScript is not Java
    assert import_rules.check(r, "PHP Developer", "PHP, JavaScript") is None
    assert import_rules.check(r, "PHP Developer", "PHP and Java") == "ignored skill “java”"
    assert import_rules.check(r, "PHP Developer", "PHP, .NET Core") == "ignored skill “.net”"
    assert import_rules.check(r, "PHP Intern") == "ignored role “intern”"
    assert import_rules.check(r, "PHP Recruiter", "php") == \
        "title has none of your roles to keep (developer, lead, architect)"
    assert import_rules.check(r, "Lead Developer", "Python and Go") == \
        "none of your required skills"
    # "phpunit" is not "php"
    assert import_rules.check(r, "Developer", "We test with phpunit") is not None
    # skills the source sent count too
    assert import_rules.check(r, "Lead Developer", "", ["Magento"]) is None


def test_no_description() -> None:
    assert import_rules.check(rules(), "Senior Software Engineer") is None  # kept by default
    assert import_rules.check(rules(keep_without_description=False),
                              "Senior Software Engineer") == \
        "none of your required skills (no description)"
    # ignored roles still apply without a description
    assert import_rules.check(rules(ignored_roles=["sales"]), "Sales Engineer") is not None


def test_validate() -> None:
    out = import_rules.validate_settings(
        {"required_skills": " PHP , php,  Magento  2,", "sources": ["manual", "scan"]})
    assert out["required_skills"] == ["PHP", "Magento 2"]
    assert out["sources"] == ["scan", "manual"] and out["enabled"] is False


def test_settings_api(client: TestClient) -> None:
    got = client.get("/api/v1/import-rules").json()
    assert got["rules"]["enabled"] is False and got["rules"]["required_skills"] == []
    assert "manual" not in got["rules"]["sources"] and "manual" in got["sources"]
    save(client, required_skills=STACK, ignored_skills=["java"])
    assert client.get("/api/v1/import-rules").json()["rules"]["ignored_skills"] == ["java"]
    bad = client.patch("/api/v1/settings/app", json={"import_rules": {"sources": ["nope"]}})
    assert bad.status_code == 422
    test = client.post("/api/v1/import-rules/check", json={
        "title": "Magento Lead", "description": "Java and PHP"}).json()
    assert test["saved"] is False and test["found_ignored_skills"] == ["java"]
    assert test["found_skills"] == ["php", "magento"]
    unsaved = client.post("/api/v1/import-rules/check", json={
        "title": "Magento Lead", "description": "Java and PHP",
        "rules": {"enabled": True, "required_skills": ["php"]}}).json()
    assert unsaved["saved"] is True


def test_imports_skip_filtered_jobs(client: TestClient, db: Session) -> None:
    save(client, required_skills=STACK, ignored_skills=["java"], ignored_roles=["intern"])
    rows = [
        {"Job Title": "Magento Lead", "Company": "Alpha"},
        {"Job Title": "Java Developer", "Company": "Beta", "description": "Java, Spring"},
        {"Job Title": "Python Developer", "Company": "Gamma", "description": "Python, Django"},
        {"Job Title": "PHP Intern", "Company": "Delta"},
    ]
    stats = import_jobs(db, rows, "file", origin="import")
    assert stats["created"] == 1 and stats["filtered_skipped"] == 3
    assert [j.title for j in db.query(Job)] == ["Magento Lead"]
    assert db.query(Job).count() == 1

    # A job already in the app is still merged (only new jobs are checked)
    save(client, required_skills=["laravel"])
    again = import_jobs(db, [{"Job Title": "Magento Lead", "Company": "Alpha"}], "file",
                        origin="import")
    assert again["merged"] == 1

    # AI search / extension: the row says why
    agent = client.post("/api/v1/jobs/agent-import", json={"jobs": [
        {"title": "Python Lead", "company": "Epsilon", "description": "Python only"}],
        "dry_run": True}).json()
    assert agent["results"][0]["result"] == "filtered"
    assert agent["counts"]["filtered"] == 1


def test_add_job_by_hand(client: TestClient) -> None:
    save(client, required_skills=STACK)
    body = {"title": "Python Developer", "company": "Zeta",
            "url": "https://boards.greenhouse.io/zeta/jobs/1", "jd": "Python and Django"}
    assert client.post("/api/v1/jobs", json=body).status_code == 201  # by hand: not checked
    save(client, required_skills=STACK, sources=["manual"])
    body["url"], body["company"] = "https://boards.greenhouse.io/eta/jobs/2", "Eta"
    r = client.post("/api/v1/jobs", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "job_filtered"
    # turned off: everything is saved again
    save(client, enabled=False)
    assert client.post("/api/v1/jobs", json=body).status_code == 201
