"""Application settings, loaded from environment variables (and an optional .env file)."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Career Intelligence"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    log_format: Literal["json", "text"] = "json"

    database_url: str = "postgresql+psycopg://career:career@localhost:5432/career_intelligence"
    redis_url: str | None = None

    # Career-Ops integration. CAREER_OPS_PATH is the user's checkout (read-only for us);
    # CAREER_OPS_DATA_PATH overrides its data root the same way CAREER_OPS_ROOT does upstream.
    career_ops_path: Path | None = None
    career_ops_data_path: Path | None = None
    career_ops_url: str | None = None
    career_ops_api_key: SecretStr | None = None
    career_ops_scan_enabled: bool = False

    # Google service-account key (JSON) for reading private Google Sheets. If unset, the app
    # uses backend/secrets/google-service-account.json when that file exists.
    google_service_account_file: Path | None = None

    ai_provider: Literal["none", "openai", "anthropic", "gemini", "ollama"] = "none"
    ai_api_key: SecretStr | None = None
    ai_model: str | None = None
    ai_base_url: str | None = None  # OpenAI-compatible endpoint (e.g. http://localhost:11434/v1)
    ai_timeout_seconds: int = 60

    storage_path: Path = Path("storage")
    max_upload_bytes: int = 10 * 1024 * 1024

    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    @field_validator(
        "career_ops_path", "career_ops_data_path", "career_ops_url", "career_ops_api_key",
        "ai_api_key", "ai_model", "ai_base_url", "redis_url", "google_service_account_file",
        mode="before",
    )
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        # `CAREER_OPS_DATA_PATH=` in .env means "not set", not Path("") (the current folder).
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [o.strip() for o in value.split(",") if o.strip()]
        return value

    @property
    def career_ops_data_root(self) -> Path | None:
        return self.career_ops_data_path or self.career_ops_path


@lru_cache
def get_settings() -> Settings:
    return Settings()
