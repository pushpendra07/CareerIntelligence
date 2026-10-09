"""CV advice: skills to add to the CV, skills you lack, and the one-click actions."""

from fastapi.testclient import TestClient

CV_TEXT = """Asha Rao
Technical Lead
asha@example.com

SUMMARY
Technical Lead with 12 years of Magento 2 and PHP experience.

SKILLS
Magento 2, PHP, MySQL, GraphQL

EXPERIENCE
Technical Lead, Acme Commerce, Jan 2014 - Present
- Led Magento 2 projects
"""

JD = """Technical Lead - Adobe Commerce
Requirements
- 8+ years Magento 2 and PHP
- Hands-on AWS and Docker
- Kubernetes experience
Location: Pune (Hybrid)
"""


def setup(client: TestClient) -> None:
    client.post("/api/v1/cvs", data={"name": "Lead CV"},
                files={"file": ("cv.txt", CV_TEXT.encode(), "text/plain")})
    cv = client.get("/api/v1/cvs").json()["items"][0]
    client.post(f"/api/v1/cvs/{cv['id']}/activate")
    client.post("/api/v1/profile/import-cv", json={"cv_version_id": cv["current_version_id"]})
    core = client.get("/api/v1/profile").json()["core_skills"]
    client.patch("/api/v1/profile", json={"core_skills": [*core, "AWS"]})  # has it, CV silent
    r = client.post("/api/v1/jobs", json={"title": "Technical Lead - Adobe Commerce",
                                          "company": "Acme", "jd": JD})
    assert r.status_code == 201, r.text


def skills(items: list[dict]) -> list[str]:  # type: ignore[type-arg]
    return [i["skill"] for i in items]


def test_advice_splits_add_to_cv_and_missing(client: TestClient) -> None:
    setup(client)
    a = client.get("/api/v1/cv-advice").json()
    assert a["cv"] == "Lead CV" and a["jobs_considered"] == 1
    assert "AWS" in skills(a["add_to_cv"])          # on profile, not in the CV text
    assert "Magento 2" not in skills(a["add_to_cv"])  # already in the CV
    assert {"Docker", "Kubernetes"} <= set(skills(a["missing"]))
    aws = next(i for i in a["add_to_cv"] if i["skill"] == "AWS")
    assert aws["required"] == 1 and aws["examples"][0]["title"] == "Technical Lead - Adobe Commerce"


def test_actions_add_to_profile_search_and_hide(client: TestClient) -> None:
    setup(client)
    r = client.post("/api/v1/cv-advice/skills/add-to-profile", json={"skill": "docker"}).json()
    assert r["skill"] == "Docker" and r["rescored"] >= 1
    assert "Docker" in client.get("/api/v1/profile").json()["core_skills"]
    a = client.get("/api/v1/cv-advice").json()
    assert "Docker" not in skills(a["missing"]) and "Docker" in skills(a["add_to_cv"])

    client.post("/api/v1/cv-advice/skills/add-to-search", json={"skill": "Kubernetes"})
    assert "Kubernetes" in client.get("/api/v1/preferences").json()["preferred_skills"]
    k8s = next(i for i in client.get("/api/v1/cv-advice").json()["missing"]
               if i["skill"] == "Kubernetes")
    assert k8s["in_search"] is True

    client.post("/api/v1/cv-advice/skills/hide", json={"skill": "Kubernetes"})
    a = client.get("/api/v1/cv-advice").json()
    assert "Kubernetes" not in skills(a["missing"]) and a["hidden"] == ["Kubernetes"]
    client.post("/api/v1/cv-advice/skills/unhide", json={"skill": "Kubernetes"})
    assert client.get("/api/v1/cv-advice").json()["hidden"] == []
    assert client.post("/api/v1/cv-advice/skills/bogus", json={"skill": "x"}).status_code == 422
