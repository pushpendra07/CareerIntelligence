"""Dashboard counters, charts, funnels, skill-gap analytics and Today's Priorities.

All aggregation happens in SQL (GROUP BY / jsonb_array_elements) so it stays fast at
10,000+ jobs; the frontend only ever receives small summaries.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import Integer, Numeric, case, cast, func, or_, select, text
from sqlalchemy.orm import Session

from app.models.application import Application, FollowUp
from app.models.company import Company, Contact
from app.models.cv import CV
from app.models.interview import Interview, InterviewResult, InterviewStatus
from app.models.job import Job, JobSourceLink, JobStatus
from app.models.match import JobMatch
from app.models.offer import Offer, OfferStatus
from app.skills.catalog import SKILLS

UNAPPLIED = [
    JobStatus.NEW.value,
    JobStatus.DISCOVERED.value,
    JobStatus.REVIEWING.value,
    JobStatus.SHORTLISTED.value,
    JobStatus.READY_TO_APPLY.value,
]


def _count(db: Session, stmt: Any) -> int:
    return int(db.scalar(stmt) or 0)


def summary(db: Session) -> dict[str, int]:
    all_jobs = select(func.count()).select_from(Job)
    # Job cards open the "Open jobs" tab, so closed positions are counted separately.
    # Same set as the "All open" tab: closed and not-relevant jobs are left out.
    jobs = all_jobs.where(Job.status.not_in([JobStatus.CLOSED.value, JobStatus.NOT_RELEVANT.value]))
    today = date.today()
    return {
        "total_jobs": _count(db, jobs),
        "closed_jobs": _count(db, all_jobs.where(Job.status == JobStatus.CLOSED.value)),
        "new_jobs": _count(
            db, jobs.where(Job.status.in_([JobStatus.NEW.value, JobStatus.DISCOVERED.value]))
        ),
        "jobs_scored": _count(db, jobs.where(Job.match_score.is_not(None))),
        "jobs_90_plus": _count(db, jobs.where(Job.match_score >= 90)),
        "jobs_80_plus": _count(db, jobs.where(Job.match_score >= 80)),
        "stale_scores": _count(db, all_jobs.where(Job.score_stale.is_(True))),
        "shortlisted": _count(db, jobs.where(Job.status == JobStatus.SHORTLISTED.value)),
        "applications": _count(db, select(func.count()).select_from(Application)),
        "interviews": _count(db, select(func.count()).select_from(Interview)),
        "offers": _count(db, select(func.count()).select_from(Offer)),
        "rejections": _count(
            db,
            select(func.count()).select_from(Application).where(Application.status == "REJECTED"),
        ),
        "pending_followups": _count(
            db, select(func.count()).select_from(FollowUp).where(FollowUp.completed.is_(False))
        ),
        "overdue_followups": _count(
            db,
            select(func.count())
            .select_from(FollowUp)
            .where(FollowUp.completed.is_(False), FollowUp.due_date < today),
        ),
        "companies": _count(db, select(func.count()).select_from(Company)),
        # Last 7 days, for "this week" on the dashboard.
        "new_this_week": _count(
            db, all_jobs.where(Job.created_at >= datetime.now(UTC) - timedelta(days=7))
        ),
        "applied_this_week": _count(
            db,
            select(func.count()).select_from(Application)
            .where(Application.created_at >= datetime.now(UTC) - timedelta(days=7)),
        ),
    }


def _pairs(rows: Any) -> list[dict[str, Any]]:
    return [{"label": str(k) if k is not None else "Unknown", "value": int(v)} for k, v in rows]


def charts(db: Session) -> dict[str, Any]:
    bucket = case(
        (Job.match_score >= 90, "90-100"),
        (Job.match_score >= 80, "80-89"),
        (Job.match_score >= 70, "70-79"),
        (Job.match_score >= 60, "60-69"),
        (Job.match_score.is_not(None), "0-59"),
        else_="Not scored",
    )
    by_score: dict[str, int] = dict(db.execute(select(bucket, func.count()).group_by(bucket)).all())
    order = ["90-100", "80-89", "70-79", "60-69", "0-59", "Not scored"]

    week = func.date_trunc("week", Interview.scheduled_at)
    interviews_over_time = [
        {"label": w.date().isoformat(), "value": int(n)}
        for w, n in db.execute(
            select(week, func.count())
            .where(Interview.scheduled_at.is_not(None))
            .group_by(week)
            .order_by(week)
        ).all()
    ]
    location = func.jsonb_array_elements_text(Job.locations).table_valued("value")
    top_locations = db.execute(
        select(location.c.value, func.count())
        .select_from(Job)
        .join(location, text("true"))
        .group_by(location.c.value)
        .order_by(func.count().desc())
        .limit(10)
    ).all()

    top_companies = [
        {
            "label": name,
            "value": int(n),
            "avg_score": round(float(avg), 1) if avg else None,
            "tier": tier,
        }
        for name, tier, n, avg in db.execute(
            select(Company.name, Company.tier, func.count(Job.id), func.avg(Job.match_score))
            .join(Job, Job.company_id == Company.id)
            .group_by(Company.id)
            .order_by(func.avg(Job.match_score).desc().nulls_last(), func.count(Job.id).desc())
            .limit(10)
        ).all()
    ]
    return {
        "jobs_by_source": _pairs(
            db.execute(
                select(JobSourceLink.source, func.count(func.distinct(JobSourceLink.job_id)))
                .group_by(JobSourceLink.source)
                .order_by(func.count().desc())
            ).all()
        ),
        "jobs_by_score": [{"label": k, "value": int(by_score.get(k, 0))} for k in order],
        "applications_by_status": _pairs(
            db.execute(
                select(Application.status, func.count())
                .group_by(Application.status)
                .order_by(func.count().desc())
            ).all()
        ),
        "interviews_over_time": interviews_over_time,
        "applications_by_company": _pairs(
            db.execute(
                select(Company.name, func.count(Application.id))
                .join(Application, Application.company_id == Company.id)
                .group_by(Company.name)
                .order_by(func.count(Application.id).desc())
                .limit(10)
            ).all()
        ),
        "jobs_by_location": _pairs(top_locations),
        "jobs_by_work_model": _pairs(
            db.execute(
                select(Job.work_model, func.count())
                .group_by(Job.work_model)
                .order_by(func.count().desc())
            ).all()
        ),
        "top_companies": top_companies,
        "top_requested_skills": top_requested_skills(db),
        "skill_gaps": skill_gaps(db),
    }


def top_requested_skills(db: Session, limit: int = 15) -> list[dict[str, Any]]:
    skill = func.jsonb_array_elements_text(Job.required_skills).table_valued("value")
    rows = db.execute(
        select(skill.c.value, func.count())
        .select_from(Job)
        .join(skill, text("true"))
        .group_by(skill.c.value)
        .order_by(func.count().desc(), skill.c.value)
        .limit(limit)
    ).all()
    return _pairs(rows)


def skill_gaps(db: Session, limit: int = 15) -> list[dict[str, Any]]:
    """Required skills most often missing in current matches (weighted toward good jobs)."""
    elem = func.jsonb_array_elements(JobMatch.result["skills"]).table_valued("value")
    skill = elem.c.value.op("->>")("skill")
    match = elem.c.value.op("->>")("match")
    importance = elem.c.value.op("->>")("importance")
    rows = db.execute(
        select(skill, func.count(), func.avg(JobMatch.score))
        .select_from(JobMatch)
        .join(Job, Job.current_match_id == JobMatch.id)
        .join(elem, text("true"))
        .where(match.in_(["MISSING", "NICE_TO_HAVE", "RELATED"]))
        .group_by(skill, importance)
        .having(importance == "REQUIRED")
        .order_by(func.count().desc(), skill)
        .limit(limit)
    ).all()
    return [{"label": s, "value": int(n), "avg_job_score": round(float(a), 1)} for s, n, a in rows]


def funnels(db: Session) -> dict[str, list[dict[str, Any]]]:
    def app_count(*statuses: str) -> int:
        return _count(
            db,
            select(func.count()).select_from(Application).where(Application.status.in_(statuses)),
        )

    later = ["SCREENING", "INTERVIEW", "OFFER", "ACCEPTED"]
    reached_screen = _count(
        db,
        select(func.count(func.distinct(Application.id)))
        .select_from(Application)
        .where(
            or_(
                Application.status.in_(later),
                Application.events.any(
                    text("to_status IN ('SCREENING','INTERVIEW','OFFER','ACCEPTED')")
                ),
            )
        ),
    )
    reached_interview = _count(
        db,
        select(func.count(func.distinct(Interview.application_id))).where(
            Interview.application_id.is_not(None)
        ),
    )
    application = [
        {"stage": "Applied", "value": _count(db, select(func.count()).select_from(Application))},
        {"stage": "Screening+", "value": reached_screen},
        {"stage": "Interview", "value": reached_interview},
        {
            "stage": "Offer",
            "value": _count(
                db,
                select(func.count(func.distinct(Offer.application_id))).where(
                    Offer.application_id.is_not(None)
                ),
            ),
        },
        {"stage": "Accepted", "value": app_count("ACCEPTED")},
    ]
    ivs = select(func.count()).select_from(Interview)
    interview = [
        {"stage": "Scheduled", "value": _count(db, ivs)},
        {
            "stage": "Completed",
            "value": _count(db, ivs.where(Interview.status == InterviewStatus.COMPLETED.value)),
        },
        {
            "stage": "Passed",
            "value": _count(db, ivs.where(Interview.result == InterviewResult.PASSED.value)),
        },
    ]
    offers = select(func.count()).select_from(Offer)
    offer = [
        {"stage": "Received", "value": _count(db, offers)},
        {
            "stage": "Negotiated",
            "value": _count(db, offers.where(func.jsonb_array_length(Offer.negotiation_log) > 0)),
        },
        {
            "stage": "Accepted",
            "value": _count(db, offers.where(Offer.status == OfferStatus.ACCEPTED.value)),
        },
    ]
    return {"application": application, "interview": interview, "offer": offer}


def score_analytics(db: Session) -> dict[str, Any]:
    comp = func.jsonb_array_elements(JobMatch.result["components"]).table_valued("value")
    key = comp.c.value.op("->>")("key")
    factor: Any = cast(comp.c.value.op("->>")("factor"), Numeric())
    rows = db.execute(
        select(key, func.avg(factor))
        .select_from(JobMatch)
        .join(Job, Job.current_match_id == JobMatch.id)
        .join(comp, text("true"))
        .group_by(key)
    ).all()
    by_rec = _pairs(
        db.execute(
            select(Job.recommendation, func.count())
            .where(Job.recommendation.is_not(None))
            .group_by(Job.recommendation)
        ).all()
    )
    applied_scores = db.execute(
        select(func.avg(Job.match_score), func.count()).join(
            Application, Application.job_id == Job.id
        )
    ).one()
    return {
        "average_component_factor": {k: round(float(v), 3) for k, v in rows},
        "by_recommendation": by_rec,
        "average_score": db.scalar(select(func.avg(Job.match_score))),
        "average_score_applied": applied_scores[0],
        "interview_rate_by_score": _interview_rate_by_score(db),
    }


def _interview_rate_by_score(db: Session) -> list[dict[str, Any]]:
    bucket = (cast(Job.match_score, Integer) / 10 * 10).label("bucket")
    has_iv = select(Interview.id).where(Interview.job_id == Job.id).exists()
    rows = db.execute(
        select(bucket, func.count(), func.sum(case((has_iv, 1), else_=0)))
        .join(Application, Application.job_id == Job.id)
        .where(Job.match_score.is_not(None))
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    return [
        {"label": f"{b}-{b + 9}", "applications": int(n), "interviews": int(i or 0)}
        for b, n, i in rows
    ]


def priorities(db: Session, limit: int = 12) -> list[dict[str, Any]]:
    """Today's Priorities, ranked: interviews soon, overdue follow-ups, expiring offers,
    best unapplied jobs, then housekeeping."""
    now = datetime.now(UTC)
    today = date.today()
    items: list[dict[str, Any]] = []
    for iv, title, company in db.execute(
        select(Interview, Job.title, Company.name)
        .join(Job, Interview.job_id == Job.id)
        .join(Company, Interview.company_id == Company.id)
        .where(
            Interview.status.in_(
                [InterviewStatus.SCHEDULED.value, InterviewStatus.RESCHEDULED.value]
            ),
            Interview.scheduled_at.between(now - timedelta(hours=2), now + timedelta(days=3)),
        )
        .order_by(Interview.scheduled_at)
    ).all():
        assert iv.scheduled_at is not None
        days = (iv.scheduled_at.date() - today).days
        when = "today" if days <= 0 else "tomorrow" if days == 1 else f"in {days} days"
        items.append(
            {
                "type": "INTERVIEW",
                "rank": 1,
                "title": f"Interview {when} — {company}",
                "detail": f"{iv.round_type.replace('_', ' ').title()} · {title}",
                "due": iv.scheduled_at,
                "link": {"entity": "interview", "id": iv.id},
                "prep_link": {"entity": "interview_prep", "id": iv.id},
            }
        )
    for f, contact in db.execute(
        select(FollowUp, Contact.name)
        .outerjoin(Contact, FollowUp.contact_id == Contact.id)
        .where(FollowUp.completed.is_(False), FollowUp.due_date <= today)
        .order_by(FollowUp.due_date)
        .limit(10)
    ).all():
        who = f" — {contact}" if contact else ""
        items.append(
            {
                "type": "FOLLOW_UP",
                "rank": 2,
                "title": f"Follow up{who}",
                "detail": f.title,
                "due": f.due_date,
                "overdue": f.due_date < today,
                "link": {"entity": "followup", "id": f.id},
            }
        )
    for o, company in db.execute(
        select(Offer, Company.name)
        .join(Company, Offer.company_id == Company.id)
        .where(
            Offer.status.in_([OfferStatus.RECEIVED.value, OfferStatus.NEGOTIATING.value]),
            Offer.expiry_date.is_not(None),
            Offer.expiry_date <= today + timedelta(days=5),
        )
        .order_by(Offer.expiry_date)
    ).all():
        items.append(
            {
                "type": "OFFER",
                "rank": 3,
                "title": f"Decide on offer — {company}",
                "detail": f"Expires {o.expiry_date}",
                "due": o.expiry_date,
                "link": {"entity": "offer", "id": o.id},
            }
        )
    no_app = ~select(Application.id).where(Application.job_id == Job.id).exists()
    for job, company in db.execute(
        select(Job, Company.name)
        .join(Company, Job.company_id == Company.id)
        .where(
            Job.status.in_(UNAPPLIED),
            Job.match_score >= 80,
            Job.score_stale.is_(False),
            Job.jd_status == "OK",
            no_app,
        )
        .order_by(Job.match_score.desc(), Job.posting_date.desc().nulls_last())
        .limit(5)
    ).all():
        items.append(
            {
                "type": "APPLY",
                "rank": 4,
                "title": f"Apply — {job.title} — {job.match_score}/100",
                "detail": company,
                "due": job.application_deadline,
                "link": {"entity": "job", "id": job.id},
            }
        )
    stale = _count(db, select(func.count()).select_from(Job).where(Job.score_stale.is_(True)))
    if stale:
        items.append(
            {
                "type": "REANALYZE",
                "rank": 5,
                "title": f"Re-analyze {stale} jobs",
                "detail": "Scores are stale after profile/preference changes",
                "due": None,
                "link": {"entity": "reanalyze", "id": None},
            }
        )
    missing_jd = _count(
        db,
        select(func.count())
        .select_from(Job)
        .where(Job.jd_status != "OK", Job.status.in_(UNAPPLIED), Job.match_score >= 70),
    )
    if missing_jd:
        items.append(
            {
                "type": "ADD_JD",
                "rank": 6,
                "title": f"Add job descriptions for {missing_jd} promising jobs",
                "detail": "Scores without a JD are low-confidence",
                "due": None,
                "link": {"entity": "jobs_missing_jd", "id": None},
            }
        )
    items.sort(key=lambda i: (i["rank"], str(i.get("due") or "9999")))
    for n, item in enumerate(items[:limit], 1):
        item["position"] = n
    return items[:limit]


def global_search(db: Session, q: str, limit: int = 5) -> dict[str, list[dict[str, Any]]]:
    like = f"%{q.strip()}%"
    jobs = db.execute(
        select(Job.id, Job.title, Company.name, Job.match_score)
        .join(Company, Job.company_id == Company.id)
        .where(or_(Job.title.ilike(like), Company.name.ilike(like)))
        .order_by(Job.match_score.desc().nulls_last())
        .limit(limit)
    ).all()
    companies = db.execute(
        select(Company.id, Company.name, Company.tier)
        .where(or_(Company.name.ilike(like), Company.domain.ilike(like)))
        .order_by(Company.name)
        .limit(limit)
    ).all()
    contacts = db.execute(
        select(Contact.id, Contact.name, Contact.job_title)
        .where(or_(Contact.name.ilike(like), Contact.email.ilike(like)))
        .limit(limit)
    ).all()
    apps = db.execute(
        select(Application.id, Job.title, Company.name, Application.status)
        .join(Job, Application.job_id == Job.id)
        .join(Company, Application.company_id == Company.id)
        .where(or_(Job.title.ilike(like), Company.name.ilike(like)))
        .limit(limit)
    ).all()
    ivs = db.execute(
        select(Interview.id, Job.title, Company.name, Interview.round_type)
        .join(Job, Interview.job_id == Job.id)
        .join(Company, Interview.company_id == Company.id)
        .where(or_(Job.title.ilike(like), Company.name.ilike(like)))
        .limit(limit)
    ).all()
    cvs = db.execute(
        select(CV.id, CV.name, CV.target_role)
        .where(or_(CV.name.ilike(like), CV.target_role.ilike(like)))
        .limit(limit)
    ).all()
    ql = q.strip().lower()
    skills = [
        s.name for s in SKILLS if ql and (ql in s.name.lower() or any(ql in a for a in s.aliases))
    ][:limit]
    return {
        "jobs": [{"id": i, "title": t, "subtitle": c, "score": s} for i, t, c, s in jobs],
        "companies": [{"id": i, "title": n, "subtitle": t} for i, n, t in companies],
        "recruiters": [{"id": i, "title": n, "subtitle": t} for i, n, t in contacts],
        "applications": [{"id": i, "title": t, "subtitle": f"{c} · {s}"} for i, t, c, s in apps],
        "interviews": [{"id": i, "title": t, "subtitle": f"{c} · {r}"} for i, t, c, r in ivs],
        "cvs": [{"id": i, "title": n, "subtitle": r} for i, n, r in cvs],
        "skills": [{"id": None, "title": s, "subtitle": "skill"} for s in skills],
    }
