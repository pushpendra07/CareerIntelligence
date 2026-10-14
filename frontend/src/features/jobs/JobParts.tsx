import { useState } from "react";
import { Chips } from "../../components/ui";
import type { JobDetail } from "../../types/api";
import { experienceRange, formatDate, humanize, salaryRange } from "../../utils/format";

/** Shared by Review and the job page: the facts that decide whether a job is worth it. */

export function KeyFacts({ job }: { job: JobDetail }) {
  const facts: [string, string][] = [
    ["Location", [job.location ?? job.locations.join(", "), job.work_model !== "UNKNOWN" ? humanize(job.work_model) : null].filter(Boolean).join(" · ") || "—"],
    ["Experience", experienceRange(job.experience_min, job.experience_max)],
    ["Salary", job.salary_text || salaryRange(job.salary_min, job.salary_max, job.salary_currency)],
    ["Posted", formatDate(job.posting_date)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
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
