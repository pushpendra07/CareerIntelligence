"""Email updates: connect your inbox (read-only), check it, confirm the status changes it found."""

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.api.deps import DB
from app.integrations import email_inbox
from app.services import email_updates

router = APIRouter(prefix="/email", tags=["email"])


class AccountIn(BaseModel):
    user: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)
    host: str | None = Field(default=None, max_length=200)
    port: int | None = None
    folder: str | None = Field(default=None, max_length=100)


class ConfirmIn(BaseModel):
    job_id: int | None = None
    status: str | None = Field(default=None, max_length=30)  # another status than suggested
    change_status: bool = True  # false: only link the email to the job


@router.get("/account")
def account(db: DB) -> dict[str, Any]:
    """Connected address and server (never the password), settings, last check, pending count."""
    return email_updates.status(db)


@router.put("/account")
def connect(db: DB, body: AccountIn) -> dict[str, Any]:
    """Log in once to check the details, then save them in backend/secrets/ (not the database)."""
    acc = email_inbox.validate_account(body.user, body.password, body.host, body.port,
                                       body.folder)
    return email_updates.connect_account(db, acc)


@router.delete("/account", status_code=204)
def disconnect(db: DB) -> None:
    """Forget the account (the updates already found are kept)."""
    email_updates.disconnect_account(db)


@router.post("/check")
def check(db: DB) -> dict[str, Any]:
    """Read new messages now (headers only, the text of job-search emails)."""
    return email_updates.check(db)


@router.get("/updates")
def updates(db: DB, state: str | None = Query(None, pattern="^(PENDING|DONE|DISMISSED)$"),
            job_id: int | None = None,
            limit: int = Query(100, ge=1, le=500)) -> list[dict[str, Any]]:
    return email_updates.describe(db, email_updates.list_updates(db, state, job_id, limit))


@router.post("/updates/rematch")
def rematch(db: DB) -> dict[str, int]:
    """Match the emails waiting for review again (e.g. after adding the job one is about)."""
    return email_updates.rematch_pending(db)


@router.post("/updates/confirm-all")
def confirm_all(db: DB) -> dict[str, int]:
    """Confirm every pending update that knows its job."""
    return email_updates.confirm_all(db)


@router.post("/updates/{update_id}/confirm")
def confirm(db: DB, update_id: int, body: ConfirmIn) -> dict[str, Any]:
    u = email_updates.confirm(db, update_id, body.job_id, body.status, body.change_status)
    return email_updates.describe(db, [u])[0]


@router.post("/updates/{update_id}/dismiss")
def dismiss(db: DB, update_id: int) -> dict[str, Any]:
    return email_updates.describe(db, [email_updates.dismiss(db, update_id)])[0]
