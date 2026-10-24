"""Calendar: interviews, follow-ups, offer deadlines and apply-by dates as calendar events."""

from datetime import UTC, date, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core import auth
from app.core.config import Settings
from app.services import calendar_service as cal

SOON = date.today() + timedelta(days=5)


def setup(client: TestClient) -> dict[str, int]:
    job = client.post("/api/v1/jobs", json={
        "title": "Magento Lead", "company": "Acme, Inc.", "jd": "PHP; Magento 2"}).json()["job"]
    # Not applied yet, with an apply-by date (a job with an interview is past that).
    todo = client.post("/api/v1/jobs", json={
        "title": "Adobe Commerce Architect", "company": "Gamma", "jd": "Adobe Commerce",
        "application_deadline": SOON.isoformat()}).json()["job"]
    at = datetime.combine(SOON, datetime.min.time(), tzinfo=UTC).replace(hour=9, minute=30)
    iv = client.post("/api/v1/interviews", json={
        "job_id": job["id"], "round_type": "TECHNICAL", "mode": "VIDEO",
        "scheduled_at": at.isoformat(), "duration_minutes": 45, "interviewers": "Priya",
        "meeting_link": "https://meet.example.com/abc"}).json()
    fu = client.post("/api/v1/followups", json={"title": "Ping Priya", "due_date": SOON.isoformat(),
                                                "job_id": job["id"]}).json()
    return {"job": todo["id"], "interview": iv["id"], "followup": fu["id"]}


def test_one_event_as_ics_and_as_a_google_calendar_link(client: TestClient) -> None:
    ids = setup(client)
    r = client.get(f"/api/v1/calendar/interview/{ids['interview']}.ics")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    assert "attachment" in r.headers["content-disposition"]
    body = r.text
    assert body.startswith("BEGIN:VCALENDAR\r\n") and body.endswith("END:VCALENDAR\r\n")
    assert f"DTSTART:{SOON:%Y%m%d}T093000Z" in body and f"DTEND:{SOON:%Y%m%d}T101500Z" in body
    assert "SUMMARY:Interview: Acme\\, Inc. — Technical" in body  # commas escaped
    assert "TRIGGER:-PT30M" in body  # reminder half an hour before
    unfolded = body.replace("\r\n ", "")
    assert f"/interviews/{ids['interview']}/prep" in unfolded  # links back to the prep page
    assert all(len(line.encode()) <= 75 for line in body.split("\r\n"))

    g = client.get(f"/api/v1/calendar/interview/{ids['interview']}/google",
                   follow_redirects=False)
    assert g.status_code == 307
    url = urlsplit(g.headers["location"])
    q = parse_qs(url.query)
    assert url.netloc == "calendar.google.com" and q["action"] == ["TEMPLATE"]
    assert q["dates"] == [f"{SOON:%Y%m%d}T093000Z/{SOON:%Y%m%d}T101500Z"]
    assert q["location"] == ["https://meet.example.com/abc"]

    fu = client.get(f"/api/v1/calendar/followup/{ids['followup']}.ics").text
    nxt = SOON + timedelta(days=1)
    assert f"DTSTART;VALUE=DATE:{SOON:%Y%m%d}" in fu and f"DTEND;VALUE=DATE:{nxt:%Y%m%d}" in fu
    assert "VALARM" not in fu  # all-day: no alarm
    assert client.get(f"/api/v1/calendar/deadline/{ids['job']}.ics").status_code == 200
    assert client.get("/api/v1/calendar/interview/999999.ics").status_code == 404


def test_offer_expiry_and_joining_date(client: TestClient) -> None:
    job = client.post("/api/v1/jobs", json={"title": "Lead", "company": "Beta", "jd": "PHP"}).json()
    o = client.post("/api/v1/offers", json={"job_id": job["job"]["id"],
                                            "expiry_date": SOON.isoformat(),
                                            "designation": "Tech Lead"}).json()
    body = client.get(f"/api/v1/calendar/offer/{o['id']}.ics").text
    assert "SUMMARY:Offer from Beta expires" in body


def test_private_feed_needs_its_key_and_works_without_login(
    client: TestClient, settings: Settings
) -> None:
    ids = setup(client)
    assert client.get("/api/v1/calendar/feed").json() == {"enabled": False, "path": None}
    assert client.get("/api/v1/calendar/feed.ics", params={"token": "x" * 43}).status_code == 404
    path = client.post("/api/v1/calendar/feed").json()["path"]
    assert client.post("/api/v1/calendar/feed").json()["path"] == path  # same link until replaced

    auth.save_account(settings, auth.new_account("me", "longenough"))  # login on
    anon = TestClient(client.app)  # a calendar app: no login cookie
    assert anon.get("/api/v1/calendar/feed").status_code == 401  # the link isn't shown to it
    r = anon.get(path)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    for uid in (f"interview-{ids['interview']}", f"followup-{ids['followup']}",
                f"deadline-{ids['job']}"):
        assert f"UID:{uid}@career-intelligence" in r.text
    assert anon.get("/api/v1/calendar/feed.ics").status_code == 404  # no key, no feed
    assert oct(cal.FEED_FILE.stat().st_mode & 0o777) == "0o600"

    _login(client)
    new = client.post("/api/v1/calendar/feed", params={"new_link": "true"}).json()["path"]
    assert new != path and anon.get(path).status_code == 404 and anon.get(new).status_code == 200
    client.delete("/api/v1/calendar/feed")
    assert anon.get(new).status_code == 404


def _login(client: TestClient) -> None:
    assert client.post("/api/v1/auth/login",
                       json={"username": "me", "password": "longenough"}).status_code == 200


def test_done_and_old_items_leave_the_feed(client: TestClient, db: Session) -> None:
    ids = setup(client)
    client.post(f"/api/v1/followups/{ids['followup']}/complete")
    old = client.post("/api/v1/followups", json={
        "title": "Long ago", "due_date": (date.today() - timedelta(days=60)).isoformat()}).json()
    uids = {e.uid for e in cal.events(db)}
    assert f"followup-{ids['followup']}@career-intelligence" not in uids
    assert f"followup-{old['id']}@career-intelligence" not in uids
    assert f"interview-{ids['interview']}@career-intelligence" in uids


@pytest.mark.parametrize("text", ["short", "é" * 80, "x" * 200])
def test_long_lines_are_folded_on_character_boundaries(text: str) -> None:
    ev = cal.Event(uid="u", title=text, start=SOON, end=SOON + timedelta(days=1))
    body = cal.to_ics([ev], now=datetime(2026, 1, 1, tzinfo=UTC))
    assert all(len(line.encode()) <= 75 for line in body.split("\r\n"))
    assert f"SUMMARY:{text}" in body.replace("\r\n ", "")
