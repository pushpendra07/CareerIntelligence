import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import { ListInput } from "../../components/ListInput";
import { Card, Chips, ErrorBox, Field, Spinner } from "../../components/ui";
import type { Preferences } from "../../types/api";

const LISTS: [keyof Preferences, string, string?][] = [
  ["target_titles", "Target job titles"],
  ["required_skills", "Required skills", "skills you insist on"],
  ["preferred_skills", "Preferred skills"],
  ["preferred_domains", "Preferred domains"],
  ["preferred_companies", "Preferred companies"],
  ["preferred_locations", "Preferred locations", "cities, or 'Remote India'"],
  ["employment_types", "Employment types"],
  ["excluded_roles", "Excluded roles"],
  ["excluded_technologies", "Excluded technologies"],
  ["excluded_industries", "Excluded industries"],
];

export function PreferencesPage() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: () => api.get<Preferences>("/preferences") });
  const [form, setForm] = useState<Preferences | null>(null);
  useEffect(() => { if (prefs.data) setForm(prefs.data); }, [prefs.data]);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Preferences>("/preferences", body),
    onSuccess: (p) => { qc.setQueryData(["preferences"], p); qc.invalidateQueries({ queryKey: ["jobs"] }); },
  });
  if (prefs.isLoading || !form) return <Spinner />;
  if (prefs.error) return <ErrorBox error={prefs.error} />;
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setForm({ ...form, [k]: v });
  const num = (v: string | null) => (v === null || v === "" ? null : v);
  const submit = () => {
    const { version: _v, effective_titles: _e, ...rest } = form; // eslint-disable-line @typescript-eslint/no-unused-vars
    void _v; void _e;
    save.mutate({
      ...rest,
      min_experience_years: num(form.min_experience_years), max_experience_years: num(form.max_experience_years),
      min_salary: num(form.min_salary), target_salary: num(form.target_salary),
      notice_period_days: form.notice_period_days === null || String(form.notice_period_days) === "" ? null : Number(form.notice_period_days),
    });
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1>Target Job Profile</h1><p className="text-xs text-slate-500">Version {prefs.data!.version}. Changing preferences marks existing scores stale.</p></div>
        <button className="btn-primary" onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save preferences"}</button>
      </div>
      {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
      {save.isSuccess && <p className="text-sm text-emerald-700">Saved. Re-analyze jobs from the dashboard to refresh scores.</p>}
      <Card title="Roles">
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.include_architect_roles} onChange={(e) => set("include_architect_roles", e.target.checked)} />
          Include Architect roles (off by default)
        </label>
        <div><div className="label">Effective target titles</div><Chips items={prefs.data!.effective_titles} tone="indigo" /></div>
      </Card>
      <Card title="Preferences">
        <div className="grid gap-3 md:grid-cols-2">
          {LISTS.map(([k, label, hint]) => (
            <Field key={k} label={label} hint={hint}><ListInput label={label} value={form[k] as string[]} onChange={(v) => set(k, v as never)} /></Field>
          ))}
        </div>
      </Card>
      <Card title="Work model, experience & salary">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(["remote_ok", "hybrid_ok", "onsite_ok"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} />{k.replace("_ok", "").replace(/^./, (c) => c.toUpperCase())} OK</label>
          ))}
          <Field label="Min experience"><input className="input" type="number" step="0.5" value={form.min_experience_years ?? ""} onChange={(e) => set("min_experience_years", e.target.value)} /></Field>
          <Field label="Max experience"><input className="input" type="number" step="0.5" value={form.max_experience_years ?? ""} onChange={(e) => set("max_experience_years", e.target.value)} /></Field>
          <Field label="Notice period (days)"><input className="input" type="number" value={form.notice_period_days ?? ""} onChange={(e) => set("notice_period_days", e.target.value as unknown as number)} /></Field>
          <Field label="Minimum salary (annual)"><input className="input" type="number" value={form.min_salary ?? ""} onChange={(e) => set("min_salary", e.target.value)} /></Field>
          <Field label="Target salary (annual)"><input className="input" type="number" value={form.target_salary ?? ""} onChange={(e) => set("target_salary", e.target.value)} /></Field>
          <Field label="Currency"><input className="input" maxLength={3} value={form.salary_currency} onChange={(e) => set("salary_currency", e.target.value.toUpperCase())} /></Field>
        </div>
      </Card>
    </div>
  );
}
