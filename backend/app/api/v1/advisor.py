from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import DB
from app.services import cv_advisor

router = APIRouter(prefix="/cv-advice", tags=["cv-advice"])


class SkillIn(BaseModel):
    skill: str = Field(min_length=1, max_length=100)


@router.get("")
def advice(db: DB) -> dict[str, Any]:
    """Skills to add to your CV (you have them, the CV doesn't say so) and skills you lack,
    ranked by how many of your open jobs ask for them."""
    return cv_advisor.advice(db)


@router.post("/skills/{action}")
def skill_action(
    db: DB, action: Literal["add-to-profile", "add-to-search", "hide", "unhide"], body: SkillIn
) -> dict[str, Any]:
    return cv_advisor.act(db, action, body.skill)
