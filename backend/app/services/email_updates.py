"""Email updates: read your inbox (read-only) and suggest job status changes (no AI, no tokens).

Every check reads only the headers of new messages. A message's text is downloaded only when its
headers look like your job search: it comes from a recruiter you know, a company you track (its
domain or name), a job-board system (Greenhouse, Lever, Workday…), or its subject talks about an
application or interview. Job alerts and newsletters are skipped.

Each job-search email is classified by plain phrases (rejection, interview invite, assessment,
offer, "thanks for applying", a recruiter writing) and matched to a company and job you track.
The status it implies is only *suggested*: nothing changes until you click Confirm. An email is
kept with the sentence that decided it (`evidence`), never the whole message.
"""

import logging
import re
import threading
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.core.text import LEGAL_SUFFIXES, fold
from app.integrations import email_inbox
from app.integrations.email_inbox import Account, Connect, Header, Mail
from app.models.app_settings import AppSettings
from app.models.application import Application
from app.models.company import Company, Contact
from app.models.email_update import EmailKind, EmailUpdate, EmailUpdateState
from app.models.job import Job, JobStatus
from app.skills.catalog import find_skills

logger = logging.getLogger(__name__)

DEFAULTS: dict[str, Any] = {
    "auto_check": True,  # check by itself while the app runs
    "every_minutes": 30,
    "first_days": 30,  # how far back the first check reads
    "notify": True,  # bell + desktop notification when something new is found
}
STATE_KEY = "email_sync"  # app settings: where the last check stopped (not user settings)
MAX_PER_CHECK = 400  # messages per check; the rest are read by the next one
TICK_SECONDS = 60
REVIEW_URL = "/followups/email"

# --- what an email is about ----------------------------------------------------------------

_REJECTION = (
    "not be moving forward", "not moving forward with your", "won't be moving forward",
    "will not be proceeding", "won't be proceeding", "decided not to proceed",
    "decided to proceed with other", "move forward with other candidates",
    "moving forward with other candidates", "proceed with other candidates",
    "pursue other candidates", "regret to inform", "not been selected", "were not selected",
    "not selected for", "position has been filled", "role has been filled",
    "no longer considering your", "decided to go with another candidate",
    "not be progressing", "not progress your application", "not to progress your application",
    "application was unsuccessful", "application has been unsuccessful",
    "other candidates whose", "not shortlisted", "closed your application",
    "not to move forward", "not move forward with", "will not move forward",
    "not be able to offer you", "unable to offer you", "decided to pursue other",
    "chosen to pursue other", "chosen to move forward with another", "chose another candidate",
    "position is no longer available", "role is no longer available", "not the right fit",
)
_OFFER = (
    "offer letter", "pleased to offer you", "happy to offer you", "extend an offer to you",
    "extend you an offer", "offer of employment", "formal offer", "employment offer",
)
_INTERVIEW = (
    "schedule an interview", "schedule your interview", "interview invitation",
    "invite you to an interview", "invite you for an interview", "invitation to interview",
    "invite you to interview", "like to invite you", "next round", "next step in the process",
    "next steps in our process", "set up a time", "set up a call", "schedule a call",
    "schedule a time", "your availability", "available for a call", "calendly.com/",
    "interview has been scheduled", "interview is scheduled", "interview confirmation",
    "interview is confirmed", "technical interview", "phone screen", "like to speak with you",
    "goodtime.io", "book a time", "pick a time", "select a time", "would like to schedule",
    "love to schedule", "like to arrange", "arrange a call", "arrange an interview",
    "move you forward to", "moving you forward to", "shortlisted for the next",
)
_ASSESSMENT = (
    "coding challenge", "coding test", "coding assessment", "online assessment",
    "technical assessment", "take-home", "take home assignment", "home assignment",
    "technical assignment", "hackerrank.com", "codility.com", "testgorilla", "hackerearth",
    "mettl.com", "codesignal", "online test", "technical test", "complete the assessment",
)
_RECEIVED = (
    "thank you for applying", "thanks for applying", "application received",
    "received your application", "application has been received", "your application was sent",
    "application has been submitted", "application was submitted", "successfully applied",
    "thank you for your application", "thanks for your application",
    "we have received your", "application is complete", "thank you for submitting",
)
# "if we decide to move forward, we'll schedule an interview" is not an invite.
_CONDITIONAL = re.compile(r"\b(if|should|once|in case|whether|may|might)\b")
_REPLY_START = re.compile(r"\n\s*(on .{0,200}wrote:|-{2,}\s*original message|from: )",
                          re.IGNORECASE)

