"""Optional AI providers behind one small interface.

The application never requires AI: scoring, parsing and prep are deterministic. AI is used
only for optional extras (suggested interview questions, JD summaries). Providers are plain
HTTPS calls (stdlib), so switching provider is a config change: AI_PROVIDER, AI_MODEL,
AI_API_KEY, AI_BASE_URL.
"""

import json
import logging
import urllib.error
import urllib.request
from typing import Any, Protocol

from app.core.config import Settings

logger = logging.getLogger(__name__)

DEFAULT_MODELS = {"anthropic": "claude-sonnet-5-5"}
DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "ollama": "http://localhost:11434/v1",
    "anthropic": "https://api.anthropic.com",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
}


class AIUnavailableError(RuntimeError):
    """AI is not configured, or the provider call failed."""


class AIProvider(Protocol):
    name: str

    def complete(self, system: str, prompt: str, max_tokens: int = 1500) -> str: ...


def _post_json(
    url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int
) -> dict[str, Any]:
    if not url.startswith(("https://", "http://")):
        raise AIUnavailableError("AI base URL must be http(s)")
    req = urllib.request.Request(  # noqa: S310 - scheme checked above; URL is operator config
        url,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            result: dict[str, Any] = json.loads(resp.read().decode())
            return result
    except urllib.error.HTTPError as exc:
        # Never log request headers (they carry the API key).
        logger.warning("AI provider HTTP error", extra={"status": exc.code, "url": url})
        raise AIUnavailableError(f"AI provider returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        logger.warning("AI provider unreachable", extra={"url": url, "error": str(exc)})
        raise AIUnavailableError("AI provider is unreachable") from exc


class OpenAICompatible:
    """OpenAI, Ollama, LM Studio, vLLM and any /v1/chat/completions endpoint."""

    def __init__(
        self, name: str, base_url: str, model: str, api_key: str | None, timeout: int
    ) -> None:
        self.name, self.base_url, self.model = name, base_url.rstrip("/"), model
        self.api_key, self.timeout = api_key, timeout

    def complete(self, system: str, prompt: str, max_tokens: int = 1500) -> str:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        data = _post_json(
            f"{self.base_url}/chat/completions",
            {
                "model": self.model,
                "max_tokens": max_tokens,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
            },
            headers,
            self.timeout,
        )
        return str(data["choices"][0]["message"]["content"])


class Anthropic:
    name = "anthropic"

    def __init__(self, base_url: str, model: str, api_key: str, timeout: int) -> None:
        self.base_url, self.model, self.api_key, self.timeout = (
            base_url.rstrip("/"),
            model,
            api_key,
            timeout,
        )

    def complete(self, system: str, prompt: str, max_tokens: int = 1500) -> str:
        data = _post_json(
            f"{self.base_url}/v1/messages",
            {
                "model": self.model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": [{"role": "user", "content": prompt}],
            },
            {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"},
            self.timeout,
        )
        return "".join(
            b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
        )


class Gemini:
    name = "gemini"

    def __init__(self, base_url: str, model: str, api_key: str, timeout: int) -> None:
        self.base_url, self.model, self.api_key, self.timeout = (
            base_url.rstrip("/"),
            model,
            api_key,
            timeout,
        )

    def complete(self, system: str, prompt: str, max_tokens: int = 1500) -> str:
        data = _post_json(
            f"{self.base_url}/models/{self.model}:generateContent",
            {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.2},
            },
            {"x-goog-api-key": self.api_key},
            self.timeout,
        )
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts)


def get_provider(settings: Settings) -> AIProvider:
    name = settings.ai_provider
    if name == "none":
        raise AIUnavailableError("AI is not configured (AI_PROVIDER=none)")
    key = settings.ai_api_key.get_secret_value() if settings.ai_api_key else None
    model = settings.ai_model or DEFAULT_MODELS.get(name)
    if not model:
        raise AIUnavailableError(f"Set AI_MODEL for provider '{name}'")
    base = settings.ai_base_url or DEFAULT_BASE_URLS[name]
    if name in ("openai", "ollama"):
        if name == "openai" and not key:
            raise AIUnavailableError("Set AI_API_KEY for OpenAI")
        return OpenAICompatible(name, base, model, key, settings.ai_timeout_seconds)
    if not key:
        raise AIUnavailableError(f"Set AI_API_KEY for {name}")
    if name == "anthropic":
        return Anthropic(base, model, key, settings.ai_timeout_seconds)
    return Gemini(base, model, key, settings.ai_timeout_seconds)
