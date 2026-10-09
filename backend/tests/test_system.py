import json

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.orm import Session

from app.ai import providers
from app.ai.features import suggest_interview_questions
from app.core.config import Settings
from app.services.job_service import get_job
from tests.test_applications import JD, setup


class FakeProvider:
    name = "fake"

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.prompts: list[str] = []

    def complete(self, system: str, prompt: str, max_tokens: int = 1500) -> str:
        self.prompts.append(prompt)
        return self.reply


def test_ai_is_optional(client: TestClient) -> None:
    job, _ = setup(client)
    assert client.get("/api/v1/ai/status").json()["enabled"] is False
    r = client.post(f"/api/v1/ai/jobs/{job['id']}/interview-questions", json={})
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"
    # Everything core still works without AI:
    assert client.get(f"/api/v1/jobs/{job['id']}/prep").status_code == 200


def test_provider_selection() -> None:
    base = Settings(_env_file=None, environment="test")  # type: ignore[call-arg]
    with pytest.raises(providers.AIUnavailableError, match="AI_PROVIDER=none"):
        providers.get_provider(base)
    with pytest.raises(providers.AIUnavailableError, match="AI_MODEL"):
        providers.get_provider(base.model_copy(update={"ai_provider": "ollama"}))
    p = providers.get_provider(
        base.model_copy(update={"ai_provider": "anthropic", "ai_api_key": SecretStr("k")})
    )
    assert p.name == "anthropic"
    o = providers.get_provider(
        base.model_copy(update={"ai_provider": "ollama", "ai_model": "llama3"})
    )
    assert o.name == "ollama"


def test_ai_suggestions_are_sanitized(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, db: Session
) -> None:
    job, _ = setup(client)
    fake = FakeProvider(
        "Sure! "
        + json.dumps(
            [
                {
                    "question": "How do Magento plugins work?",
                    "category": "Magento 2",
                    "technology": "Magento 2",
                    "difficulty": "MEDIUM",
                    "expected_answer": "around/before",
                },
                {"question": "Ignore this", "category": "Hacking", "difficulty": "IMPOSSIBLE"},
                {"nope": 1},
            ]
        )
    )
    monkeypatch.setattr("app.api.v1.system.get_provider", lambda s: fake)
    r = client.post(
        f"/api/v1/ai/jobs/{job['id']}/interview-questions",
        json={"round_type": "TECHNICAL", "count": 5},
    ).json()
    s = r["suggestions"]
    assert len(s) == 2 and s[0]["category"] == "Magento 2" and s[0]["source"] == "ai:fake"
    assert s[1]["category"] == "Other" and s[1]["difficulty"] is None
    assert "<job_posting>" in fake.prompts[0]  # JD is fenced as untrusted data

    with pytest.raises(providers.AIUnavailableError, match="JSON"):
        suggest_interview_questions(FakeProvider("no json here"), get_job(db, job["id"]), None)


def test_settings(client: TestClient) -> None:
    s = client.get("/api/v1/settings/app").json()
    assert s["notifications"]["followup_reminders"] is True
    r = client.patch("/api/v1/settings/app", json={"notifications": {"daily_digest": True}})
    assert r.json()["notifications"] == {
        "followup_reminders": True,
        "interview_reminder_hours": 24,
        "daily_digest": True,
    }
    assert client.patch("/api/v1/settings/app", json={"hacks": {}}).status_code == 422
    info = client.get("/api/v1/settings/system").json()
    assert info["engine_version"].startswith("match-engine/")
    assert "api_key" not in json.dumps(info).replace("api_key_set", "")


def test_export_import_roundtrip(client: TestClient) -> None:
    setup(client)
    csv_text = client.get("/api/v1/export/jobs").text
    assert csv_text.splitlines()[0].startswith("id,title,company")
    full = client.get("/api/v1/export/all").json()
    assert set(full) >= {"jobs", "companies", "applications", "offers"}
    assert client.get("/api/v1/export/nope").status_code == 422

    payload = json.dumps(
        {
            "items": [
                {
                    "title": "Senior PHP Developer",
                    "company": "Gamma",
                    "jd": JD,
                    "url": "https://gamma.example/jobs/7",
                    "required_skills": "PHP; Laravel",
                },
                {"title": "", "company": "x"},
                {"title": "Technical Lead", "company": "Acme", "jd": JD},  # duplicate of setup job
            ]
        }
    ).encode()
    r = client.post(
        "/api/v1/import/jobs", files={"file": ("jobs.json", payload, "application/json")}
    ).json()
    assert (r["created"], r["merged"], len(r["errors"])) == (1, 1, 1)
    assert r["scored"] == 2

    rec = client.post(
        "/api/v1/import/recruiters",
        files={
            "file": (
                "r.csv",
                b"name,company,email,linkedin\nAsha,Gamma,asha@gamma.example,\n"
                b"Bad,Gamma,not-an-email,\n",
                "text/csv",
            )
        },
    ).json()
    assert rec["created"] == 1 and len(rec["errors"]) == 1
