"""Draft an email to HR / the recruiter for a job (no AI, no tokens).

The email ties what the job asks for to evidence from the profile: the required skills you
match exactly, your most relevant project or achievement (picked by overlap with the job's
skills), a matching certification, leadership when the role is a lead role, notice period and
location. Nothing is invented; facts the app doesn't have are simply left out.

Two versions are returned: a full email and a short message for LinkedIn / InMail.
"""

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.company import Contact
from app.models.job import Job
from app.models.profile import ProfessionalProfile, TargetProfile
from app.services import job_service, match_service, profile_service

MAX_SKILLS = 4
MAX_EVIDENCE = 230
_LEGAL_SUFFIX = re.compile(
    r"[\s,]+(?:private|pvt\.?)?\s*(?:limited|ltd\.?|inc\.?|llc|llp|gmbh|corp(?:oration)?\.?|"
    r"plc|s\.?a\.?|b\.?v\.?)$", re.IGNORECASE)
_LEAD_WORDS = ("lead", "manager", "head", "architect", "principal", "director")
# Past-tense verbs that start CV highlights without "-ed" ("Led", "Built" ...).
_IRREGULAR = {"led", "built", "drove", "ran", "wrote", "made", "took", "set", "cut", "grew",
              "won", "began", "brought", "kept", "found", "rebuilt", "overhauled", "spearheaded"}


def _years(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return f"{int(value)}+" if value % 1 else str(int(value))


def short_company(name: str) -> str:
    """'Acme Technologies Private Limited' -> 'Acme Technologies'."""
    return _LEGAL_SUFFIX.sub("", name).strip() or name


def email_domain(website: str | None) -> str | None:
    if not website:
        return None
    host = urlsplit(website if "://" in website else f"https://{website}").hostname
    return host.removeprefix("www.") if host else None


def _first_name(name: str | None) -> str | None:
    return name.split()[0] if name and name.split() else None


def _sentence(text: str) -> str:
    """First sentence, shortened at a word boundary if still long, without the final period."""
    first = re.split(r"(?<=[.!?])\s+", text.strip())[0].rstrip(".")
    if len(first) <= MAX_EVIDENCE:
        return first
    return first[:MAX_EVIDENCE].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def _first_person(sentence: str) -> str:
    """'Led the audit…' -> 'I led the audit…' (CV highlights start with a past-tense verb)."""
    word = sentence.split(" ", 1)[0]
    if word.lower().endswith("ed") or word.lower() in _IRREGULAR:
        return f"I {word.lower()}{sentence[len(word):]}"
    return sentence


@dataclass
class Evidence:
    text: str
    project: str | None
    score: int


def _job_terms(job: Job, matched: list[str]) -> list[str]:
    terms = matched + list(job.required_skills or []) + list(job.preferred_skills or [])
    return list(dict.fromkeys(t.lower() for t in terms if t and len(t) > 1))


def _evidence(profile: ProfessionalProfile, terms: list[str]) -> list[Evidence]:
    """Project highlights and achievements, most relevant to the job's skills first."""
    def hits(text: str) -> int:
        low = text.lower()
        return sum(1 for t in terms if t in low)

    found: list[Evidence] = []
    for project in profile.projects or []:
        overlap = len({s.lower() for s in project.get("skills") or []} & set(terms))
        for highlight in project.get("highlights") or []:
            if highlight and highlight.strip():
                found.append(Evidence(_sentence(highlight), project.get("name"),
                                      2 * hits(highlight) + overlap))
    for achievement in profile.achievements or []:
        if achievement and achievement.strip():
            found.append(Evidence(_sentence(achievement), None, 2 * hits(achievement)))
    found.sort(key=lambda e: -e.score)  # stable: CV order breaks ties
    unique: dict[str, Evidence] = {}
    for e in found:
        unique.setdefault(e.text[:80].lower(), e)
    return list(unique.values())


def _matched_skills(match: dict[str, Any] | None) -> tuple[list[str], list[str]]:
    """Required and nice-to-have skills you have exactly, in the job's order."""
    exact = [s for s in (match or {}).get("skills") or [] if s.get("match") == "EXACT_MATCH"]
    required = [s["skill"] for s in exact if s.get("importance") == "REQUIRED"]
    preferred = [s["skill"] for s in exact if s.get("importance") != "REQUIRED"]
    return list(dict.fromkeys(required)), [p for p in dict.fromkeys(preferred) if p not in required]


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} and {items[-1]}"