# Job alerts, newsletters and "jobs you may like" are never updates.
_ALERT_SUBJECT = re.compile(
    r"job alert|jobs? for you|recommended jobs|new jobs|jobs you may|jobs matching|"
    r"is hiring|are hiring|apply now|jobs? near|top jobs|similar jobs|newsletter|webinar|"
    r"unsubscribe|digest|people are looking|viewed your profile|who's viewed",
    re.IGNORECASE)
_ALERT_SENDER = re.compile(
    r"^(jobalerts|jobs-listings|jobalert|alerts?|newsletter|news|marketing|digest|"
    r"notifications?-noreply|messages-noreply|invitations)@", re.IGNORECASE)
_JOB_SUBJECT = re.compile(
    r"applica|applying|applied|candida|interview|position|\brole\b|opportunit|\boffer\b|"
    r"assessment|hiring|recruit|your profile|\bjob\b|next steps|career",
    re.IGNORECASE)

# Job-board / applicant-tracking systems that send mail for the employer.
ATS_DOMAINS = (
    "greenhouse.io", "greenhouse-mail.io", "lever.co", "ashbyhq.com", "smartrecruiters.com",
    "myworkday.com", "myworkdayjobs.com", "workday.com", "workablemail.com", "workable.com",
    "recruitee.com", "teamtailor.com", "teamtailor-mail.com", "successfactors.com",
    "successfactors.eu", "sapsf.com", "oraclecloud.com", "taleo.net", "icims.com",
    "jobvite.com", "bamboohr.com", "keka.com", "zohorecruit.com", "zohorecruit.in",
    "pinpointhq.com", "freshteam.com", "darwinbox.in", "darwinbox.com", "hirist.com",
    "instahyre.com", "cutshort.io", "wellfound.com", "linkedin.com", "naukri.com",
    "indeed.com", "foundit.in", "breezy.hr", "jazzhr.com", "recruiterbox.com",
    # Job platforms and test / scheduling tools that also write for many employers.
    "indeedemail.com", "jobgether.com", "uplers.com", "jobright.ai", "hirist.tech", "iimjobs.com",
    "shine.com", "timesjobs.com", "glassdoor.com", "glassdoor.co.in", "monster.com",
    "monsterindia.com", "apna.co", "internshala.com", "turing.com", "toptal.com", "angel.co",
    "hackerrank.com", "hackerearth.com", "codility.com", "testgorilla.com", "mettl.com",
    "imocha.io", "calendly.com",
)
# "Thank you for applying to Acme", "Your application at Acme", "Magento Developer at Acme":
# the employer, even when a job platform sent the email.
_EMPLOYER = [
    re.compile(r"\b(?:applying|applied|application|apply)\s+(?:to|at|with)\s+(?P<n>[^|:!?.,()\[\]]+)",
               re.IGNORECASE),
    re.compile(r"\binterest in (?:joining |working (?:at|with) )?(?P<n>[^|:!?.,()\[\]]+)",
               re.IGNORECASE),
    re.compile(r"\b(?:position|role|opening|opportunity|job)\s+(?:at|with)\s+(?P<n>[^|:!?.,()\[\]]+)",
               re.IGNORECASE),
    re.compile(r"\sat\s+(?P<n>[A-Z][^|:!?.,()\[\]]*)"),
]
FREE_MAIL = ("gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com",
             "hotmail.com", "live.com", "icloud.com", "me.com", "proton.me", "protonmail.com",
             "rediffmail.com", "aol.com", "zoho.com")

# The job status each kind of email points to.
TARGET = {
    EmailKind.OFFER: JobStatus.OFFER, EmailKind.REJECTION: JobStatus.REJECTED,
    EmailKind.INTERVIEW: JobStatus.INTERVIEW, EmailKind.ASSESSMENT: JobStatus.SCREENING,
    EmailKind.RECEIVED: JobStatus.APPLIED, EmailKind.RECRUITER: JobStatus.RECRUITER_CONTACTED,
}
_PIPELINE = [JobStatus.APPLIED, JobStatus.RECRUITER_CONTACTED, JobStatus.SCREENING,
             JobStatus.INTERVIEW, JobStatus.AWAITING_FEEDBACK, JobStatus.OFFER,
             JobStatus.ACCEPTED]
_OVER = {JobStatus.REJECTED, JobStatus.WITHDRAWN, JobStatus.ACCEPTED, JobStatus.DUPLICATE}


