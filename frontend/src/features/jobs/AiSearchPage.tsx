import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Badge, Card, ErrorBox, Field, PageIntro } from "../../components/ui";
import { useCollector } from "./collector";
import { PortalLauncher } from "./PortalLauncher";
import { PORTAL_NAMES as PORTALS } from "./portals";

export type Preferences = {
  effective_titles?: string[]; preferred_skills?: string[]; required_skills?: string[]; preferred_locations?: string[];
  remote_ok?: boolean; hybrid_ok?: boolean; onsite_ok?: boolean; min_salary?: string | null; target_salary?: string | null;
  salary_currency?: string | null; min_experience_years?: string | null; excluded_roles?: string[]; excluded_technologies?: string[];
};

type RowResult = {
  index: number; result: "new" | "duplicate" | "repeat" | "deleted" | "filtered" | "invalid"; title?: string; company?: string; url?: string | null;
  has_description?: boolean; job_id?: number | null; matched_by?: string | null; existing_title?: string; existing_status?: string;
  same_as?: number; error?: string;
};
type ImportResult = { dry_run: boolean; counts: Record<RowResult["result"], number>; results: RowResult[] };

const lakh = (v?: string | null) => (v ? `${Math.round(Number(v) / 100000)} LPA` : null);

/** The instructions for Claude (Chrome extension / Desktop) or Gemini, built from the Target Profile. */
export function buildPrompt(p: Preferences, portals: string[], count: number, days: number, pageUrl: string, apiUrl: string, start?: string): string {
  const work = [p.remote_ok && "remote (from India)", p.hybrid_ok && "hybrid", p.onsite_ok && "on-site"].filter(Boolean).join(", ");
  const salary = p.salary_currency === "INR" || !p.salary_currency
    ? [lakh(p.min_salary) && `at least ${lakh(p.min_salary)}`, lakh(p.target_salary) && `target ${lakh(p.target_salary)}`].filter(Boolean).join(", ")
    : [p.min_salary && `at least ${p.min_salary} ${p.salary_currency}`].filter(Boolean).join("");
  const list = (v?: string[]) => (v?.length ? v.join(", ") : "—");
  const skip = [...(p.excluded_roles ?? []), ...(p.excluded_technologies ?? [])];
  return `You are my job-search assistant. Use my browser to find NEW, REAL, OPEN job postings on job portals, then add them to my job tracker app (Career Intelligence). Never invent a job, company, link, date, salary or requirement.
${start ? `\n${start}\n` : ""}
== WHAT I WANT ==
Job titles: ${list(p.effective_titles)}
Main skills: ${list([...(p.required_skills ?? []), ...(p.preferred_skills ?? [])])}
Locations: ${list(p.preferred_locations)}${work ? `\nWork type: ${work}` : ""}${salary ? `\nSalary: ${salary} (skip postings that clearly pay less)` : ""}${p.min_experience_years ? `\nMy experience: ${p.min_experience_years}+ years` : ""}
Full-time only. Posted in the last ${days} days.${skip.length ? `\nSkip: ${skip.join(", ")}` : ""}
Skip jobs whose main technology is not in my skills, junior / trainee roles, and jobs limited to other countries.

== WHERE TO SEARCH ==
${portals.join(", ")}.
Use the portal's own search with a title from the list plus a location (or "remote India") and the "last ${days} days" filter. Use my existing logged-in session; never enter passwords. If a portal shows a CAPTCHA or asks me to log in, stop using that portal and tell me. Go at a normal reading pace. Do not apply, save, follow, or message anyone.

== FOR EACH JOB ==
Open the posting itself (not just the search results) and check it is still open. Collect:
- title (exactly as posted), company, location, workplace (Remote / Hybrid / Onsite), experience, salary (only if stated)
- posted date as YYYY-MM-DD if shown
- url: the direct link to THIS posting (no search-results link; tracking parts like ?trk= can stay)
- description: the full job description text (copy it; it is used to score the job)
- portal: where you found it
- notes: one line on why it fits me
Stop after ${count} good jobs. Quality over quantity.

== HAND THE JOBS TO MY APP ==
Make a JSON list, one object per job, with exactly these keys:
[{"title": "...", "company": "...", "location": "...", "workplace": "Hybrid", "experience": "8+ years", "salary": "25-35 LPA", "posted": "2026-10-14", "url": "https://...", "portal": "LinkedIn", "description": "...", "notes": "..."}]
Then:
1. Open ${pageUrl} in a new tab.
2. Paste the JSON into the box "Jobs from the assistant" and click "Check". The app shows which jobs are new and which are already saved (same link, same company + title in any city, repost) — it removes duplicates for you.
3. Click "Add … new jobs".
(If you can't use the browser for this, but can run commands: POST the list to ${apiUrl} as {"jobs": [...]} — add "dry_run": true first to check. If neither works, give me the JSON in one code block and I will paste it.)

== REPORT ==
Added: N jobs (title | company | city | portal). Already in the app: N. Skipped and why (one line each). Portals you could not use and why.`;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard?.writeText(text).then(() => {
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }, () => {});
  return <button type="button" className="btn-primary" onClick={copy}>{done ? "Copied" : "Copy prompt"}</button>;
}

