"""Turn contacts written in jobs (notes, comments, description) into Recruiters linked to the job.

`link_job_contacts` runs when a job is added or its notes / description / comments change;
`find_in_all_jobs` does every job at once (Recruiters → *Find contacts in jobs*). Both are
idempotent: an existing contact (same email, phone or LinkedIn) is reused and only its empty
fields are filled — nothing you entered is overwritten.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.jobs.contacts import ROLE_MAILBOX, FoundContact, extract_contacts
from app.models.company import Contact
from app.models.job import Job, JobComment
from app.services.activity import record_activity


@dataclass
class LinkStats:
    created: int = 0
    updated: int = 0
    linked: int = 0

    def add(self, other: "LinkStats") -> None:
        self.created += other.created
        self.updated += other.updated
        self.linked += other.linked


def _texts(job: Job, comments: list[JobComment]) -> list[tuple[str | None, bool, str]]:
    """(text, trusted, where): your notes and comments are trusted; the description isn't."""
    return [
        (job.notes, True, "notes"),
        *((c.body, True, "comment") for c in comments),
        (job.original_jd, False, "description"),
    ]


def _existing(db: Session, c: FoundContact) -> Contact | None:
    for col, value in ((Contact.email, c.email), (Contact.phone, c.phone),
                       (Contact.linkedin_url, c.linkedin_url)):
        if value:
            found = db.scalar(select(Contact).where(col == value).limit(1))
            if found:
                return found
    return None


def _is_placeholder_name(contact: Contact) -> bool:
    return contact.name in {contact.email, contact.phone, contact.linkedin_url, "Recruiter"}


def _save(db: Session, job: Job, c: FoundContact, where: str, stats: LinkStats) -> Contact:
    contact = _existing(db, c)
    if contact is None:
        role_box = c.email is not None and c.email.split("@")[0] in ROLE_MAILBOX
        contact = Contact(
            # Never invent a person: without a name, the address itself is the name.
            name=c.name or c.email or c.phone or c.linkedin_url or "Contact",
            company_id=job.company_id,
            contact_type="HR" if role_box else "RECRUITER",
            email=c.email, phone=c.phone, linkedin_url=c.linkedin_url,
            source=f"Job #{job.id} {where}",
            notes=f"Found in job #{job.id} ({where}): {c.evidence[0]}" if c.evidence else None,
        )
        db.add(contact)
        db.flush()
        record_activity(db, "contact.found", "contact", contact.id, contact.name,
                        {"job_id": job.id, "where": where})
        stats.created += 1
        return contact
    changed = False
    for attr in ("email", "phone", "linkedin_url"):
        if getattr(c, attr) and not getattr(contact, attr):
            setattr(contact, attr, getattr(c, attr))
            changed = True
    if c.name and _is_placeholder_name(contact):
        contact.name = c.name
        changed = True
    if contact.company_id is None:
        contact.company_id = job.company_id
        changed = True
    stats.updated += int(changed)
    return contact


def link_job_contacts(db: Session, job: Job) -> LinkStats:
    """Find contacts in one job and save / link them (no commit)."""
    stats = LinkStats()
    comments = list(db.scalars(select(JobComment).where(JobComment.job_id == job.id)))
    first: Contact | None = None
    seen: set[str] = set()
    for text, trusted, where in _texts(job, comments):
        for c in extract_contacts(text, trusted=trusted):
            if c.key() in seen:
                continue
            seen.add(c.key())
            contact = _save(db, job, c, where, stats)
            first = first or contact
    if first is not None and job.recruiter_contact_id is None:
        job.recruiter_contact_id = first.id
        stats.linked += 1
    return stats


def find_in_all_jobs(db: Session) -> dict[str, Any]:
    """Every job's notes, comments and description → Recruiters. Safe to run again."""
    total = LinkStats()
    jobs = list(db.scalars(select(Job).options(selectinload(Job.company)).order_by(Job.id)))
    with_contacts = 0
    for job in jobs:
        s = link_job_contacts(db, job)
        with_contacts += int(bool(s.created or s.updated or s.linked))
        total.add(s)
    db.commit()
    return {"jobs_checked": len(jobs), "jobs_with_new_contacts": with_contacts,
            "created": total.created, "updated": total.updated, "linked": total.linked}
