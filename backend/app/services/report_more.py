"""Reports on the pipeline's health, the job market and your own activity.

Same shape and helpers as `report_service` (which registers these builders). Everything is
counted from your own data: no outside benchmarks.
"""

from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime, timedelta
from statistics import median
from typing import Any

from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.application import Application, ApplicationEvent
from app.models.company import Company
from app.models.job import Job
from app.services.report_service import (
    BY1,
    BY2,
    FOUND,
    INTERVIEWED,
    MIN_SAMPLE,
    RESPONDED,
    Range,
    _stacked,
    chart,
    kpi,
    nice,
    pct,
    place,
    table,
    top_n,
)

ACTIVE = ["APPLIED", "RECRUITER_CONTACTED", "SCREENING", "INTERVIEW", "AWAITING_FEEDBACK"]
OFFERED = ["OFFER", "ACCEPTED"]
STALE_DAYS = 14
NEW = ["NEW", "DISCOVERED"]
DECISIONS = ["job.status_changed", "job.shortlisted", "job.applied", "job.rejected"]


def _band(value: float | None, edges: Sequence[tuple[float, str]], last: str,
          missing: str = "Not stated") -> str:
    """The label of the first edge `value` is at or below; `last` above all of them."""
    if value is None:
        return missing
    for edge, label in edges:
        if value <= edge:
            return label
    return last


def _days(a: date | None, b: date) -> int | None:
    return (b - a).days if a else None


def _median(values: list[float]) -> float | None:
    return round(median(values), 1) if values else None


# ---------------------------------------------------------------- pipeline health

AGE_BANDS = [(7, "0–7 days"), (14, "8–14 days"), (30, "15–30 days"), (60, "31–60 days")]


def _first_answer() -> Any:
    return (select(ApplicationEvent.application_id,
                   func.min(ApplicationEvent.occurred_at).label("at"))
            .where(ApplicationEvent.to_status.in_(RESPONDED))
            .group_by(ApplicationEvent.application_id).subquery())