const RESULT: Record<RowResult["result"], { label: string; tone: "green" | "gray" | "amber" | "red" | "blue" }> = {
  new: { label: "New", tone: "green" }, duplicate: { label: "Already in the app", tone: "gray" }, repeat: { label: "Repeated in the list", tone: "gray" },
  deleted: { label: "You deleted it before", tone: "amber" }, filtered: { label: "Not allowed by your import rules", tone: "amber" }, invalid: { label: "Can't add", tone: "red" },
};

function parseJobs(text: string): unknown[] | string {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  if (!raw) return "Paste the JSON list the assistant gave you.";
  try {
    const data: unknown = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data as { jobs?: unknown })?.jobs;
    return Array.isArray(list) && list.length ? list : "Expected a JSON list of jobs: [{\"title\": …, \"company\": …}]";
  } catch {
    return "That isn't valid JSON. Ask the assistant for the jobs as one JSON list.";
  }
}

/**
 * Jobs → AI search: a prompt for Claude or Gemini to search LinkedIn, Naukri and other portals in
 * the browser, and a box where the jobs it found are checked for duplicates and added.
 */
export function AiSearchPage() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: () => api.get<Preferences>("/preferences") });
  const [portals, setPortals] = useState<string[]>(PORTALS.slice(0, 7));
  const [count, setCount] = useState(20);
  const [days, setDays] = useState(14);
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [checked, setChecked] = useState<ImportResult | null>(null);
  const [added, setAdded] = useState<ImportResult | null>(null);
  const [launch, setLaunch] = useState<string | null>(null);

  const origin = window.location.origin;
  const apiOrigin = window.location.port === "5173" ? origin.replace(/:5173$/, ":8010") : origin; // dev UI vs one-port install
  const prompt = buildPrompt(prefs.data ?? {}, portals, count, days, `${origin}/jobs/ai-search`, `${apiOrigin}/api/v1/jobs/agent-import`);

  const send = useMutation({
    mutationFn: ({ jobs, dryRun }: { jobs: unknown[]; dryRun: boolean }) => api.post<ImportResult>("/jobs/agent-import", { jobs, dry_run: dryRun }),
    onSuccess: (r) => {
      if (r.dry_run) setChecked(r);
      else {
        setAdded(r);
        setChecked(null);
        qc.invalidateQueries({ queryKey: ["jobs"] });
      }
    },
    meta: { toastError: true },
  });
  const run = (dryRun: boolean) => {
    const jobs = parseJobs(text);
    if (typeof jobs === "string") return setParseError(jobs);
    setParseError(null);
    setAdded(null);
    send.mutate({ jobs, dryRun });
  };
  const shown = added ?? checked;
  // Jobs the Job collector extension read: put them in the box and check them right away.
  const collected = useCallback((jobs: unknown[]) => {
    setText(JSON.stringify(jobs, null, 2));
    setParseError(null);
    setAdded(null);
    send.mutate({ jobs, dryRun: true });
  }, [send.mutate]); // eslint-disable-line react-hooks/exhaustive-deps
  const collector = useCollector(collected);
  const promptFor = (portal: string, start: string) =>
    buildPrompt(prefs.data ?? {}, [portal], count, days, `${origin}/jobs/ai-search`, `${apiOrigin}/api/v1/jobs/agent-import`, start);

  return (
    <div className="space-y-4">
      <div>
        <h1>AI job search</h1>
        <PageIntro>LinkedIn, Naukri and similar portals can't be scanned. Let Claude (the Chrome extension or Desktop app) or Gemini
          search them in your browser: copy the prompt, give it to the assistant, and it pastes the jobs back here. Duplicates are found for you.</PageIntro>
      </div>

      <Card title="1. Search a portal">
        <p className="mb-3 text-sm text-slate-600">Pick a portal, then choose Claude, Gemini or the Job collector extension. The portal opens with your search filled in.</p>
        <div className="flex flex-wrap gap-2">
          {PORTALS.map((p) => (
            <button key={p} type="button" className="btn-secondary" onClick={() => setLaunch(p)}>{p}</button>
          ))}
        </div>
        {collector.state.phase === "running" && (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded bg-indigo-50 p-2 text-sm text-indigo-800">
            Job collector · {collector.state.portal}: {collector.state.message}
            <button type="button" className="btn-secondary py-0.5 text-xs" onClick={collector.stop}>Stop</button>
          </p>
        )}
        {collector.state.phase === "done" && <p className="mt-3 text-sm text-slate-600">{collector.state.message} Checked below — click <b>Add</b> to save the new ones.</p>}
        {collector.state.phase === "error" && <p className="mt-3 text-sm text-rose-600">Job collector · {collector.state.portal}: {collector.state.message}</p>}
      </Card>
      {launch && (
        <PortalLauncher portal={launch} prefs={prefs.data ?? {}} days={days} count={count} collectorReady={!!collector.version} collectorVersion={collector.version}
          busy={collector.state.phase === "running"} promptFor={promptFor} onCollect={collector.start} onClose={() => setLaunch(null)} />
      )}

      <Card title="Or: one prompt for several portals" actions={<CopyButton text={prompt} />}>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {PORTALS.map((p) => (
            <label key={p} className="flex items-center gap-1.5">
              <input type="checkbox" checked={portals.includes(p)}
                onChange={(e) => setPortals(e.target.checked ? PORTALS.filter((x) => x === p || portals.includes(x)) : portals.filter((x) => x !== p))} />
              {p}
            </label>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-4">
          <Field label="Jobs to find"><input className="input w-24" type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} /></Field>
          <Field label="Posted within (days)"><input className="input w-24" type="number" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} /></Field>
        </div>
        <textarea aria-label="Prompt" className="input h-64 w-full font-mono text-xs" readOnly value={prompt} />
        <p className="mt-2 text-xs text-slate-500">
          Built from your <Link className="link" to="/preferences">Skills & targets</Link> (titles, skills, locations, salary) — change it there.
          The assistant uses your own logged-in browser; it never applies or messages anyone.
        </p>
      </Card>

      <Card title="2. Jobs from the assistant">
        <p className="mb-2 text-sm text-slate-600">The assistant pastes its JSON list here (or you do), or the Job collector fills it in. <b>Check</b> shows which jobs are new; nothing is saved until you click <b>Add</b>.</p>
        <textarea aria-label="Jobs from the assistant" className="input h-40 w-full font-mono text-xs" placeholder='[{"title": "Senior PHP Developer", "company": "…", "url": "https://www.linkedin.com/jobs/view/…", "description": "…"}]'
          value={text} onChange={(e) => { setText(e.target.value); setChecked(null); }} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="btn-secondary" disabled={send.isPending} onClick={() => run(true)}>Check</button>
          {checked && checked.counts.new > 0 && (
            <button className="btn-primary" disabled={send.isPending} onClick={() => run(false)}>Add {checked.counts.new} new job{checked.counts.new === 1 ? "" : "s"}</button>
          )}
          {checked && checked.counts.new === 0 && <span className="text-sm text-slate-600">Nothing new to add.</span>}
        </div>
        {parseError && <p className="mt-2 text-sm text-rose-600">{parseError}</p>}
        {send.error && <ErrorBox error={send.error} />}
        {added && (
          <p className="mt-3 rounded bg-emerald-50 p-2 text-sm text-emerald-800">
            Added {added.counts.new} new job{added.counts.new === 1 ? "" : "s"}{added.counts.duplicate ? `; ${added.counts.duplicate} already in the app (links added to them)` : ""}.{" "}
            <Link className="link" to="/jobs?added_via=ai_search">See jobs from AI search</Link>
          </p>
        )}
        {shown && (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {shown.results.map((r) => (
              <li key={r.index} className="flex flex-wrap items-center gap-2 py-2">
                <Badge tone={RESULT[r.result].tone}>{RESULT[r.result].label}</Badge>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.title ?? `Row ${r.index + 1}`}</span>
                  {r.company && <span className="text-slate-500"> · {r.company}</span>}
                  {r.result === "duplicate" && r.job_id && (
                    <span className="text-slate-500"> — same as <Link className="link" to={`/jobs/${r.job_id}`}>#{r.job_id}</Link>
                      {r.existing_title && r.existing_title !== r.title ? ` ${r.existing_title}` : ""}</span>
                  )}
                  {r.result === "new" && r.job_id && <> — <Link className="link" to={`/jobs/${r.job_id}`}>#{r.job_id}</Link></>}
                  {r.result === "repeat" && <span className="text-slate-500"> — same as row {(r.same_as ?? 0) + 1}</span>}
                  {r.error && <span className="text-rose-600"> — {r.error}</span>}
                </span>
                {r.result === "new" && !r.has_description && <span className="text-xs text-amber-700">no description: score is a guess</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
