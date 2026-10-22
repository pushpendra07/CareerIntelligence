"""Reports: one report per area of the search, for a date range, with charts and a detail table.

Every report returns the same shape so the UI can draw any of them:

    {"report", "title", "description", "from", "to", "group", "periods",
     "kpis":   [{"key", "label", "value", "previous", "unit", "better"}],
     "findings": [{"tone": good | bad | info, "text", "link"?}],
     "charts": [{"id", "title", "kind", "series": [{"key", "label"}], "data": [{"label", ...}],
                 "note"}],
     "table":  {"title", "columns": [{"key", "label", "kind"}], "rows": [...]}}

`kind` of a chart: line | bar | stacked | donut | hbar. `previous` is the same measure for the
period of equal length just before `from`, so the UI can show the change. All counting is in
SQL; tables are capped at TABLE_LIMIT rows.
"""

import re
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal

from sqlalchemy import Date, String, cast, func, literal, or_, select, text
from sqlalchemy.orm import Session, aliased

from app.core.errors import DomainValidationError, NotFoundError
from app.jobs.jd_parser import CITY_ALIASES, INDIAN_CITIES, normalize_employment_type
from app.models.application import Application, ApplicationEvent, FollowUp
from app.models.company import Company
from app.models.interview import Interview
from app.models.job import Job, JobSourceLink
from app.models.offer import Offer
from app.models.scan import ScanRun

Group = Literal["day", "week", "month"]
TABLE_LIMIT = 2000  # rows sent per table (chart clicks filter these in the browser)
TOP = 8  # categories shown before "Other"
MIN_SAMPLE = 5  # cases needed before a rate or median is compared with the previous period
BY1 = (text("1"),)  # GROUP BY the first (and second) selected column
BY2 = (text("1"), text("2"))

RESPONDED = ["RECRUITER_CONTACTED", "SCREENING", "INTERVIEW", "AWAITING_FEEDBACK", "OFFER",
             "ACCEPTED", "REJECTED"]
INTERVIEWED = ["INTERVIEW", "AWAITING_FEEDBACK", "OFFER", "ACCEPTED"]

REPORTS: dict[str, tuple[str, str]] = {
    "overview": ("Overview", "Everything at a glance: jobs found, applications, answers, "
                 "interviews and offers over time."),
    "pipeline": ("Pipeline health", "Conversion from application to offer, how long employers "
                 "take, applications going quiet, and cohorts by when you applied."),
    "jobs": ("Jobs found", "Jobs added in the period: where they came from, how well they "
             "fit, where and how you'd work."),
    "applications": ("Applications", "What you applied to, how employers answered and how "
                     "fast."),
    "interviews": ("Interviews", "Interview rounds: how many, what kind, and how they went."),
    "offers": ("Offers", "Offers received, their pay and what you decided."),
    "companies": ("Companies", "Per company: jobs, applications, interviews and offers."),
    "market": ("Market & pay", "What the market asks for: pay shown, experience, seniority, "
               "remote share and who is hiring."),
    "sources": ("Job sources", "Which sources bring jobs that fit and lead to interviews."),
    "followups": ("Follow-ups", "Follow-ups planned, done on time, late or still open."),
    "skills": ("Skills", "Skills most asked for in the period's jobs, and how often you "
               "have them."),
    "activity": ("Your activity", "What you did: jobs reviewed, shortlisted, applied and "
                 "dismissed, and the backlog waiting for you."),
    "scans": ("Scans & imports", "Job scans and imports: runs, results and failures."),
}
# Reports grouped for the menu: summary, the pipeline, the market, how the search runs.
SECTIONS = {"overview": "Summary", "pipeline": "Pipeline", "applications": "Pipeline",
            "interviews": "Pipeline", "offers": "Pipeline", "followups": "Pipeline",
            "jobs": "Market", "market": "Market", "skills": "Market", "companies": "Market",
            "sources": "Operations", "activity": "Operations", "scans": "Operations"}


# When a job was found: the date your Google Sheet says it was added (jobs imported from a
# sheet arrive in the app in one go, days or weeks later), else the day it entered the app.
_src = aliased(JobSourceLink)
SHEET_DATE = (
    select(func.min(cast(_src.raw["import"]["added_to_sheet"].astext, Date)))
    .where(_src.job_id == Job.id).correlate(Job).scalar_subquery()
)
FOUND = cast(func.least(SHEET_DATE, cast(Job.created_at, Date)), Date)


# ---------------------------------------------------------------- periods


def default_group(start: date, end: date) -> Group:
    days = (end - start).days + 1
    return "day" if days <= 31 else "week" if days <= 200 else "month"


def _bucket_start(d: date, group: Group) -> date:
    if group == "week":
        return d - timedelta(days=d.weekday())
    if group == "month":
        return d.replace(day=1)
    return d


def _next(d: date, group: Group) -> date:
    if group == "day":
        return d + timedelta(days=1)
    if group == "week":
        return d + timedelta(days=7)
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def periods(start: date, end: date, group: Group) -> list[date]:
    out, d = [], _bucket_start(start, group)
    while d <= end:
        out.append(d)
        d = _next(d, group)
    return out


def period_label(d: date, group: Group) -> str:
    if group == "month":
        return d.strftime("%b %Y")
    return d.strftime("%d %b")


class Range:
    """The chosen dates, the previous period of the same length, and helpers to filter by them."""

    def __init__(self, start: date, end: date, group: Group):
        self.start, self.end, self.group = start, end, group
        length = (end - start).days + 1
        self.prev_start, self.prev_end = start - timedelta(days=length), start - timedelta(days=1)
        self.buckets = periods(start, end, group)

    @staticmethod
    def _ts(d: date) -> datetime:
        return datetime.combine(d, time.min).astimezone(UTC)

    def within(self, col: Any, previous: bool = False) -> Any:
        """`col` between the dates (a datetime column compares with whole days)."""
        lo, hi = (self.prev_start, self.prev_end) if previous else (self.start, self.end)
        if isinstance(col.type, Date):
            return col.between(lo, hi)
        return (col >= self._ts(lo)) & (col < self._ts(hi + timedelta(days=1)))

    def bucket_of(self, when: date | datetime) -> date:
        """The start date of the period a Python date or datetime falls in."""
        return _bucket_start(when.date() if isinstance(when, datetime) else when, self.group)

    def bucket(self, col: Any) -> Any:
        """SQL expression: the start date of the period `col` falls in."""
        return cast(func.date_trunc(self.group, col), Date)

    def series(self, rows: Any, keys: list[str] | None = None) -> list[dict[str, Any]]:
        """[(bucket, key, n)] or [(bucket, n)] → one dict per period with every key filled."""
        data: dict[date, dict[str, Any]] = {
            b: {"label": period_label(b, self.group), "period": b.isoformat()}
            for b in self.buckets}
        for row in rows:
            b = row[0] if isinstance(row[0], date) else row[0].date()
            b = _bucket_start(b, self.group)
            if b not in data:
                continue
            key, n = (row[1], row[2]) if len(row) == 3 else ("value", row[1])
            key = str(key) if key is not None else "Unknown"
            data[b][key] = data[b].get(key, 0) + int(n or 0)
        for d in data.values():
            for k in keys or ["value"]:
                d.setdefault(k, 0)
        return list(data.values())