def _norm(text: str) -> str:
    """Lower case, accents and punctuation removed, single spaces: for name/title matching."""
    return " " + re.sub(r"[^a-z0-9]+", " ", fold(text).lower()).strip() + " "


def _domain(address: str) -> str:
    return address.rsplit("@", 1)[-1].lower() if "@" in address else ""


def _under(domain: str, parents: tuple[str, ...]) -> bool:
    return any(domain == p or domain.endswith("." + p) for p in parents)


def employer_in_subject(subject: str) -> str:
    """The employer the subject names ("Thank you for applying to Acme Ltd" -> "Acme Ltd")."""
    for pattern in _EMPLOYER:
        if m := pattern.search(subject):
            name = re.split(r"\s+[-–—]\s+|\s+for\s+|\s+-$", m.group("n").strip())[0]
            name = re.sub(r"^(?:the|our|a)\s+", "", name.strip(" '\"-"), flags=re.IGNORECASE)
            if 2 <= len(name) <= 80:
                return name
    return ""


def _mentions(name: str, text: str) -> bool:
    """`name` (normalized, " adobe ") appears in `text` as a company, not as part of a
    technology ("Adobe Commerce", "Salesforce Commerce Cloud")."""
    start = 0
    while (at := text.find(name, start)) >= 0:
        start = at + 1
        word = name.strip()
        after = text[at + 1: at + len(name) + 30]
        if not any(len(s) > len(word) and s.lower().startswith(word) for s in find_skills(after)):
            return True
    return False


def _sentence(text: str, at: int) -> str:
    start = max(text.rfind(c, 0, at) for c in ".!?\n") + 1
    ends = [i for i in (text.find(c, at) for c in ".!?\n") if i != -1]
    end = min(ends) + 1 if ends else len(text)
    return re.sub(r"\s+", " ", text[start:end]).strip()[:300]


def _find(text: str, low: str, phrases: tuple[str, ...]) -> str | None:
    """The first sentence with one of the phrases that isn't conditional ("if we…")."""
    for p in phrases:
        at = low.find(p)
        while at != -1:
            sentence = _sentence(text, at)
            if not _CONDITIONAL.search(sentence.lower()):
                return sentence
            at = low.find(p, at + len(p))
    return None


def classify(subject: str, text: str) -> tuple[EmailKind, str] | None:
    """What the email says about your application, and the sentence that says it."""
    body = _REPLY_START.split("\n" + text, maxsplit=1)[0][:6000]
    full = f"{subject}.\n{body}"
    low = full.lower()
    if len(low) != len(full):  # rare characters whose lower case is longer
        full = low
    if hit := _find(full, low, _REJECTION):
        return EmailKind.REJECTION, hit
    if hit := _find(full, low, _OFFER):
        return EmailKind.OFFER, hit
    if "interview" in subject.lower() and not _CONDITIONAL.search(subject.lower()):
        return EmailKind.INTERVIEW, subject[:300]
    if hit := _find(full, low, _INTERVIEW):
        return EmailKind.INTERVIEW, hit
    if hit := _find(full, low, _ASSESSMENT):
        return EmailKind.ASSESSMENT, hit
    if "unfortunately" in low and re.search(r"applica|candida|position|\brole\b", low):
        return EmailKind.REJECTION, _sentence(full, low.find("unfortunately"))
    if hit := _find(full, low, _RECEIVED):
        return EmailKind.RECEIVED, hit
    return None


def is_needed(status: str, target: JobStatus) -> bool:
    """Whether moving a job from `status` to `target` is news (never backwards)."""
    current = JobStatus(status) if status in JobStatus.__members__ else JobStatus.NEW
    if target == JobStatus.REJECTED:
        return current not in _OVER
    if current in _OVER:
        return False
    rank = _PIPELINE.index(current) if current in _PIPELINE else -1
    return rank < _PIPELINE.index(target)


# --- which company and job ----------------------------------------------------------------


@dataclass
class _Company:
    id: int
    name: str
    names: list[str]  # normalized, " acme corp "
    domains: list[str]


@dataclass
class _Job:
    id: int
    company_id: int
    title: str
    norm_title: str
    status: str
    applied: bool
    changed: datetime | None