def _current_role(profile: ProfessionalProfile) -> tuple[str | None, str | None]:
    jobs = profile.companies or []
    current = next((c for c in jobs if c.get("is_current")), jobs[0] if jobs else None)
    if current and current.get("title"):
        return current["title"], current.get("company")
    return (profile.primary_roles[0] if profile.primary_roles else None), None


def _cert_name(cert: str) -> str:
    """'Adobe Certified Expert – Adobe Commerce Developer' -> 'Adobe Certified Expert'."""
    return re.split(r"\s+[–—-]\s+", cert)[0].strip()


def _cert_fits(cert: str, terms: list[str], job_text: str) -> bool:
    """A certification is worth mentioning when its subject is something the job asks for."""
    low = cert.lower()
    if any(t in low for t in terms):
        return True
    subject = re.split(r"\s+[–—-]\s+", cert, maxsplit=1)[-1]  # "Adobe Commerce Developer"
    words = subject.split()
    return len(words) >= 2 and " ".join(words[:2]).lower() in job_text


def _article(word: str) -> str:
    return "an" if word[:1].lower() in "aeiou" else "a"


def _city(location: str | None) -> str | None:
    """'Bengaluru (Bangalore), Karnataka, India' -> 'Bengaluru'."""
    return re.split(r"[,;/(|]", location)[0].strip() or None if location else None


def _location_note(job: Job, target: TargetProfile | None) -> str | None:
    if not target or job.work_model == "REMOTE":
        return None
    city = _city(job.location)
    wanted = [w.lower() for w in target.preferred_locations or []]
    if city and any(city.lower() in w or w in city.lower() for w in wanted):
        return f"{city} works well for me"
    return None