# ---------------------------------------------------------------- building blocks


def _count(db: Session, stmt: Any) -> int:
    return int(db.scalar(stmt) or 0)


def kpi(label: str, key: str, now: float | int | None, previous: float | int | None = None,
        unit: str = "", better: str = "up", sample: tuple[int, int] | None = None
        ) -> dict[str, Any]:
    """`sample`: how many cases a rate or median rests on (now, previous); findings compare
    the two periods only when both have at least MIN_SAMPLE."""
    return {"key": key, "label": label, "value": now, "previous": previous, "unit": unit,
            "better": better, "sample": list(sample) if sample else None}


def pct(part: int, whole: int) -> int | None:
    return round(part * 100 / whole) if whole else None


def chart(cid: str, title: str, kind: str, data: list[dict[str, Any]],
          series: list[tuple[str, str]] | None = None, note: str | None = None,
          filter: str | None = None) -> dict[str, Any]:
    """`filter`: clicking a bar/slice shows only the table rows whose `filter` field equals the
    item's `code` (lists: contains it)."""
    return {"id": cid, "title": title, "kind": kind, "data": data, "note": note,
            "filter": filter,
            "series": [{"key": k, "label": lbl} for k, lbl in (series or [("value", "Count")])]}


def pairs(rows: Any, label: Callable[[Any], str] = lambda v: str(v)) -> list[dict[str, Any]]:
    """[(value, n)] → [{label, value, code}]; `code` is the raw value, used for filtering."""
    return [{"label": label(k) if k is not None else "Unknown", "value": int(n),
             "code": str(k) if k is not None else None} for k, n in rows]


def top_n(items: list[dict[str, Any]], n: int = TOP) -> list[dict[str, Any]]:
    """Largest first; the rest summed into "Other"."""
    items = sorted(items, key=lambda x: -x["value"])
    if len(items) <= n:
        return items
    rest = sum(i["value"] for i in items[n:])
    return [*items[:n], {"label": "Other", "value": rest}]


def nice(code: str | None) -> str:
    return (code or "Unknown").replace("_", " ").capitalize()


def table(title: str, columns: list[tuple[str, str, str]], rows: list[dict[str, Any]]
          ) -> dict[str, Any]:
    return {"title": title, "rows": rows[:TABLE_LIMIT], "total": len(rows),
            "columns": [{"key": k, "label": lbl, "kind": kind} for k, lbl, kind in columns]}


_CITY_RES = [(re.compile(rf"\b{re.escape(c)}\b", re.I), CITY_ALIASES.get(c.lower(), c))
             for c in INDIAN_CITIES]


def place(location: str | None) -> str:
    """Group a free-text location: its Indian city, else remote (India / elsewhere), India
    without a city, outside India, or not stated. "Bengaluru / Bangalore" → "Bengaluru"."""
    text = (location or "").strip()
    if not text:
        return "Not stated"
    cities = list(dict.fromkeys(name for rx, name in _CITY_RES if rx.search(text)))
    if len(cities) == 1:
        return cities[0]
    if cities:
        return "Several Indian cities"
    india = re.search(r"\bindia\b|\bpan[- ]india\b", text, re.I)
    if re.search(r"\bremote\b|work from home|\bwfh\b|anywhere", text, re.I):
        return "Remote (India)" if india else "Remote (outside India / global)"
    return "India (city not stated)" if india else "Outside India"


def _city(location: str | None) -> str:
    return place(location)


def _band(score: int | None) -> str:
    return "Not scored" if score is None else f"{min(score // 10 * 10, 90)}"


JOB_COLUMNS = [
    ("title", "Job", "job"), ("company", "Company", "company"), ("location", "Location", "text"),
    ("work_model", "Work model", "code"), ("employment_type", "Type", "text"),
    ("score", "Score", "number"), ("status", "Job status", "code"),
    ("app_status", "Application", "code"), ("applied_on", "Applied", "date"),
    ("source", "Source", "code"), ("found", "Found", "date"), ("added", "Added to app", "date"),
]


def applied_in(r: Range) -> Any:
    """Jobs with an application sent in the period (own alias: no clash with outer joins)."""
    a = aliased(Application)
    return Job.id.in_(select(a.job_id).where(r.within(a.applied_on)))


def job_table(db: Session, title: str, *where: Any) -> dict[str, Any]:
    """The jobs behind a report's numbers, best score first, with their latest application.
    Extra fields (city, band, tier, skills, added_via) are there for chart-click filters."""
    latest = (
        select(Application.job_id, func.max(Application.id).label("app_id"))
        .group_by(Application.job_id).subquery()
    )
    rows = db.execute(
        select(Job, Company.name, Company.tier, Application.status, Application.applied_on,
               FOUND)
        .join(Company, Company.id == Job.company_id)
        .outerjoin(latest, latest.c.job_id == Job.id)
        .outerjoin(Application, Application.id == latest.c.app_id)
        .where(*where)
        .order_by(FOUND.desc(), Job.match_score.desc().nulls_last(), Job.id.desc())
        .limit(TABLE_LIMIT + 1)
    ).all()
    out = [{
        "id": j.id, "title": j.title, "company": c, "company_id": j.company_id,
        "location": j.location, "city": _city(j.location),
        "work_model": j.work_model,
        "employment_type": normalize_employment_type(j.employment_type) or "Not stated",
        "score": j.match_score, "band": _band(j.match_score), "status": j.status,
        "app_status": ast, "applied_on": ap.isoformat() if ap else None, "source": j.source,
        "found": found.isoformat() if found else None,
        "added": j.created_at.date().isoformat(), "tier": tier or "NO_TIER",
        "skills": j.required_skills or [], "added_via": j.added_via or [],
    } for j, c, tier, ast, ap, found in rows]
    t = table(title, JOB_COLUMNS, out)
    if len(out) > TABLE_LIMIT:
        t["total"] = _count(db, select(func.count(Job.id)).where(*where))
    return t