def _pipeline(db: Session, r: Range) -> dict[str, Any]:
    first = _first_answer()
    days_to_answer = cast(first.c.at, Date) - Application.applied_on
    is_ = Application.status.in_

    def stats(previous: bool) -> dict[str, Any]:
        w = r.within(Application.applied_on, previous)
        n, answered, iv, offers, waiting, days = db.execute(
            select(func.count(Application.id),
                   func.count().filter(is_(RESPONDED)), func.count().filter(is_(INTERVIEWED)),
                   func.count().filter(is_(OFFERED)),
                   func.count().filter(Application.status == "APPLIED"),
                   func.percentile_cont(0.5).within_group(days_to_answer))
            .outerjoin(first, first.c.application_id == Application.id).where(w)).one()
        return {"n": n, "answered": answered, "iv": iv, "offers": offers, "waiting": waiting,
                "days": round(days) if days is not None else None}

    now, prev = stats(False), stats(True)
    today = date.today()
    stale_before = datetime.now(UTC) - timedelta(days=STALE_DAYS)
    active = db.execute(
        select(Application.id, Job.id, Job.title, Company.name, Application.applied_on,
               Application.status, Application.updated_at, Application.follow_up_date,
               Job.match_score)
        .join(Job, Job.id == Application.job_id)
        .join(Company, Company.id == Application.company_id)
        .where(is_(ACTIVE)).order_by(Application.applied_on)
    ).all()
    stale = [a for a in active if a.updated_at < stale_before]
    ages: dict[str, int] = {label: 0 for _, label in AGE_BANDS} | {"Over 60 days": 0}
    rows = []
    for aid, jid, title, company, applied, status, updated, follow, score in active:
        age = _band(_days(applied, today), AGE_BANDS, "Over 60 days")
        ages[age] = ages.get(age, 0) + 1
        rows.append({
            "id": jid, "app_id": aid, "title": title, "company": company,
            "applied_on": applied.isoformat(), "status": status, "score": score,
            "waiting": _days(applied, today), "idle": (today - updated.date()).days,
            "follow_up": follow.isoformat() if follow else None, "age_band": age,
            "stale": "Yes" if updated < stale_before else "No",
        })

    cohorts = db.execute(
        select(r.bucket(Application.applied_on), func.count(Application.id),
               func.count().filter(is_(RESPONDED)), func.count().filter(is_(INTERVIEWED)),
               func.count().filter(is_(OFFERED)),
               func.count().filter(Application.status == "REJECTED"),
               func.count().filter(Application.status == "APPLIED"),
               func.percentile_cont(0.5).within_group(days_to_answer))
        .outerjoin(first, first.c.application_id == Application.id)
        .where(r.within(Application.applied_on)).group_by(*BY1).order_by(*BY1)
    ).all()
    label = {d["period"]: d["label"] for d in r.series([])}
    cohort_rows = [{
        "label": label.get(b.isoformat(), b.isoformat()), "period": b.isoformat(), "apps": n,
        "answered": a, "answer_rate": pct(a, n), "interviews": i, "interview_rate": pct(i, n),
        "offers": o, "rejected": rj, "waiting": wt,
        "answer_days": round(d) if d is not None else None,
    } for b, n, a, i, o, rj, wt, d in cohorts]
    rates = {row["period"]: row for row in cohort_rows}
    trend = [{"label": d["label"], "Answered %": rates.get(d["period"], {}).get("answer_rate"),
              "Interview %": rates.get(d["period"], {}).get("interview_rate")}
             for d in r.series([])]

    def stage(label: str, n: int, of: int | None = None) -> dict[str, Any]:
        share = f" · {pct(n, of)}%" if of else ""
        return {"label": f"{label}{share}", "value": n}

    findings = []
    if stale:
        verb = "applications have" if len(stale) != 1 else "application has"
        findings.append({"tone": "bad", "link": "/applications",
                         "text": f"{len(stale)} active {verb} had no update for {STALE_DAYS}+ "
                                 "days: a short follow-up often gets a reply."})
    if now["n"] and now["answered"] == 0:
        findings.append({"tone": "bad", "text": f"None of the {now['n']} applications sent in "
                                                "the period has an answer yet."})
    if now["days"] is not None and now["answered"] >= MIN_SAMPLE:
        findings.append({"tone": "info", "text": f"Employers answered in {now['days']} days "
                                                 f"(median of {now['answered']} answers)."})
    return {
        "kpis": [
            kpi("Active applications (now)", "active", len(active)),
            kpi("Answer rate", "answer_rate", pct(now["answered"], now["n"]),
                pct(prev["answered"], prev["n"]), "%", sample=(now["n"], prev["n"])),
            kpi("Answers → interview", "iv_rate", pct(now["iv"], now["answered"]),
                pct(prev["iv"], prev["answered"]), "%",
                sample=(now["answered"], prev["answered"])),
            kpi("Interview → offer", "offer_rate", pct(now["offers"], now["iv"]),
                pct(prev["offers"], prev["iv"]), "%", sample=(now["iv"], prev["iv"])),
            kpi("Days to first answer (median)", "days", now["days"], prev["days"], " days",
                better="down", sample=(now["answered"], prev["answered"])),
            kpi(f"No update for {STALE_DAYS}+ days", "stale", len(stale), better="down"),
        ],
        "charts": [
            chart("stages", "How far the period's applications got", "hbar", [
                stage("Applied", now["n"]), stage("Got an answer", now["answered"], now["n"]),
                stage("Interview", now["iv"], now["n"]), stage("Offer", now["offers"], now["n"]),
            ], [("value", "Applications")],
                note="Each stage as a share of the applications sent in the period."),
            chart("trend", "Answer and interview rate, by when you applied", "line", trend,
                  [("Answered %", "Answered %"), ("Interview %", "Interview %")],
                  note="Recent periods are still young: answers may yet come."),
            chart("age", "Active applications by time since you applied", "bar",
                  [{"label": k, "code": k, "value": v} for k, v in ages.items()],
                  [("value", "Applications")], filter="age_band"),
            chart("status", "Where active applications stand", "donut", [
                {"label": nice(s), "code": s, "value": n} for s, n in sorted(
                    {s: sum(1 for x in rows if x["status"] == s) for s in ACTIVE}.items(),
                    key=lambda x: -x[1]) if n], filter="status"),
        ],
        "findings": findings,
        "table": table("Cohorts: applications by when you sent them", [
            ("label", "Applied in", "text"), ("apps", "Applications", "number"),
            ("answered", "Answered", "number"), ("answer_rate", "Answer %", "number"),
            ("interviews", "Interviews", "number"), ("interview_rate", "Interview %", "number"),
            ("offers", "Offers", "number"), ("rejected", "Rejected", "number"),
            ("waiting", "No answer yet", "number"),
            ("answer_days", "Days to answer (median)", "number"),
        ], cohort_rows),
        "jobs": table("Active applications (oldest first)", [
            ("title", "Job", "job"), ("company", "Company", "text"),
            ("applied_on", "Applied", "date"), ("status", "Status", "code"),
            ("waiting", "Days waiting", "number"), ("idle", "Days since update", "number"),
            ("follow_up", "Follow up", "date"), ("score", "Score", "number"),
        ], rows),
    }


