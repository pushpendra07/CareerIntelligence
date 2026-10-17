"""Scheduled reminders (Settings → Reminders): "check the job portals", "apply to shortlisted
jobs", "follow up", or your own message, on a cron schedule ("*/5 * * * *", "0 9 * * 1-5"…).

The API process checks the schedules every 30 seconds while it runs. A reminder that fires is
stored as a ReminderEvent: the web app shows it in the bell, as a toast and (when allowed) as a
browser notification. On macOS it can also show a desktop notification, so it reaches you even
when the browser is closed.
"""

import logging
import platform
import re
import shutil
import subprocess
import threading
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError, NotFoundError
from app.models.app_settings import AppSettings
from app.models.reminder import ReminderEvent

logger = logging.getLogger(__name__)

KINDS = ("check_portals", "apply", "follow_up", "custom")
DEFAULT_PORTALS = ["LinkedIn", "Naukri", "Indeed", "Company careers pages"]
DEFAULT_RULES: list[dict[str, Any]] = [
    {"id": "check-portals", "kind": "check_portals", "enabled": True, "label": "Check job portals",
     "cron": "0 10-20/2 * * 1-6", "portals": DEFAULT_PORTALS, "message": "",
     "only_when_needed": False},
    {"id": "apply", "kind": "apply", "enabled": True, "label": "Apply to shortlisted jobs",
     "cron": "0 11,17 * * 1-5", "portals": [], "message": "", "only_when_needed": True},
    {"id": "follow-up", "kind": "follow_up", "enabled": True, "label": "Follow up",
     "cron": "30 10 * * 1-5", "portals": [], "message": "", "only_when_needed": True},
]
DEFAULTS: dict[str, Any] = {"desktop": False, "rules": DEFAULT_RULES}
CHECK_EVERY_SECONDS = 30
KEEP_EVENTS = 500
_fire_lock = threading.Lock()

# --- cron ---------------------------------------------------------------------------------

_BOUNDS = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))
_NAMES = ("minute", "hour", "day of month", "month", "day of week")


def _field(text: str, lo: int, hi: int, name: str) -> set[int]:
    out: set[int] = set()
    for part in text.split(","):
        m = re.fullmatch(r"(\*|\d+(?:-\d+)?)(?:/(\d+))?", part)
        if not m:
            raise DomainValidationError(f"Cron {name}: '{part}' is not valid")
        rng, step = m.group(1), int(m.group(2) or 1)
        if step < 1:
            raise DomainValidationError(f"Cron {name}: step must be 1 or more")
        if rng == "*":
            a, b = lo, hi
        elif "-" in rng:
            a, b = (int(x) for x in rng.split("-"))
        else:
            a = b = int(rng)
            if m.group(2):  # "5/15" = from 5 to the end, every 15
                b = hi
        if not (lo <= a <= hi and lo <= b <= hi and a <= b):
            raise DomainValidationError(f"Cron {name}: {part} is outside {lo}–{hi}")
        out.update(range(a, b + 1, step))
    return out


class Cron:
    """A 5-field cron schedule: minute hour day-of-month month day-of-week (local time)."""

    def __init__(self, expr: str) -> None:
        parts = expr.split()
        if len(parts) != 5:
            raise DomainValidationError(
                "A cron schedule has 5 parts: minute hour day month weekday, "
                "e.g. */30 9-18 * * 1-5")
        self.expr = " ".join(parts)
        sets = [_field(p, lo, hi, n) for p, (lo, hi), n in zip(parts, _BOUNDS, _NAMES, strict=True)]
        self.minutes, self.hours, self.days, self.months, dows = sets
        self.dows = {d % 7 for d in dows}  # 7 = Sunday too
        self.any_day, self.any_dow = parts[2] == "*", parts[4] == "*"

    def matches(self, t: datetime) -> bool:
        if t.minute not in self.minutes or t.hour not in self.hours or t.month not in self.months:
            return False
        day_ok, dow_ok = t.day in self.days, (t.weekday() + 1) % 7 in self.dows
        if self.any_day or self.any_dow:  # standard cron: both restricted = either may match
            return day_ok and dow_ok
        return day_ok or dow_ok

    def next_after(self, t: datetime, limit_days: int = 40) -> datetime | None:
        t = t.replace(second=0, microsecond=0) + timedelta(minutes=1)
        for _ in range(limit_days * 24 * 60):
            if self.matches(t):
                return t
            t += timedelta(minutes=1)
        return None


