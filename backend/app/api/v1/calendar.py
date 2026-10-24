from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import RedirectResponse

from app.api.deps import DB
from app.core.errors import NotFoundError
from app.services import calendar_service

router = APIRouter(prefix="/calendar", tags=["calendar"])

Kind = Literal["interview", "followup", "offer", "deadline"]
ICS = "text/calendar; charset=utf-8"
FEED_PATH = "/api/v1/calendar/feed.ics"


def _app_url(request: Request) -> str:
    """The address you reached the app at (links in the events point back to it)."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host")
            or request.url.netloc)
    return f"{proto}://{host}"


@router.get("/feed")
def feed_status() -> dict[str, Any]:
    """Whether the private calendar feed is on, and its link (path; add the app's address)."""
    token = calendar_service.feed_token()
    return {"enabled": token is not None, "path": f"{FEED_PATH}?token={token}" if token else None}


@router.post("/feed")
def feed_on(new_link: bool = False) -> dict[str, Any]:
    """Turn the feed on (or, with new_link, replace its link: the old one stops working)."""
    token = calendar_service.new_feed_token() if new_link else calendar_service.feed_token(True)
    return {"enabled": True, "path": f"{FEED_PATH}?token={token}"}


@router.delete("/feed")
def feed_off() -> dict[str, Any]:
    calendar_service.stop_feed()
    return {"enabled": False, "path": None}


@router.get("/feed.ics")
def feed(db: DB, request: Request, token: str = Query(default="", max_length=200)) -> Response:
    """The calendar apps subscribe to: open without logging in, but only with the feed's key."""
    if not calendar_service.token_ok(token):
        raise NotFoundError("Not found")
    body = calendar_service.to_ics(calendar_service.events(db, _app_url(request)))
    return Response(body, media_type=ICS, headers={"Cache-Control": "no-store"})


@router.get("/{kind}/{item_id}.ics")
def one_ics(db: DB, request: Request, kind: Kind, item_id: int) -> Response:
    """One event as an .ics file (Apple Calendar, Outlook…)."""
    ev = calendar_service.one(db, kind, item_id, _app_url(request))
    return Response(calendar_service.to_ics([ev], name=ev.title), media_type=ICS,
                    headers={"Content-Disposition": f'attachment; filename="{kind}-{item_id}.ics"'})


@router.get("/{kind}/{item_id}/google")
def one_google(db: DB, request: Request, kind: Kind, item_id: int) -> RedirectResponse:
    """Opens Google Calendar's "new event" page with this event filled in."""
    ev = calendar_service.one(db, kind, item_id, _app_url(request))
    return RedirectResponse(calendar_service.google_url(ev), status_code=307)