# ---------------------------------------------------------------- market & demand

SALARY_BANDS = [(10, "Under 10 LPA"), (20, "10–20 LPA"), (30, "20–30 LPA"), (40, "30–40 LPA"),
                (50, "40–50 LPA")]
EXP_BANDS = [(2, "0–2 yrs"), (5, "3–5 yrs"), (8, "6–8 yrs"), (12, "9–12 yrs")]


def _lpa(lo: Any, hi: Any, currency: str | None) -> float | None:
    """A yearly INR salary in lakhs: the middle of the range shown, else the one end shown."""
    if (currency or "INR").upper() != "INR":
        return None
    values = [float(v) for v in (lo, hi) if v is not None and float(v) > 0]
    return round(sum(values) / len(values) / 1e5, 1) if values else None


def _market_rows(db: Session, r: Range, previous: bool = False) -> list[dict[str, Any]]:
    rows = db.execute(
        select(Job.id, Job.title, Job.company_id, Company.name, Job.location, Job.work_model,
               Job.seniority, Job.experience_min, Job.salary_min, Job.salary_max,
               Job.salary_currency, Job.salary_text, Job.match_score, FOUND)
        .join(Company, Company.id == Job.company_id).where(r.within(FOUND, previous))
        .order_by(FOUND.desc(), Job.id.desc())
    ).all()
    out = []
    for jid, title, cid, company, loc, wm, sen, exp, lo, hi, cur, stext, score, found in rows:
        lpa = _lpa(lo, hi, cur)
        years = float(exp) if exp is not None else None
        out.append({
            "id": jid, "title": title, "company_id": cid, "company": company, "location": loc,
            "city": place(loc), "work_model": wm, "seniority": sen or "NOT_STATED",
            "experience": years, "exp_band": _band(years, EXP_BANDS, "13+ yrs"),
            "salary_lpa": lpa, "salary_band": _band(lpa, SALARY_BANDS, "50+ LPA",
                                                    "Not shown" if lo is None and hi is None
                                                    else "Other currency"),
            "salary_shown": lo is not None or hi is not None or bool(stext),
            "score": score, "found": found.isoformat() if found else None,
        })
    return out


