"""Weekly goals (applications, jobs reviewed, follow-ups done, recruiters contacted) and the
reminders the browser shows (follow-ups due, interviews coming up).

Weeks run Monday–Sunday in the app's time zone. Everything is counted from what actually
happened (applications, the activity log, completed follow-ups) — nothing is self-reported.
A target of 0 turns that goal off.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError
from app.models.activity_log import ActivityLog
from app.models.application import Application, FollowUp
from app.models.company import Company
from app.models.interview import Interview
from app.models.job import Job

DEFAULT_GOALS: dict[str, int] = {"applications": 10, "reviewed": 30, "followups": 5,
                                 "outreach": 3}
GOALS: dict[str, dict[str, str]] = {
    "applications": {"label": "Applications sent", "to": "/jobs?tab=pending",
                     "hint": "Jobs you applied to (Apply, or set to Applied)"},
    "reviewed": {"label": "New jobs reviewed", "to": "/jobs/review",
                 "hint": "New jobs you shortlisted, skipped or moved on"},
    "followups": {"label": "Follow-ups done", "to": "/followups",
                  "hint": "Follow-ups marked done"},
    "outreach": {"label": "Recruiters contacted", "to": "/recruiters",
                 "hint": "Recruiters set to Contacted"},
}
UNREVIEWED = ("NEW", "DISCOVERED")
HISTORY_WEEKS = 12


def validate_goals(values: dict[str, Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    for key, default in DEFAULT_GOALS.items():
        v = values.get(key, default)
        if isinstance(v, bool) or not isinstance(v, int | float) or not 0 <= v <= 500:
            raise DomainValidationError(f"Goal '{key}' must be a number from 0 to 500")
        out[key] = int(v)
    return out


def week_of(day: date) -> tuple[date, date]:
    start = day - timedelta(days=day.weekday())
    return start, start + timedelta(days=6)


def _ts(d: date) -> datetime:
    return datetime.combine(d, time.min).astimezone(UTC)


def _between(col: Any, start: date, end: date) -> Any:
    return (col >= _ts(start)) & (col < _ts(end + timedelta(days=1)))


def _counters(db: Session) -> dict[str, Callable[[date, date], int]]:
    def applications(s: date, e: date) -> int:
        return int(db.scalar(select(func.count(Application.id))
                             .where(Application.applied_on.between(s, e))) or 0)

    def reviewed(s: date, e: date) -> int:
        return int(db.scalar(
            select(func.count(func.distinct(ActivityLog.entity_id))).where(
                ActivityLog.entity_type == "job",
                ActivityLog.data["from"].astext.in_(UNREVIEWED),
                _between(ActivityLog.occurred_at, s, e))) or 0)

    def followups(s: date, e: date) -> int:
        return int(db.scalar(select(func.count(FollowUp.id)).where(
            FollowUp.completed.is_(True), _between(FollowUp.completed_at, s, e))) or 0)

    def outreach(s: date, e: date) -> int:
        return int(db.scalar(
            select(func.count(func.distinct(ActivityLog.entity_id))).where(
                ActivityLog.action == "recruiter.contacted",
                _between(ActivityLog.occurred_at, s, e))) or 0)

    return {"applications": applications, "reviewed": reviewed, "followups": followups,
            "outreach": outreach}


def weekly(db: Session, targets: dict[str, int], today: date | None = None) -> dict[str, Any]:
    """This week's progress per goal, last week's, and how many weeks in a row were met."""
    today = today or date.today()
    start, end = week_of(today)
    count = _counters(db)
    active = {k: t for k, t in targets.items() if t > 0 and k in count}
    days_left = (end - today).days + 1  # today included

    def met(s: date, e: date) -> bool:
        return bool(active) and all(count[k](s, e) >= t for k, t in active.items())

    goals = []
    for key, meta in GOALS.items():
        target = targets.get(key, 0)
        done = count[key](start, today)
        left = max(target - done, 0)
        approx = int(db.scalar(select(func.count(Application.id)).where(
            Application.applied_on.between(start, today), Application.origin == "auto")) or 0
        ) if key == "applications" else 0
        goals.append({
            "key": key, **meta, "target": target, "done": done, "left": left,
            # Applications recorded automatically (job set to Applied, e.g. by a sheet import):
            # their date is when that happened, which may not be when you applied.
            "approximate": approx,
            "per_day": -(-left // days_left) if target else 0,  # ceil
            "last_week": count[key](start - timedelta(days=7), start - timedelta(days=1)),
        })
    streak = 0
    for n in range(1, HISTORY_WEEKS + 1):
        s = start - timedelta(days=7 * n)
        if not met(s, s + timedelta(days=6)):
            break
        streak += 1
    return {
        "week_start": start.isoformat(), "week_end": end.isoformat(), "days_left": days_left,
        "goals": goals, "streak": streak,
        "all_met": met(start, today),
    }


def reminders(db: Session, now: datetime | None = None) -> dict[str, Any]:
    """What the browser should remind you about: follow-ups due today or late, and interviews
    in the next 24 hours."""
    now = now or datetime.now(UTC)
    today = now.astimezone().date()
    due = db.execute(
        select(FollowUp.id, FollowUp.title, FollowUp.due_date, FollowUp.job_id)
        .where(FollowUp.completed.is_(False), FollowUp.due_date <= today)
        .order_by(FollowUp.due_date, FollowUp.id).limit(50)
    ).all()
    soon = db.execute(
        select(Interview.id, Interview.job_id, Interview.round_number, Interview.round_type,
               Interview.scheduled_at, Interview.meeting_link, Job.title, Company.name)
        .join(Job, Job.id == Interview.job_id).join(Company, Company.id == Interview.company_id)
        .where(Interview.status.in_(["SCHEDULED", "RESCHEDULED"]),
               Interview.scheduled_at >= now, Interview.scheduled_at <= now + timedelta(hours=24))
        .order_by(Interview.scheduled_at)
    ).all()
    return {
        "followups": [{"id": i, "title": t, "due_date": d.isoformat(),
                       "late_days": (today - d).days, "job_id": j} for i, t, d, j in due],
        "interviews": [{"id": i, "job_id": j, "round": rn, "round_type": rt,
                        "scheduled_at": at.isoformat(), "meeting_link": link, "job_title": t,
                        "company": c,
                        "minutes_until": int((at - now).total_seconds() // 60)}
                       for i, j, rn, rt, at, link, t, c in soon if at is not None],
    }
