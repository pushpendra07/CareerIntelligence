import { useState } from "react";
import { Chips } from "../../components/ui";
import type { JobDetail } from "../../types/api";
import { experienceRange, formatDate, formatDateTime, humanize, salaryRange } from "../../utils/format";

/** Shared by Review and the job page: the facts that decide whether a job is worth it. */

export function KeyFacts({ job }: { job: JobDetail }) {
  const facts: [string, string][] = [
    ["Location", [job.location ?? job.locations.join(", "), job.work_model !== "UNKNOWN" ? humanize(job.work_model) : null].filter(Boolean).join(" · ") || "—"],
    ["Experience", experienceRange(job.experience_min, job.experience_max)],
    ["Salary", job.salary_text || salaryRange(job.salary_min, job.salary_max, job.salary_currency)],
    ["Posted on job site", formatDate(job.posting_date)],
    ["Added to this app", formatDate(job.created_at)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
      {facts.map(([k, v]) => (
        <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></div>
      ))}
    </dl>
  );
}

/** The strongest and weakest parts of the score, in plain words. */
export function FitSummary({ job }: { job: JobDetail }) {
  const m = job.match;
  if (!m) return <p className="text-sm text-slate-500">Not scored yet — it will be within a minute.</p>;
  const parts = m.components.filter((c) => c.weight > 0);
  const good = parts.filter((c) => c.factor >= 0.8).sort((a, b) => b.weight - a.weight).slice(0, 3);
  const weak = parts.filter((c) => c.factor < 0.5).sort((a, b) => b.weight - a.weight).slice(0, 3);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <div className="label">Why it fits</div>
        <ul className="space-y-1 text-sm text-slate-700">
          {good.length ? good.map((c) => <li key={c.key}>✓ {c.reasons[0] ?? c.label}</li>) : <li className="text-slate-500">Nothing stands out</li>}
        </ul>
        {m.strong_matches.length > 0 && <div className="mt-2"><Chips items={m.strong_matches} tone="green" /></div>}
      </div>
      <div>
        <div className="label">Watch out for</div>
        <ul className="space-y-1 text-sm text-slate-700">
          {m.blockers.map((b) => <li key={b.message} className="text-rose-700">✗ {b.message}</li>)}
          {weak.map((c) => <li key={c.key}>– {c.reasons[0] ?? c.label}</li>)}
          {!m.blockers.length && !weak.length && !m.missing.length && <li className="text-slate-500">No concerns</li>}
          {m.missing.length > 0 && <li>Skills it asks for that you don't list:</li>}
        </ul>
        {m.missing.length > 0 && <div className="mt-1"><Chips items={m.missing} tone="red" /></div>}
      </div>
    </div>
  );
}

const JD_PREVIEW = 1500;

/** The job description, shortened until asked for in full. */
export function JobDescription({ text, empty }: { text: string; empty?: string }) {
  const [full, setFull] = useState(false);
  const jd = text.trim();
  if (!jd) return <p className="text-sm text-slate-500">{empty ?? "No description saved — the score is a rough guess from the title. Open the posting to read it."}</p>;
  return (
    <>
      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
        {full || jd.length <= JD_PREVIEW ? jd : `${jd.slice(0, JD_PREVIEW)}…`}
      </p>
      {jd.length > JD_PREVIEW && <button className="link mt-1 text-sm" onClick={() => setFull((v) => !v)}>{full ? "Show less" : "Show the full description"}</button>}
    </>
  );
}

/** Where to read or apply: the job's own link, or the first source that has one. */
export const postingUrl = (job: JobDetail) => job.source_url ?? job.source_links.find((l) => l.original_url)?.original_url ?? null;

type TimelineEvent = { when: string; dateOnly: boolean; label: string; note?: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Where a job came from and when: posted → added to a sheet → added to the app → seen again. */
export function sourceTimeline(job: JobDetail): { events: TimelineEvent[]; missing: string[] } {
  const events: TimelineEvent[] = [];
  const missing: string[] = [];
  const name = (l: JobDetail["source_links"][number]) =>
    l.imported?.source ? `sheet “${l.imported.source}”` : [humanize(l.source), l.detail].filter(Boolean).join(" · ");
  const sheetPosted = job.source_links.map((l) => l.imported?.posted_text).find((t) => t && !ISO_DAY.test(t));
  if (job.posting_date) {
    events.push({ when: job.posting_date, dateOnly: true, label: "Posted on the job site", note: sheetPosted ? `sheet says “${sheetPosted}”` : undefined });
  } else if (sheetPosted) {
    missing.push(`Posted date unknown (sheet says “${sheetPosted}”)`);
  } else {
    missing.push("Posted date unknown");
  }
  for (const l of job.source_links) {
    if (!l.imported) continue;
    if (l.imported.added_to_sheet) events.push({ when: l.imported.added_to_sheet, dateOnly: true, label: `Added to ${name(l)}` });
    else missing.push(`Date added to ${name(l)}: the sheet has no date column`);
  }
  const links = [...job.source_links].sort((a, b) => a.first_seen_at.localeCompare(b.first_seen_at));
  events.push({ when: job.created_at, dateOnly: false, label: "Added to this app", note: links[0] ? `from ${name(links[0])}` : undefined });
  for (const l of links.slice(1)) events.push({ when: l.first_seen_at, dateOnly: false, label: `Also found in ${name(l)}` });
  for (const l of links) {
    const later = new Date(l.last_seen_at).getTime() - new Date(l.first_seen_at).getTime() > 3_600_000;
    if (later) events.push({ when: l.last_seen_at, dateOnly: false, label: `Last seen in ${name(l)}` });
  }
  // Date-only events sort as the start of their day.
  events.sort((a, b) => (a.dateOnly ? `${a.when}T00` : a.when).localeCompare(b.dateOnly ? `${b.when}T00` : b.when));
  return { events, missing };
}

export function SourceTimeline({ job }: { job: JobDetail }) {
  const { events, missing } = sourceTimeline(job);
  return (
    <div className="text-sm">
      <ol className="relative space-y-3 border-l border-slate-200 pl-4">
        {events.map((e, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-indigo-500 ring-2 ring-white dark:ring-slate-900" aria-hidden />
            <div className="text-xs text-slate-500">{e.dateOnly ? formatDate(e.when) : formatDateTime(e.when)}</div>
            <div className="text-slate-800">{e.label}</div>
            {e.note && <div className="text-xs text-slate-500">{e.note}</div>}
          </li>
        ))}
      </ol>
      {missing.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-slate-400">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
      )}
    </div>
  );
}
