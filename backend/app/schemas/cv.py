from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CVVersionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cv_id: int
    version_number: int
    label: str | None
    original_filename: str
    content_type: str
    size_bytes: int
    sha256: str
    parser_version: str
    created_at: datetime


class CVVersionDetail(CVVersionSummary):
    parsed: dict[str, Any]
    extracted_text: str


class CVOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    target_role: str | None
    notes: str | None
    is_active: bool
    is_archived: bool
    current_version_id: int | None
    created_at: datetime
    updated_at: datetime
    versions: list[CVVersionSummary] = Field(default_factory=list)
    top_skills: list[str] = Field(default_factory=list)
    total_experience_years: float | None = None


class CVUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    target_role: str | None = Field(default=None, max_length=200)
    notes: str | None = None
    is_archived: bool | None = None


class CVComparison(BaseModel):
    left_version_id: int
    right_version_id: int
    skills_added: list[str]
    skills_removed: list[str]
    skills_common: list[str]
    roles_added: list[str]
    roles_removed: list[str]
    projects_added: list[str]
    projects_removed: list[str]
    summary_changed: bool
    experience_years: dict[str, float | None]
    text_diff: list[str]
