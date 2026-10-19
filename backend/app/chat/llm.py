"""Tool-calling chat with each AI provider (Claude, Gemini, OpenAI-compatible: OpenAI, OmniRoute,
Ollama). One loop per provider: ask, run the tools the model asks for, send the results back,
until it answers in text (or the round limit is hit).
"""

import json
from collections.abc import Callable
from typing import Any

from app.ai.providers import AIUnavailableError, Anthropic, Gemini, OpenAICompatible, _post_json

MAX_ROUNDS = 6
MAX_TOKENS = 1600
ToolSpec = tuple[str, str, dict[str, Any]]  # name, description, JSON schema
Execute = Callable[[str, dict[str, Any]], str]  # run a tool -> JSON text for the model
History = list[dict[str, str]]  # [{"role": "user"|"assistant", "content": "..."}]


def _gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Gemini takes an OpenAPI subset: drop keys it rejects."""
    out = {k: v for k, v in schema.items() if k not in ("additionalProperties", "default")}
    if "properties" in out:
        out["properties"] = {k: _gemini_schema(v) for k, v in out["properties"].items()}
        if not out["properties"]:
            out.pop("properties")
            out.pop("required", None)
    if "items" in out:
        out["items"] = _gemini_schema(out["items"])
    return out


def chat_anthropic(
    p: Anthropic, system: str, history: History, tools: list[ToolSpec], execute: Execute
) -> str:
    messages: list[dict[str, Any]] = [{"role": m["role"], "content": m["content"]} for m in history]
    specs = [{"name": n, "description": d, "input_schema": s} for n, d, s in tools]
    for _ in range(MAX_ROUNDS):
        data = _post_json(
            f"{p.base_url}/v1/messages",
            {
                "model": p.model,
                "max_tokens": MAX_TOKENS,
                "system": system,
                "messages": messages,
                "tools": specs,
            },
            {"x-api-key": p.api_key, "anthropic-version": "2023-06-01"},
            p.timeout,
        )
        content = data.get("content", [])
        calls = [b for b in content if b.get("type") == "tool_use"]
        if not calls:
            return "".join(b.get("text", "") for b in content if b.get("type") == "text")
        messages.append({"role": "assistant", "content": content})
        messages.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": c["id"],
                        "content": execute(c["name"], c.get("input") or {}),
                    }
                    for c in calls
                ],
            }
        )
    return "I looked this up in several steps but couldn't finish — try a narrower question."


def chat_openai(
    p: OpenAICompatible, system: str, history: History, tools: list[ToolSpec], execute: Execute
) -> str:
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, *history]
    specs = [
        {"type": "function", "function": {"name": n, "description": d, "parameters": s}}
        for n, d, s in tools
    ]
    headers = {"Authorization": f"Bearer {p.api_key}"} if p.api_key else {}
    for _ in range(MAX_ROUNDS):
        data = _post_json(
            f"{p.base_url}/chat/completions",
            {
                "model": p.model,
                "max_tokens": MAX_TOKENS,
                "temperature": 0.2,
                "messages": messages,
                "tools": specs,
            },
            headers,
            p.timeout,
        )
        msg = (data.get("choices") or [{}])[0].get("message") or {}
        calls = msg.get("tool_calls") or []
        if not calls:
            return str(msg.get("content") or "")
        messages.append(
            {"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls}
        )
        for c in calls:
            fn = c.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": c.get("id"),
                    "content": execute(fn.get("name", ""), args),
                }
            )
    return "I looked this up in several steps but couldn't finish — try a narrower question."


def chat_gemini(
    p: Gemini, system: str, history: History, tools: list[ToolSpec], execute: Execute
) -> str:
    contents: list[dict[str, Any]] = [
        {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
        for m in history
    ]
    specs = [
        {
            "functionDeclarations": [
                {"name": n, "description": d, "parameters": _gemini_schema(s)}
                if s.get("properties")
                else {"name": n, "description": d}
                for n, d, s in tools
            ]
        }
    ]
    for _ in range(MAX_ROUNDS):
        data = _post_json(
            f"{p.base_url}/models/{p.model}:generateContent",
            {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": contents,
                "tools": specs,
                "generationConfig": {"maxOutputTokens": MAX_TOKENS, "temperature": 0.2},
            },
            {"x-goog-api-key": p.api_key},
            p.timeout,
        )
        content = (data.get("candidates") or [{}])[0].get("content") or {}
        parts = content.get("parts") or []
        calls = [x["functionCall"] for x in parts if "functionCall" in x]
        if not calls:
            return "".join(x.get("text", "") for x in parts)
        contents.append({"role": "model", "parts": parts})  # as returned (keeps signatures)
        contents.append(
            {
                "role": "user",
                "parts": [
                    {
                        "functionResponse": {
                            "name": c.get("name"),
                            "response": {
                                "result": json.loads(
                                    execute(c.get("name", ""), c.get("args") or {})
                                )
                            },
                        }
                    }
                    for c in calls
                ],
            }
        )
    return "I looked this up in several steps but couldn't finish — try a narrower question."


def run_chat(
    provider: Any, system: str, history: History, tools: list[ToolSpec], execute: Execute
) -> str:
    if isinstance(provider, Anthropic):
        return chat_anthropic(provider, system, history, tools, execute)
    if isinstance(provider, Gemini):
        return chat_gemini(provider, system, history, tools, execute)
    if isinstance(provider, OpenAICompatible):
        return chat_openai(provider, system, history, tools, execute)
    raise AIUnavailableError(f"Chat isn't supported for provider {provider.name}")