@dataclass
class Context:
    """Everything a check needs to match emails, loaded once per check."""

    me: str
    companies: dict[int, _Company] = field(default_factory=dict)
    contacts: dict[str, int] = field(default_factory=dict)  # email -> company id
    jobs: dict[int, list[_Job]] = field(default_factory=dict)  # company id -> jobs
    known: set[str] = field(default_factory=set)  # message ids already stored

    @classmethod
    def load(cls, db: Session, me: str) -> "Context":
        ctx = cls(me=me.lower())
        applied = set(db.scalars(select(Application.job_id).distinct()))
        rows = db.execute(select(Job.id, Job.company_id, Job.title, Job.status,
                                 Job.status_changed_at)
                          .where(Job.status != JobStatus.DUPLICATE.value))
        for jid, cid, title, status, changed in rows:
            ctx.jobs.setdefault(cid, []).append(
                _Job(jid, cid, title, _norm(title), status, jid in applied, changed))
        for c in db.scalars(select(Company).where(Company.id.in_(list(ctx.jobs)))):
            names = []
            for n in [c.name, *(c.aliases or [])]:
                key = _norm(LEGAL_SUFFIXES.sub(" ", fold(n or "").lower()))
                if len(key.strip()) >= 3 and key not in names:
                    names.append(key)
            domains = [d for d in {c.domain, _host(c.website)}
                       if d and not _under(d, FREE_MAIL) and not _under(d, ATS_DOMAINS)]
            ctx.companies[c.id] = _Company(c.id, c.name, names, domains)
        for address, owner in db.execute(select(Contact.email, Contact.company_id)
                                         .where(Contact.email.is_not(None),
                                                Contact.company_id.is_not(None))):
            # A saved contact on a job platform (notification@smartrecruiters.com) writes for
            # many employers, so it never decides the company.
            if address and owner and not _under(_domain(address.strip().lower()), ATS_DOMAINS):
                ctx.contacts[address.strip().lower()] = owner
        ctx.known = set(db.scalars(select(EmailUpdate.message_id)))
        return ctx

    def company_for(self, h: Header, text: str = "") -> tuple[_Company | None, str, bool]:
        """The company an email is from, why, and whether the sender is the company itself
        (a contact you saved or its own domain) rather than just its name in the email."""
        sender = h.sender_email
        if (cid := self.contacts.get(sender)) and cid in self.companies:
            return self.companies[cid], f"from your contact {sender}", True
        domain = _domain(sender)
        if domain and not _under(domain, ATS_DOMAINS) and not _under(domain, FREE_MAIL):
            for c in self.companies.values():
                if any(_under(domain, (d,)) for d in c.domains):
                    return c, f"sent from {domain}", True
        if employer := employer_in_subject(h.subject):
            span = _norm(employer)
            hits = [c for c in self.companies.values()
                    if any(_mentions(n, span) or (len(span.strip()) >= 4 and span in n)
                           for n in c.names)]
            if hits:
                best = self._best(hits)
                return best, f"{best.name} is the employer in the subject", False
            # Job platforms put the employer in the sender name ("Bosch Group via ...").
            sender = _norm(h.sender_name)
            hits = [c for c in self.companies.values()
                    if any(_mentions(n, sender) for n in c.names)]
            if hits:
                best = self._best(hits)
                return best, f"{best.name} is the sender", False
            return None, "", False  # an employer you don't track: never guess from the text
        head = _norm(f"{h.sender_name} {h.subject}")
        hits = [c for c in self.companies.values() if any(_mentions(n, head) for n in c.names)]
        where = "named in the sender or subject"
        if not hits and text:
            body = _norm(text[:3000])
            hits = [c for c in self.companies.values()
                    if any(_mentions(n, body) for n in c.names if len(n.strip()) > 3)]
            where = "named in the email"
        if not hits:
            return None, "", False
        best = self._best(hits)
        return best, f"{best.name} {where}", False

    def _best(self, hits: list[_Company]) -> _Company:
        # The most specific name wins ("Acme Digital" over "Acme"); then one you applied to.
        hits.sort(key=lambda c: (max(len(n) for n in c.names),
                                 any(j.applied for j in self.jobs.get(c.id, []))), reverse=True)
        return hits[0]

    def looks_relevant(self, h: Header) -> bool:
        sender = h.sender_email
        if not sender or sender == self.me:
            return False
        if _ALERT_SUBJECT.search(h.subject) or _ALERT_SENDER.match(sender):
            return False
        if sender in self.contacts or _under(_domain(sender), ATS_DOMAINS):
            return True
        if self.company_for(h)[0] is not None:
            return True
        return bool(_JOB_SUBJECT.search(h.subject))

    def job_for(self, company: _Company, mail: Mail,
                sure: bool = False) -> tuple[_Job | None, list[_Job], str]:
        """The job an email is about. `sure`: the company itself wrote (its own domain or a
        contact), so its only (open) job is a safe link; otherwise only a job named in the email
        or your only application there is linked, and the rest are suggestions to pick from."""
        jobs = self.jobs.get(company.id, [])
        subject, body = _norm(mail.subject), _norm(mail.text[:6000])
        named = [j for j in jobs if len(j.norm_title.strip()) >= 5 and j.norm_title in subject]
        named = named or [j for j in jobs
                          if len(j.norm_title.strip()) >= 5 and j.norm_title in body]
        if len(named) == 1:
            return named[0], [], f"“{named[0].title}” is in the email"
        applied = [j for j in named or jobs if j.applied]
        if len(applied) == 1:
            return applied[0], [], "your only application there"
        live = named or applied or [j for j in jobs if is_needed(j.status, JobStatus.REJECTED)]
        if sure and len(live) == 1:
            return live[0], [], "the only open job there"
        if sure and len(jobs) == 1:
            return jobs[0], [], "the only job there"
        # Not sure which job (or one you never applied to): suggest, you confirm.
        pool = live or jobs
        pool.sort(key=lambda j: (j.applied, j.changed or datetime.min.replace(tzinfo=UTC)),
                  reverse=True)
        return None, pool[:8], "which job? pick one"


