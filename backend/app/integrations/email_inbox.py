"""Read your own mailbox over IMAP, read-only (Settings → Email).

The account (address, app password, server) is saved to `backend/secrets/email-account.json`
(git-ignored, readable only by you), never in the database, so it is not in backups or exports
and the API never returns the password. The mailbox is opened read-only and messages are read
with BODY.PEEK, so nothing is marked as read, moved or deleted.

Gmail: turn on 2-Step Verification, create an app password at
https://myaccount.google.com/apppasswords and use it instead of your normal password.
Yahoo: Account info → Account security → Generate app password (https://login.yahoo.com/account/security),
server imap.mail.yahoo.com.
"""

import email
import imaplib
import json
import os
import re
import ssl
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager, suppress
from dataclasses import asdict, dataclass
from datetime import date, datetime
from email import policy
from email.message import EmailMessage
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path
from typing import Protocol

from app.core.errors import DomainValidationError
from app.core.html_text import html_to_text

ACCOUNT_FILE = Path("secrets/email-account.json")
GMAIL_HOST = "imap.gmail.com"
YAHOO_HOST = "imap.mail.yahoo.com"
# Where each provider's app passwords are made (the normal password is refused over IMAP).
APP_PASSWORD_PAGES = {"gmail": "myaccount.google.com/apppasswords",
                      "yahoo": "login.yahoo.com/account/security"}
TIMEOUT_SECONDS = 30
MAX_MESSAGE_BYTES = 300_000  # only the start of a message is read (text comes before attachments)
_LABEL = r"[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?"
_HOST = re.compile(rf"^{_LABEL}(\.{_LABEL})+$")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


class MailboxError(DomainValidationError):
    pass


@dataclass
class Account:
    user: str
    password: str
    host: str = GMAIL_HOST
    port: int = 993
    folder: str = "INBOX"

    @property
    def is_gmail(self) -> bool:
        return self.host.lower() in (GMAIL_HOST, "imap.googlemail.com")

    @property
    def provider(self) -> str:
        """gmail | yahoo | other: which setup help and links apply."""
        host = self.host.lower()
        if self.is_gmail:
            return "gmail"
        if host == YAHOO_HOST or host.endswith(".mail.yahoo.com"):
            return "yahoo"
        return "other"


def validate_account(user: str, password: str, host: str | None, port: int | None,
                     folder: str | None) -> Account:
    user, password = user.strip(), password.replace(" ", "").strip()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", user):
        raise MailboxError("Enter your full email address")
    if not password:
        raise MailboxError("Enter the app password")
    host = (host or GMAIL_HOST).strip().lower()
    if not _HOST.match(host):
        raise MailboxError("The mail server must be a host name like imap.gmail.com")
    port = port or 993
    if not 1 <= port <= 65535:
        raise MailboxError("The port must be between 1 and 65535")
    folder = (folder or "INBOX").strip() or "INBOX"
    if len(folder) > 100 or '"' in folder or "\\" in folder:
        raise MailboxError("That folder name can't be used")
    return Account(user, password, host, port, folder)


def load_account() -> Account | None:
    try:
        info = json.loads(ACCOUNT_FILE.read_text(encoding="utf-8"))
        return Account(**{k: info[k] for k in ("user", "password", "host", "port", "folder")})
    except (OSError, ValueError, KeyError, TypeError):
        return None


def save_account(account: Account) -> None:
    ACCOUNT_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = ACCOUNT_FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(asdict(account), f)
    os.replace(tmp, ACCOUNT_FILE)


def delete_account() -> None:
    ACCOUNT_FILE.unlink(missing_ok=True)


# --- messages ------------------------------------------------------------------------------


@dataclass
class Header:
    uid: int
    message_id: str
    sender_name: str
    sender_email: str
    subject: str
    received_at: datetime | None


@dataclass
class Mail(Header):
    text: str


def _parse(uid: int, raw: bytes) -> tuple[Header, EmailMessage]:
    msg = email.message_from_bytes(raw, policy=policy.default)
    assert isinstance(msg, EmailMessage)
    name, addr = parseaddr(str(msg.get("From", "")))
    try:
        when = parsedate_to_datetime(str(msg["Date"])) if msg.get("Date") else None
    except (TypeError, ValueError):
        when = None
    mid = str(msg.get("Message-ID", "")).strip()[:500]
    subject = re.sub(r"\s+", " ", str(msg.get("Subject", ""))).strip()
    return Header(uid, mid, name.strip()[:300], addr.strip().lower()[:300], subject[:500],
                  when), msg


