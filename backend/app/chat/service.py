"""The chat assistant: AI with tools when an AI provider is set up, else built-in commands.

Either way it only *reads* through tools; changes come back as actions the user confirms in the
chat (the UI then calls the normal API), so nothing is changed by the model on its own.
"""

import json
import logging
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.ai.providers import AIUnavailableError, get_provider
from app.chat import commands, llm
from app.chat.tools import TAB_STATUSES, TOOLS, ToolResult, run_tool
from app.core.config import Settings
from app.core.errors import DomainValidationError

logger = logging.getLogger(__name__)
MAX_HISTORY = 16
DEFAULT_SETTINGS: dict[str, Any] = {
    "enabled": True,  # show the Assistant (chat button, ⌘J) and answer /chat
    "use_ai": True,  # use the AI provider when one is set up; off = built-in commands only
}


def validate_settings(cfg: dict[str, Any]) -> dict[str, Any]:
    return {k: bool(cfg.get(k, v)) for k, v in DEFAULT_SETTINGS.items()}


def assistant_settings(db: Session) -> dict[str, Any]:
    from app.models.app_settings import AppSettings

    row = db.get(AppSettings, 1)
    return {**DEFAULT_SETTINGS, **((row.data if row else {}).get("assistant") or {})}


def provider_for(db: Session, settings: Settings) -> tuple[Any, str | None]:
    """The AI provider the Assistant uses, or (None, why not)."""
    if not assistant_settings(db)["use_ai"]:
        return None, "AI is turned off for the Assistant (Settings → About & AI)"
    try:
        return get_provider(settings), None
    except AIUnavailableError as exc:
        return None, str(exc)
MAX_TOOL_JSON = 14_000

SYSTEM = """You are the assistant inside Career Intelligence, the user's personal job-search app.
Today is {today}. Answer from the user's own data using the tools — jobs, scores, statuses,
applications, interviews, follow-ups, offers, companies, recruiters and their profile. Never invent
jobs, companies, numbers or links; if a tool returns nothing, say so.

Changes (status, applying, notes, finishing a follow-up) are only proposed with the propose_* tools:
the user confirms each one with a button under your answer. Say "confirm below" — never claim a
change is done. "Apply" means recording the application here and giving the apply link; you can't
submit applications on other websites.

Style: short and direct, Markdown, lists for several items. Link jobs as [#ID Title](/jobs/ID).
Mention scores as "score 82". Use Indian formats (LPA) for INR salaries."""


