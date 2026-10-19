"""The chat without AI: understands common questions and commands with simple rules.

"new jobs 80+", "remote magento jobs in pune", "#512", "status of Accenture", "apply 512",
"mark 512 not relevant", "note 512 called HR", "interviews", "follow-ups", "offers",
"summary", "recruiters at Acme", "my profile". Returns tool calls; the service runs them.
"""

import re
from typing import Any

HELP = """I can look things up and make changes for you (you confirm each change). Try:
- **new jobs 80+** · **remote magento jobs in pune** · **best laravel jobs this week**
- **#512** — everything about a job · **status of Accenture** — jobs and applications there
- **apply 512** · **mark 512 not relevant** · **note 512 called the recruiter**
- **interviews** · **follow-ups** · **offers** · **applications last 30 days**
- **summary** · **companies hiring magento** · **recruiters at Acme** · **my profile**

Add an AI key (Claude, Gemini, OpenAI or OmniRoute) to ask anything in your own words."""

STATUS_WORDS = {
    "not relevant": "NOT_RELEVANT",
    "irrelevant": "NOT_RELEVANT",
    "ready to apply": "READY_TO_APPLY",
    "on hold": "ON_HOLD",
    "recruiter contacted": "RECRUITER_CONTACTED",
    "awaiting feedback": "AWAITING_FEEDBACK",
    "applied": "APPLIED",
    "closed": "CLOSED",
    "rejected": "REJECTED",
    "interview": "INTERVIEW",
    "offer": "OFFER",
    "accepted": "ACCEPTED",
    "shortlisted": "SHORTLISTED",
    "shortlist": "SHORTLISTED",
    "reviewing": "REVIEWING",
    "withdrawn": "WITHDRAWN",
    "withdraw": "WITHDRAWN",
    "screening": "SCREENING",
    "new": "NEW",
}
TABS = {
    "new": "new",
    "pending": "pending",
    "applied": "applied",
    "interview": "interview",
    "interviews": "interview",
    "rejected": "rejected",
    "closed": "closed",
    "selected": "selected",
    "not relevant": "not-pursuing",
}
STOP = {
    "show", "me", "find", "list", "get", "all", "my", "the", "a", "an", "any", "for", "with",
    "of", "on", "at", "to", "in", "please", "jobs", "job", "roles", "role", "openings", "opening",
    "positions", "position", "search", "which", "what", "are", "is", "there", "do", "i", "have",
    "some", "can", "you", "give",
}
Call = tuple[str, dict[str, Any]]


def _id(text: str) -> int | None:
    m = re.search(r"#?\b(\d{1,7})\b", text)
    return int(m.group(1)) if m else None


