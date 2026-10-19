import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.providers import Anthropic, Gemini, OpenAICompatible
from app.chat import commands, llm, service

JD = "Magento 2 technical lead. PHP, Adobe Commerce, MySQL, GraphQL. 8+ years. Hybrid in Pune."


def add_job(client: TestClient, title: str, company: str, **over: Any) -> int:
    body = {"title": title, "company": company, "jd": JD, "location": "Pune, India",
            "url": f"https://jobs.example.com/{company.lower()}/{abs(hash(title)) % 10**8}", **over}
    r = client.post("/api/v1/jobs", json=body)
    assert r.status_code == 201, r.text
    return int(r.json()["job"]["id"])


def ask(client: TestClient, text: str) -> dict[str, Any]:
    r = client.post("/api/v1/chat", json={"messages": [{"role": "user", "content": text}]})
    assert r.status_code == 200, r.text
    return r.json()


class TestCommands:
    def test_parse(self) -> None:
        assert commands.parse("apply 512") == ([("propose_apply", {"job_id": 512})], None)
        assert commands.parse("mark #77 as not relevant")[0] == [
            ("propose_status_change", {"job_id": 77, "status": "NOT_RELEVANT"})]
        assert commands.parse("note 12: called the recruiter")[0] == [
            ("propose_note", {"job_id": 12, "text": "called the recruiter"})]
        assert commands.parse("#512")[0] == [("get_job", {"job_id": 512})]
        assert commands.parse("upcoming interviews")[0][0][0] == "list_interviews"
        assert commands.parse("help")[1] == commands.HELP
        calls, _ = commands.parse("remote magento jobs in pune 80+ this week")
        assert calls == [("search_jobs", {"limit": 10, "min_score": 80, "work_model": "REMOTE",
                                          "location": "pune", "posted_within_days": 7,
                                          "query": "magento"})]
        assert commands.parse("new jobs")[0][0][1]["status"] == ["new"]
        assert commands.parse("status of Accenture")[0][1][0] == "list_applications"


def test_chat_without_ai_finds_reads_and_proposes(client: TestClient) -> None:
    job = add_job(client, "Magento Technical Lead", "Acme")
    add_job(client, "Laravel Developer", "Beta Labs", jd="Laravel and PHP developer. Remote.")
    assert client.get("/api/v1/chat/status").json()["mode"] == "commands"

    found = ask(client, "magento jobs")
    assert found["mode"] == "commands" and "Found **1** job" in found["reply"]
    assert found["cards"][0]["items"][0]["id"] == job

    detail = ask(client, f"#{job}")
    assert f"[#{job} Magento Technical Lead](/jobs/{job})" in detail["reply"]

    apply = ask(client, f"apply {job}")
    action = apply["actions"][0]
    assert action["path"] == "/applications" and action["body"]["job_id"] == job
    assert "confirm below" in apply["reply"]
    # Nothing changed yet: the user confirms by calling the action's API.
    assert client.get(f"/api/v1/jobs/{job}").json()["status"] == "NEW"
    confirmed = client.post(f"/api/v1{action['path']}", json=action["body"])
    assert confirmed.status_code == 201
    assert client.get(f"/api/v1/jobs/{job}").json()["status"] == "APPLIED"

    status = ask(client, f"mark {job} rejected")["actions"][0]
    assert status["path"] == f"/jobs/{job}/status" and status["body"] == {"status": "REJECTED"}
    assert "⚠️" in ask(client, "mark 999999 closed")["reply"]  # unknown job, said plainly
    assert "**1** application." in ask(client, "applications")["reply"]
    assert ask(client, "summary")["cards"][0]["type"] == "counts"
    assert "Beta Labs" in json.dumps(ask(client, "Beta Labs"))  # falls back to search everything


FAKE_ROUNDS: list[dict[str, Any]] = []