def _host(url: str | None) -> str | None:
    m = re.match(r"^(?:https?://)?(?:www\.)?([^/:?#]+)", (url or "").strip().lower())
    return m.group(1) if m else None


def _guess_company(h: Header) -> str:
    employer = employer_in_subject(h.subject)
    if employer and not find_skills(employer):  # "Adobe Commerce SaaS Lead" is a job title
        return employer
    name = re.sub(r"(?i)\b(hiring|talent|recruit\w*|careers?|team|acquisition|hr|jobs|"
                  r"people|no.?reply|notifications?|via|at)\b", " ", h.sender_name)
    name = re.sub(r"\s+", " ", name).strip(" -|,")
    if name:
        return name
    domain = _domain(h.sender_email)
    return "" if _under(domain, ATS_DOMAINS) else domain.split(".")[0]


def analyse(ctx: Context, mail: Mail) -> EmailUpdate | None:
    """The update one email brings, or None when it isn't about your job search."""
    company, why, from_company = ctx.company_for(mail, mail.text)
    found = classify(mail.subject, mail.text)
    if found is None:
        # A person at a company you track wrote to you (not a no-reply system, and not just an
        # email that mentions the company, like an order from a shop of the same name).
        if company is None or not from_company or "reply" in mail.sender_email.split("@")[0]:
            return None
        first = next((s for s in re.split(r"(?<=[.!?\n])\s+", mail.text) if len(s) > 20), "")
        found = (EmailKind.RECRUITER, first.strip()[:300] or mail.subject[:300])
    kind, evidence = found
    if company is None and not (_under(_domain(mail.sender_email), ATS_DOMAINS)
                                or _JOB_SUBJECT.search(mail.subject)):
        return None
    update = EmailUpdate(
        message_id=mail.message_id, received_at=mail.received_at, sender_name=mail.sender_name,
        sender_email=mail.sender_email, subject=mail.subject, evidence=evidence, kind=kind.value,
        candidate_job_ids=[], state=EmailUpdateState.PENDING.value,
    )
    _link(ctx, mail, update, (company, why, from_company))
    return update


def _link(ctx: Context, mail: Mail, update: EmailUpdate,
          found: tuple[_Company | None, str, bool] | None = None) -> None:
    """Set the company, job (or jobs to pick from), reason and suggested status of an update."""
    company, why, from_company = found or ctx.company_for(mail, mail.text)
    target = TARGET[EmailKind(update.kind)]
    update.company_id, update.job_id, update.candidate_job_ids = None, None, []
    update.suggested_status = target.value
    if company is None:
        guess = _guess_company(mail)
        update.match_reason = (f"Not a company you track{f' (looks like {guess})' if guess else ''}"
                               )[:200]
        return
    update.company_id = company.id
    job, candidates, how = ctx.job_for(company, mail, sure=from_company)
    update.match_reason = (f"{why}; {how}" if job else why)[:200]
    if job is None:
        update.candidate_job_ids = [j.id for j in candidates]
        return
    update.job_id = job.id
    if not is_needed(job.status, target):
        update.suggested_status = None
        update.state = EmailUpdateState.DONE.value  # nothing to change: kept as history
        update.resolved_at = datetime.now(UTC)


