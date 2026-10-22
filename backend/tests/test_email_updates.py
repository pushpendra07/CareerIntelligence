"""Email updates: reading the inbox (a fake one, never the network) and suggesting statuses."""

import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date
from email.message import EmailMessage
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.errors import DomainValidationError
from app.integrations import email_inbox
from app.integrations.email_inbox import Account, Mailbox
from app.models.email_update import EmailKind
from app.models.job import Job, JobStatus
from app.services import email_updates
from app.services.email_updates import classify, is_needed

ME = "me@example.com"


def mail(uid: int, sender: str, subject: str, body: str, html: bool = False) -> bytes:
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = sender, ME, subject
    m["Date"] = "Wed, 21 Oct 2026 10:00:00 +0530"
    m["Message-ID"] = f"<m{uid}@mail.example>"
    if html:
        m.set_content("<html><body><p>" + body + "</p></body></html>", subtype="html")
    else:
        m.set_content(body)
    return m.as_bytes()


class FakeMailbox:
    def __init__(self, messages: dict[int, bytes], uidvalidity: int = 7) -> None:
        self.messages = messages
        self.uidvalidity = uidvalidity
        self.bodies_read: list[int] = []
        self.searched_since: date | None = None

    def search_since(self, since: date) -> list[int]:
        self.searched_since = since
        return list(self.messages)

    def search_after(self, uid: int) -> list[int]:
        return [u for u in self.messages if u > uid]

    def headers(self, uids: list[int]) -> dict[int, bytes]:
        return {u: self.messages[u].split(b"\n\n", 1)[0] + b"\n\n" for u in uids}

    def message(self, uid: int) -> bytes:
        self.bodies_read.append(uid)
        return self.messages[uid]


def connector(box: FakeMailbox) -> Any:
    @contextmanager
    def connect(_: Account) -> Iterator[Mailbox]:
        yield box
    return connect


def add_job(client: TestClient, title: str, company: str, website: str | None = None) -> int:
    r = client.post("/api/v1/jobs", json={"title": title, "company": company, "location": "Pune",
                                          "jd": "Build PHP and Magento APIs. " * 5})
    assert r.status_code == 201, r.text
    job = r.json()["job"]
    if website:
        client.patch(f"/api/v1/companies/{job['company']['id']}",
                     json={"website": website})
    return int(job["id"])


@pytest.fixture
def account() -> Account:
    acc = Account(ME, "abcd efgh")
    email_inbox.save_account(acc)
    return acc


# --- classifying -------------------------------------------------------------------------


@pytest.mark.parametrize(("subject", "body", "kind"), [
    ("Your application to Acme", "Unfortunately, we have decided to move forward with other "
     "candidates for the Senior PHP Developer role.", EmailKind.REJECTION),
    ("Update", "After careful review we regret to inform you that we will not be moving forward.",
     EmailKind.REJECTION),
    ("Interview invitation – PHP Developer", "Hi, please share your availability.",
     EmailKind.INTERVIEW),
    ("Next steps", "We'd like to invite you to interview. Pick a slot at calendly.com/acme/30.",
     EmailKind.INTERVIEW),
    ("Acme – coding assessment", "Please complete the assessment on HackerRank.com within 3 days.",
     EmailKind.ASSESSMENT),
    ("Re: PHP Lead", "Thank you for your time. We have decided not to move forward with your "
     "application at this stage.", EmailKind.REJECTION),
    ("Acme", "Sadly we will not be able to offer you a position.", EmailKind.REJECTION),
    ("Quick chat?", "We would like to schedule a 30 minute call with our CTO.",
     EmailKind.INTERVIEW),
    ("Offer", "We are pleased to offer you the role of Lead Engineer.", EmailKind.OFFER),
    ("Thank you for applying!", "We have received your application for Magento Developer. "
     "If your profile is a match, we will reach out to schedule an interview.",
     EmailKind.RECEIVED),
])
def test_classify(subject: str, body: str, kind: EmailKind) -> None:
    found = classify(subject, body)
    assert found is not None and found[0] == kind
    assert found[1]  # the sentence that decided it