def parse(message: str) -> tuple[list[Call], str | None]:
    """Tool calls for a message, or (no calls, help text)."""
    t = " ".join(message.strip().split())
    low = t.lower()
    if not low or low in ("help", "?", "hi", "hello", "hey") or "what can you do" in low:
        return [], HELP

    if m := re.match(r"^(?:apply|applied)\s+(?:to|for)?\s*(?:job\s*)?#?(\d+)\b", low):
        return [("propose_apply", {"job_id": int(m.group(1))})], None
    if m := re.match(
        r"^(?:mark|set|move|change)\s+(?:job\s*)?#?(\d+)\s+(?:as|to|status)?\s*(.+)$", low
    ):
        word = m.group(2).strip(" .")
        status = next((v for k, v in STATUS_WORDS.items() if word.startswith(k)), None)
        if status:
            return [("propose_status_change", {"job_id": int(m.group(1)), "status": status})], None
        return [], f"I don't know the status “{word}”. Try: {', '.join(sorted(set(STATUS_WORDS)))}."
    if m := re.match(
        r"^(?:add\s+)?(?:note|comment)\s+(?:to\s+|on\s+)?(?:job\s*)?#?(\d+)[:\s-]+(.+)$", t, re.I
    ):
        return [("propose_note", {"job_id": int(m.group(1)), "text": m.group(2)})], None
    if m := re.match(r"^(?:done|complete)\s+follow-?up\s+#?(\d+)$", low):
        return [("propose_followup_done", {"followup_id": int(m.group(1))})], None
    if re.fullmatch(r"(?:job\s*|show\s+|open\s+)?#\d+|job\s+\d+|\d+", low):
        return [("get_job", {"job_id": _id(low)})], None

    if re.search(
        r"\b(summary|overview|dashboard|stats|statistics|pipeline|how am i doing|progress)\b", low
    ):
        return [("pipeline_summary", {})], None
    if "interview" in low and not re.search(r"\bjobs?\b", low):
        return [
            ("list_interviews", {"upcoming": not re.search(r"\b(past|previous|done|last)\b", low)})
        ], None
    if re.search(r"follow[- ]?ups?|reminders?|due\b", low):
        return [("list_followups", {"due_within_days": 30 if "month" in low else 7})], None
    if re.search(r"\boffers?\b", low) and "jobs" not in low:
        return [("list_offers", {})], None
    if re.search(r"\b(my )?profile\b|\bmy skills\b|\btarget roles?\b|what am i looking", low):
        return [("my_profile", {})], None
    if m := re.search(r"(?:status of|what happened (?:with|to)|update on|news from)\s+(.+)$", low):
        q = m.group(1).strip(" ?.")
        return [
            ("search_jobs", {"query": q, "status": [], "closed": None, "limit": 10}),
            ("list_applications", {"query": q}),
        ], None
    if re.search(r"\b(recruiters?|contacts?|hr)\b", low):
        q = re.sub(r"\b(recruiters?|contacts?|hr|at|from|in|show|list|my|all)\b", " ", low).strip()
        return [("recruiters", {"query": q or None})], None
    if re.search(r"\bapplications?\b|where (?:did|have) i appl|applied (?:to|at|for)", low):
        days = re.search(r"(?:last|past)\s+(\d+)\s+days?", low)
        q = re.sub(
            r"\b(applications?|where|did|have|i|applied|apply|to|at|for|my|show|list|last|past|\d+|days?)\b",
            " ",
            low,
        ).strip()
        return [
            (
                "list_applications",
                {
                    "query": q or None,
                    "applied_within_days": int(days.group(1)) if days else None,
                    "limit": 15,
                },
            )
        ], None
    if re.search(r"\bcompan(y|ies)\b", low):
        q = re.sub(r"\b(compan(y|ies)|hiring|show|list|all|which|with|jobs?)\b", " ", low).strip()
        return [
            ("companies", {"query": q or None, "has_jobs": True if "hiring" in low else None})
        ], None
    return [("search_jobs", job_filters(low))], None


def job_filters(low: str) -> dict[str, Any]:
    """Filters from a free sentence about jobs."""
    args: dict[str, Any] = {"limit": 10}
    if m := re.search(r"(\d{2})\s*\+|(?:above|over|score|min(?:imum)?)\s*(\d{2})", low):
        args["min_score"] = int(m.group(1) or m.group(2))
        low = low.replace(m.group(0), " ")
    for w in ("remote", "hybrid", "onsite"):
        if re.search(rf"\b{w}\b|on-site" if w == "onsite" else rf"\b{w}\b", low):
            args["work_model"] = w.upper()
            low = re.sub(rf"\b{w}\b|on-site", " ", low)
    if m := re.search(
        r"\bin\s+([a-z][a-z .-]+?)(?=$|\s+(?:with|above|over|posted|this|last|from)\b)", low
    ):
        args["location"] = m.group(1).strip()
        low = low.replace(m.group(0), " ")
    if m := re.search(r"(?:last|past)\s+(\d+)\s+days?", low):
        args["posted_within_days"] = int(m.group(1))
        low = low.replace(m.group(0), " ")
    elif re.search(r"\bthis week\b|\brecent\b", low):
        args["posted_within_days"] = 7
        low = re.sub(r"\bthis week\b|\brecent\b", " ", low)
    elif re.search(r"\btoday\b", low):
        args["posted_within_days"] = 1
        low = low.replace("today", " ")
    if re.search(r"\b(newest|latest|new added|just added)\b", low):
        args["sort"] = "newest"
    statuses = [v for k, v in TABS.items() if re.search(rf"\b{k}\b", low)]
    for k in TABS:
        low = re.sub(rf"\b{k}\b", " ", low)
    if statuses:
        args["status"] = statuses
    low = re.sub(
        r"\b(best|top|good|great|newest|latest|matching|matches|relevant|added|just)\b", " ", low
    )
    words = [w for w in re.findall(r"[a-z0-9+#.]+", low) if w not in STOP]
    if words:
        args["query"] = " ".join(words)
    return args
