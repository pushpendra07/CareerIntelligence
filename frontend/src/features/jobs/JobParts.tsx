import { useState } from "react";
import { Chips } from "../../components/ui";
import type { JobDetail } from "../../types/api";
import { experienceRange, formatDate, humanize, salaryRange } from "../../utils/format";

/** Shared by Review and the job page: the facts that decide whether a job is worth it. */

export function KeyFacts({ job }: { job: JobDetail }) {
  // Dates in the order they happened: posted → added to the sheet (if from one) → added here.
  const sheets = (job.source_links ?? []).filter((l) => l.imported);
  const addedToSheet = sheets.map((l) => l.imported?.added_to_sheet).filter(Boolean).sort()[0];
  const sheetPosted = sheets.map((l) => l.imported?.posted_text).find(Boolean);
  const facts: [string, string][] = [
    ["Location", [job.location ?? job.locations.join(", "), job.work_model !== "UNKNOWN" ? humanize(job.work_model) : null].filter(Boolean).join(" · ") || "—"],
    ["Experience", experienceRange(job.experience_min, job.experience_max)],
    ["Salary", job.salary_text || salaryRange(job.salary_min, job.salary_max, job.salary_currency)],
    ["Posted on job site", job.posting_date ? formatDate(job.posting_date) : sheetPosted ? `“${sheetPosted}” (sheet)` : "—"],
    ...(sheets.length ? [["Added to sheet", addedToSheet ? formatDate(addedToSheet) : "— (no date in sheet)"] as [string, string]] : []),
    ["Added to this app", formatDate(job.created_at)],
  ];
  return (
    // Sized by the space it gets (container query), so it also fits the narrow list preview.
    <div className="@container">
      <dl className={`grid grid-cols-2 gap-3 text-sm ${facts.length > 5 ? "@lg:grid-cols-3 @4xl:grid-cols-6" : "@lg:grid-cols-3 @3xl:grid-cols-5"}`}>
        {facts.map(([k, v]) => (
          <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></div>
        ))}
      </dl>
    </div>
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

export type SkillMarks = { have: string[]; related: string[]; missing: string[] };

const MARK_CLASS = {
  have: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  related: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  missing: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200",
};

/** The job's skills as the score saw them: ones you have, related ones, and missing ones. */
export function skillMarks(job: JobDetail): SkillMarks | undefined {
  const skills = job.match?.skills;
  if (!skills?.length) return undefined;
  const pick = (...kinds: string[]) => skills.filter((s) => kinds.includes(s.match)).map((s) => s.skill);
  return { have: pick("EXACT_MATCH", "PARTIAL_MATCH"), related: pick("RELATED"), missing: pick("MISSING") };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text with each skill name marked (whole words, any case; longer names win). */
export function Highlighted({ text, marks }: { text: string; marks?: SkillMarks }) {
  const kind = new Map<string, keyof SkillMarks>();
  if (marks) for (const k of ["missing", "related", "have"] as const) for (const s of marks[k]) if (s.trim()) kind.set(s.toLowerCase(), k);
  if (!kind.size) return <>{text}</>;
  const terms = [...kind.keys()].sort((a, b) => b.length - a.length).map(escape);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) => {
        const k = i % 2 ? kind.get(part.toLowerCase()) : undefined;
        return k
          ? <mark key={i} className={`rounded px-0.5 ${MARK_CLASS[k]}`} title={k === "have" ? "You have this skill" : k === "related" ? "You have a related skill" : "Not in your profile"}>{part}</mark>
          : part;
      })}
    </>
  );
}

/** The job description, shortened until asked for in full; skills marked when given. */
export function JobDescription({ text, empty, marks }: { text: string; empty?: string; marks?: SkillMarks }) {
  const [full, setFull] = useState(false);
  const jd = text.trim();
  if (!jd) return <p className="text-sm text-slate-500">{empty ?? "No description saved — the score is a rough guess from the title. Open the posting to read it."}</p>;
  return (
    <>
      {marks && (marks.have.length + marks.related.length + marks.missing.length) > 0 && (
        <p className="mb-2 flex flex-wrap gap-2 text-xs text-slate-500" data-testid="skill-legend">
          <span className={`rounded px-1 ${MARK_CLASS.have}`}>you have it</span>
          <span className={`rounded px-1 ${MARK_CLASS.related}`}>related skill</span>
          <span className={`rounded px-1 ${MARK_CLASS.missing}`}>missing</span>
        </p>
      )}
      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]">
        <Highlighted text={full || jd.length <= JD_PREVIEW ? jd : `${jd.slice(0, JD_PREVIEW)}…`} marks={marks} />
      </p>
      {jd.length > JD_PREVIEW && <button className="link mt-1 text-sm" onClick={() => setFull((v) => !v)}>{full ? "Show less" : "Show the full description"}</button>}
    </>
  );
}

/** Where to read or apply: the job's own link, or the first source that has one. */
export const postingUrl = (job: JobDetail) => job.source_url ?? job.source_links.find((l) => l.original_url)?.original_url ?? null;