def _stacked_keys(rows: list[Any]) -> list[str]:
    """Most frequent second-column values (for a stacked chart's series), up to TOP."""
    totals: dict[str, int] = {}
    for r in rows:
        key = str(r[1]) if r[1] is not None else "Unknown"
        totals[key] = totals.get(key, 0) + int(r[2])
    return [k for k, _ in sorted(totals.items(), key=lambda x: -x[1])][:TOP]


def _stacked(r: Range, rows: list[Any]) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
    keys = _stacked_keys(rows)
    folded = [(b, k if (str(k) if k is not None else "Unknown") in keys else "Other", n)
              for b, k, n in rows]
    if any(k == "Other" for _, k, _ in folded):
        keys.append("Other")
    return r.series(folded, keys), [(k, nice(k) if k.isupper() else k) for k in keys]


# ---------------------------------------------------------------- reports


def _overview(db: Session, r: Range) -> dict[str, Any]:
    def counts(previous: bool) -> dict[str, int]:
        return {
            "jobs": _count(db, select(func.count(Job.id)).where(
                r.within(FOUND, previous))),
            "apps": _count(db, select(func.count(Application.id)).where(
                r.within(Application.applied_on, previous))),
            "answers": _count(db, select(func.count(func.distinct(
                ApplicationEvent.application_id))).where(
                ApplicationEvent.to_status.in_(RESPONDED),
                r.within(ApplicationEvent.occurred_at, previous))),
            "interviews": _count(db, select(func.count(Interview.id)).where(
                r.within(func.coalesce(Interview.scheduled_at, Interview.created_at), previous))),
            "offers": _count(db, select(func.count(Offer.id)).where(
                r.within(Offer.offer_date, previous))),
            "rejections": _count(db, select(func.count(func.distinct(
                ApplicationEvent.application_id))).where(
                ApplicationEvent.to_status == "REJECTED",
                r.within(ApplicationEvent.occurred_at, previous))),
        }

    now, prev = counts(False), counts(True)
    iv_at = func.coalesce(Interview.scheduled_at, Interview.created_at)
    activity: list[Any] = []
    for key, col, where in [
        ("Applications", Application.applied_on, None),
        ("Answers", ApplicationEvent.occurred_at, ApplicationEvent.to_status.in_(RESPONDED)),
        ("Interviews", iv_at, None),
        ("Offers", Offer.offer_date, None),
    ]:
        stmt = select(r.bucket(col), literal(key), func.count()).where(r.within(col))
        if where is not None:
            stmt = stmt.where(where)
        activity += db.execute(stmt.group_by(*BY1)).all()
    jobs = db.execute(select(r.bucket(FOUND), func.count(Job.id))
                      .where(r.within(FOUND)).group_by(*BY1)).all()
    status = db.execute(select(Application.status, func.count()).where(
        r.within(Application.applied_on)).group_by(*BY1)).all()
    applied = now["apps"]
    reached = {
        "Applied": applied,
        "Got an answer": _count(db, select(func.count()).where(
            r.within(Application.applied_on), Application.status.in_(RESPONDED))),
        "Interview": _count(db, select(func.count()).where(
            r.within(Application.applied_on), Application.status.in_(INTERVIEWED))),
        "Offer": _count(db, select(func.count()).where(
            r.within(Application.applied_on), Application.status.in_(["OFFER", "ACCEPTED"]))),
    }
    series = r.series(activity, ["Applications", "Answers", "Interviews", "Offers"])
    job_series = {d["period"]: d["value"] for d in r.series(jobs)}
    rows = [{**d, "Jobs found": job_series.get(d["period"], 0)} for d in series]
    return {
        "kpis": [
            kpi("Jobs found", "jobs", now["jobs"], prev["jobs"]),
            kpi("Applications", "apps", now["apps"], prev["apps"]),
            kpi("Answers from employers", "answers", now["answers"], prev["answers"]),
            kpi("Interviews", "interviews", now["interviews"], prev["interviews"]),
            kpi("Offers", "offers", now["offers"], prev["offers"]),
            kpi("Rejections", "rejections", now["rejections"], prev["rejections"],
                better="down"),
        ],
        "charts": [
            chart("activity", "Activity over time", "line", series,
                  [("Applications", "Applications"), ("Answers", "Answers"),
                   ("Interviews", "Interviews"), ("Offers", "Offers")]),
            chart("jobs", "Jobs found", "bar", r.series(jobs), [("value", "Jobs found")]),
            chart("funnel", "How far the period's applications got", "hbar",
                  [{"label": k, "value": v} for k, v in reached.items()],
                  note="Of the applications sent in the period: where each one is now."),
            chart("status", "Applications by current status", "donut", pairs(status, nice),
                  filter="app_status"),
        ],
        "jobs": job_table(db, "Jobs found or applied to in the period",
                          or_(r.within(FOUND), applied_in(r))),
        "table": table("By period", [
            ("label", "Period", "text"), ("Jobs found", "Jobs found", "number"),
            ("Applications", "Applications", "number"), ("Answers", "Answers", "number"),
            ("Interviews", "Interviews", "number"), ("Offers", "Offers", "number"),
        ], rows),
    }