def test_classify_ignores_conditional_and_quoted_text() -> None:
    # "if… we'll schedule an interview" is not an invite; nothing else here is news either.
    assert classify("Hello", "If selected, we will schedule an interview with you.") is None
    # A reply quoting an older rejection is not a rejection.
    body = "Thanks, see you Monday!\n\nOn Tue, Acme wrote:\n> we regret to inform you"
    assert classify("Re: chat", body) is None
    # A rejection that also says thanks for applying is a rejection.
    found = classify("Thank you for applying", "Thank you for applying. Unfortunately your "
                     "application was unsuccessful.")
    assert found and found[0] == EmailKind.REJECTION


def test_status_only_moves_forward() -> None:
    assert is_needed("NEW", JobStatus.APPLIED)
    assert is_needed("APPLIED", JobStatus.INTERVIEW)
    assert not is_needed("INTERVIEW", JobStatus.APPLIED)  # never backwards
    assert not is_needed("INTERVIEW", JobStatus.SCREENING)
    assert is_needed("INTERVIEW", JobStatus.REJECTED)
    assert not is_needed("REJECTED", JobStatus.REJECTED)
    assert not is_needed("REJECTED", JobStatus.INTERVIEW)


# --- checking the inbox ------------------------------------------------------------------


def test_check_finds_updates_and_skips_the_rest(client: TestClient, db: Session,
                                                account: Account) -> None:
    acme = add_job(client, "Senior PHP Developer", "Acme Corp", "https://acme.com")
    client.post(f"/api/v1/jobs/{acme}/status", json={"status": "APPLIED"})
    globex = add_job(client, "Magento Developer", "Globex")
    add_job(client, "Laravel Developer", "Globex")
    box = FakeMailbox({
        1: mail(1, "Acme Talent <talent@acme.com>", "Your application",
                "Hi, unfortunately we are moving forward with other candidates for this role."),
        2: mail(2, "Globex Hiring <no-reply@greenhouse-mail.io>",
                "Interview invitation: Magento Developer at Globex",
                "We'd like to invite you to interview. Please share your availability.",
                html=True),
        3: mail(3, "Mum <mum@example.org>", "Dinner on Sunday?", "Come home early."),
        4: mail(4, "LinkedIn <jobalerts-noreply@linkedin.com>", "30 new jobs for you",
                "Unfortunately… apply now"),
        5: mail(5, ME, "Re: Interview", "Sent by me."),
        6: mail(6, "Hiring <jobs@initech.io>", "Thank you for applying to Initech",
                "We have received your application for Backend Engineer."),
        # Mentions a tracked company, but isn't from it and says nothing about a job.
        8: mail(8, "Globex Store <orders@globexshop.example>", "Your Globex order has shipped",
                "Your parcel is on its way and should arrive on Friday."),
    })
    result = email_updates.check(db, connector(box), today=date(2026, 10, 22))
    assert result["messages"] == 7 and result["found"] == 3 and result["to_review"] == 3
    assert box.searched_since == date(2026, 9, 22)  # first check: the last 30 days
    assert 3 not in box.bodies_read and 4 not in box.bodies_read and 5 not in box.bodies_read

    items = {u["subject"]: u for u in client.get("/api/v1/email/updates",
                                                 params={"state": "PENDING"}).json()}
    rejected = items["Your application"]
    assert rejected["kind"] == "REJECTION" and rejected["job"]["id"] == acme
    assert rejected["suggested_status"] == "REJECTED" and "acme.com" in rejected["match_reason"]
    invite = items["Interview invitation: Magento Developer at Globex"]
    assert invite["kind"] == "INTERVIEW" and invite["job"]["id"] == globex  # title in subject
    assert invite["open_url"].endswith("#search/rfc822msgid:m2@mail.example")  # open in Gmail
    unknown = items["Thank you for applying to Initech"]
    assert unknown["job"] is None and unknown["company"] is None
    assert "Not a company you track" in unknown["match_reason"]

    # Nothing changed yet: the user confirms.
    assert db.get(Job, acme).status == "APPLIED"  # type: ignore[union-attr]
    r = client.post(f"/api/v1/email/updates/{rejected['id']}/confirm", json={})
    assert r.status_code == 200 and r.json()["state"] == "DONE"
    assert r.json()["applied_status"] == "REJECTED"
    assert client.get(f"/api/v1/jobs/{acme}").json()["status"] == "REJECTED"
    comments = client.get(f"/api/v1/jobs/{acme}").json()["comments"]
    assert "moving forward with other candidates" in comments[0]["body"]
    assert client.post(f"/api/v1/email/updates/{rejected['id']}/confirm",
                       json={}).status_code == 409

    # The next check reads only newer messages, and never stores the same email twice.
    box.messages[9] = mail(9, "Acme Talent <talent@acme.com>", "Hello again",
                           "Would you be available for a call this week?")
    again = email_updates.check(db, connector(box))
    assert again["messages"] == 1 and again["found"] == 1
    # The job was rejected, so an invite after that is kept as history, not a suggestion.
    assert again["to_review"] == 0
    assert client.get("/api/v1/dashboard").json()["summary"]["email_updates"] == 2


