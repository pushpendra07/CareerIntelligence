"""Filtering jobs by several skills: any or all of them, exact or with their specific forms."""

from fastapi.testclient import TestClient


def add(client: TestClient, title: str, skills: list[str]) -> int:
    r = client.post("/api/v1/jobs", json={"title": title, "company": "Acme", "jd": "Build things.",
                                          "required_skills": skills})
    assert r.status_code == 201, r.text
    return int(r.json()["job"]["id"])


def titles(client: TestClient, **params: str) -> set[str]:
    r = client.get("/api/v1/jobs", params={"size": 50, **params})
    assert r.status_code == 200, r.text
    return {j["title"] for j in r.json()["items"]}


def test_several_skills_any_all_and_exact(client: TestClient) -> None:
    add(client, "PHP Lead", ["PHP", "Magento 2"])
    add(client, "C# Dev", ["C#"])
    add(client, "Full stack", ["PHP", "C#"])
    add(client, "Magento Dev", ["Magento"])

    assert titles(client, technology="C#, Php") == {"PHP Lead", "C# Dev", "Full stack"}  # any
    assert titles(client, technology="C#, Php", skills_mode="all") == {"Full stack"}
    # Not exact: "Magento" finds Magento 2 too; exact: only jobs that list "Magento" itself.
    assert titles(client, technology="magento") == {"PHP Lead", "Magento Dev"}
    assert titles(client, technology="magento", skills_exact="true") == {"Magento Dev"}
    assert titles(client, technology="php, magento", skills_mode="all") == {"PHP Lead"}
    counts = client.get("/api/v1/jobs/status-counts",
                        params={"technology": "C#, Php", "skills_mode": "all"}).json()
    assert sum(counts.values()) == 1
