"""What the chat assistant can look up, and the changes it can propose.

Read tools call the same functions as the HTTP API (so results match the UI) and return compact
JSON for the model plus a "card" the UI shows. Write tools never change anything: they return an
*action* (an API call) that the user confirms with a button in the chat.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import AppError, DomainValidationError
from app.core.pagination import PageParams
from app.models.job import JobStatus
from app.services.job_service import JobFilters

MAX_ROWS = 25
STATUSES = [s.value for s in JobStatus]
# The Jobs page tabs, so "applied jobs" or "pending" mean the same as in the UI.
TAB_STATUSES = {
    "new": ["NEW", "DISCOVERED"],
    "pending": ["REVIEWING", "SHORTLISTED", "READY_TO_APPLY", "ON_HOLD"],
    "applied": ["APPLIED", "RECRUITER_CONTACTED", "SCREENING"],
    "interview": ["INTERVIEW", "AWAITING_FEEDBACK"],
    "selected": ["OFFER", "ACCEPTED"],
    "rejected": ["REJECTED"],
    "not-pursuing": ["WITHDRAWN", "NOT_RELEVANT", "IGNORED", "DUPLICATE"],
    "closed": ["CLOSED"],
}


@dataclass
class ToolResult:
    data: Any  # what the model reads
    card: dict[str, Any] | None = None  # what the user sees under the answer
    action: dict[str, Any] | None = None  # a change waiting for the user's confirmation


@dataclass
class Tool:
    name: str
    description: str
    params: dict[str, Any]  # JSON-schema properties
    run: Callable[[Session, dict[str, Any]], ToolResult]
    required: list[str] = field(default_factory=list)
    writes: bool = False

    def schema(self) -> dict[str, Any]:
        return {"type": "object", "properties": self.params, "required": self.required}


def _limit(args: dict[str, Any], default: int = 10) -> int:
    try:
        return max(1, min(int(args.get("limit") or default), MAX_ROWS))
    except (TypeError, ValueError):
        return default


def _statuses(value: Any) -> list[str] | None:
    """Job statuses from status names or tab names ("applied", "pending"…)."""
    if not value:
        return None
    out: list[str] = []
    for v in value if isinstance(value, list) else [value]:
        key = str(v).strip().lower().replace(" ", "-").replace("_", "-")
        if key in TAB_STATUSES:
            out += TAB_STATUSES[key]
        elif (up := str(v).strip().upper().replace(" ", "_").replace("-", "_")) in STATUSES:
            out.append(up)
    return out or None


def _job_row(j: Any) -> dict[str, Any]:
    return {
        "id": j.id,
        "title": j.title,
        "company": j.company.name if j.company else None,
        "location": j.location,
        "work_model": j.work_model,
        "score": j.match_score,
        "recommendation": j.recommendation,
        "status": j.status,
        "posted": j.posting_date.isoformat() if j.posting_date else None,
        "added": j.created_at.date().isoformat() if j.created_at else None,
        "url": j.source_url,
    }


def _jobs_card(title: str, rows: list[dict[str, Any]], total: int) -> dict[str, Any]:
    return {"type": "jobs", "title": title, "total": total, "items": rows}


# --- read tools -----------------------------------------------------------------------------

SORTS = {
    "best": "-match_score",
    "newest": "-created_at",
    "posted": "-posting_date",
    "company": "company",
    "status": "status",
}


def search_jobs(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.services import job_service

    posted_after = None
    if a.get("posted_within_days"):
        posted_after = date.today() - timedelta(days=int(a["posted_within_days"]))
    work = str(a.get("work_model") or "").upper() or None
    f = JobFilters(
        q=a.get("query") or None,
        min_score=a.get("min_score"),
        location=a.get("location"),
        work_model=work if work in ("REMOTE", "HYBRID", "ONSITE") else None,
        technology=a.get("technology"),
        status=_statuses(a.get("status")),
        closed=a.get("closed")
        if a.get("closed") is not None
        else (None if _statuses(a.get("status")) else False),
        added_via=a.get("added_via"),
        posted_after=posted_after,
        has_application=a.get("has_application"),
        sort=SORTS.get(str(a.get("sort") or "best"), "-match_score"),
    )
    limit = _limit(a)
    items, total = job_service.list_jobs(db, PageParams(page=1, size=limit), f)
    words = str(f.q or "").split()
    if total == 0 and len(words) > 1:  # "magento lead pune": every word somewhere, any order
        f.q = max(words, key=len)
        wide, _ = job_service.list_jobs(db, PageParams(page=1, size=300), f)
        def hay(j: Any) -> str:
            return f"{j.title} {j.company.name if j.company else ''} {j.location or ''}".lower()

        hits = [j for j in wide if all(w.lower() in hay(j) for w in words)]
        items, total = hits[:limit], len(hits)
    rows = [_job_row(j) for j in items]
    return ToolResult({"total": total, "jobs": rows}, _jobs_card("Jobs", rows, total))


def get_job(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.api.v1.jobs import get_job as job_detail

    d = job_detail(db, int(a["job_id"])).model_dump(mode="json")
    match = d.get("match") or {}
    skills = match.get("skills") or []
    data = {
        **{
            k: d.get(k)
            for k in (
                "id",
                "title",
                "location",
                "status",
                "match_score",
                "recommendation",
                "seniority",
                "work_model",
                "experience_min",
                "experience_max",
                "salary_text",
                "salary_min",
                "salary_max",
                "posting_date",
                "source_url",
                "added_via",
                "notes",
                "required_skills",
                "preferred_skills",
                "jd_status",
                "created_at",
            )
        },
        "company": (d.get("company") or {}).get("name"),
        "skills_matched": [s["skill"] for s in skills if s.get("match") != "MISSING"],
        "skills_missing": [s["skill"] for s in skills if s.get("match") == "MISSING"],
        "blockers": match.get("blockers"),
        "score_parts": match.get("components"),
        "strong_matches": match.get("strong_matches"),
        "location_fit": match.get("location_fit"),
        "experience_fit": match.get("experience_fit"),
        "salary_status": match.get("salary_status"),
        "recruiter": d.get("recruiter"),
        "recent_activity": [a.get("summary") for a in (d.get("activity") or [])[:8]],
        "comments": [c.get("body") for c in (d.get("comments") or [])[:5]],
        "description_start": (d.get("original_jd") or "")[:1500],
    }
    card = {
        "type": "jobs",
        "title": "Job",
        "total": 1,
        "items": [
            {
                "id": d["id"],
                "title": d["title"],
                "company": data["company"],
                "location": d.get("location"),
                "score": d.get("match_score"),
                "status": d.get("status"),
                "url": d.get("source_url"),
            }
        ],
    }
    return ToolResult(data, card)


def pipeline_summary(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.services import dashboard_service, job_service

    counts = job_service.status_counts(db, JobFilters())
    data = {
        "job_status_counts": counts,
        "summary": dashboard_service.summary(db),
        "priorities": dashboard_service.priorities(db, 8),
    }
    return ToolResult(
        data,
        {
            "type": "counts",
            "title": "Jobs by status",
            "items": [{"label": k, "value": v} for k, v in counts.items() if v],
        },
    )


def list_applications(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.api.v1.applications import list_apps

    after = (
        date.today() - timedelta(days=int(a["applied_within_days"]))
        if a.get("applied_within_days")
        else None
    )
    status = a.get("status")
    page = list_apps(
        db,
        PageParams(page=1, size=_limit(a)),
        q=a.get("query") or None,
        status=[status.upper()] if isinstance(status, str) and status else None,
        company_id=None,
        job_id=a.get("job_id"),
        cv_version_id=None,
        applied_after=after,
        sort="-applied_on",
    )
    rows = [
        {
            k: r.get(k)
            for k in (
                "id",
                "job_id",
                "job_title",
                "company_name",
                "status",
                "applied_on",
                "method",
                "match_score",
                "follow_up_date",
                "recruiter_name",
                "cv_name",
                "notes",
            )
        }
        for r in (x.model_dump(mode="json") for x in page.items)
    ]
    return ToolResult(
        {"total": page.total, "applications": rows},
        {
            "type": "list",
            "title": "Applications",
            "total": page.total,
            "items": [
                {
                    "label": f"{r.get('job_title')} · {r.get('company_name')}",
                    "detail": f"{r.get('status')} · applied {r.get('applied_on') or '—'}",
                    "href": f"/jobs/{r['job_id']}" if r.get("job_id") else None,
                }
                for r in rows
            ],
        },
    )


def list_interviews(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.api.v1.interviews import list_interviews as ivs

    page = ivs(
        db,
        PageParams(page=1, size=_limit(a)),
        job_id=a.get("job_id"),
        company_id=None,
        status=None,
        upcoming=a.get("upcoming", True),
        sort="scheduled_at" if a.get("upcoming", True) else "-scheduled_at",
    )
    rows = [
        {
            k: r.get(k)
            for k in (
                "id",
                "job_id",
                "job_title",
                "company_name",
                "round_number",
                "round_type",
                "status",
                "scheduled_at",
                "mode",
                "meeting_link",
                "interviewers",
                "notes",
                "feedback",
                "result",
            )
        }
        for r in (x.model_dump(mode="json") for x in page.items)
    ]
    return ToolResult(
        {"total": page.total, "interviews": rows},
        {
            "type": "list",
            "title": "Interviews",
            "total": page.total,
            "items": [
                {
                    "label": f"{r.get('job_title')} · {r.get('company_name')}",
                    "detail": (
                        f"{r.get('round_type')} · {r.get('scheduled_at') or 'not scheduled'} · "
                        f"{r.get('status')}"
                    ),
                    "href": "/interviews",
                }
                for r in rows
            ],
        },
    )


def list_followups(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.api.v1.applications import list_followups as fus

    due = date.today() + timedelta(days=int(a.get("due_within_days") or 7))
    page = fus(
        db,
        PageParams(page=1, size=_limit(a)),
        completed=False,
        due_before=due,
        kind=None,
        application_id=None,
        job_id=a.get("job_id"),
    )
    rows = [
        {
            k: r.get(k)
            for k in (
                "id",
                "job_id",
                "job_title",
                "company_name",
                "kind",
                "title",
                "due_date",
                "overdue",
                "notes",
                "contact_name",
                "job_status",
            )
        }
        for r in (x.model_dump(mode="json") for x in page.items)
    ]
    return ToolResult(
        {"total": page.total, "followups": rows},
        {
            "type": "list",
            "title": "Follow-ups",
            "total": page.total,
            "items": [
                {
                    "label": (
                        f"{r.get('title') or r.get('job_title') or r.get('kind')} · "
                        f"{r.get('company_name') or ''}"
                    ),
                    "detail": f"due {r.get('due_date')}{' (overdue)' if r.get('overdue') else ''}",
                    "href": "/followups",
                }
                for r in rows
            ],
        },
    )


def list_offers(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.api.v1.offers import list_offers as offers

    page = offers(db, PageParams(page=1, size=_limit(a)), status=None)
    rows = [x.model_dump(mode="json") for x in page.items]
    keep = (
        "id",
        "job_id",
        "job_title",
        "company_name",
        "status",
        "designation",
        "base_salary",
        "variable_pay",
        "bonus",
        "total_ctc",
        "currency",
        "offer_date",
        "expiry_date",
        "joining_date",
        "location",
        "work_model",
    )
    rows = [{k: r.get(k) for k in keep if k in r} for r in rows]
    return ToolResult(
        {"total": page.total, "offers": rows},
        {
            "type": "list",
            "title": "Offers",
            "total": page.total,
            "items": [
                {
                    "label": f"{r.get('job_title')} · {r.get('company_name')}",
                    "detail": str(r.get("status")),
                    "href": "/offers",
                }
                for r in rows
            ],
        },
    )


def search_everything(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.services import dashboard_service

    q = str(a.get("query") or "").strip()
    if len(q) < 2:
        raise DomainValidationError("Search needs at least 2 characters")
    return ToolResult(dashboard_service.global_search(db, q, limit=_limit(a, 6)))


def companies(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.api.v1.companies import list_companies

    page = list_companies(
        db,
        PageParams(page=1, size=_limit(a)),
        q=a.get("query") or None,
        tier=a.get("tier"),
        verification_status=None,
        india_presence=None,
        job_search_enabled=None,
        hiring_status=None,
        has_jobs=a.get("has_jobs"),
        sort="-jobs",
    )
    keep = (
        "id",
        "name",
        "tier",
        "website",
        "careers_url",
        "job_count",
        "open_job_count",
        "verification_status",
        "job_search_enabled",
        "hiring_status",
    )
    rows = [{k: r.get(k) for k in keep} for r in (x.model_dump(mode="json") for x in page.items)]
    return ToolResult(
        {"total": page.total, "companies": rows},
        {
            "type": "list",
            "title": "Companies",
            "total": page.total,
            "items": [
                {
                    "label": r["name"],
                    "detail": f"{r.get('open_job_count') or 0} open jobs",
                    "href": f"/companies/{r['id']}",
                }
                for r in rows
            ],
        },
    )


def recruiters(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.api.v1.companies import list_contacts

    page = list_contacts(
        db,
        PageParams(page=1, size=_limit(a)),
        q=a.get("query") or None,
        company_id=None,
        status=None,
    )
    keep = (
        "id",
        "name",
        "job_title",
        "company_name",
        "email",
        "phone",
        "linkedin_url",
        "status",
        "last_contacted_at",
        "next_followup_at",
        "notes",
    )
    rows = [{k: r.get(k) for k in keep} for r in (x.model_dump(mode="json") for x in page.items)]
    return ToolResult(
        {"total": page.total, "recruiters": rows},
        {
            "type": "list",
            "title": "Recruiters",
            "total": page.total,
            "items": [
                {
                    "label": r["name"],
                    "detail": " · ".join(filter(None, [r.get("job_title"), r.get("company_name")])),
                    "href": "/recruiters",
                }
                for r in rows
            ],
        },
    )


def my_profile(db: Session, a: dict[str, Any]) -> ToolResult:
    from app.api.v1.profile import get_preferences, get_profile

    p = get_profile(db).model_dump(mode="json")
    t = get_preferences(db).model_dump(mode="json")
    keep = (
        "headline",
        "location",
        "summary",
        "total_experience_years",
        "relevant_experience_years",
        "primary_roles",
        "core_skills",
        "additional_skills",
        "domains",
        "certifications",
    )
    return ToolResult(
        {
            "profile": {k: p.get(k) for k in keep},
            "target": {
                k: t.get(k)
                for k in (
                    "effective_titles",
                    "preferred_skills",
                    "preferred_locations",
                    "remote_ok",
                    "hybrid_ok",
                    "onsite_ok",
                    "min_salary",
                    "target_salary",
                    "salary_currency",
                )
            },
        }
    )


# --- write tools: proposals the user confirms ---------------------------------------------------


def _job_label(db: Session, job_id: int) -> tuple[str, str | None]:
    from app.services.job_service import get_job as load

    j = load(db, job_id)
    return f"#{j.id} {j.title} · {j.company.name}", j.source_url


def propose_status(db: Session, a: dict[str, Any]) -> ToolResult:
    found = _statuses(a.get("status"))
    status = found[0] if found else ""
    if status not in STATUSES:
        raise DomainValidationError(f"Unknown status {a.get('status')!r}")
    label, _ = _job_label(db, int(a["job_id"]))
    action = {
        "kind": "status",
        "label": f"Set {label} to {status.replace('_', ' ').title()}",
        "method": "POST",
        "path": f"/jobs/{int(a['job_id'])}/status",
        "body": {"status": status},
    }
    return ToolResult({"proposed": action["label"], "needs_confirmation": True}, action=action)


def propose_apply(db: Session, a: dict[str, Any]) -> ToolResult:
    job_id = int(a["job_id"])
    label, url = _job_label(db, job_id)
    body: dict[str, Any] = {"job_id": job_id, "method": str(a.get("method") or "COMPANY_SITE")}
    if a.get("notes"):
        body["notes"] = str(a["notes"])[:2000]
    action = {
        "kind": "apply",
        "label": f"Record application: {label}",
        "method": "POST",
        "path": "/applications",
        "body": body,
        "open_url": url,
    }
    return ToolResult(
        {"proposed": action["label"], "apply_link": url, "needs_confirmation": True}, action=action
    )


def propose_note(db: Session, a: dict[str, Any]) -> ToolResult:
    label, _ = _job_label(db, int(a["job_id"]))
    text = str(a.get("text") or "").strip()
    if not text:
        raise DomainValidationError("The note is empty")
    action = {
        "kind": "note",
        "label": f"Add note to {label}: “{text[:80]}”",
        "method": "POST",
        "path": f"/jobs/{int(a['job_id'])}/comments",
        "body": {"body": text[:5000]},
    }
    return ToolResult({"proposed": action["label"], "needs_confirmation": True}, action=action)


def propose_followup_done(db: Session, a: dict[str, Any]) -> ToolResult:
    fid = int(a["followup_id"])
    action = {
        "kind": "followup",
        "label": f"Mark follow-up #{fid} done",
        "method": "POST",
        "path": f"/followups/{fid}/complete",
        "body": {},
    }
    return ToolResult({"proposed": action["label"], "needs_confirmation": True}, action=action)


_LIMIT = {"type": "integer", "description": f"How many rows (1-{MAX_ROWS}, default 10)"}
_JOB_ID = {"type": "integer", "description": "Job ID (the #number)"}

TOOLS: list[Tool] = [
    Tool(
        "search_jobs",
        "Find jobs in the user's list. Combine filters as needed.",
        {
            "query": {
                "type": "string",
                "description": "Words in the title or company, e.g. 'Magento', 'Accenture'",
            },
            "status": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Statuses or tabs: new, pending, applied, interview, selected, rejected, "
                    "not-pursuing, closed, or exact statuses like NOT_RELEVANT"
                ),
            },
            "min_score": {"type": "integer", "description": "Minimum match score 0-100"},
            "location": {"type": "string", "description": "City or 'remote'"},
            "work_model": {"type": "string", "enum": ["REMOTE", "HYBRID", "ONSITE"]},
            "technology": {"type": "string", "description": "e.g. magento2, laravel, php"},
            "posted_within_days": {"type": "integer"},
            "has_application": {
                "type": "boolean",
                "description": "true = applied (has an application)",
            },
            "closed": {"type": "boolean", "description": "true = only closed postings"},
            "added_via": {
                "type": "string",
                "enum": ["manual", "sheet", "scanner", "career_ops", "file", "ai_search"],
            },
            "sort": {"type": "string", "enum": list(SORTS)},
            "limit": _LIMIT,
        },
        search_jobs,
    ),
    Tool(
        "get_job",
        (
            "Everything about one job: status, score and why, skills matched/missing, salary, "
            "link, application, recent activity, notes."
        ),
        {"job_id": _JOB_ID},
        get_job,
        ["job_id"],
    ),
    Tool(
        "pipeline_summary",
        (
            "Counts of jobs per status, overall numbers (applications, interviews, offers, "
            "follow-ups due) and today's priorities."
        ),
        {},
        pipeline_summary,
    ),
    Tool(
        "list_applications",
        "Applications (newest first) with status and follow-up dates.",
        {
            "query": {"type": "string", "description": "Job title or company"},
            "status": {
                "type": "string",
                "description": "e.g. APPLIED, SCREENING, INTERVIEW, OFFER, REJECTED",
            },
            "applied_within_days": {"type": "integer"},
            "job_id": _JOB_ID,
            "limit": _LIMIT,
        },
        list_applications,
    ),
    Tool(
        "list_interviews",
        "Interviews: upcoming (default) or past.",
        {"upcoming": {"type": "boolean"}, "job_id": _JOB_ID, "limit": _LIMIT},
        list_interviews,
    ),
    Tool(
        "list_followups",
        "Open follow-ups due soon or overdue.",
        {
            "due_within_days": {"type": "integer", "description": "Default 7"},
            "job_id": _JOB_ID,
            "limit": _LIMIT,
        },
        list_followups,
    ),
    Tool("list_offers", "Job offers and their status.", {"limit": _LIMIT}, list_offers),
    Tool(
        "search_everything",
        "Search jobs, companies, recruiters, applications and interviews by a word or name.",
        {"query": {"type": "string"}, "limit": _LIMIT},
        search_everything,
        ["query"],
    ),
    Tool(
        "companies",
        "Companies in the user's list (most jobs first), with job counts and careers links.",
        {
            "query": {"type": "string"},
            "tier": {"type": "string"},
            "has_jobs": {"type": "boolean"},
            "limit": _LIMIT,
        },
        companies,
    ),
    Tool(
        "recruiters",
        "Recruiters / contacts with company, email, phone, LinkedIn.",
        {"query": {"type": "string"}, "limit": _LIMIT},
        recruiters,
    ),
    Tool(
        "my_profile",
        (
            "The user's profile (experience, skills) and what they are looking for (titles, "
            "locations, salary)."
        ),
        {},
        my_profile,
    ),
    Tool(
        "propose_status_change",
        (
            "Propose changing a job's status. The user confirms with a button; nothing changes "
            "until then."
        ),
        {"job_id": _JOB_ID, "status": {"type": "string", "enum": STATUSES}},
        propose_status,
        ["job_id", "status"],
        writes=True,
    ),
    Tool(
        "propose_apply",
        (
            "Propose recording an application for a job (marks it Applied, adds a follow-up) and "
            "give its apply link. The user confirms with a button."
        ),
        {
            "job_id": _JOB_ID,
            "method": {
                "type": "string",
                "enum": [
                    "COMPANY_SITE",
                    "LINKEDIN",
                    "NAUKRI",
                    "REFERRAL",
                    "EMAIL",
                    "RECRUITER",
                    "OTHER",
                ],
            },
            "notes": {"type": "string"},
        },
        propose_apply,
        ["job_id"],
        writes=True,
    ),
    Tool(
        "propose_note",
        "Propose adding a note/comment to a job. The user confirms with a button.",
        {"job_id": _JOB_ID, "text": {"type": "string"}},
        propose_note,
        ["job_id", "text"],
        writes=True,
    ),
    Tool(
        "propose_followup_done",
        "Propose marking a follow-up as done. The user confirms with a button.",
        {"followup_id": {"type": "integer"}},
        propose_followup_done,
        ["followup_id"],
        writes=True,
    ),
]
BY_NAME = {t.name: t for t in TOOLS}


def run_tool(db: Session, name: str, args: dict[str, Any]) -> ToolResult:
    tool = BY_NAME.get(name)
    if tool is None:
        return ToolResult({"error": f"Unknown tool {name}"})
    try:
        return tool.run(db, args or {})
    except AppError as exc:
        return ToolResult({"error": exc.message})
    except (KeyError, TypeError, ValueError) as exc:
        return ToolResult({"error": f"Bad arguments for {name}: {exc}"})
