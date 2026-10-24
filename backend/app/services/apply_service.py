"""Apply assistant: everything an application form asks for, in one place, and recording it.

Nothing is submitted for you. The job page shows the kit with copy buttons; the browser
extension fills an employer's form with it and attaches the CV; you check it and press Submit.
Then the application is recorded (job → Applied, a follow-up planned).

The kit comes from your profile, your target roles, the job's recommended CV, the HR email
draft, and your saved application answers (app settings "apply"). Missing values stay empty;
nothing is invented.
"""

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError
from app.core.urls import detect_source, normalize_url
from app.models.app_settings import AppSettings
from app.models.application import Application
from app.models.cv import CV
from app.models.job import Job, JobSourceLink
from app.services import application_service, email_draft, profile_service
from app.services.activity import record_activity

# Saved once, used on every form. "answers": your own questions and answers. Name fields, contact
# details and city are worked out from your profile when left empty. recruiter_message may use
# {title} and {company} (filled in for the job).
APPLY_FIELDS = ("first_name", "middle_name", "last_name", "date_of_birth", "email", "phone",
                "linkedin",
                "address_line1", "address_line2", "city", "state", "postal_code", "country",
                "current_ctc", "expected_ctc", "salary_negotiable", "notice_period", "relocate",
                "work_authorization", "github", "portfolio", "current_company", "current_title",
                "recruiter_message")
LONG_FIELDS = {"recruiter_message"}
DEFAULTS: dict[str, Any] = {**{k: "" for k in APPLY_FIELDS}, "answers": []}


def _row(db: Session) -> AppSettings:
    row = db.get(AppSettings, 1)
    if row is None:
        row = AppSettings(id=1, data={})
        db.add(row)
        db.flush()
    return row


def get_answers(db: Session) -> dict[str, Any]:
    saved = (_row(db).data or {}).get("apply") or {}
    return {**DEFAULTS, **{k: v for k, v in saved.items() if k in DEFAULTS}}