def _market(db: Session, r: Range) -> dict[str, Any]:
    rows, prev = _market_rows(db, r), _market_rows(db, r, previous=True)

    def stats(rs: list[dict[str, Any]]) -> dict[str, Any]:
        lpas = [x["salary_lpa"] for x in rs if x["salary_lpa"] is not None]
        exps = [x["experience"] for x in rs if x["experience"] is not None]
        return {"n": len(rs), "shown": pct(sum(1 for x in rs if x["salary_shown"]), len(rs)),
                "lpa": _median(lpas), "lpa_n": len(lpas),
                "remote": pct(sum(1 for x in rs if x["work_model"] == "REMOTE"), len(rs)),
                "exp": _median(exps), "exp_n": len(exps),
                "companies": len({x["company_id"] for x in rs})}

    now, before = stats(rows), stats(prev)

    def counts(key: str, order: list[str] | None = None) -> list[dict[str, Any]]:
        c: dict[str, int] = {}
        for x in rows:
            c[x[key]] = c.get(x[key], 0) + 1
        keys = order or sorted(c, key=lambda k: -c[k])
        return [{"label": k if key != "seniority" else nice(k), "code": k, "value": c[k]}
                for k in keys if c.get(k)]

    salary_order = [label for _, label in SALARY_BANDS] + ["50+ LPA"]
    exp_order = [label for _, label in EXP_BANDS] + ["13+ yrs", "Not stated"]
    by_sen: dict[str, list[float]] = {}
    for x in rows:
        if x["salary_lpa"] is not None:
            by_sen.setdefault(x["seniority"], []).append(x["salary_lpa"])
    pay = sorted(((nice(k), k, _median(v) or 0.0, len(v)) for k, v in by_sen.items()
                  if len(v) >= 2), key=lambda x: -x[2])
    companies: dict[tuple[int, str], int] = {}
    for x in rows:
        companies[(x["company_id"], x["company"])] = companies.get(
            (x["company_id"], x["company"]), 0) + 1
    hiring = sorted(companies.items(), key=lambda x: -x[1])[:12]
    per = db.execute(select(r.bucket(FOUND), Job.work_model, func.count(Job.id))
                     .where(r.within(FOUND)).group_by(*BY2)).all()
    data, series = _stacked(r, list(per))
    other_currency = sum(1 for x in rows if x["salary_band"] == "Other currency")

    findings = []
    if now["lpa"] is not None:
        findings.append({"tone": "info", "text": f"Median pay shown: ₹{now['lpa']:g} LPA, from the "
                                                 f"{now['lpa_n']} jobs that state it in INR."})
    if now["n"] and now["shown"] is not None and now["shown"] < 30:
        findings.append({"tone": "info", "text": f"Only {now['shown']}% of jobs show a salary, so "
                                                 "pay figures rest on a small sample."})
    if hiring and hiring[0][1] >= 3:
        (_, name), n = hiring[0]
        findings.append({"tone": "info", "text": f"{name} posted the most jobs ({n})."})
    return {
        "kpis": [
            kpi("Jobs found", "jobs", now["n"], before["n"]),
            kpi("Hiring companies", "companies", now["companies"], before["companies"]),
            kpi("Show a salary", "shown", now["shown"], before["shown"], "%",
                sample=(now["n"], before["n"])),
            kpi("Median pay shown (INR)", "lpa", now["lpa"], before["lpa"], " LPA",
                sample=(now["lpa_n"], before["lpa_n"])),
            # Remote share and experience asked are neither good nor bad: no colour.
            kpi("Remote", "remote", now["remote"], before["remote"], "%", better="none",
                sample=(now["n"], before["n"])),
            kpi("Median experience asked", "exp", now["exp"], before["exp"], " yrs",
                better="none", sample=(now["exp_n"], before["exp_n"])),
        ],
        "charts": [
            chart("salary", "Pay shown (INR, per year)", "bar",
                  counts("salary_band", salary_order), [("value", "Jobs")], filter="salary_band",
                  note=f"Middle of the range shown. {other_currency} job(s) in other currencies "
                       "are left out." if other_currency else "Middle of the range shown."),
            chart("experience", "Experience asked for", "bar", counts("exp_band", exp_order),
                  [("value", "Jobs")], filter="exp_band"),
            chart("seniority", "Seniority", "donut", top_n(counts("seniority")),
                  filter="seniority"),
            chart("pay_by_level", "Median pay by seniority (INR)", "hbar",
                  [{"label": f"{lbl} ({n})", "code": code, "value": v}
                   for lbl, code, v, n in pay], [("value", "LPA")], filter="seniority",
                  note="Seniority levels with at least 2 jobs that show pay; (n) jobs."),
            chart("work_model", "Onsite, hybrid or remote, per period", "stacked", data, series),
            chart("hiring", "Companies posting the most jobs", "hbar",
                  [{"label": name, "code": name, "value": n} for (_, name), n in hiring],
                  [("value", "Jobs")], filter="company"),
        ],
        "findings": findings,
        "table": table("Jobs found in the period", [
            ("title", "Job", "job"), ("company", "Company", "company"),
            ("location", "Location", "text"), ("work_model", "Work model", "code"),
            ("seniority", "Seniority", "code"), ("experience", "Experience (yrs)", "number"),
            ("salary_lpa", "Pay (LPA)", "number"), ("score", "Score", "number"),
            ("found", "Found", "date"),
        ], rows),
    }