def rematch_pending(db: Session) -> dict[str, int]:
    """Match the emails still waiting for review again — after the matching improves, or
    after you add the job an email is about. Uses what was kept (sender, subject, the quoted
    sentence); emails you confirmed or dismissed are left as they are."""
    ctx = Context.load(db, "")
    changed = 0
    for update in db.scalars(select(EmailUpdate).where(
            EmailUpdate.state == EmailUpdateState.PENDING.value)):
        before = (update.company_id, update.job_id, list(update.candidate_job_ids or []))
        mail = Mail(uid=0, message_id=update.message_id, sender_name=update.sender_name,
                    sender_email=update.sender_email, subject=update.subject,
                    received_at=update.received_at, text=update.evidence)
        _link(ctx, mail, update)
        if (update.company_id, update.job_id, list(update.candidate_job_ids or [])) != before:
            changed += 1
    db.commit()
    return {"rematched": changed, "pending": pending_count(db)}


# --- settings and state ---------------------------------------------------------------------


def _row(db: Session) -> AppSettings:
    row = db.get(AppSettings, 1)
    if row is None:
        row = AppSettings(id=1, data={})
        db.add(row)
        db.flush()
    return row


def current(db: Session) -> dict[str, Any]:
    return {**DEFAULTS, **((_row(db).data or {}).get("email") or {})}


def validate_settings(cfg: dict[str, Any]) -> dict[str, Any]:
    for key in ("auto_check", "notify"):
        if not isinstance(cfg.get(key), bool):
            raise DomainValidationError(f"email.{key} must be true or false")
    for key, lo, hi in (("every_minutes", 5, 1440), ("first_days", 1, 365)):
        value = cfg.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or not lo <= value <= hi:
            raise DomainValidationError(f"email.{key} must be a whole number from {lo} to {hi}")
    return {k: cfg[k] for k in DEFAULTS}


def _state(db: Session) -> dict[str, Any]:
    return dict((_row(db).data or {}).get(STATE_KEY) or {})


def _save_state(db: Session, state: dict[str, Any]) -> None:
    row = _row(db)
    row.data = {**(row.data or {}), STATE_KEY: state}


_check_lock = threading.Lock()


def is_checking() -> bool:
    return _check_lock.locked()


def status(db: Session) -> dict[str, Any]:
    account = email_inbox.load_account()
    state = _state(db)
    return {
        "connected": account is not None,
        "user": account.user if account else None,
        "host": account.host if account else None,
        "port": account.port if account else None,
        "folder": account.folder if account else None,
        "is_gmail": account.is_gmail if account else None,
        "provider": account.provider if account else None,
        "settings": current(db),
        "last_check": state.get("last_check"),
        "checking": is_checking(),
        "pending": pending_count(db),
    }


def connect_account(db: Session, account: Account,
                    connect: Connect | None = None) -> dict[str, Any]:
    """Log in once to check the details, then save them (never in the database)."""
    with (connect or email_inbox.imap_connect)(account):
        pass
    email_inbox.save_account(account)
    if _state(db).get("user") != account.user:
        _save_state(db, {"user": account.user})  # a different mailbox starts afresh
        db.commit()
    return status(db)


def disconnect_account(db: Session) -> None:
    email_inbox.delete_account()
    _save_state(db, {})
    db.commit()


# --- checking the inbox ---------------------------------------------------------------------


def check(db: Session, connect: Connect | None = None,
          today: date | None = None) -> dict[str, Any]:
    """Read new messages since the last check and store the job-search updates they bring."""
    account = email_inbox.load_account()
    if account is None:
        raise DomainValidationError("Connect your email first (Settings → Email)")
    if not _check_lock.acquire(blocking=False):
        raise ConflictError("The inbox is already being checked")
    started = datetime.now(UTC)
    state = _state(db)
    try:
        result = _check(db, account, state, connect or email_inbox.imap_connect,
                        today or date.today())
    except DomainValidationError as exc:
        db.rollback()
        state = _state(db)
        state["last_check"] = {"at": started.isoformat(), "error": exc.message}
        _save_state(db, state)
        db.commit()
        raise
    finally:
        _check_lock.release()
    return result


