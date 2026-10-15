"""Draft an email to HR / the recruiter for a job (no AI, no tokens).

Built only from facts the app already has: the job (title, company, link, requisition ID), the
current match (required skills you have, shared domains) and your profile (experience, headline,
an achievement, signature). Nothing is invented; missing facts are simply left out.
"""

import re
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.company import Contact
from app.models.job import Job
from app.models.profile import ProfessionalProfile
from app.services import job_service, match_service, profile_service

MAX_SKILLS = 5


def _years(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return f"{int(value)}+" if value % 1 else str(int(value))


def _matched_skills(match: dict[str, Any] | None) -> list[str]:
    """Skills the job asks for that you have exactly: required first, in the job's order."""
    exact = [s for s in (match or {}).get("skills") or [] if s.get("match") == "EXACT_MATCH"]
    exact.sort(key=lambda s: s.get("importance") != "REQUIRED")  # stable: keeps the job's order
    return list(dict.fromkeys(s["skill"] for s in exact))[:MAX_SKILLS]


def email_domain(website: str | None) -> str | None:
    host = (urlsplit(website if website and "://" in website else f"https://{website}").hostname
            if website else None)
    return host.removeprefix("www.") if host else None


_LEGAL_SUFFIX = re.compile(
    r"[\s,]+(?:private|pvt\.?)?\s*(?:limited|ltd\.?|inc\.?|llc|llp|gmbh|corp(?:oration)?\.?|"
    r"plc|s\.?a\.?|b\.?v\.?)$", re.IGNORECASE)
MAX_ACHIEVEMENT = 220


def short_company(name: str) -> str:
    """'Acme Technologies Private Limited' -> 'Acme Technologies'."""
    short = _LEGAL_SUFFIX.sub("", name).strip()
    return short or name


def _first_sentence(text: str) -> str:
    """The achievement's first sentence, shortened at a word boundary if still long."""
    first = re.split(r"(?<=[.!?])\s+", text.strip())[0].rstrip(".")
    if len(first) <= MAX_ACHIEVEMENT:
        return first
    return first[:MAX_ACHIEVEMENT].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def _first_name(name: str | None) -> str | None:
    return name.split()[0] if name and name.split() else None


def build_draft(job: Job, profile: ProfessionalProfile, match: dict[str, Any] | None,
                contacts: list[Contact], url: str | None) -> dict[str, Any]:
    company = short_company(job.company.name)
    skills = _matched_skills(match)
    shared_domains = [d for d in (job.parsed_jd or {}).get("domains") or []
                      if d in (profile.domains or [])][:2]
    years = _years(profile.total_experience_years)
    role = profile.primary_roles[0] if profile.primary_roles else None

    recruiter = job.recruiter_contact
    to_options = [{"name": c.name, "email": c.email, "job_title": c.job_title}
                  for c in ([recruiter] if recruiter else []) + contacts if c and c.email]
    to_options = list({o["email"]: o for o in to_options}.values())
    greeting_name = _first_name(recruiter.name) if recruiter else None

    intro = f"I'm writing about the {job.title} role at {company}"
    if job.location:
        intro += f" ({job.location})"
    intro += " and would like to be considered."
    article = "an" if role and role[0].lower() in "aeiou" else "a"
    about = (f"I'm {article} {role}" + (f" with {years} years of experience" if years else "")
             if role else f"I have {years} years of experience" if years else "")
    if about and shared_domains:
        about += f" in {' and '.join(shared_domains)}"
    points: list[str] = []
    if skills:
        points.append(f"Hands-on with what the role asks for: {', '.join(skills)}")
    if profile.leadership_experience_years:
        points.append(f"{_years(profile.leadership_experience_years)} years leading teams")
    if profile.achievements:
        points.append(_first_sentence(profile.achievements[0]))

    lines = [f"Hi {greeting_name}," if greeting_name else "Hello Hiring Team,", "", intro]
    if about:
        lines += ["", f"{about}."]
    if points:
        lines += ["", "Why I'm a good fit:"] + [f"- {p}" for p in points]
    # A requisition ID that is just the number in the link adds nothing.
    req_id = job.external_id if job.external_id and job.external_id not in (url or "") else None
    ref = " / ".join(filter(None, [req_id and f"Req. ID {req_id}", url]))
    if ref:
        lines += ["", f"Job: {ref}"]
    lines += ["", "My CV is attached. I'd welcome a short call to discuss how I can help "
              f"{company}.", "", "Best regards,"]
    signature = (profile.full_name, profile.phone, profile.email, profile.linkedin_url)
    lines += [x for x in signature if x]

    by = f" – {profile.full_name}" if profile.full_name else ""
    top = skills[0] if skills else ""
    experience = (f" – {years} yrs" if years else "") + (f", {top}" if top else "")
    subjects = list(dict.fromkeys(filter(None, [
        f"Application for {job.title}{by}",
        f"{job.title} at {company}{experience}",
        f"{job.title} ({req_id}){by}" if req_id else None,
        f"Interested in the {job.title} role at {company}",
    ])))
    return {
        "to": to_options[0]["email"] if to_options else None,
        "to_options": to_options,
        "subjects": subjects,
        "body": "\n".join(lines),
        "company": company,
        "company_domain": email_domain(job.company.website),
        "facts_used": {"skills": skills, "domains": shared_domains, "years": years},
    }


def draft_for_job(db: Session, job_id: int) -> dict[str, Any]:
    job = job_service.get_job(db, job_id)
    match = match_service.current_match(db, job)
    contacts = list(db.scalars(select(Contact).where(
        Contact.company_id == job.company_id, Contact.email.is_not(None)).order_by(Contact.id)))
    links = (s.original_url for s in job.source_links if s.original_url)
    url = job.source_url or next(links, None)
    return build_draft(job, profile_service.get_profile(db), match.result if match else None,
                       contacts, url)