def test_ambiguous_job_and_linking(client: TestClient, db: Session, account: Account) -> None:
    a = add_job(client, "PHP Developer", "Umbrella")
    b = add_job(client, "Frontend Engineer", "Umbrella")
    client.post(f"/api/v1/jobs/{a}/status", json={"status": "APPLIED"})
    client.post(f"/api/v1/jobs/{b}/status", json={"status": "APPLIED"})
    box = FakeMailbox({1: mail(1, "Umbrella Careers <careers@lever.co>", "Umbrella – next steps",
                               "Please complete the coding challenge by Friday.")})
    email_updates.check(db, connector(box))
    item = client.get("/api/v1/email/updates", params={"state": "PENDING"}).json()[0]
    assert item["job"] is None and {c["id"] for c in item["candidates"]} == {a, b}
    assert client.post(f"/api/v1/email/updates/{item['id']}/confirm",
                       json={}).status_code == 422  # which job?
    done = client.post(f"/api/v1/email/updates/{item['id']}/confirm", json={"job_id": b}).json()
    assert done["job"]["id"] == b and done["applied_status"] == "SCREENING"
    assert client.get(f"/api/v1/jobs/{a}").json()["status"] == "APPLIED"


def test_updates_settle_when_the_job_moved_on(client: TestClient, db: Session,
                                              account: Account) -> None:
    job = add_job(client, "Magento Architect", "Hooli", "https://hooli.com")
    client.post(f"/api/v1/jobs/{job}/status", json={"status": "APPLIED"})
    box = FakeMailbox({1: mail(1, "Hooli <hr@hooli.com>", "Schedule your interview",
                               "Let's set up a call.")})
    email_updates.check(db, connector(box))
    assert email_updates.pending_count(db) == 1
    client.post(f"/api/v1/jobs/{job}/status", json={"status": "INTERVIEW"})  # done by hand
    assert client.get("/api/v1/email/updates", params={"state": "PENDING"}).json() == []
    history = client.get("/api/v1/email/updates", params={"job_id": job}).json()
    assert history[0]["state"] == "DONE"


def test_dismiss_and_confirm_all(client: TestClient, db: Session, account: Account) -> None:
    j1 = add_job(client, "PHP Lead", "Stark Industries", "https://stark.com")
    j2 = add_job(client, "Laravel Developer", "Wayne Enterprises", "https://wayne.com")
    box = FakeMailbox({
        1: mail(1, "Stark <hr@stark.com>", "Thanks for applying", "We have received your CV."),
        2: mail(2, "Wayne <hr@wayne.com>", "Thank you for your application", "Received."),
        3: mail(3, "Talent <jobs@ashbyhq.com>", "Your application status",
                "Unfortunately, we won't be moving forward with your application."),
    })
    email_updates.check(db, connector(box))
    pending = client.get("/api/v1/email/updates", params={"state": "PENDING"}).json()
    unmatched = next(u for u in pending if u["job"] is None)
    assert client.post(f"/api/v1/email/updates/{unmatched['id']}/dismiss").json()["state"] \
        == "DISMISSED"
    assert client.post("/api/v1/email/updates/confirm-all").json() == {"confirmed": 2,
                                                                       "pending": 0}
    assert client.get(f"/api/v1/jobs/{j1}").json()["status"] == "APPLIED"
    assert client.get(f"/api/v1/jobs/{j2}").json()["status"] == "APPLIED"


