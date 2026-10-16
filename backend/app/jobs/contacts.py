"""Find recruiter / HR contacts (email, phone, LinkedIn, name) in job notes and descriptions.

Pure and deterministic. Conservative on purpose — a wrong "recruiter" is worse than none:

- Emails in **notes** count (you or your sheet put them there); emails in a **job description**
  count only after an application cue ("send your resume to", "contact", "HR"…).
- Mailboxes that are never a recruiter (accommodations@, privacy@, noreply@…) are skipped.
- A number is a phone only after a phone cue (phone, call, WhatsApp, mobile…) or with a +91 /
  +<country> prefix, so requisition IDs like "#4012345678" are not phones.
- Names come only from the text ("Contact: Riya Sharma") or a person-like email
  ("asha.verma@" → "Asha Verma"); role mailboxes (hr@, careers@) get no name.
"""

import re
from dataclasses import dataclass, field

EMAIL_RE = re.compile(
    r"[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
LINKEDIN_RE = re.compile(r"(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_%-]+/?", re.I)
# +country code and 8–13 digits, or a 10-digit Indian mobile; spaces / dashes / dots allowed.
PHONE_RE = re.compile(
    r"(?<![\w#/=.-])(\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){1,4}\d{2,5}(?![\w/])"
)
PHONE_CUE = re.compile(
    r"\b(phone|ph|tel|telephone|call|calling|mobile|mob|cell|whats\s?app|wa|contact(?:\s+no)?"
    r"|reach)\b[^\n]{0,25}$", re.I)
APPLY_CUE = re.compile(
    r"\b(resume|cv|profile|send|share|mail|email|e-mail|apply|applications?|contact|reach|"
    r"recruit\w*|hr|hiring|talent|interested|spoc|write)\b", re.I)
NAME_CUE = re.compile(
    r"\b(?:contact(?:\s+person)?|recruiter|hr(?:\s+(?:name|contact|manager|spoc))?|spoc|"
    r"hiring\s+manager|talent\s+acquisition|poc|name)\s*[:\-–]\s*"
    r"(?P<name>[A-Z][a-z]+(?:\.?\s+[A-Z][a-z.]+){0,3})", re.I)

NOT_RECRUITER = {
    "accommodation", "accommodations", "accessibility", "privacy", "dataprotection", "dpo", "gdpr",
    "noreply", "no-reply", "donotreply", "do-not-reply", "unsubscribe", "abuse", "legal",
    "security", "webmaster", "postmaster", "support", "help", "feedback", "press", "media",
    "invoice", "billing", "sales", "marketing", "compliance", "ethics", "whistleblower",
}
ROLE_MAILBOX = {
    "hr", "hrd", "careers", "career", "jobs", "job", "talent", "recruitment", "recruiting",
    "recruiter", "recruiters", "hiring", "resume", "resumes", "cv", "info", "contact", "admin",
    "people", "ta", "apply", "joinus", "join", "work", "team", "office", "hello", "mail",
    "placement", "placements", "staffing", "hrteam", "hr.team", "talentacquisition",
}
# Lines in a job description about these are never a recruiter's number.
NOT_RECRUITER_LINE = re.compile(
    r"accommodation|disabilit|toll[- ]?free|fraud|scam|grievance|ethics|hotline|helpline|"
    r"whistle|equal (employment )?opportunit|privacy", re.I)
EXAMPLE_DOMAINS = ("example.com", "example.org", "email.com", "domain.com", "yourcompany.com")


@dataclass
class FoundContact:
    email: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None
    name: str | None = None
    evidence: list[str] = field(default_factory=list)  # the lines they were found in

    def key(self) -> str:
        return self.email or self.phone or self.linkedin_url or ""


def normalize_phone(raw: str) -> str | None:
    """'+91 98765-43210' / '9876543210' → '+91 98765 43210'; other countries kept as +digits.
    None when it isn't a plausible phone number."""
    plus = raw.strip().startswith("+")
    digits = re.sub(r"\D", "", raw)
    if plus:
        if digits.startswith("91") and len(digits) == 12 and digits[2] in "6789":
            return f"+91 {digits[2:7]} {digits[7:]}"
        return f"+{digits}" if 9 <= len(digits) <= 15 else None
    if len(digits) == 12 and digits.startswith("91") and digits[2] in "6789":
        return f"+91 {digits[2:7]} {digits[7:]}"
    if len(digits) == 11 and digits.startswith("0") and digits[1] in "6789":
        digits = digits[1:]
    if len(digits) == 10 and digits[0] in "6789":
        return f"+91 {digits[:5]} {digits[5:]}"
    if 10 <= len(digits) <= 11 and digits.startswith("0"):  # landline with STD code
        return digits
    return None


def name_from_email(email: str) -> str | None:
    """'asha.verma@x' → 'Asha Verma'; role mailboxes and handles → None."""
    local = email.split("@")[0].lower()
    if local in ROLE_MAILBOX or any(local.startswith(f"{r}.") or local.startswith(f"{r}_")
                                    for r in ("hr", "careers", "jobs", "talent", "recruit")):
        return None
    parts = [p for p in re.split(r"[._-]+", local) if p]
    if not 2 <= len(parts) <= 3 or not all(p.isalpha() and len(p) >= 2 for p in parts):
        return None
    return " ".join(p.capitalize() for p in parts)


def _skip_email(email: str) -> bool:
    local, _, domain = email.lower().partition("@")
    base = re.sub(r"[^a-z-]", "", local)
    return (
        base in NOT_RECRUITER
        or any(base.startswith(x) for x in ("noreply", "no-reply", "donotreply", "accommodation"))
        or domain in EXAMPLE_DOMAINS
        or domain.split(".")[-1] in {"png", "jpg", "jpeg", "gif", "svg", "webp"}
    )


def extract_contacts(text: str | None, *, trusted: bool) -> list[FoundContact]:
    """Contacts in `text`. `trusted` = your own notes / sheet columns (every email counts);
    otherwise (a job description) an email needs an application cue just before it."""
    if not text:
        return []
    found: dict[str, FoundContact] = {}
    order: list[str] = []
    # Work line by line (" | " splits "Email: a@b | Phone: 98…" into one contact's parts).
    for line in text.splitlines():
        if not line.strip():
            continue
        line_contacts: list[FoundContact] = []
        emails = []
        for m in EMAIL_RE.finditer(line):
            email = m.group(0).strip(".").lower()
            if _skip_email(email):
                continue
            before = line[max(0, m.start() - 90):m.start()]
            if not trusted and not APPLY_CUE.search(before):
                continue
            emails.append(email)
        phones = []
        masked = EMAIL_RE.sub(" ", LINKEDIN_RE.sub(" ", line))
        skip_phones = not trusted and NOT_RECRUITER_LINE.search(line)
        for m in ([] if skip_phones else PHONE_RE.finditer(masked)):
            raw = m.group(0)
            # "1 (800) 555-0100" / "+1 …": a North American number, never an Indian mobile.
            if "(" in raw and not raw.strip().startswith("+") or re.search(
                    r"(?:^|\s)\+?1[\s.-]*$", masked[max(0, m.start() - 4):m.start()]):
                continue
            cue = PHONE_CUE.search(masked[max(0, m.start() - 40):m.start()])
            if not (cue or raw.strip().startswith("+")):
                continue
            if phone := normalize_phone(raw):
                phones.append(phone)
        links = [m.group(0).split("?")[0].rstrip("/") for m in LINKEDIN_RE.finditer(line)]
        links = [ln if ln.startswith("http") else f"https://{ln}" for ln in links]
        name_m = NAME_CUE.search(line)
        name = name_m.group("name").strip() if name_m else None
        if name and name.lower().split()[0] in {"email", "phone", "mail", "number", "no", "the"}:
            name = None
        # One person per line: pair the first email / phone / link; extras become their own.
        n = max(len(emails), len(phones), len(links), 0)
        for i in range(n):
            line_contacts.append(FoundContact(
                email=emails[i] if i < len(emails) else None,
                phone=phones[i] if i < len(phones) else None,
                linkedin_url=links[i] if i < len(links) else None,
                name=name if i == 0 else None,
                evidence=[line.strip()[:300]],
            ))
        for c in line_contacts:
            if not c.name and c.email:
                c.name = name_from_email(c.email)
            k = c.key()
            if k in found:
                prev = found[k]
                prev.phone = prev.phone or c.phone
                prev.linkedin_url = prev.linkedin_url or c.linkedin_url
                prev.name = prev.name or c.name
                continue
            # A phone already seen with an email on another line: same person.
            same = next((found[o] for o in order if c.phone and found[o].phone == c.phone), None)
            if same:
                same.email = same.email or c.email
                continue
            found[k] = c
            order.append(k)
    return [found[k] for k in order]