def save_answers(db: Session, data: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {k: str(data.get(k) or "").strip()[:5000 if k in LONG_FIELDS else 500]
                             for k in APPLY_FIELDS}
    clean["answers"] = [
        {"question": str(a.get("question") or "").strip()[:500],
         "answer": str(a.get("answer") or "").strip()[:5000]}
        for a in (data.get("answers") or [])
        if isinstance(a, dict) and str(a.get("question") or "").strip()
    ][:100]
    row = _row(db)
    row.data = {**(row.data or {}), "apply": clean}
    record_activity(db, "apply.answers_saved", "settings", None, "Application answers saved")
    db.commit()
    return get_answers(db)


def _years(value: Any) -> str:
    return f"{float(value):g}" if value is not None else ""


def _lakhs(value: Any, currency: str | None) -> str:
    if value is None:
        return ""
    amount = float(value)
    if (currency or "INR").upper() == "INR":
        return f"{amount / 1e5:g} LPA"
    return f"{amount:,.0f} {currency}"


def applicant(db: Session) -> dict[str, Any]:
    """Your details as forms ask for them; saved answers win over values worked out."""
    p = profile_service.get_profile(db)
    t = profile_service.get_target(db)
    saved = get_answers(db)
    name = (p.full_name or "").strip()
    words = name.split()
    first = saved["first_name"] or (words[0] if words else "")
    last = saved["last_name"] or (words[-1] if len(words) > 1 else "")
    middle = saved["middle_name"] or (" ".join(words[1:-1]) if not saved["first_name"]
                                      and not saved["last_name"] else "")
    current = next((c for c in (p.companies or []) if c.get("is_current")), None) or next(
        iter(p.companies or []), None)
    location = p.location or ""
    notice = f"{t.notice_period_days} days" if t.notice_period_days is not None else ""
    return {
        "full_name": name or " ".join(w for w in (first, middle, last) if w),
        "first_name": first, "middle_name": middle, "last_name": last,
        "date_of_birth": saved["date_of_birth"],
        "email": saved["email"] or p.email or "", "phone": saved["phone"] or p.phone or "",
        "linkedin": saved["linkedin"] or p.linkedin_url or "",
        "location": location, "city": saved["city"] or location.split(",")[0].strip(),
        "address_line1": saved["address_line1"], "address_line2": saved["address_line2"],
        "state": saved["state"], "postal_code": saved["postal_code"], "country": saved["country"],
        "headline": p.headline or "",
        "total_experience": _years(p.total_experience_years),
        "current_company": saved["current_company"] or (current or {}).get("company") or "",
        "current_title": saved["current_title"] or (current or {}).get("title") or "",
        "current_ctc": saved["current_ctc"],
        "expected_ctc": saved["expected_ctc"] or _lakhs(t.target_salary, t.salary_currency),
        "salary_negotiable": saved["salary_negotiable"],
        "notice_period": saved["notice_period"] or notice,
        "relocate": saved["relocate"], "work_authorization": saved["work_authorization"],
        "github": saved["github"], "portfolio": saved["portfolio"],
    }


LABELS = {
    "full_name": "Full name", "first_name": "First name", "middle_name": "Middle name",
    "last_name": "Last name", "date_of_birth": "Date of birth", "address_line1": "Address",
    "address_line2": "Address line 2",
    "state": "State", "postal_code": "PIN / postal code", "country": "Country",
    "salary_negotiable": "Salary negotiable",
    "email": "Email", "phone": "Phone", "linkedin": "LinkedIn", "location": "Location",
    "city": "City", "headline": "Headline", "total_experience": "Total experience (years)",
    "current_company": "Current company", "current_title": "Current title",
    "current_ctc": "Current CTC", "expected_ctc": "Expected CTC",
    "notice_period": "Notice period", "relocate": "Willing to relocate",
    "work_authorization": "Work authorisation", "github": "GitHub", "portfolio": "Portfolio",
}


def _cv(db: Session, job: Job | None) -> dict[str, Any] | None:
    cv = db.get(CV, job.recommended_cv_id) if job and job.recommended_cv_id else None
    if cv is None:
        cv = db.scalar(select(CV).where(CV.is_active.is_(True), CV.is_archived.is_(False))
                       .order_by(CV.updated_at.desc()))
    if cv is None or cv.current_version_id is None:
        return None
    version = cv.current_version
    return {"id": cv.id, "name": cv.name, "version_id": cv.current_version_id,
            "filename": version.original_filename if version else None,
            "content_type": version.content_type if version else None,
            "download": f"/api/v1/cvs/{cv.id}/versions/{cv.current_version_id}/file"}


def _message(template: str, job: Job | None) -> str:
    """Your own message to the recruiter, with {title} and {company} filled in. Without a job,
    a message that needs them isn't used."""
    if not template:
        return ""
    if job is None:
        return "" if re.search(r"\{(title|company)\}", template) else template
    return template.replace("{title}", job.title).replace("{company}", job.company.name)


def kit(db: Session, job_id: int | None) -> dict[str, Any]:
    """The apply kit for a job (or only your details, without a job)."""
    job = db.get(Job, job_id) if job_id is not None else None
    if job_id is not None and job is None:
        raise NotFoundError(f"Job {job_id} not found")
    you = applicant(db)
    saved_message = get_answers(db)["recruiter_message"]
    out: dict[str, Any] = {
        "job": None, "applicant": you, "labels": LABELS,
        "answers": get_answers(db)["answers"], "cv": _cv(db, job),
        "cover_note": _message(saved_message, None), "email": None,
        "missing": [LABELS[k] for k in ("full_name", "email", "phone", "linkedin",
                                         "current_ctc", "expected_ctc", "notice_period")
                    if not you[k]],
    }
    if job is None:
        return out
    links = [s.original_url for s in job.source_links if s.original_url]
    out["job"] = {"id": job.id, "title": job.title, "company": job.company.name,
                  "status": job.status, "url": job.source_url or next(iter(links), None)}
    draft = email_draft.draft_for_job(db, job.id)
    out["cover_note"] = _message(saved_message, job) or draft.get("short") or ""
    contact = job.recruiter_contact
    to = (contact.email if contact and contact.email else None) or draft.get("to")
    if to:
        subjects = draft.get("subjects") or [f"Application: {job.title}"]
        out["email"] = {"to": to, "subject": subjects[0], "body": draft.get("body") or "",
                        "name": contact.name if contact else None}
    return out


def record(db: Session, job_id: int, method: str, cv_version_id: int | None,
           note: str | None) -> dict[str, Any]:
    """You submitted it: the job becomes Applied with an application and a follow-up date.
    An application already open for the job is returned as it is."""
    job = db.get(Job, job_id)
    if job is None:
        raise NotFoundError(f"Job {job_id} not found")
    existing = db.scalar(select(Application).where(Application.job_id == job_id)
                         .order_by(Application.id.desc()))
    data: dict[str, Any] = {"method": method, "notes": note}
    if cv_version_id:
        data["cv_version_id"] = cv_version_id
    try:
        app = application_service.create_application(db, job_id, data)
        created = True
    except ConflictError:
        if existing is None:
            raise
        app, created = existing, False
    return {"application_id": app.id, "created": created, "status": app.status,
            "applied_on": app.applied_on.isoformat() if app.applied_on else None,
            "follow_up_date": app.follow_up_date.isoformat() if app.follow_up_date else None}


_APPLY_TAIL = re.compile(r"/(apply|application|applications|apply-now)/?$", re.I)


def lookup(db: Session, url: str) -> dict[str, Any] | None:
    """The job in your list that a page belongs to: the posting itself or its application form
    (…/apply), by link or by the board's job ID."""
    tried = {url, _APPLY_TAIL.sub("", url.split("?")[0].split("#")[0])}
    for u in tried:
        normalized = normalize_url(u)
        link = db.scalar(select(JobSourceLink).where(JobSourceLink.normalized_url == normalized))
        job = link.job if link else db.scalar(select(Job).where(Job.source_url == u))
        if job is not None:
            break
    else:
        detected = detect_source(url)
        job = None
        if detected.external_id:
            link = db.scalar(select(JobSourceLink).where(
                JobSourceLink.source == detected.source.value,
                JobSourceLink.external_id == detected.external_id))
            job = link.job if link else None
    if job is None:
        return None
    return {"id": job.id, "title": job.title, "company": job.company.name, "status": job.status}
