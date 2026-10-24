"""Skill roadmap: missing skills tried out on your open jobs, and the order to learn them."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.services import skill_roadmap
from tests.test_cv_advisor import setup


def test_roadmap_scores_missing_skills_without_changing_anything(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup(client)  # one open job asking for Magento 2, PHP, AWS, Docker, Kubernetes
    job = client.get("/api/v1/jobs").json()["items"][0]
    score = job["match_score"]
    real = skill_roadmap.active_config

    def one_point_up(db: Any) -> Any:  # "good" = one point above today's score
        row, cfg = real(db)
        t = cfg.thresholds.model_copy(update={"recommended": score + 1})
        return row, cfg.model_copy(update={"thresholds": t})

    monkeypatch.setattr(skill_roadmap, "active_config", one_point_up)
    r = client.get("/api/v1/cv-advice/roadmap").json()
    assert r["jobs_considered"] == 1 and r["good_now"] == 0 and r["threshold"] == score + 1
    found = {s["skill"]: s for s in r["skills"]}
    assert "Kubernetes" in found and "Docker" in found
    assert "Magento 2" not in found and "AWS" not in found  # you have these
    k8s = found["Kubernetes"]
    assert k8s["required"] == 1 and k8s["jobs_raised"] == 1 and k8s["avg_gain"] > 0
    assert k8s["new_good"] == 1 and k8s["examples"][0]["before"] == score

    steps = r["roadmap"]
    assert steps and steps[0]["skill"] in found and steps[0]["new_good"] == 1
    assert [s["total_good"] for s in steps] == sorted(s["total_good"] for s in steps)
    assert [s["step"] for s in steps] == list(range(1, len(steps) + 1))
    # Read-only: the stored score is untouched.
    assert client.get(f"/api/v1/jobs/{job['id']}").json()["match_score"] == score

    client.post("/api/v1/cv-advice/skills/hide", json={"skill": "Kubernetes"})
    r = client.get("/api/v1/cv-advice/roadmap").json()
    assert "Kubernetes" not in {s["skill"] for s in r["skills"]} and r["hidden"] == ["Kubernetes"]


def test_empty_roadmap_without_jobs(client: TestClient) -> None:
    r = client.get("/api/v1/cv-advice/roadmap").json()
    assert (r["jobs_considered"], r["skills"], r["roadmap"]) == (0, [], [])
