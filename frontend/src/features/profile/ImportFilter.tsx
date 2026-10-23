import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { ErrorBox, Field } from "../../components/ui";

/** The import rules (app settings `import_rules`): which new jobs any source may save. */
export interface ImportRules {
  enabled: boolean;
  // Older filter-only words; the Job search card merges them into its lists and clears them.
  required_skills: string[];
  ignored_skills: string[];
  required_roles: string[];
  ignored_roles: string[];
  keep_without_description: boolean;
  sources: string[];
  extras_enabled: boolean;
  from_profile: Record<ProfileKey, boolean>;
}

export type ProfileKey = "target_titles" | "required_skills" | "excluded_roles" | "excluded_technologies";
export type ProfileLists = Record<ProfileKey, string[]>;

interface CheckResult {
  saved: boolean; reason: string | null;
  found_skills: string[]; found_ignored_skills: string[]; found_roles: string[]; found_ignored_roles: string[];
}

interface Impact {
  checked: number; blocked: number; high_scoring_blocked: number;
  reasons: { reason: string; count: number }[];
  examples: { id: number; title: string; score: number | null; reason: string }[];
}

/** What the filters (as edited, before saving) would have done to the open jobs you have now. */
export function ImpactPreview({ rules, profile }: { rules: ImportRules; profile: ProfileLists }) {
  const run = useMutation({ mutationFn: () => api.post<Impact>("/import-rules/impact", { rules: { ...rules, enabled: true }, profile }) });
  const r = run.data;
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">What would these filters block?</span>
        <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Checking…" : r ? "Check again" : "Check my open jobs"}
        </button>
      </div>
      {!r && !run.error && <p className="mt-1 text-xs text-slate-500">Tries the filters as they are on this page (saved or not) on the jobs you have now. Nothing is changed.</p>}
      {r && (
        <div className="mt-2 space-y-2 text-sm" role="status">
          <p className={r.blocked ? "text-amber-800" : "text-emerald-700"}>
            {r.blocked
              ? <>Of your {r.checked} open jobs, <b>{r.blocked}</b> would not have been saved{r.high_scoring_blocked ? <>, including <b>{r.high_scoring_blocked} scoring 70+</b></> : null}.</>
              : <>All {r.checked} of your open jobs would still have been saved.</>}
          </p>
          {r.reasons.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Why">
              {r.reasons.map((x) => <li key={x.reason} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{x.reason} · {x.count}</li>)}
            </ul>
          )}
          {r.examples.length > 0 && (
            <ul className="space-y-0.5 text-xs" aria-label="Examples">
              {r.examples.map((x) => (
                <li key={x.id}><Link className="link" to={`/jobs/${x.id}`}>{x.title}</Link>
                  {x.score != null && <span className="text-slate-500"> · score {x.score}</span>}
                  <span className="text-slate-400"> — {x.reason}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {run.error && <ErrorBox error={new Error(errorMessage(run.error))} />}
    </div>
  );
}

/** Try the filters (as edited, before saving) on one job title and description. */
export function RuleTester({ rules, profile }: { rules: ImportRules; profile: ProfileLists }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const test = useMutation({
    mutationFn: () => api.post<CheckResult>("/import-rules/check", { title, description, rules: { ...rules, enabled: true }, profile }),
  });
  const r = test.data;
  const found = r && [
    ["Titles that fit", r.found_roles], ["Skills found", r.found_skills],
    ["Ignored titles found", r.found_ignored_roles], ["Ignored skills found", r.found_ignored_skills],
  ].filter(([, v]) => (v as string[]).length) as [string, string[]][];
  return (
    <details className="min-w-0 flex-1 rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-medium">Test a job against these filters</summary>
      <div className="mt-3 grid gap-3">
        <Field label="Job title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Magento Developer" /></Field>
        <Field label="Job description (optional)"><textarea className="input min-h-24 text-xs" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div><button className="btn-secondary" disabled={!title.trim() || test.isPending} onClick={() => test.mutate()}>{test.isPending ? "Checking…" : "Check"}</button></div>
        {r && (
          <div className={`rounded p-2 text-sm ${r.saved ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`} role="status">
            <b>{r.saved ? "Would be saved" : `Would not be saved: ${r.reason}`}</b>
            {found?.map(([k, v]) => <span key={k} className="block text-xs">{k}: {v.join(", ")}</span>)}
          </div>
        )}
        {test.error && <ErrorBox error={new Error(errorMessage(test.error))} />}
      </div>
    </details>
  );
}