def describe(expr: str) -> str:
    """A short plain-language version of common schedules (the UI shows the cron otherwise)."""
    m = re.fullmatch(r"\*/(\d+) \* \* \* \*", expr)
    if m:
        return f"every {m.group(1)} minutes"
    if expr == "* * * * *":
        return "every minute"
    if expr == "0 * * * *":
        return "every hour"
    m = re.fullmatch(r"0 \*/(\d+) \* \* \*", expr)
    if m:
        return f"every {m.group(1)} hours"
    return expr


# --- settings -----------------------------------------------------------------------------

def _row(db: Session) -> AppSettings:
    row = db.get(AppSettings, 1)
    if row is None:
        row = AppSettings(id=1, data={})
        db.add(row)
        db.flush()
    return row


def current(db: Session) -> dict[str, Any]:
    saved = (_row(db).data or {}).get("reminders") or {}
    return {**DEFAULTS, **saved}


def validate(cfg: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(cfg.get("desktop", False), bool):
        raise DomainValidationError("desktop must be true or false")
    rules = cfg.get("rules")
    if not isinstance(rules, list) or len(rules) > 30:
        raise DomainValidationError("rules must be a list of at most 30 reminders")
    out, ids = [], set()
    for r in rules:
        if not isinstance(r, dict):
            raise DomainValidationError("Each reminder must be an object")
        rid = str(r.get("id") or "").strip()
        if not re.fullmatch(r"[a-z0-9-]{1,40}", rid) or rid in ids:
            raise DomainValidationError(f"Reminder id '{rid}' must be unique: a-z, 0-9 and -")
        ids.add(rid)
        kind = r.get("kind")
        if kind not in KINDS:
            raise DomainValidationError(f"Reminder kind must be one of {', '.join(KINDS)}")
        label = str(r.get("label") or "").strip()[:80]
        message = str(r.get("message") or "").strip()[:300]
        if kind == "custom" and not message:
            raise DomainValidationError("A custom reminder needs a message")
        portals = [str(p).strip()[:60] for p in (r.get("portals") or []) if str(p).strip()][:12]
        cron = Cron(str(r.get("cron") or ""))
        out.append({"id": rid, "kind": kind, "enabled": bool(r.get("enabled")),
                    "label": label or kind.replace("_", " ").capitalize(), "cron": cron.expr,
                    "portals": portals, "message": message,
                    "only_when_needed": bool(r.get("only_when_needed"))})
    return {"desktop": bool(cfg.get("desktop", False)), "rules": out}


def save(db: Session, cfg: dict[str, Any]) -> dict[str, Any]:
    clean = validate(cfg)
    row = _row(db)
    row.data = {**(row.data or {}), "reminders": clean}
    db.commit()
    return overview(db)


def desktop_available() -> bool:
    return platform.system() == "Darwin" and shutil.which("osascript") is not None


def overview(db: Session, now: datetime | None = None) -> dict[str, Any]:
    cfg = current(db)
    now = now or datetime.now().astimezone()
    rules = []
    for r in cfg["rules"]:
        nxt = Cron(r["cron"]).next_after(now) if r["enabled"] else None
        rules.append({**r, "schedule": describe(r["cron"]),
                      "next_run": nxt.isoformat() if nxt else None})
    return {"desktop": cfg["desktop"], "desktop_available": desktop_available(), "rules": rules}


# --- firing -------------------------------------------------------------------------------

def _counts(db: Session) -> dict[str, int]:
    from app.services.dashboard_service import summary

    return summary(db)


def build_message(db: Session, rule: dict[str, Any]) -> tuple[str, str, str] | None:
    """(title, body, url) for a reminder now, or None when there's nothing to do and the
    reminder only fires when needed."""
    kind = rule["kind"]
    if kind == "custom":
        return rule["label"], rule["message"], "/"
    s = _counts(db)
    if kind == "check_portals":
        portals = rule.get("portals") or DEFAULT_PORTALS
        new = s.get("new_jobs", 0)
        body = f"Look for new jobs on {', '.join(portals)}. Paste good ones with Add job."
        if new:
            body += f" {new} new jobs are already waiting for review."
        return rule["label"] or "Check job portals", body, "/jobs/new"
    if kind == "apply":
        n = s.get("ready_to_apply", 0)
        if not n and rule.get("only_when_needed"):
            return None
        body = (f"{n} shortlisted job{'' if n == 1 else 's'} waiting for your application."
                if n else "No shortlisted jobs yet: review new jobs and shortlist the good ones.")
        return rule["label"] or "Apply", body, "/jobs?tab=pending" if n else "/jobs/review"
    n = s.get("due_followups", 0)
    if not n and rule.get("only_when_needed"):
        return None
    late = s.get("overdue_followups", 0)
    body = (f"{n} follow-up{'' if n == 1 else 's'} due{f', {late} late' if late else ''}."
            if n else "No follow-ups due. Check your applications for news.")
    return rule["label"] or "Follow up", body, "/followups"


def _desktop(title: str, body: str) -> None:
    if not desktop_available():
        return
    try:
        subprocess.run(  # noqa: S603 - fixed program; title/body are arguments, never code
            ["/usr/bin/osascript", "-e", "on run argv",
             "-e", "display notification (item 2 of argv) with title (item 1 of argv) "
                   "subtitle \"Career Intelligence\" sound name \"Glass\"",
             "-e", "end run", title, body],
            capture_output=True, timeout=10, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        logger.warning("desktop notification failed", exc_info=True)


def fire(db: Session, rule: dict[str, Any], test: bool = False,
         desktop: bool | None = None) -> ReminderEvent | None:
    msg = build_message(db, rule)
    if msg is None:
        if not test:
            return None
        msg = (rule["label"], "Nothing to do right now, so this reminder would stay quiet.", "/")
    title, body, url = msg
    event = ReminderEvent(rule_id=rule["id"], title=title[:200], body=body, url=url, test=test)
    db.add(event)
    db.flush()
    old = db.scalars(select(ReminderEvent.id).order_by(ReminderEvent.id.desc())
                     .offset(KEEP_EVENTS)).all()
    for eid in old:
        db.delete(db.get(ReminderEvent, eid))
    db.commit()
    if desktop if desktop is not None else current(db)["desktop"]:
        _desktop(title, body)
    return event


def fire_now(db: Session, rule_id: str) -> ReminderEvent:
    rule = next((r for r in current(db)["rules"] if r["id"] == rule_id), None)
    if rule is None:
        raise NotFoundError("No such reminder")
    event = fire(db, rule, test=True)
    assert event is not None
    return event


def events(db: Session, after: int = 0, limit: int = 50) -> list[ReminderEvent]:
    stmt = select(ReminderEvent).order_by(ReminderEvent.id.desc()).limit(limit)
    if after:
        stmt = stmt.where(ReminderEvent.id > after)
    return list(db.scalars(stmt))


def run_due(db: Session, now: datetime, fired: dict[str, str]) -> list[ReminderEvent]:
    """Fire every enabled reminder whose schedule matches this minute (once per minute)."""
    minute = now.replace(second=0, microsecond=0)
    key = minute.isoformat()
    out = []
    for rule in current(db)["rules"]:
        if not rule["enabled"] or fired.get(rule["id"]) == key:
            continue
        if Cron(rule["cron"]).matches(minute):
            fired[rule["id"]] = key
            if event := fire(db, rule):
                out.append(event)
    return out


def _loop(stop: threading.Event) -> None:
    from app.db.session import get_sessionmaker

    fired: dict[str, str] = {}
    while not stop.wait(CHECK_EVERY_SECONDS):
        try:
            with _fire_lock, get_sessionmaker()() as db:
                run_due(db, datetime.now().astimezone(), fired)
        except Exception:
            logger.exception("reminder check failed")


def start_scheduler() -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=_loop, args=(stop,), name="reminders", daemon=True).start()
    return stop