def _check(db: Session, account: Account, state: dict[str, Any], connect: Connect,
           today: date) -> dict[str, Any]:
    started = datetime.now(UTC)
    ctx = Context.load(db, account.user)
    new: list[EmailUpdate] = []
    read = 0
    with connect(account) as box:
        same = (state.get("user") == account.user and state.get("uidvalidity") == box.uidvalidity
                and state.get("last_uid"))
        if same:
            uids = box.search_after(int(state["last_uid"]))
        else:
            first_days = int(current(db)["first_days"])
            uids = box.search_since(today - timedelta(days=first_days))
        uids = sorted(uids)
        more = len(uids) > MAX_PER_CHECK
        uids = uids[:MAX_PER_CHECK]
        headers = box.headers(uids)
        for uid in uids:
            raw = headers.get(uid)
            if raw is None:
                continue
            h = email_inbox.parse_header(uid, raw)
            h.message_id = h.message_id or f"<uid-{box.uidvalidity}-{uid}@{account.host}>"
            if h.message_id in ctx.known or not ctx.looks_relevant(h):
                continue
            read += 1
            mail = email_inbox.parse_mail(uid, box.message(uid))
            mail.message_id = h.message_id
            update = analyse(ctx, mail)
            if update is not None:
                db.add(update)
                ctx.known.add(update.message_id)
                new.append(update)
        last_uid = max(uids) if uids else state.get("last_uid") if same else None
        uidvalidity = box.uidvalidity
    found = sum(1 for u in new if u.state == EmailUpdateState.PENDING.value)
    summary = {"at": started.isoformat(), "messages": len(uids), "read": read,
               "found": len(new), "to_review": found, "more": more, "error": None}
    _save_state(db, {"user": account.user, "uidvalidity": uidvalidity, "last_uid": last_uid,
                     "last_check": summary})
    db.commit()
    rematch_pending(db)  # older ones may now match a job you added since
    logger.info("email check", extra={k: v for k, v in summary.items() if k != "at"})
    return {**summary, "pending": pending_count(db)}


def _due(db: Session, now: datetime) -> bool:
    cfg = current(db)
    if not cfg["auto_check"] or email_inbox.load_account() is None:
        return False
    last = (_state(db).get("last_check") or {}).get("at")
    if not last:
        return True
    return now - datetime.fromisoformat(last) >= timedelta(minutes=int(cfg["every_minutes"]))


def scheduled_check(db: Session, now: datetime | None = None,
                    connect: Connect | None = None) -> dict[str, Any] | None:
    """Check the inbox when it's time (Settings → Email), and say so when something is new."""
    if is_checking() or not _due(db, now or datetime.now(UTC)):
        return None
    result = check(db, connect)
    if result["to_review"] and current(db)["notify"]:
        from app.services.reminder_service import notify

        n = result["to_review"]
        latest = db.scalars(select(EmailUpdate.subject)
                            .where(EmailUpdate.state == EmailUpdateState.PENDING.value)
                            .order_by(EmailUpdate.id.desc()).limit(3)).all()
        notify(db, "email", f"{n} new email update{'s' if n != 1 else ''} about your jobs",
               "; ".join(latest)[:300], REVIEW_URL)
    return result


def _loop(stop: threading.Event) -> None:
    from app.db.session import get_sessionmaker

    while not stop.wait(TICK_SECONDS):
        try:
            with get_sessionmaker()() as db:
                scheduled_check(db)
        except (DomainValidationError, ConflictError) as exc:
            logger.warning("email check failed: %s", exc)
        except Exception:
            logger.exception("email check failed")


def start_scheduler() -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=_loop, args=(stop,), name="email-check", daemon=True).start()
    return stop


# --- reviewing updates ----------------------------------------------------------------------


def pending_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(EmailUpdate)
                     .where(EmailUpdate.state == EmailUpdateState.PENDING.value)) or 0


def _get(db: Session, update_id: int) -> EmailUpdate:
    update = db.get(EmailUpdate, update_id)
    if update is None:
        raise NotFoundError("Email update not found")
    return update


def _settle(db: Session) -> None:
    """Pending updates whose job already moved on (you changed it yourself) need nothing."""
    rows = db.execute(select(EmailUpdate, Job.status).join(Job, Job.id == EmailUpdate.job_id)
                      .where(EmailUpdate.state == EmailUpdateState.PENDING.value)).all()
    now = datetime.now(UTC)
    changed = False
    for update, job_status in rows:
        target = update.suggested_status
        if target and not is_needed(job_status, JobStatus(target)):
            update.state, update.resolved_at = EmailUpdateState.DONE.value, now
            changed = True
    if changed:
        db.commit()