def _jobs(db: Session, r: Range) -> dict[str, Any]:
    in_range = r.within(FOUND)

    def stats(previous: bool) -> dict[str, Any]:
        w = r.within(FOUND, previous)
        return {
            "n": _count(db, select(func.count(Job.id)).where(w)),
            "avg": db.scalar(select(func.round(func.avg(Job.match_score))).where(w)),
            "strong": _count(db, select(func.count(Job.id)).where(w, Job.match_score >= 80)),
            "jd": _count(db, select(func.count(Job.id)).where(w, Job.original_jd != "")),
        }

    now, prev = stats(False), stats(True)
    by_source = db.execute(select(r.bucket(FOUND), Job.source, func.count(Job.id))
                           .where(in_range).group_by(*BY2)).all()
    data, series = _stacked(r, list(by_source))
    band = func.coalesce(
        cast(func.least(func.floor(Job.match_score / 10) * 10, 90), String), "Not scored")
    scores = db.execute(select(band, func.count(Job.id)).where(in_range).group_by(*BY1)).all()
    score_data = sorted(pairs(scores), key=lambda x: (x["label"] == "Not scored", x["label"]))
    for s in score_data:
        if s["label"] != "Not scored":
            s["label"] = f"{s['label']}–{int(s['label']) + 9}"
    places: dict[str, int] = {}
    types: dict[str, int] = {}
    for location, kind in db.execute(select(Job.location, Job.employment_type).where(in_range)):
        places[place(location)] = places.get(place(location), 0) + 1
        k = normalize_employment_type(kind) or "Not stated"
        types[k] = types.get(k, 0) + 1
    return {
        "kpis": [
            kpi("Jobs found", "jobs", now["n"], prev["n"]),
            kpi("Average score", "avg", now["avg"] and int(now["avg"]),
                prev["avg"] and int(prev["avg"])),
            kpi("Score 80+", "strong", now["strong"], prev["strong"]),
            kpi("With a description", "jd", pct(now["jd"], now["n"]), pct(prev["jd"], prev["n"]),
                "%", sample=(now["n"], prev["n"])),
        ],
        "findings": [{"tone": "bad", "link": "/jobs?jd_status=MISSING",
                      "text": f"{100 - (pct(now['jd'], now['n']) or 0)}% of the period's jobs "
                              "have no description, so their scores are rough guesses."}]
        if now["n"] and (pct(now["jd"], now["n"]) or 0) < 80 else [],
        "charts": [
            chart("added", "Jobs found per period, by source", "stacked", data, series),
            chart("scores", "How well they fit (score)", "bar", score_data, [("value", "Jobs")],
                  filter="band"),
            chart("work_model", "Onsite, hybrid or remote", "donut", pairs(db.execute(
                select(Job.work_model, func.count(Job.id)).where(in_range).group_by(*BY1)).all(),
                lambda v: "Not stated" if v == "UNKNOWN" else nice(v)), filter="work_model"),
            chart("status", "Where they are now", "donut", top_n(pairs(db.execute(
                select(Job.status, func.count(Job.id)).where(in_range).group_by(*BY1)).all(),
                nice)), filter="status"),
            chart("locations", "Where the jobs are", "hbar",
                  top_n(pairs(places.items()), 12), filter="city"),
            chart("type", "Job type", "donut", pairs(sorted(types.items(), key=lambda x: -x[1])),
                  filter="employment_type"),
        ],
        "table": job_table(db, "Jobs found in the period (newest first)", in_range),
    }


def _applications(db: Session, r: Range) -> dict[str, Any]:
    in_range = r.within(Application.applied_on)
    first_answer = (
        select(ApplicationEvent.application_id,
               func.min(ApplicationEvent.occurred_at).label("at"))
        .where(ApplicationEvent.to_status.in_(RESPONDED))
        .group_by(ApplicationEvent.application_id).subquery()
    )

    def stats(previous: bool) -> dict[str, Any]:
        w = r.within(Application.applied_on, previous)
        n = _count(db, select(func.count(Application.id)).where(w))
        answered = _count(db, select(func.count()).where(w, Application.status.in_(RESPONDED)))
        iv = _count(db, select(func.count()).where(w, Application.status.in_(INTERVIEWED)))
        rejected = _count(db, select(func.count()).where(w, Application.status == "REJECTED"))
        days = db.scalar(
            select(func.percentile_cont(0.5).within_group(
                cast(first_answer.c.at, Date) - Application.applied_on))
            .join(first_answer, first_answer.c.application_id == Application.id).where(w))
        return {"n": n, "answered": answered, "iv": iv, "rejected": rejected,
                "days": round(days) if days is not None else None}

    now, prev = stats(False), stats(True)
    by_method = db.execute(select(r.bucket(Application.applied_on), Application.method,
                                  func.count()).where(in_range).group_by(*BY2)).all()
    data, series = _stacked(r, list(by_method))
    band = func.coalesce(
        cast(func.least(func.floor(Job.match_score / 10) * 10, 90), String), "Not scored")
    by_band = db.execute(
        select(band, func.count(), func.count().filter(Application.status.in_(INTERVIEWED)))
        .join(Job, Job.id == Application.job_id).where(in_range).group_by(*BY1)).all()
    band_data = sorted(
        [{"label": b if b == "Not scored" else f"{b}–{int(b) + 9}", "Applied": n,
          "Interview": i} for b, n, i in by_band],
        key=lambda x: (x["label"] == "Not scored", x["label"]))
    today = date.today()
    rows = db.execute(
        select(Application.id, Job.id, Job.title, Company.name, Application.applied_on,
               Application.status, Application.method, Job.match_score, Application.updated_at,
               Application.follow_up_date, first_answer.c.at, Application.origin)
        .join(Job, Job.id == Application.job_id)
        .join(Company, Company.id == Application.company_id)
        .outerjoin(first_answer, first_answer.c.application_id == Application.id)
        .where(in_range).order_by(Application.applied_on.desc(), Application.id.desc())
    ).all()
    return {
        "kpis": [
            kpi("Applications", "apps", now["n"], prev["n"]),
            kpi("Answer rate", "answer_rate", pct(now["answered"], now["n"]),
                pct(prev["answered"], prev["n"]), "%", sample=(now["n"], prev["n"])),
            kpi("Interview rate", "interview_rate", pct(now["iv"], now["n"]),
                pct(prev["iv"], prev["n"]), "%", sample=(now["n"], prev["n"])),
            kpi("Rejected", "rejected", now["rejected"], prev["rejected"], better="down"),
            kpi("Days to first answer (median)", "days", now["days"], prev["days"],
                " days", better="down", sample=(now["answered"], prev["answered"])),
        ],
        "charts": [
            chart("per_period", "Applications per period, by how you applied", "stacked",
                  data, series),
            chart("status", "Where they are now", "donut", pairs(db.execute(
                select(Application.status, func.count()).where(in_range).group_by(*BY1)).all(),
                nice), filter="status"),
            chart("by_score", "Do higher scores get interviews?", "bar", band_data,
                  [("Applied", "Applied"), ("Interview", "Reached interview")],
                  note="Applications grouped by the job's score."),
            chart("method", "How you applied", "hbar", top_n(pairs(db.execute(
                select(Application.method, func.count()).where(in_range).group_by(*BY1)).all(),
                nice)), filter="method"),
        ],
        "table": table("Applications in the period", [
            ("title", "Job", "job"), ("company", "Company", "text"),
            ("applied_on", "Applied", "date"), ("status", "Status", "code"),
            ("method", "How", "code"), ("score", "Score", "number"),
            ("answer_days", "Days to answer", "number"), ("idle_days", "Days since update",
                                                         "number"),
            ("follow_up", "Follow up", "date"),
        ], [{"id": jid, "app_id": aid, "title": t + (" (date approx.)" if o == "auto" else ""),
             "company": c, "applied_on": ap.isoformat(), "status": st, "method": m,
             "score": s, "answer_days": (fa.date() - ap).days if fa else None,
             "idle_days": (today - up.date()).days if up else None,
             "follow_up": fu.isoformat() if fu else None}
            for aid, jid, t, c, ap, st, m, s, up, fu, fa, o in rows]),
    }


