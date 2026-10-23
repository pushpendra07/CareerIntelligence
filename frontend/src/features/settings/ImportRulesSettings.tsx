import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import { Card, ErrorBox, Field, PageIntro, Spinner } from "../../components/ui";

export interface ImportRules {
  enabled: boolean;
  required_skills: string[];
  ignored_skills: string[];
  required_roles: string[];
  ignored_roles: string[];
  keep_without_description: boolean;
  sources: string[];
}

type ListKey = "required_skills" | "ignored_skills" | "required_roles" | "ignored_roles";

interface CheckResult {
  saved: boolean; reason: string | null;
  found_skills: string[]; found_ignored_skills: string[]; found_roles: string[]; found_ignored_roles: string[];
}

const LISTS: { key: ListKey; label: string; hint: string; tone: "keep" | "skip"; placeholder: string }[] = [
  { key: "required_skills", label: "Skills a job must have", tone: "keep", placeholder: "e.g. Magento 2",
    hint: "A new job is saved only when its title or description mentions at least one. Empty = no skill needed." },
  { key: "ignored_skills", label: "Skills to ignore", tone: "skip", placeholder: "e.g. Java",
    hint: "A new job whose title or description mentions any of these is not saved." },
  { key: "required_roles", label: "Roles to keep", tone: "keep", placeholder: "e.g. Tech Lead",
    hint: "The job title must contain at least one. Empty = any title." },
  { key: "ignored_roles", label: "Roles to ignore", tone: "skip", placeholder: "e.g. Intern",
    hint: "A job title containing any of these is not saved." },
];

/** Add and remove words one at a time; a comma-separated paste adds several. */
export function TermList({ label, hint, tone, placeholder, values, onChange }: {
  label: string; hint: string; tone: "keep" | "skip"; placeholder: string; values: string[]; onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const next = [...values];
    for (const raw of text.split(",")) {
      const term = raw.trim().replace(/\s+/g, " ");
      if (term && !next.some((v) => v.toLowerCase() === term.toLowerCase())) next.push(term);
    }
    if (next.length > values.length) onChange(next);
    setText("");
  };
  const chip = tone === "keep" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-800 ring-rose-200";
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="label">{label}</div>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      <ul className="mb-2 flex min-h-7 flex-wrap gap-1.5" aria-label={label}>
        {values.length === 0 && <li className="text-xs text-slate-400">None</li>}
        {values.map((v) => (
          <li key={v} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${chip}`}>
            {v}
            <button type="button" className="ml-0.5 leading-none opacity-60 hover:opacity-100" aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="input text-sm" value={text} placeholder={placeholder} aria-label={`Add to ${label}`}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn-secondary" disabled={!text.trim()} onClick={add}>Add</button>
      </div>
    </div>
  );
}

/** Try the rules (as edited, before saving) on one job. */
function RuleTester({ rules, unsaved }: { rules: ImportRules; unsaved: boolean }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const test = useMutation({
    mutationFn: () => api.post<CheckResult>("/import-rules/check", { title, description, rules: { ...rules, enabled: true } }),
  });
  const r = test.data;
  const found = r && [
    ["Skills found", r.found_skills], ["Ignored skills found", r.found_ignored_skills],
    ["Roles found", r.found_roles], ["Ignored roles found", r.found_ignored_roles],
  ].filter(([, v]) => (v as string[]).length) as [string, string[]][];
  return (
    <details className="rounded border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-medium">Test a job against these rules</summary>
      <div className="mt-3 grid gap-3">
        {unsaved && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">Testing the rules as edited above — they are not saved yet.</p>}
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

/** Settings → Import rules: which new jobs any source may save. */
export function ImportRulesSettings() {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["import-rules"], queryFn: () => api.get<{ rules: ImportRules; sources: Record<string, string> }>("/import-rules") });
  const [draft, setDraft] = useState<ImportRules | null>(null);
  useEffect(() => { if (saved.data) setDraft(saved.data.rules); }, [saved.data]);
  const save = useMutation({
    mutationFn: () => api.patch("/settings/app", { import_rules: draft }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-rules"] }),
    meta: { success: "Import rules saved", toastError: true },
  });
  if (!draft || !saved.data) return <Spinner />;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved.data.rules);
  const set = (patch: Partial<ImportRules>) => setDraft({ ...draft, ...patch });
  const toggleSource = (key: string, on: boolean) =>
    set({ sources: Object.keys(saved.data.sources).filter((k) => (k === key ? on : draft.sources.includes(k))) });
  return (
    <div className="space-y-4">
      <div>
        <h1>Settings</h1>
        <PageIntro>Decide which jobs get into the app. Checked for every new job before it is saved; jobs already in the app are never removed.</PageIntro>
      </div>
      <Card title="Import rules" actions={<>
        {changed && <button className="btn-secondary" onClick={() => setDraft(saved.data.rules)}>Undo changes</button>}
        <button className="btn-primary" disabled={!changed || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</button>
      </>}>
        <div className="space-y-4 text-sm">
          <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3">
            <input type="checkbox" className="mt-0.5" checked={draft.enabled} aria-label="Use import rules" onChange={(e) => set({ enabled: e.target.checked })} />
            <span>
              <b>Use import rules</b>
              <span className="block text-xs text-slate-500">
                {draft.enabled
                  ? "On: a new job that breaks a rule below is not saved, and the import counts it as skipped."
                  : "Off: every job is saved, whatever its skills or title."}
              </span>
            </span>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            {LISTS.map((l) => (
              <TermList key={l.key} label={l.label} hint={l.hint} tone={l.tone} placeholder={l.placeholder} values={draft[l.key]} onChange={(v) => set({ [l.key]: v } as Partial<ImportRules>)} />
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Whole words, any case: “PHP” doesn't match “PHPUnit”, “Java” doesn't match “JavaScript”, and “Magento 2” also matches “Magento2”.
            Ignore rules win over keep rules.
          </p>

          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={draft.keep_without_description} onChange={(e) => set({ keep_without_description: e.target.checked })} />
            <span>
              Keep jobs that have no description yet
              <span className="block text-xs text-slate-500">Many sheet and Career-Ops rows have only a title. When ticked, such a job is kept unless its title breaks a role or ignore rule; untick to skip it unless the title shows a required skill.</span>
            </span>
          </label>

          <fieldset>
            <legend className="label">Apply to jobs from</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(saved.data.sources).map(([key, name]) => (
                <label key={key} className="flex items-center gap-1">
                  <input type="checkbox" checked={draft.sources.includes(key)} onChange={(e) => toggleSource(key, e.target.checked)} />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>

          <RuleTester rules={draft} unsaved={changed} />
        </div>
        {save.error && <div className="mt-2"><ErrorBox error={new Error(errorMessage(save.error))} /></div>}
      </Card>
    </div>
  );
}