@pytest.mark.parametrize("kind", ["anthropic", "openai", "gemini"])
def test_ai_chat_uses_tools_and_never_writes(
    kind: str, client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    job = add_job(client, "Adobe Commerce Architect", "Gamma")
    provider: Any = {
        "anthropic": Anthropic("https://ai.test", "m", "k", 5),
        "openai": OpenAICompatible("omniroute", "http://localhost:20128/v1", "m", None, 5),
        "gemini": Gemini("https://ai.test", "m", "k", 5),
    }[kind]
    sent: list[dict[str, Any]] = []
    calls = [("search_jobs", {"query": "Adobe Commerce"}), ("propose_apply", {"job_id": job})]

    def fake_post(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int
                  ) -> dict[str, Any]:
        sent.append(payload)
        step = len(sent) - 1
        if step < len(calls):
            name, args = calls[step]
            if kind == "anthropic":
                return {"content": [{"type": "tool_use", "id": f"t{step}", "name": name,
                                     "input": args}]}
            if kind == "openai":
                return {"choices": [{"message": {"content": None, "tool_calls": [
                    {"id": f"t{step}", "type": "function",
                     "function": {"name": name, "arguments": json.dumps(args)}}]}}]}
            return {"candidates": [{"content": {"role": "model", "parts": [
                {"functionCall": {"name": name, "args": args}}]}}]}
        text = f"[#{job} Adobe Commerce Architect](/jobs/{job}) — confirm below."
        if kind == "anthropic":
            return {"content": [{"type": "text", "text": text}]}
        if kind == "openai":
            return {"choices": [{"message": {"content": text}}]}
        return {"candidates": [{"content": {"parts": [{"text": text}]}}]}

    monkeypatch.setattr(llm, "_post_json", fake_post)
    monkeypatch.setattr(service, "get_provider", lambda settings: provider)
    out = ask(client, "find adobe commerce jobs and apply to the best one")
    assert out["mode"] == "ai" and f"/jobs/{job}" in out["reply"]
    assert out["cards"][0]["items"][0]["id"] == job
    assert out["actions"][0]["path"] == "/applications"
    # The search result went back to the model; the job was not changed.
    assert "Adobe Commerce Architect" in json.dumps(sent[1])
    assert client.get(f"/api/v1/jobs/{job}").json()["status"] == "NEW"
    tools = json.dumps(sent[0])
    assert "propose_apply" in tools and "search_jobs" in tools


def test_ai_failure_falls_back_to_commands(client: TestClient,
                                          monkeypatch: pytest.MonkeyPatch) -> None:
    from app.ai.providers import AIUnavailableError

    def down(*a: Any, **k: Any) -> dict[str, Any]:
        raise AIUnavailableError("AI provider returned HTTP 401")

    monkeypatch.setattr(llm, "_post_json", down)
    monkeypatch.setattr(service, "get_provider",
                        lambda s: Anthropic("https://ai.test", "m", "k", 5))
    out = ask(client, "summary")
    assert out["mode"] == "commands" and "HTTP 401" in out["note"]


def test_assistant_can_be_turned_off_and_ai_switched_off(
    client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    claude = Anthropic("https://ai.test", "m", "k", 5)
    monkeypatch.setattr(service, "get_provider", lambda s: claude)
    assert client.get("/api/v1/chat/status").json()["mode"] == "ai"

    client.patch("/api/v1/settings/app", json={"assistant": {"use_ai": False}})
    st = client.get("/api/v1/chat/status").json()
    assert st["mode"] == "commands" and st["enabled"] is True and st["use_ai"] is False
    out = ask(client, "summary")  # answered without calling the AI
    assert out["mode"] == "commands" and out["note"] is None

    client.patch("/api/v1/settings/app", json={"assistant": {"enabled": False}})
    assert client.get("/api/v1/chat/status").json()["enabled"] is False
    r = client.post("/api/v1/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 422 and "turned off" in r.json()["error"]["message"]