def _interviews(db: Session, r: Range) -> dict[str, Any]:
    at = func.coalesce(Interview.scheduled_at, Interview.created_at)

    def stats(previous: bool) -> dict[str, int]:
        w = r.within(at, previous)
        return {
            "n": _count(db, select(func.count(Interview.id)).where(w)),
            "done": _count(db, select(func.count()).where(w, Interview.status == "COMPLETED")),
            "passed": _count(db, select(func.count()).where(w, Interview.result == "PASSED")),
            "failed": _count(db, select(func.count()).where(w, Interview.result == "FAILED")),
        }

    now, prev = stats(False), stats(True)
    upcoming = _count(db, select(func.count()).where(
        Interview.scheduled_at >= datetime.now(UTC),
        Interview.status.in_(["SCHEDULED", "RESCHEDULED"])))
    per = db.execute(select(r.bucket(at), Interview.round_type, func.count())
                     .where(r.within(at)).group_by(*BY2)).all()
    data, series = _stacked(r, list(per))
    rows = db.execute(
        select(Interview.id, Job.id, Job.title, Company.name, Interview.round_number,
               Interview.round_type, Interview.mode, at, Interview.status, Interview.result)
        .join(Job, Job.id == Interview.job_id).join(Company, Company.id == Interview.company_id)
        .where(r.within(at)).order_by(at.desc())
    ).all()
    decided = now["passed"] + now["failed"]
    return {
        "kpis": [
            kpi("Interviews", "n", now["n"], prev["n"]),
            kpi("Completed", "done", now["done"], prev["done"]),
            kpi("Passed", "passed", now["passed"], prev["passed"]),
            kpi("Pass rate", "pass_rate", pct(now["passed"], decided),
                pct(prev["passed"], prev["passed"] + prev["failed"]), "%",
                sample=(decided, prev["passed"] + prev["failed"])),
            kpi("Coming up (from today)", "upcoming", upcoming),
        ],
        "charts": [
            chart("per_period", "Interviews per period, by round", "stacked", data, series),
            chart("result", "Results", "donut", pairs(db.execute(
                select(Interview.result, func.count()).where(r.within(at)).group_by(*BY1)).all(),
                nice), filter="result"),
            chart("status", "Status", "donut", pairs(db.execute(
                select(Interview.status, func.count()).where(r.within(at)).group_by(*BY1)).all(),
                nice), filter="status"),
            chart("rounds", "Rounds by type", "hbar", pairs(db.execute(
                select(Interview.round_type, func.count()).where(r.within(at))
                .group_by(*BY1)).all(), nice), filter="round_type"),
        ],
        "table": table("Interviews in the period", [
            ("title", "Job", "job"), ("company", "Company", "text"), ("round", "Round", "number"),
            ("round_type", "Type", "code"), ("mode", "Mode", "code"), ("when", "When", "date"),
            ("status", "Status", "code"), ("result", "Result", "code"),
        ], [{"id": jid, "interview_id": iid, "title": t, "company": c, "round": rn,
             "round_type": rt, "mode": mo, "when": w.date().isoformat() if w else None,
             "status": st, "result": res}
            for iid, jid, t, c, rn, rt, mo, w, st, res in rows]),
    }


def _offers(db: Session, r: Range) -> dict[str, Any]:
    def stats(previous: bool) -> dict[str, Any]:
        w = r.within(Offer.offer_date, previous)
        return {
            "n": _count(db, select(func.count(Offer.id)).where(w)),
            "accepted": _count(db, select(func.count()).where(w, Offer.status == "ACCEPTED")),
            "best": db.scalar(select(func.max(Offer.total_ctc)).where(w)),
            "avg": db.scalar(select(func.avg(Offer.total_ctc)).where(w)),
        }

    now, prev = stats(False), stats(True)
    rows = db.execute(
        select(Offer.id, Job.id, Job.title, Company.name, Offer.offer_date, Offer.status,
               Offer.base_salary, Offer.total_ctc, Offer.currency, Offer.work_model,
               Offer.location, Offer.expiry_date, Offer.joining_date)
        .join(Job, Job.id == Offer.job_id).join(Company, Company.id == Offer.company_id)
        .where(r.within(Offer.offer_date)).order_by(Offer.offer_date.desc())
    ).all()
    money = [{"label": c, "value": int(ctc)} for _, _, _, c, _, _, _, ctc, *_ in rows if ctc]
    return {
        "kpis": [
            kpi("Offers", "n", now["n"], prev["n"]),
            kpi("Accepted", "accepted", now["accepted"], prev["accepted"]),
            kpi("Best total CTC", "best", now["best"] and int(now["best"]),
                prev["best"] and int(prev["best"]), "money"),
            kpi("Average total CTC", "avg", now["avg"] and int(now["avg"]),
                prev["avg"] and int(prev["avg"]), "money"),
        ],
        "charts": [
            chart("per_period", "Offers per period", "bar", r.series(db.execute(
                select(r.bucket(Offer.offer_date), func.count()).where(
                    r.within(Offer.offer_date)).group_by(*BY1)).all()), [("value", "Offers")]),
            chart("status", "Decisions", "donut", pairs(db.execute(
                select(Offer.status, func.count()).where(r.within(Offer.offer_date))
                .group_by(*BY1)).all(), nice), filter="status"),
            chart("ctc", "Total CTC by company", "hbar", sorted(money, key=lambda x: -x["value"]),
                  [("value", "Total CTC")]),
        ],
        "table": table("Offers in the period", [
            ("title", "Job", "job"), ("company", "Company", "text"),
            ("offer_date", "Offered", "date"), ("status", "Status", "code"),
            ("base", "Base", "money"), ("ctc", "Total CTC", "money"),
            ("work_model", "Work model", "code"), ("location", "Location", "text"),
            ("expiry", "Reply by", "date"), ("joining", "Joining", "date"),
        ], [{"id": jid, "offer_id": oid, "title": t, "company": c, "offer_date": od.isoformat(),
             "status": st, "base": base and int(base), "ctc": ctc and int(ctc), "currency": cur,
             "work_model": wm, "location": lo, "expiry": ex.isoformat() if ex else None,
             "joining": jo.isoformat() if jo else None}
            for oid, jid, t, c, od, st, base, ctc, cur, wm, lo, ex, jo in rows]),
    }


