import time
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.deps import AppSettings
from app.core import auth

router = APIRouter(tags=["auth"])


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=500)


@router.get("/auth/status")
def status(request: Request, settings: AppSettings) -> dict[str, Any]:
    """Whether a password is required, and whether this browser is logged in."""
    need = auth.required(settings)
    token = request.cookies.get(auth.COOKIE)
    return {"required": need, "authenticated": not need or auth.valid_token(settings, token)}


@router.post("/auth/login")
def login(body: LoginIn, settings: AppSettings) -> Response:
    if not auth.required(settings):
        return JSONResponse({"authenticated": True})
    if not auth.password_ok(settings, body.password):
        time.sleep(1)  # slows down guessing
        return JSONResponse(
            {"error": {"code": "unauthorized", "message": "Wrong password", "details": None}},
            status_code=401)
    res = JSONResponse({"authenticated": True})
    res.set_cookie(auth.COOKIE, auth.make_token(settings), max_age=auth.MAX_AGE, httponly=True,
                   samesite="lax", path="/")
    return res


@router.post("/auth/logout")
def logout() -> Response:
    res = JSONResponse({"authenticated": False})
    res.delete_cookie(auth.COOKIE, path="/")
    return res