def parse_header(uid: int, raw: bytes) -> Header:
    return _parse(uid, raw)[0]


def parse_mail(uid: int, raw: bytes) -> Mail:
    """Headers plus the message text (plain text, or the HTML part turned into text)."""
    header, msg = _parse(uid, raw)
    text = ""
    try:
        part = msg.get_body(preferencelist=("plain", "html"))
        if part is not None:
            content = part.get_content()
            if isinstance(content, str):
                text = html_to_text(content) if part.get_content_subtype() == "html" else content
    except (LookupError, KeyError, ValueError, AssertionError):
        text = ""
    return Mail(**asdict(header), text=re.sub(r"[ \t\r\f\v]+", " ", text).strip())


# --- IMAP ----------------------------------------------------------------------------------


class Mailbox(Protocol):
    uidvalidity: int

    def search_since(self, since: date) -> list[int]: ...
    def search_after(self, uid: int) -> list[int]: ...
    def headers(self, uids: list[int]) -> dict[int, bytes]: ...
    def message(self, uid: int) -> bytes: ...


Connect = Callable[[Account], AbstractContextManager[Mailbox]]


def _imap_date(d: date) -> str:
    return f"{d.day:02d}-{_MONTHS[d.month - 1]}-{d.year}"


class ImapMailbox:
    def __init__(self, conn: imaplib.IMAP4_SSL, uidvalidity: int) -> None:
        self.conn = conn
        self.uidvalidity = uidvalidity

    def _search(self, *criteria: str) -> list[int]:
        typ, data = self.conn.uid("SEARCH", *criteria)
        if typ != "OK" or not data or not data[0]:
            return []
        return [int(x) for x in data[0].split()]

    def search_since(self, since: date) -> list[int]:
        return self._search("SINCE", _imap_date(since))

    def search_after(self, uid: int) -> list[int]:
        # "n:*" always includes the newest message, even when it is older than n.
        return [u for u in self._search("UID", f"{uid + 1}:*") if u > uid]

    def _fetch(self, uids: list[int], what: str) -> dict[int, bytes]:
        out: dict[int, bytes] = {}
        for i in range(0, len(uids), 100):
            chunk = ",".join(str(u) for u in uids[i:i + 100])
            typ, data = self.conn.uid("FETCH", chunk, what)
            if typ != "OK":
                continue
            for item in data:
                if isinstance(item, tuple) and len(item) == 2:
                    m = re.search(rb"UID (\d+)", item[0])
                    if m:
                        out[int(m.group(1))] = bytes(item[1])
        return out

    def headers(self, uids: list[int]) -> dict[int, bytes]:
        return self._fetch(uids, "(UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])")

    def message(self, uid: int) -> bytes:
        return self._fetch([uid], f"(UID BODY.PEEK[]<0.{MAX_MESSAGE_BYTES}>)").get(uid, b"")


@contextmanager
def imap_connect(account: Account) -> Iterator[Mailbox]:
    """Log in over SSL and open the folder read-only. Friendly errors for the usual problems."""
    try:
        conn = imaplib.IMAP4_SSL(account.host, account.port,
                                 ssl_context=ssl.create_default_context(),
                                 timeout=TIMEOUT_SECONDS)
    except (OSError, ssl.SSLError) as exc:
        raise MailboxError(f"Could not reach {account.host}:{account.port} ({exc})") from exc
    try:
        try:
            conn.login(account.user, account.password)
        except imaplib.IMAP4.error as exc:
            page = APP_PASSWORD_PAGES.get(account.provider)
            name = account.provider.capitalize()
            hint = (f" {name} needs an app password ({page}), not your normal password."
                    if page else " Check the address, password and server.")
            raise MailboxError(f"The mail server refused the login.{hint}") from exc
        typ, _ = conn.select(f'"{account.folder}"', readonly=True)
        if typ != "OK":
            raise MailboxError(f"Folder '{account.folder}' was not found")
        _, val = conn.response("UIDVALIDITY")
        uidvalidity = int(val[0]) if val and val[0] else 0
        yield ImapMailbox(conn, uidvalidity)
    except (TimeoutError, imaplib.IMAP4.error, OSError) as exc:
        raise MailboxError(f"Reading the mailbox failed: {exc}") from exc
    finally:
        with suppress(imaplib.IMAP4.error, OSError):
            conn.logout()