def _companies(db: Session, r: Range) -> dict[str, Any]:
    jobs = (select(Job.company_id.label("cid"), func.count(Job.id).label("jobs"),
                   func.max(Job.match_score).label("best"),
                   func.round(func.avg(Job.match_score)).label("avg"))
            .where(r.within(FOUND)).group_by(Job.company_id).subquery())
    apps = (select(Application.company_id.label("cid"), func.count().label("apps"),
                   func.count().filter(Application.status.in_(RESPONDED)).label("answers"))
            .where(r.within(Application.applied_on)).group_by(Application.company_id).subquery())
    at = func.coalesce(Interview.scheduled_at, Interview.created_at)
    ivs = (select(Interview.company_id.label("cid"), func.count().label("ivs"))
           .where(r.within(at)).group_by(Interview.company_id).subquery())
    offers = (select(Offer.company_id.label("cid"), func.count().label("offers"))
              .where(r.within(Offer.offer_date)).group_by(Offer.company_id).subquery())
    z = func.coalesce
    rows = db.execute(
        select(Company.id, Company.name, Company.tier, z(jobs.c.jobs, 0), jobs.c.best,
               jobs.c.avg, z(apps.c.apps, 0), z(apps.c.answers, 0), z(ivs.c.ivs, 0),
               z(offers.c.offers, 0))
        .outerjoin(jobs, jobs.c.cid == Company.id).outerjoin(apps, apps.c.cid == Company.id)
        .outerjoin(ivs, ivs.c.cid == Company.id).outerjoin(offers, offers.c.cid == Company.id)
        .where((jobs.c.jobs.is_not(None)) | (apps.c.apps.is_not(None))
               | (ivs.c.ivs.is_not(None)) | (offers.c.offers.is_not(None)))
        .order_by(z(offers.c.offers, 0).desc(), z(ivs.c.ivs, 0).desc(),
                  z(apps.c.apps, 0).desc(), z(jobs.c.jobs, 0).desc())
    ).all()
    out = [{"company_id": cid, "company": n, "tier": t, "jobs": j, "best": b,
            "avg": a and int(a), "apps": ap, "answers": an, "interviews": iv, "offers": of}
           for cid, n, t, j, b, a, ap, an, iv, of in rows]
    by_apps = [{"label": x["company"], "code": x["company"], "Applications": x["apps"],
                "Interviews": x["interviews"]}
               for x in sorted(out, key=lambda x: -x["apps"])[:10] if x["apps"]]
    by_jobs = [{"label": x["company"], "code": x["company"], "value": x["jobs"]}
               for x in sorted(out, key=lambda x: -x["jobs"])[:10] if x["jobs"]]
    tiers: dict[str, int] = {}
    for x in out:
        if x["apps"]:
            tiers[x["tier"] or "NO_TIER"] = tiers.get(x["tier"] or "NO_TIER", 0) + x["apps"]
    return {
        "kpis": [
            kpi("Companies with activity", "active", len(out)),
            kpi("Applied to", "applied", sum(1 for x in out if x["apps"])),
            kpi("With interviews", "iv", sum(1 for x in out if x["interviews"])),
            kpi("With offers", "offers", sum(1 for x in out if x["offers"])),
        ],
        "charts": [
            chart("apps", "Most applied-to companies", "bar", by_apps,
                  [("Applications", "Applications"), ("Interviews", "Interviews")],
                  filter="company"),
            chart("jobs", "Most jobs found", "hbar", by_jobs, [("value", "Jobs")],
                  filter="company"),
            chart("tiers", "Applications by company tier", "donut",
                  [{"label": "No tier" if k == "NO_TIER" else k.replace("TIER_", "Tier "),
                    "code": k, "value": v} for k, v in tiers.items()], filter="tier"),
        ],
        "jobs": job_table(db, "Jobs found or applied to in the period",
                          or_(r.within(FOUND), applied_in(r))),
        "table": table("Companies with activity in the period", [
            ("company", "Company", "company"), ("tier", "Tier", "code"),
            ("jobs", "Jobs found", "number"), ("best", "Best score", "number"),
            ("avg", "Avg score", "number"), ("apps", "Applied", "number"),
            ("answers", "Answers", "number"), ("interviews", "Interviews", "number"),
            ("offers", "Offers", "number"),
        ], out),
    }


def _sources(db: Session, r: Range) -> dict[str, Any]:
    in_range = r.within(FOUND)
    rows = db.execute(
        select(Job.source, func.count(Job.id), func.round(func.avg(Job.match_score)),
               func.count(Job.id).filter(Job.match_score >= 80),
               func.count(func.distinct(Application.id)),
               func.count(func.distinct(Application.id)).filter(
                   Application.status.in_(INTERVIEWED)))
        .outerjoin(Application, Application.job_id == Job.id).where(in_range)
        .group_by(Job.source).order_by(func.count(Job.id).desc())
    ).all()
    out = [{"source": s, "jobs": n, "avg": a and int(a), "strong": st, "apps": ap,
            "interviews": iv, "interview_rate": pct(iv, ap)} for s, n, a, st, ap, iv in rows]
    per = db.execute(select(r.bucket(FOUND), Job.source, func.count(Job.id))
                     .where(in_range).group_by(*BY2)).all()
    data, series = _stacked(r, list(per))
    best = max((x for x in out if x["jobs"] >= 3 and x["avg"] is not None),
               key=lambda x: x["avg"], default=None)
    most_iv = max((x for x in out if x["interviews"]), key=lambda x: x["interviews"], default=None)
    findings = []
    if best:
        findings.append({"tone": "good", "link": f"/jobs?source={best['source']}",
                         "text": f"{nice(best['source'])} brings the best-fitting jobs (average "
                                 f"score {best['avg']} over {best['jobs']} jobs)."})
    if most_iv:
        findings.append({"tone": "good",
                         "text": f"Most interviews came from {nice(most_iv['source'])} "
                                 f"({most_iv['interviews']} of {most_iv['apps']} applications)."})
    return {
        "findings": findings,
        "kpis": [
            kpi("Sources used", "n", len(out)),
            kpi("Best average score", "best", best["avg"] if best else None),
            kpi("Jobs found", "jobs", sum(x["jobs"] for x in out)),
        ],
        "charts": [
            chart("per_period", "Jobs found per period, by source", "stacked", data, series),
            chart("quality", "Average score by source", "hbar",
                  [{"label": nice(x["source"]), "code": x["source"], "value": x["avg"] or 0}
                   for x in out],
                  [("value", "Average score")],
                  note=f"Best: {nice(best['source'])}" if best else None, filter="source"),
            chart("funnel", "Applications and interviews by source", "bar",
                  [{"label": nice(x["source"]), "code": x["source"], "Applied": x["apps"],
                    "Interview": x["interviews"]} for x in out if x["apps"]],
                  [("Applied", "Applied"), ("Interview", "Reached interview")], filter="source"),
        ],
        "jobs": job_table(db, "Jobs found in the period", in_range),
        "table": table("Sources", [
            ("source", "Source", "source"), ("jobs", "Jobs", "number"),
            ("avg", "Avg score", "number"), ("strong", "Score 80+", "number"),
            ("apps", "Applied", "number"), ("interviews", "Interviews", "number"),
            ("interview_rate", "Interview rate %", "number"),
        ], out),
    }