# ---------------------------------------------------------------- your activity

OUTCOMES = {"SHORTLISTED": "Shortlisted", "READY_TO_APPLY": "Shortlisted",
            "REVIEWING": "Shortlisted", "ON_HOLD": "Shortlisted", "APPLIED": "Applied",
            "NOT_RELEVANT": "Not relevant", "CLOSED": "Closed"}
BACKLOG_BANDS = [(0, "Today"), (3, "1–3 days"), (7, "4–7 days"), (14, "8–14 days"),
                 (30, "15–30 days")]


def _decisions(db: Session, start: date, end: date) -> list[Any]:
    """Status changes of jobs that were new: (job id, when, to)."""
    lo = datetime.combine(start, datetime.min.time()).astimezone(UTC)
    hi = datetime.combine(end + timedelta(days=1), datetime.min.time()).astimezone(UTC)
    return list(db.execute(
        select(ActivityLog.entity_id, ActivityLog.occurred_at, ActivityLog.data["to"].astext)
        .where(ActivityLog.entity_type == "job", ActivityLog.action.in_(DECISIONS),
               ActivityLog.data["from"].astext.in_(NEW),
               ActivityLog.occurred_at >= lo, ActivityLog.occurred_at < hi)
        .order_by(ActivityLog.occurred_at)
    ).all())