def list_updates(db: Session, state: str | None = None, job_id: int | None = None,
                 limit: int = 100) -> list[EmailUpdate]:
    if state == EmailUpdateState.PENDING.value:
        _settle(db)
    stmt = select(EmailUpdate).order_by(EmailUpdate.received_at.desc().nulls_last(),
                                        EmailUpdate.id.desc()).limit(limit)
    if state:
        stmt = stmt.where(EmailUpdate.state == state)
    if job_id is not None:
        stmt = stmt.where(EmailUpdate.job_id == job_id)
    return list(db.scalars(stmt))


def confirm(db: Session, update_id: int, job_id: int | None = None,
            status: str | None = None, change_status: bool = True) -> EmailUpdate:
    """Apply an update: set the job's status (the suggested one unless you chose another) and
    note the email on the job. `change_status=False` only links the email to the job."""
    from app.services.job_service import add_comment, get_job, set_status

    update = _get(db, update_id)
    if update.state != EmailUpdateState.PENDING.value:
        raise ConflictError("This email update was already handled")
    job = get_job(db, job_id or update.job_id or 0) if (job_id or update.job_id) else None
    if job is None:
        raise DomainValidationError("Pick the job this email is about")
    applied = None
    if change_status:
        if status:
            if status not in JobStatus.__members__:
                raise DomainValidationError(f"Unknown status {status}")
            applied = JobStatus(status)
        else:
            target = TARGET[EmailKind(update.kind)]
            applied = target if is_needed(job.status, target) else None
    if applied is not None:
        set_status(db, job.id, applied, note=f"From an email: {update.subject}"[:300],
                   commit=False)
    update.job_id, update.company_id = job.id, job.company_id
    update.applied_status = applied.value if applied else None
    update.state, update.resolved_at = EmailUpdateState.DONE.value, datetime.now(UTC)
    when = update.received_at.date().isoformat() if update.received_at else "?"
    who = update.sender_name or update.sender_email
    add_comment(db, job.id, f"Email from {who} ({when}): {update.subject}\n“{update.evidence}”")
    return update


def confirm_all(db: Session) -> dict[str, int]:
    """Confirm every pending update that knows its job."""
    _settle(db)
    ids = db.scalars(select(EmailUpdate.id).where(
        EmailUpdate.state == EmailUpdateState.PENDING.value, EmailUpdate.job_id.is_not(None))
    ).all()
    for uid in ids:
        confirm(db, uid)
    return {"confirmed": len(ids), "pending": pending_count(db)}


def dismiss(db: Session, update_id: int) -> EmailUpdate:
    update = _get(db, update_id)
    if update.state == EmailUpdateState.PENDING.value:
        update.state, update.resolved_at = EmailUpdateState.DISMISSED.value, datetime.now(UTC)
        db.commit()
    return update


def describe(db: Session, updates: list[EmailUpdate],
             gmail: bool | None = None) -> list[dict[str, Any]]:
    """Updates for the API, with the job (and the jobs it might be) in a few fields."""
    ids = {u.job_id for u in updates if u.job_id} | {
        j for u in updates for j in (u.candidate_job_ids or [])}
    jobs = {j.id: j for j in db.scalars(select(Job).where(Job.id.in_(ids)))} if ids else {}
    names = dict(db.execute(select(Company.id, Company.name).where(Company.id.in_(
        {u.company_id for u in updates if u.company_id} | {j.company_id for j in jobs.values()}
    ))).all())
    if gmail is None:
        account = email_inbox.load_account()
        gmail = bool(account and account.is_gmail)

    def job(jid: int | None) -> dict[str, Any] | None:
        j = jobs.get(jid) if jid else None
        return None if j is None else {"id": j.id, "title": j.title, "status": j.status,
                                       "company": names.get(j.company_id)}

    out = []
    for u in updates:
        link = None
        if gmail and u.message_id.startswith("<") and not u.message_id.startswith("<uid-"):
            link = ("https://mail.google.com/mail/u/0/#search/rfc822msgid:"
                    + re.sub(r"[<>\s]", "", u.message_id))
        out.append({
            "id": u.id, "kind": u.kind, "state": u.state, "subject": u.subject,
            "sender_name": u.sender_name, "sender_email": u.sender_email,
            "received_at": u.received_at.isoformat() if u.received_at else None,
            "evidence": u.evidence, "match_reason": u.match_reason,
            "company_id": u.company_id, "company": names.get(u.company_id or 0),
            "job": job(u.job_id),
            "candidates": [c for c in (job(j) for j in (u.candidate_job_ids or [])) if c],
            "suggested_status": u.suggested_status, "applied_status": u.applied_status,
            "resolved_at": u.resolved_at.isoformat() if u.resolved_at else None,
            "open_url": link,
        })
    return out