def _followups(db: Session, r: Range) -> dict[str, Any]:
    today = date.today()

    def stats(previous: bool) -> dict[str, int]:
        w = r.within(FollowUp.due_date, previous)
        done = FollowUp.completed.is_(True)
        return {
            "due": _count(db, select(func.count(FollowUp.id)).where(w)),
            "done": _count(db, select(func.count()).where(w, done)),
            "on_time": _count(db, select(func.count()).where(
                w, done, cast(FollowUp.completed_at, Date) <= FollowUp.due_date)),
        }

    now, prev = stats(False), stats(True)
    overdue = _count(db, select(func.count()).where(
        FollowUp.completed.is_(False), FollowUp.due_date < today))
    due_rows = db.execute(select(r.bucket(FollowUp.due_date), literal("Due"), func.count())
                          .where(r.within(FollowUp.due_date)).group_by(*BY1)).all()
    done_rows = db.execute(
        select(r.bucket(FollowUp.completed_at), literal("Done"), func.count())
        .where(r.within(FollowUp.completed_at)).group_by(*BY1)).all()
    rows = db.execute(
        select(FollowUp.id, FollowUp.title, FollowUp.kind, FollowUp.due_date, FollowUp.completed,
               FollowUp.completed_at, FollowUp.job_id, Company.name)
        .outerjoin(Company, Company.id == FollowUp.company_id)
        .where(r.within(FollowUp.due_date)).order_by(FollowUp.due_date.desc())
    ).all()
    return {
        "kpis": [
            kpi("Due in the period", "due", now["due"], prev["due"]),
            kpi("Done", "done", now["done"], prev["done"]),
            kpi("Done on time", "on_time", pct(now["on_time"], now["due"]),
                pct(prev["on_time"], prev["due"]), "%"),
            kpi("Late right now", "overdue", overdue, better="down"),
        ],
        "charts": [
            chart("per_period", "Due vs done per period", "bar",
                  r.series([*due_rows, *done_rows], ["Due", "Done"]),
                  [("Due", "Due"), ("Done", "Done")]),
            chart("kind", "By kind", "donut", pairs(db.execute(
                select(FollowUp.kind, func.count()).where(r.within(FollowUp.due_date))
                .group_by(*BY1)).all(), nice), filter="kind"),
        ],
        "table": table("Follow-ups due in the period", [
            ("title", "Follow-up", "job"), ("company", "Company", "text"),
            ("kind", "Kind", "code"), ("due", "Due", "date"), ("state", "State", "text"),
        ], [{"id": jid, "title": t, "company": c, "kind": k, "due": d.isoformat(),
             "state": ("Done " + ca.date().isoformat()) if done and ca else
             "Done" if done else "Late" if d < today else "Open"}
            for _, t, k, d, done, ca, jid, c in rows]),
    }


def _skills(db: Session, r: Range) -> dict[str, Any]:
    from app.services import dashboard_service

    skill = func.jsonb_array_elements_text(Job.required_skills).table_valued("value")
    asked = db.execute(
        select(skill.c.value, func.count(func.distinct(Job.id)))
        .select_from(Job).join(skill, literal(True)).where(r.within(FOUND))
        .group_by(*BY1).order_by(func.count(func.distinct(Job.id)).desc()).limit(25)
    ).all()
    n_jobs = _count(db, select(func.count(Job.id)).where(r.within(FOUND)))
    n_skills = _count(db, select(func.count(func.distinct(skill.c.value)))
                      .select_from(Job).join(skill, literal(True)).where(r.within(FOUND)))
    gaps = dashboard_service.skill_gaps(db, 15)
    return {
        "kpis": [
            kpi("Jobs in the period", "jobs", n_jobs),
            kpi("Different skills asked for", "skills", n_skills),
            kpi("Top missing skill", "gap", gaps[0]["value"] if gaps else None,
                unit=f" jobs · {gaps[0]['label']}" if gaps else ""),
        ],
        "charts": [
            chart("asked", "Most asked-for skills (period's jobs)", "hbar",
                  [{"label": s, "code": s, "value": n} for s, n in asked[:15]],
                  [("value", "Jobs")], filter="skills"),
            chart("gaps", "Skills you're missing most (all open jobs)", "hbar",
                  [{"label": g["label"], "code": g["label"], "value": g["value"]} for g in gaps],
                  [("value", "Jobs")], filter="skills"),
        ],
        "jobs": job_table(db, "Jobs found in the period", r.within(FOUND)),
        "table": table("Skills asked for in the period", [
            ("skill", "Skill", "skill"), ("jobs", "Jobs", "number"),
            ("share", "Share of jobs %", "number"),
        ], [{"skill": s, "jobs": n, "share": pct(n, n_jobs)} for s, n in asked]),
    }