def _activity(db: Session, r: Range) -> dict[str, Any]:
    now, before = _decisions(db, r.start, r.end), _decisions(db, r.prev_start, r.prev_end)
    found = dict(db.execute(select(Job.id, FOUND).where(
        Job.id.in_({d[0] for d in now + before if d[0]}))).all())

    def stats(ds: list[Any]) -> dict[str, Any]:
        out = {"Shortlisted": 0, "Applied": 0, "Not relevant": 0, "Closed": 0}
        first: dict[int, datetime] = {}
        for jid, at, to in ds:
            if (o := OUTCOMES.get(to)) is not None:
                out[o] += 1
            first.setdefault(jid, at)
        waits = [float((at.date() - found[j]).days) for j, at in first.items()
                 if found.get(j) and at.date() >= found[j]]
        return {**out, "reviewed": len(first), "days": _median(waits)}

    s, p = stats(now), stats(before)
    since = db.scalar(select(func.min(ActivityLog.occurred_at)))
    # Decisions are only known from the first audit entry: no comparison with a period before.
    known = since is not None and since.date() <= r.prev_start

    def was(key: str) -> Any:
        return p[key] if known else None

    backlog_rows = db.execute(
        select(Job.id, Job.title, Company.name, Job.company_id, Job.match_score, FOUND)
        .join(Company, Company.id == Job.company_id)
        .where(Job.status.in_(NEW)).order_by(FOUND)).all()
    today = date.today()
    backlog: dict[str, int] = {label: 0 for _, label in BACKLOG_BANDS} | {"Over 30 days": 0}
    for *_, f in backlog_rows:
        backlog[_band(_days(f, today), BACKLOG_BANDS, "Over 30 days")] += 1
    decided = [(r.bucket_of(at), OUTCOMES.get(to, "Other moves"), 1) for _, at, to in now]
    data, series = _stacked(r, decided)
    jobs_in = db.execute(select(r.bucket(FOUND), func.count(Job.id))
                         .where(r.within(FOUND)).group_by(*BY1)).all()
    reviewed_per: dict[date, set[int]] = {}
    for jid, at, _ in now:
        reviewed_per.setdefault(r.bucket_of(at), set()).add(jid)
    flow = r.series([*[(b, "Found", n) for b, n in jobs_in],
                     *[(b, "Reviewed", len(ids)) for b, ids in reviewed_per.items()]],
                    ["Found", "Reviewed"])
    per_period = {d["period"]: d for d in data}
    table_rows = [{"label": d["label"], "found": d["Found"], "reviewed": d["Reviewed"],
                   **{k: per_period.get(d["period"], {}).get(k, 0)
                      for k in ("Shortlisted", "Applied", "Not relevant", "Closed")}}
                  for d in flow]
    note = (f"Decisions are recorded from {since.date():%d %b %Y}."
            if since and since.date() > r.start else None)
    total_found = sum(n for _, n in jobs_in)

    findings = []
    if len(backlog_rows):
        oldest = _days(backlog_rows[0][-1], today)
        findings.append({"tone": "bad" if len(backlog_rows) > 100 else "info",
                         "link": "/jobs/review",
                         "text": f"{len(backlog_rows)} new jobs are waiting for a decision"
                                 + (f"; the oldest for {oldest} days." if oldest else ".")})
    if total_found and s["reviewed"] < total_found:
        findings.append({"tone": "bad" if s["reviewed"] < total_found / 2 else "info",
                         "text": f"{total_found} jobs arrived and you decided on {s['reviewed']}: "
                                 "the backlog grows unless you review faster or narrow the "
                                 "filters."})
    if s["days"] is not None:
        findings.append({"tone": "info", "text": f"You decide on a new job {s['days']:g} days "
                                                 "after it's found (median)."})
    return {
        "kpis": [
            kpi("Jobs reviewed", "reviewed", s["reviewed"], was("reviewed")),
            kpi("Shortlisted", "shortlisted", s["Shortlisted"], was("Shortlisted")),
            kpi("Applied", "applied", s["Applied"], was("Applied")),
            kpi("Dismissed", "dismissed", s["Not relevant"] + s["Closed"],
                p["Not relevant"] + p["Closed"] if known else None, better="none"),
            kpi("Waiting for review (now)", "backlog", len(backlog_rows), better="down"),
            kpi("Days to decide (median)", "days", s["days"], was("days"), " days",
                better="down", sample=(s["reviewed"], p["reviewed"])),
        ],
        "charts": [
            chart("flow", "Jobs found vs jobs you reviewed", "bar", flow,
                  [("Found", "Found"), ("Reviewed", "Reviewed")], note=note),
            chart("decisions", "Your decisions per period", "stacked", data, series, note=note),
            chart("backlog", "New jobs waiting, by age", "bar",
                  [{"label": k, "code": k, "value": v} for k, v in backlog.items()],
                  [("value", "Jobs")]),
        ],
        "findings": findings,
        "table": table("By period", [
            ("label", "Period", "text"), ("found", "Found", "number"),
            ("reviewed", "Reviewed", "number"), ("Shortlisted", "Shortlisted", "number"),
            ("Applied", "Applied", "number"), ("Not relevant", "Not relevant", "number"),
            ("Closed", "Closed", "number"),
        ], table_rows),
        "jobs": table("Waiting for review (oldest first)", [
            ("title", "Job", "job"), ("company", "Company", "company"),
            ("score", "Score", "number"), ("found", "Found", "date"),
            ("waiting", "Days waiting", "number"),
        ], [{"id": jid, "title": t, "company": c, "company_id": cid, "score": sc,
             "found": f.isoformat() if f else None, "waiting": _days(f, today)}
            for jid, t, c, cid, sc, f in backlog_rows]),
    }


BUILDERS: dict[str, Callable[[Session, Range], dict[str, Any]]] = {
    "pipeline": _pipeline, "market": _market, "activity": _activity}
