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


NEW_JOB_STATUSES = ("NEW", "DISCOVERED")
APPLY_PENDING_STATUSES = ("SHORTLISTED", "READY_TO_APPLY")
LIST_LIMIT = 8


def _latest_applications(db: Session, job_ids: set[int]) -> dict[int, Application]:
    if not job_ids:
        return {}
    out: dict[int, Application] = {}
    for app in db.scalars(select(Application).where(Application.job_id.in_(job_ids))
                          .order_by(Application.applied_on, Application.id)):
        out[app.job_id] = app  # the latest one wins
    return out


def _job_row(job: Job, company: str, app: Application | None) -> dict[str, Any]:
    return {"job_id": job.id, "job_title": job.title, "company": company,
            "location": job.location, "work_model": job.work_model, "score": job.match_score,
            "job_status": job.status,
            "applied": app is not None, "applied_on": app.applied_on.isoformat() if app else None,
            "application_status": app.status if app else None,
            "application_id": app.id if app else None,
            "added_on": job.created_at.isoformat() if job.created_at else None}


def reminders(db: Session, now: datetime | None = None) -> dict[str, Any]:
    """What needs you (the bell and browser notifications): follow-ups due today or late,
    interviews in the next 24 hours, the best new jobs and shortlisted jobs not applied to —
    each with the job, company and whether / when you applied."""
    now = now or datetime.now(UTC)
    today = now.astimezone().date()
    due = db.execute(
        select(FollowUp, Job, Company.name)
        .outerjoin(Job, Job.id == FollowUp.job_id)
        .outerjoin(Company, Company.id == func.coalesce(FollowUp.company_id, Job.company_id))
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
    new_jobs = db.execute(
        select(Job, Company.name).join(Company, Company.id == Job.company_id)
        .where(Job.status.in_(NEW_JOB_STATUSES))
        .order_by(Job.match_score.desc().nulls_last(), Job.id.desc()).limit(LIST_LIMIT)
    ).all()
    pending = db.execute(
        select(Job, Company.name).join(Company, Company.id == Job.company_id)
        .where(Job.status.in_(APPLY_PENDING_STATUSES),
               ~select(Application.id).where(Application.job_id == Job.id).exists())
        .order_by(Job.match_score.desc().nulls_last(), Job.id.desc()).limit(LIST_LIMIT)
    ).all()
    apps = _latest_applications(db, {j.id for _, j, _ in due if j is not None})
    followups = []
    for f, job, company in due:
        row = _job_row(job, company or "", apps.get(job.id)) if job is not None else {
            "job_id": None, "job_title": None, "company": company, "applied": None}
        followups.append({**row, "id": f.id, "title": f.title, "due_date": f.due_date.isoformat(),
                          "late_days": (today - f.due_date).days})
    return {
        "followups": followups,
        "interviews": [{"id": i, "job_id": j, "round": rn, "round_type": rt,
                        "scheduled_at": at.isoformat(), "meeting_link": link, "job_title": t,
                        "company": c,
                        "minutes_until": int((at - now).total_seconds() // 60)}
                       for i, j, rn, rt, at, link, t, c in soon if at is not None],
        "new_jobs": [_job_row(job, company, None) for job, company in new_jobs],
        "apply_pending": [_job_row(job, company, None) for job, company in pending],
    }