def build_draft(job: Job, profile: ProfessionalProfile, match: dict[str, Any] | None,
                contacts: list[Contact], url: str | None,
                target: TargetProfile | None = None) -> dict[str, Any]:
    company = short_company(job.company.name)
    required, preferred = _matched_skills(match)
    top_skills = (required + preferred)[:MAX_SKILLS]
    nice = [p for p in preferred if p not in top_skills[: len(required)]][:2] if required else []
    shared_domains = [d for d in (job.parsed_jd or {}).get("domains") or []
                      if d in (profile.domains or [])][:2]
    years = _years(profile.total_experience_years)
    role, employer = _current_role(profile)
    terms = _job_terms(job, required + preferred)
    evidence = _evidence(profile, terms)
    focus = (shared_domains or top_skills[:1] or [None])[0]
    job_text = f"{job.title}\n{job.original_jd or ''}".lower()
    certs = [c for c in profile.certifications or [] if _cert_fits(c, terms, job_text)]
    is_lead = any(w in job.title.lower() for w in _LEAD_WORDS)
    # A requisition ID that is just the number in the link adds nothing.
    req_id = job.external_id if job.external_id and job.external_id not in (url or "") else None

    recruiter = job.recruiter_contact
    to_options = [{"name": c.name, "email": c.email, "job_title": c.job_title}
                  for c in ([recruiter] if recruiter else []) + contacts if c and c.email]
    to_options = list({o["email"]: o for o in to_options}.values())
    greeting = f"Hi {_first_name(recruiter.name)}," if recruiter and recruiter.name else (
        "Dear Hiring Team,")

    # 1. Who I am and what I'm applying for.
    # "Senior Developer (Tech Lead responsibilities)" reads better as "… with Tech Lead …".
    base, _, extra = (role or "").partition("(")
    base, extra = base.strip(), extra.rstrip(")").strip()
    who = []
    if profile.full_name:
        who.append(f"I'm {profile.full_name}")
    if base:
        who.append(f"{_article(base)} {base}" + (f" at {employer}" if employer else ""))
    intro = ", ".join(who)
    extras = [extra] if extra and base else []
    if years:
        field = _join(shared_domains) if shared_domains else focus
        extras.append(f"{years} years of experience" + (f" in {field}" if field else ""))
    if extras:
        intro += (" with " if intro else "I have ") + " and ".join(extras)
    city = _city(job.location)
    applying = f"I'd like to apply for the {job.title} role at {company}"
    if city:
        applying += f" in {city}"
    if req_id:
        applying += f", Req. ID {req_id}"
    opening = f"{intro}. {applying}." if intro else f"{applying}."

    # 2. Why it fits: the job's skills plus the strongest piece of evidence.
    fit: list[str] = []
    if required:
        asks = _join(required[:MAX_SKILLS])
        fit.append(f"The role asks for {asks}, which is my day-to-day work.")
    elif top_skills:
        fit.append(f"I work hands-on with {_join(top_skills)}, which this role calls for.")
    if evidence:
        best = evidence[0]
        statement = _first_person(best.text)
        if statement.startswith("I "):
            lead_in = f"Most recently, on {best.project}, " if best.project else "For example, "
            fit.append(f"{lead_in}{statement}.")
        else:
            fit.append(f"{'On ' + best.project if best.project else 'For example'}: {statement}.")

    # 3. What I'd bring: short, evidence-backed points.
    points: list[str] = []
    if certs:
        points.append(certs[0])
    if is_lead and (profile.leadership or profile.leadership_experience_years):
        lead = _join([x.lower() for x in (profile.leadership or [])[:4]])
        years_lead = _years(profile.leadership_experience_years)
        text = f"{years_lead} years leading teams" if years_lead else "Team leadership"
        points.append(f"{text}: {lead}" if lead else text)
    if len(evidence) > 1:
        points.append(evidence[1].text)
    if nice:
        points.append(f"Also experienced with {_join(nice)} from your nice-to-haves")

    # 4. Practical details and the ask.
    notice = target.notice_period_days if target else None
    practical = [x for x in (
        _location_note(job, target),
        f"I can join within {notice} days" if notice else None,
    ) if x]
    closing = (f"{'; '.join(practical)}. " if practical else "") + (
        "My CV is attached. I'd welcome a short call to discuss how I can contribute at "
        f"{company}.")

    lines = [greeting, "", opening]
    if fit:
        lines += ["", " ".join(fit)]
    if points:
        lines += ["", f"What I'd bring to {company}:"] + [f"• {p}" for p in points]
    if url:
        lines += ["", f"Job posting: {url}"]
    lines += ["", closing, "", "Thank you for your time.", "", "Best regards,"]
    title_line = " | ".join(x for x in (role, employer) if x)
    contact = " · ".join(x for x in (profile.phone, profile.email) if x)
    signature = [profile.full_name, title_line, contact, profile.linkedin_url]
    lines += [x for x in signature if x]

    # Short version for LinkedIn / InMail (under ~600 characters).
    short = [greeting.replace("Dear Hiring Team,", "Hello,"), ""]
    pitch = f"{intro}." if intro else ""
    pitch += f" I'm interested in the {job.title} role at {company}"
    pitch += f" in {city}" if city else ""
    pitch += f" — I work hands-on with {_join(top_skills[:3])}." if top_skills else "."
    if certs:
        pitch += f" I'm also {_article(certs[0])} {certs[0]}."
    short += [pitch.strip(), "", "Could we have a quick chat about it? I can share my CV."]
    if url:
        short += ["", url]
    short += ["", "Thanks,", _first_name(profile.full_name) or ""]

    by = f" | {profile.full_name}" if profile.full_name else ""
    soft = {x.lower() for x in profile.leadership or []}
    headline_skill = next((x for x in shared_domains + top_skills
                           if x.lower() not in job.title.lower() and x.lower() not in soft), None)
    tag = " ".join(x for x in (f"{years} yrs" if years else None, headline_skill) if x)
    experience = f" – {tag}" if tag else ""
    subjects = list(dict.fromkeys(filter(None, [
        f"{job.title}{experience}{by}",
        f"Application: {job.title}" + (f" ({req_id})" if req_id else "") + by,
        f"{_cert_name(certs[0])} for your {job.title} role" if certs else None,
        f"Interested in the {job.title} role at {company}",
    ])))
    return {
        "to": to_options[0]["email"] if to_options else None,
        "to_options": to_options,
        "subjects": subjects,
        "body": "\n".join(lines).rstrip(),
        "short": "\n".join(short).rstrip(),
        "company": company,
        "company_domain": email_domain(job.company.website),
        "facts_used": {"skills": top_skills, "domains": shared_domains, "years": years,
                       "evidence": [e.text for e in evidence[:2]], "certification": certs[:1]},
    }


def draft_for_job(db: Session, job_id: int) -> dict[str, Any]:
    job = job_service.get_job(db, job_id)
    match = match_service.current_match(db, job)
    contacts = list(db.scalars(select(Contact).where(
        Contact.company_id == job.company_id, Contact.email.is_not(None)).order_by(Contact.id)))
    links = (s.original_url for s in job.source_links if s.original_url)
    url = job.source_url or next(links, None)
    return build_draft(job, profile_service.get_profile(db), match.result if match else None,
                       contacts, url, profile_service.get_target(db))