# --- account and settings ----------------------------------------------------------------


def test_account_is_saved_privately_and_never_returned(client: TestClient,
                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    assert client.get("/api/v1/email/account").json()["connected"] is False
    assert client.post("/api/v1/email/check").status_code == 422  # not connected

    seen: list[Account] = []

    @contextmanager
    def ok(acc: Account) -> Iterator[Mailbox]:
        seen.append(acc)
        yield FakeMailbox({})

    monkeypatch.setattr(email_inbox, "imap_connect", ok)
    r = client.put("/api/v1/email/account", json={"user": ME, "password": "abcd efgh ijkl mnop"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["connected"] and body["user"] == ME and body["is_gmail"]
    assert "password" not in str(body) and "abcd" not in str(body)
    assert seen[0].password == "abcdefghijklmnop"  # noqa: S105 - spaces Google shows removed
    assert oct(os.stat(email_inbox.ACCOUNT_FILE).st_mode & 0o777) == "0o600"

    assert client.put("/api/v1/email/account",
                      json={"user": "not-an-email", "password": "x"}).status_code == 422
    assert client.put("/api/v1/email/account", json={"user": ME, "password": "x",
                                                     "host": "bad host"}).status_code == 422

    def refused(acc: Account) -> Any:
        raise email_inbox.MailboxError("The mail server refused the login.")

    monkeypatch.setattr(email_inbox, "imap_connect", refused)
    r = client.put("/api/v1/email/account", json={"user": "other@example.com", "password": "x"})
    assert r.status_code == 422 and "refused" in r.json()["error"]["message"]
    assert client.get("/api/v1/email/account").json()["user"] == ME  # kept the working one

    yahoo = Account("me@yahoo.com", "x", email_inbox.YAHOO_HOST)
    assert yahoo.provider == "yahoo" and not yahoo.is_gmail
    assert Account(ME, "x", "imap.fastmail.com").provider == "other"

    assert client.delete("/api/v1/email/account").status_code == 204
    assert not email_inbox.ACCOUNT_FILE.exists()


def test_settings_and_schedule(client: TestClient, db: Session, account: Account) -> None:
    saved = client.patch("/api/v1/settings/app", json={"email": {"every_minutes": 15}}).json()
    assert saved["email"]["every_minutes"] == 15 and saved["email"]["auto_check"] is True
    for bad in ({"every_minutes": 1}, {"auto_check": "yes"}, {"first_days": 0}):
        assert client.patch("/api/v1/settings/app", json={"email": bad}).status_code == 422

    job = add_job(client, "PHP Developer", "Cyberdyne", "https://cyberdyne.com")
    client.post(f"/api/v1/jobs/{job}/status", json={"status": "APPLIED"})
    box = FakeMailbox({1: mail(1, "Cyberdyne <hr@cyberdyne.com>", "Offer letter",
                               "We are pleased to offer you the position.")})
    result = email_updates.scheduled_check(db, connect=connector(box))
    assert result and result["to_review"] == 1
    events = client.get("/api/v1/reminder-events").json()
    assert events[0]["url"] == "/followups/email" and "Offer letter" in events[0]["body"]
    assert email_updates.scheduled_check(db, connect=connector(box)) is None  # not due yet


def test_failed_check_is_recorded(db: Session, account: Account) -> None:
    @contextmanager
    def broken(_: Account) -> Iterator[Mailbox]:
        raise email_inbox.MailboxError("Could not reach imap.gmail.com:993")
        yield  # pragma: no cover

    with pytest.raises(DomainValidationError):
        email_updates.check(db, broken)
    last = email_updates.status(db)["last_check"]
    assert last["error"] == "Could not reach imap.gmail.com:993"