def _scans(db: Session, r: Range) -> dict[str, Any]:
    in_range = r.within(ScanRun.started_at)
    runs = db.execute(
        select(ScanRun.id, ScanRun.kind, ScanRun.trigger, ScanRun.status, ScanRun.started_at,
               ScanRun.finished_at, ScanRun.stats)
        .where(in_range).order_by(ScanRun.started_at.desc())
    ).all()

    def num(stats: dict[str, Any], *keys: str) -> int:
        for k in keys:
            v = stats.get(k)
            if isinstance(v, int | float):
                return int(v)
        return 0

    per = db.execute(select(r.bucket(ScanRun.started_at), ScanRun.kind, func.count())
                     .where(in_range).group_by(*BY2)).all()
    data, series = _stacked(r, list(per))
    new_rows = [(run[4], "New jobs", num(run[6] or {}, "new", "created", "jobs_new"))
                for run in runs]
    failed = sum(1 for run in runs if run[3] == "FAILED")
    return {
        "kpis": [
            kpi("Runs", "runs", len(runs)),
            kpi("Failed", "failed", failed, better="down"),
            kpi("New jobs from runs", "new", sum(n for _, _, n in new_rows)),
        ],
        "charts": [
            chart("per_period", "Runs per period, by kind", "stacked", data, series),
            chart("new", "New jobs found by runs", "bar", r.series(new_rows, ["New jobs"]),
                  [("New jobs", "New jobs")]),
        ],
        "jobs": job_table(
            db, "Jobs found by scans in the period", r.within(Job.created_at),
            or_(Job.added_via.contains(["scanner"]), Job.added_via.contains(["career_ops"]))),
        "table": table("Runs in the period", [
            ("started", "Started", "date"), ("kind", "Kind", "code"),
            ("trigger", "How", "code"), ("status", "Status", "code"),
            ("minutes", "Minutes", "number"), ("new", "New jobs", "number"),
            ("errors", "Errors", "number"),
        ], [{"run_id": i, "started": s.date().isoformat(), "kind": k, "trigger": t, "status": st,
             "minutes": round((f - s).total_seconds() / 60, 1) if f else None,
             "new": num(stats or {}, "new", "created", "jobs_new"),
             "errors": num(stats or {}, "errors", "failed")}
            for i, k, t, st, s, f, stats in runs]),
    }


_BUILT_HERE: dict[str, Callable[[Session, Range], dict[str, Any]]] = {
    "overview": _overview, "jobs": _jobs, "applications": _applications,
    "interviews": _interviews, "offers": _offers, "companies": _companies,
    "sources": _sources, "followups": _followups, "skills": _skills, "scans": _scans,
}
# Pipeline health, market and activity live in report_more (they use the helpers above).
from app.services import report_more  # noqa: E402

BUILDERS: dict[str, Callable[[Session, Range], dict[str, Any]]] = {
    k: {**_BUILT_HERE, **report_more.BUILDERS}[k] for k in REPORTS}


def catalog() -> list[dict[str, str]]:
    return [{"key": k, "title": t, "description": d, "section": SECTIONS[k]}
            for k, (t, d) in REPORTS.items()]


MAX_FINDINGS = 6


def _show(value: float | int, unit: str) -> str:
    return f"{value:g}{unit}" if isinstance(value, float) else f"{value}{unit}"


def kpi_findings(kpis: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    """Plain-words notes on the KPIs that changed a lot against the previous period: a rate
    by 5+ points, a count by a quarter or more (and at least 3)."""
    out = []
    for k in kpis:
        v, p, unit = k["value"], k["previous"], k["unit"]
        if v is None or p is None or unit == "money" or v == p:
            continue
        if k.get("sample") and min(k["sample"]) < MIN_SAMPLE:
            continue  # too few cases to call it a change
        up = v > p
        # better: "up" or "down" says which way is good; anything else is neutral.
        tone = ("info" if k["better"] not in ("up", "down")
                else "good" if up == (k["better"] == "up") else "bad")
        if unit == "%":
            if abs(v - p) < 5:
                continue
            text = (f"{k['label']}: {v}% against {p}% in the previous period "
                    f"({'+' if up else '−'}{abs(v - p)} points).")
        elif p < MIN_SAMPLE:
            if abs(v - p) < 3:
                continue
            text = (f"{k['label']}: {_show(v, unit)}, against "
                    f"{_show(p, unit) if p else 'none'} in the previous period.")
        else:
            change = abs(v - p) * 100 / p
            if abs(v - p) < 3 or change < 25:
                continue
            text = (f"{k['label']}: {_show(v, unit)}, {'up' if up else 'down'} {round(change)}% "
                    f"on the previous period ({_show(p, unit)}).")
        out.append({"tone": tone, "text": text})
    return out[:limit]


def build(db: Session, name: str, start: date | None = None, end: date | None = None,
          group: Group | None = None) -> dict[str, Any]:
    if name not in BUILDERS:
        raise NotFoundError(f"No report called '{name}'")
    end = end or date.today()
    start = start or end - timedelta(days=89)
    if start > end:
        raise DomainValidationError("The start date is after the end date")
    if (end - start).days > 3700:
        raise DomainValidationError("Pick a range of ten years or less")
    group = group or default_group(start, end)
    r = Range(start, end, group)
    title, description = REPORTS[name]
    body = BUILDERS[name](db, r)
    findings = [*body.pop("findings", []), *kpi_findings(body["kpis"])][:MAX_FINDINGS]
    return {"report": name, "title": title, "description": description,
            "section": SECTIONS[name], "from": start.isoformat(), "to": end.isoformat(),
            "group": group,
            "previous": {"from": r.prev_start.isoformat(), "to": r.prev_end.isoformat()},
            "jobs": None, **body, "findings": findings}


# The executive summary: the KPIs that matter most, from several reports, and their findings.
SUMMARY_KPIS = [("overview", "jobs"), ("overview", "apps"), ("pipeline", "answer_rate"),
                ("overview", "interviews"), ("overview", "offers"), ("pipeline", "days"),
                ("pipeline", "stale"), ("activity", "backlog"), ("activity", "reviewed"),
                ("market", "lpa")]
SUMMARY_FINDINGS = ["pipeline", "activity", "overview", "sources", "market", "jobs"]


def summary(db: Session, days: int = 30) -> dict[str, Any]:
    if not 1 <= days <= 3650:
        raise DomainValidationError("Pick between 1 and 3650 days")
    end = date.today()
    start = end - timedelta(days=days - 1)
    built = {n: build(db, n, start, end) for n in dict.fromkeys(
        [n for n, _ in SUMMARY_KPIS] + SUMMARY_FINDINGS)}
    kpis = []
    for name, key in SUMMARY_KPIS:
        k = next((x for x in built[name]["kpis"] if x["key"] == key), None)
        if k is not None:
            kpis.append({**k, "report": name})
    findings, seen = [], set()
    for name in SUMMARY_FINDINGS:
        for f in built[name]["findings"]:
            if f["text"] not in seen:
                seen.add(f["text"])
                findings.append({**f, "report": name})
    order = {"bad": 0, "good": 1, "info": 2}
    findings.sort(key=lambda f: order.get(f["tone"], 3))
    first = built[SUMMARY_FINDINGS[0]]
    return {"from": start.isoformat(), "to": end.isoformat(), "days": days,
            "previous": first["previous"], "kpis": kpis, "findings": findings[:10]}