def _clean_history(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    out = [
        {
            "role": "assistant" if m.get("role") == "assistant" else "user",
            "content": str(m.get("content") or "")[:4000],
        }
        for m in messages
        if str(m.get("content") or "").strip()
    ][-MAX_HISTORY:]
    while out and out[0]["role"] != "user":  # providers want the user to speak first
        out.pop(0)
    return out


def _summary(name: str, r: ToolResult) -> str:
    """One line about a tool result, for answers without AI."""
    d = r.data if isinstance(r.data, dict) else {}
    if "error" in d:
        return f"⚠️ {d['error']}"
    if r.action:
        return f"Ready: **{r.action['label']}** — confirm below."
    if name == "search_jobs":
        n = d.get("total", 0)
        return (
            f"Found **{n}** job{'s' if n != 1 else ''}"
            + (f", showing the top {len(d['jobs'])}." if n > len(d.get("jobs", [])) else ".")
            if n
            else "No jobs match that."
        )
    if name == "get_job":
        parts = [
            f"**[#{d['id']} {d['title']}](/jobs/{d['id']})** at {d.get('company')}",
            f"status {str(d.get('status')).replace('_', ' ').title()}",
            f"score {d.get('match_score')}" if d.get("match_score") is not None else None,
            d.get("location"),
        ]
        line = " · ".join(p for p in parts if p)
        if d.get("skills_missing"):
            line += f"\nMissing skills: {', '.join(d['skills_missing'][:8])}."
        if d.get("recent_activity"):
            line += f"\nLatest: {d['recent_activity'][0]}."
        return line
    if name == "pipeline_summary":
        counts, s = d.get("job_status_counts") or {}, d.get("summary") or {}
        tabs = [(label, sum(counts.get(x, 0) for x in TAB_STATUSES[key]))
                for key, label in (("new", "new"), ("pending", "to review / apply"),
                                   ("applied", "applied"), ("interview", "interviewing"),
                                   ("selected", "offers"), ("rejected", "rejected"),
                                   ("not-pursuing", "not pursuing"), ("closed", "closed"))]
        lines = [f"**{sum(counts.values())}** jobs: "
                 + ", ".join(f"{n} {label}" for label, n in tabs if n) + "."]
        todo = [(s.get("new_70_plus"), "new jobs scoring 70+"),
                (s.get("ready_to_apply"), "ready to apply"),
                (s.get("upcoming_interviews"), "upcoming interviews"),
                (s.get("responses"), "employer responses so far")]
        lines += [f"- **{n}** {label}" for n, label in todo if n]
        return "\n".join(lines)
    if name == "search_everything":
        found = {k: len(v) for k, v in d.items() if v}
        return (
            "Found " + ", ".join(f"{n} {k}" for k, n in found.items()) + "."
            if found
            else "Nothing found."
        )
    if name == "my_profile":
        t = d.get("target") or {}
        return (
            f"You're looking for: {', '.join((t.get('effective_titles') or [])[:6])} · "
            f"in {', '.join((t.get('preferred_locations') or [])[:6])}."
        )
    total = d.get("total")
    label = name.replace("list_", "").replace("_", "-")
    if total == 1:
        label = {"companies": "company", "followups": "follow-up"}.get(label, label.rstrip("s"))
    return f"**{total}** {label}." if total else f"No {label} found."


def _search_rows(r: ToolResult) -> dict[str, Any] | None:
    """Global search results as a card (only used without AI)."""
    d = r.data if isinstance(r.data, dict) else {}
    items = [
        {
            "label": f"{x.get('title') or x.get('name')}",
            "detail": k[:-1] if k.endswith("s") else k,
            "href": f"/jobs/{x['id']}" if k == "jobs" else None,
        }
        for k, v in d.items()
        for x in v
    ]
    return (
        {"type": "list", "title": "Search", "total": len(items), "items": items} if items else None
    )


def chat(db: Session, settings: Settings, messages: list[dict[str, Any]]) -> dict[str, Any]:
    if not assistant_settings(db)["enabled"]:
        raise DomainValidationError("The Assistant is turned off (Settings → About & AI)")
    history = _clean_history(messages)
    if not history:
        return {"reply": commands.HELP, "cards": [], "actions": [], "mode": "commands"}
    cards: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []

    def collect(name: str, r: ToolResult) -> None:
        if r.card:
            cards.append(r.card)
        if r.action:
            actions.append({**r.action, "id": f"a{len(actions) + 1}"})

    provider, note = provider_for(db, settings)
    if provider is not None:

        def execute(name: str, args: dict[str, Any]) -> str:
            r = run_tool(db, name, args)
            collect(name, r)
            return json.dumps(r.data, default=str)[:MAX_TOOL_JSON]

        try:
            reply = llm.run_chat(
                provider,
                SYSTEM.format(today=date.today().isoformat()),
                history,
                [(t.name, t.description, t.schema()) for t in TOOLS],
                execute,
            )
            return {
                "reply": reply.strip() or "Done.",
                "cards": cards[-3:],
                "actions": actions,
                "mode": "ai",
                "provider": provider.name,
            }
        except AIUnavailableError as exc:
            logger.warning("chat AI failed; using commands", extra={"error": str(exc)})
            note = f"AI unavailable ({exc}) — answered with built-in commands."
            cards.clear()
            actions.clear()

    calls, text = commands.parse(history[-1]["content"])
    lines: list[str] = []
    for name, args in calls:
        r = run_tool(db, name, args)
        if name == "search_jobs" and not (r.data or {}).get("total") and args.get("query"):
            r2 = run_tool(db, "search_everything", {"query": args["query"]})  # not a job? try all
            if any((r2.data or {}).values()):
                name, r = "search_everything", r2
                r.card = _search_rows(r2)
        collect(name, r)
        lines.append(_summary(name, r))
    reply = text or "\n\n".join(lines) or commands.HELP
    return {
        "reply": reply,
        "cards": cards,
        "actions": actions,
        "mode": "commands",
        # Only worth showing when AI was meant to answer but failed.
        "note": note if note and "not configured" not in note and "turned off" not in note
        else None,
    }
