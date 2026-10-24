"""Your job search in your calendar: interviews, follow-ups, offer deadlines and apply-by dates.

Three ways out, all built from the same events:
- one event as an .ics file (opens in Apple Calendar / Outlook) or a Google Calendar link;
- a private feed (`/api/v1/calendar/feed.ics?token=…`) that calendar apps subscribe to and
  refresh by themselves. The feed key lives in `secrets/calendar-feed.json` (0600), never in
  the database, backups or API output except to show you your own link; a new key ends the old
  link. The feed is read-only: nothing in the app changes when your calendar does.
"""

import json
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.models.application import FollowUp
from app.models.interview import Interview, InterviewStatus
from app.models.job import Job, JobStatus
from app.models.offer import Offer, OfferStatus

FEED_FILE = Path("secrets/calendar-feed.json")
PRODID = "-//Career Intelligence//Job search//EN"
PAST_DAYS = 30  # the feed keeps a month of past events, so last week's interview stays visible
DEFAULT_MINUTES = 60
# Jobs you haven't applied to yet: their "apply by" date is worth a reminder.
NOT_APPLIED = (JobStatus.NEW, JobStatus.DISCOVERED, JobStatus.REVIEWING, JobStatus.SHORTLISTED,
               JobStatus.READY_TO_APPLY, JobStatus.ON_HOLD)
KINDS = ("interview", "followup", "offer", "deadline")


@dataclass
class Event:
    uid: str
    title: str
    start: datetime | date  # a datetime (UTC) for timed events, a date for all-day ones
    end: datetime | date
    description: str = ""
    location: str = ""
    url: str = ""

    @property
    def all_day(self) -> bool:
        return not isinstance(self.start, datetime)


def _label(value: str | None) -> str:
    return (value or "").replace("_", " ").capitalize()


def _interview(iv: Interview, app_url: str) -> Event | None:
    if iv.scheduled_at is None:
        return None
    start = iv.scheduled_at.astimezone(UTC)
    round_name = _label(iv.round_type)
    lines = [f"{iv.job.title} at {iv.company.name}", f"Round {iv.round_number}: {round_name}"]
    if iv.mode:
        lines.append(f"Mode: {_label(iv.mode)}")
    if iv.interviewers:
        lines.append(f"Interviewers: {iv.interviewers}")
    if iv.topics:
        lines.append(f"Topics: {', '.join(iv.topics)}")
    if iv.meeting_link:
        lines.append(f"Join: {iv.meeting_link}")
    url = f"{app_url}/interviews/{iv.id}/prep" if app_url else ""
    if url:
        lines.append(f"Prepare: {url}")
    return Event(
        uid=f"interview-{iv.id}@career-intelligence",
        title=f"Interview: {iv.company.name} — {round_name}",
        start=start, end=start + timedelta(minutes=iv.duration_minutes or DEFAULT_MINUTES),
        description="\n".join(lines), location=iv.meeting_link or "", url=url)


def _followup(f: FollowUp, app_url: str) -> Event:
    who = " · ".join(x for x in (f.company.name if f.company else "",
                                 f.contact.name if f.contact else "") if x)
    lines = [x for x in (who, f.notes or "") if x]
    url = f"{app_url}/followups" if app_url else ""
    if url:
        lines.append(f"Open: {url}")
    return Event(uid=f"followup-{f.id}@career-intelligence", title=f"Follow up: {f.title}",
                 start=f.due_date, end=f.due_date + timedelta(days=1),
                 description="\n".join(lines), url=url)


def _offer(o: Offer, app_url: str) -> list[Event]:
    url = f"{app_url}/offers" if app_url else ""
    name = o.company.name
    out = []
    if o.expiry_date and o.status in (OfferStatus.RECEIVED, OfferStatus.NEGOTIATING):
        out.append(Event(uid=f"offer-{o.id}-expiry@career-intelligence",
                         title=f"Offer from {name} expires", start=o.expiry_date,
                         end=o.expiry_date + timedelta(days=1),
                         description=f"Decide on the {o.designation or 'offer'} from {name}.",
                         url=url))
    if o.joining_date and o.status == OfferStatus.ACCEPTED:
        out.append(Event(uid=f"offer-{o.id}-joining@career-intelligence",
                         title=f"Joining {name}", start=o.joining_date,
                         end=o.joining_date + timedelta(days=1),
                         description=o.designation or "", location=o.location or "", url=url))
    return out


def _deadline(job: Job, app_url: str) -> Event:
    url = f"{app_url}/jobs/{job.id}" if app_url else ""
    when = job.application_deadline
    assert when is not None
    return Event(uid=f"deadline-{job.id}@career-intelligence",
                 title=f"Apply by: {job.title} — {job.company.name}", start=when,
                 end=when + timedelta(days=1),
                 description=f"Last day to apply.{f' {url}' if url else ''}", url=url)


