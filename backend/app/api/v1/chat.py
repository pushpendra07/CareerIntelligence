from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import DB, AppSettings
from app.chat import service

router = APIRouter(tags=["chat"])


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=8000)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=60)


@router.get("/chat/status")
def chat_status(db: DB, settings: AppSettings) -> dict[str, Any]:
    """Whether the Assistant is on, and whether it uses AI (which provider) or built-in commands."""
    cfg = service.assistant_settings(db)
    p, reason = service.provider_for(db, settings)
    return {"enabled": cfg["enabled"], "use_ai": cfg["use_ai"],
            "ai_configured": settings.ai_provider != "none",
            "mode": "ai" if p else "commands", "provider": p.name if p else None,
            "model": getattr(p, "model", None), "reason": reason}


@router.post("/chat")
def chat(db: DB, settings: AppSettings, body: ChatIn) -> dict[str, Any]:
    """One chat turn: answer from the user's data; changes come back as `actions` to confirm."""
    return service.chat(db, settings, [m.model_dump() for m in body.messages])