def events(db: Session, app_url: str = "", today: date | None = None) -> list[Event]:
    """Everything upcoming (and the last month), soonest first."""
    since = (today or datetime.now(UTC).date()) - timedelta(days=PAST_DAYS)
    out: list[Event] = []
    for iv in db.scalars(select(Interview).where(
            Interview.status.in_([InterviewStatus.SCHEDULED, InterviewStatus.RESCHEDULED]),
            Interview.scheduled_at >= datetime(since.year, since.month, since.day, tzinfo=UTC))):
        if (ev := _interview(iv, app_url)) is not None:
            out.append(ev)
    for f in db.scalars(select(FollowUp).where(FollowUp.completed.is_(False),
                                               FollowUp.due_date >= since)):
        out.append(_followup(f, app_url))
    for o in db.scalars(select(Offer)):
        out.extend(e for e in _offer(o, app_url) if e.start >= since)
    for job in db.scalars(select(Job).where(Job.application_deadline >= since,
                                            Job.status.in_(NOT_APPLIED))):
        out.append(_deadline(job, app_url))

    def key(e: Event) -> tuple[str, str]:
        day = e.start.date() if isinstance(e.start, datetime) else e.start
        return (day.isoformat(), e.uid)
    return sorted(out, key=key)


def one(db: Session, kind: str, item_id: int, app_url: str = "") -> Event:
    """The calendar event for one interview / follow-up / offer / job deadline."""
    if kind == "interview" and (iv := db.get(Interview, item_id)):
        if (ev := _interview(iv, app_url)) is not None:
            return ev
        raise NotFoundError("This interview has no date yet")
    if kind == "followup" and (f := db.get(FollowUp, item_id)):
        return _followup(f, app_url)
    if kind == "offer" and (o := db.get(Offer, item_id)):
        found = _offer(o, app_url)
        if found:
            return found[0]
        raise NotFoundError("This offer has no open expiry date or joining date")
    if kind == "deadline" and (job := db.get(Job, item_id)):
        if job.application_deadline:
            return _deadline(job, app_url)
        raise NotFoundError("This job has no apply-by date")
    raise NotFoundError(f"No {kind} {item_id}")


# --- iCalendar (RFC 5545) ---------------------------------------------------------------------


def _escape(text: str) -> str:
    return (text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


def _fold(line: str) -> str:
    """Lines longer than 75 octets continue on the next line after a space (UTF-8 safe)."""
    out: list[str] = []
    current = b""
    for ch in line:
        b = ch.encode()
        if len(current) + len(b) > (75 if not out else 74):
            out.append(current.decode())
            current = b""
        current += b
    out.append(current.decode())
    return "\r\n ".join(out)


def _when(name: str, value: datetime | date) -> str:
    if isinstance(value, datetime):
        return f"{name}:{value.astimezone(UTC):%Y%m%dT%H%M%SZ}"
    return f"{name};VALUE=DATE:{value:%Y%m%d}"


def to_ics(evs: list[Event], name: str = "Job search", now: datetime | None = None) -> str:
    stamp = f"{(now or datetime.now(UTC)).astimezone(UTC):%Y%m%dT%H%M%SZ}"
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", f"PRODID:{PRODID}", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{_escape(name)}",
             "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"]
    for e in evs:
        lines += ["BEGIN:VEVENT", f"UID:{e.uid}", f"DTSTAMP:{stamp}", _when("DTSTART", e.start),
                  _when("DTEND", e.end), f"SUMMARY:{_escape(e.title)}"]
        if e.description:
            lines.append(f"DESCRIPTION:{_escape(e.description)}")
        if e.location:
            lines.append(f"LOCATION:{_escape(e.location)}")
        if e.url:
            lines.append(f"URL:{e.url}")
        if not e.all_day:  # a reminder 30 minutes before an interview
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_escape(e.title)}",
                      "TRIGGER:-PT30M", "END:VALARM"]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


def google_url(e: Event) -> str:
    """Google Calendar's "add event" page, filled in (you press Save there)."""
    if e.all_day:
        dates = f"{e.start:%Y%m%d}/{e.end:%Y%m%d}"
    else:
        assert isinstance(e.start, datetime) and isinstance(e.end, datetime)
        dates = f"{e.start.astimezone(UTC):%Y%m%dT%H%M%SZ}/{e.end.astimezone(UTC):%Y%m%dT%H%M%SZ}"
    params = {"action": "TEMPLATE", "text": e.title, "dates": dates, "details": e.description}
    if e.location:
        params["location"] = e.location
    return "https://calendar.google.com/calendar/render?" + urlencode(params)


# --- the private feed key ---------------------------------------------------------------------


def feed_token(create: bool = False) -> str | None:
    try:
        token = json.loads(FEED_FILE.read_text(encoding="utf-8")).get("token")
        if isinstance(token, str) and len(token) >= 32:
            return token
    except (OSError, ValueError):
        pass
    return new_feed_token() if create else None


def new_feed_token() -> str:
    """A new key: the old feed link stops working."""
    token = secrets.token_urlsafe(32)
    FEED_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = FEED_FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"token": token}, f)
    os.replace(tmp, FEED_FILE)
    return token


def stop_feed() -> None:
    FEED_FILE.unlink(missing_ok=True)


def token_ok(given: str | None) -> bool:
    token = feed_token()
    return bool(token and given and secrets.compare_digest(token, given))
