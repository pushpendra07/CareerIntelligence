import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import { ListInput } from "../../components/ListInput";
import { Card, ErrorBox, Field, Spinner, PageIntro } from "../../components/ui";
import type { Profile } from "../../types/api";
import { formatDateTime } from "../../utils/format";

type Editable = Pick<Profile, "full_name" | "headline" | "email" | "phone" | "linkedin_url" | "location" | "summary"
  | "total_experience_years" | "relevant_experience_years" | "leadership_experience_years" | "primary_roles"
  | "core_skills" | "additional_skills" | "domains" | "leadership" | "certifications" | "achievements">;

const TEXT: [keyof Editable, string][] = [
  ["full_name", "Name"], ["headline", "Headline"], ["email", "Email"], ["phone", "Phone"],
  ["linkedin_url", "LinkedIn"], ["location", "Location"],
];
const YEARS: [keyof Editable, string][] = [
  ["total_experience_years", "Total experience (yrs)"], ["relevant_experience_years", "Relevant experience (yrs)"],
  ["leadership_experience_years", "Leadership experience (yrs)"],
];
const LISTS: [keyof Editable, string][] = [
  ["primary_roles", "Primary roles"], ["core_skills", "Core skills"], ["additional_skills", "Additional skills"],
  ["domains", "Domains"], ["leadership", "Leadership"], ["certifications", "Certifications"],
];

export function ProfilePage() {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile>("/profile") });
  const [form, setForm] = useState<Editable | null>(null);
  useEffect(() => { if (profile.data) setForm(profile.data); }, [profile.data]);
  const save = useMutation({
    mutationFn: (body: Partial<Editable>) => api.patch<Profile>("/profile", body),
    onSuccess: (p) => { qc.setQueryData(["profile"], p); qc.invalidateQueries({ queryKey: ["jobs"] }); },
  });
  if (profile.isLoading || !form) return <Spinner />;
  if (profile.error) return <ErrorBox error={profile.error} />;
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setForm({ ...form, [k]: v });
  const submit = () => {
    const body: Partial<Editable> = {};
    for (const k of Object.keys(form) as (keyof Editable)[]) {
      const v = form[k];
      (body as Record<string, unknown>)[k] = typeof v === "string" && v.trim() === "" ? null : v;
    }
    save.mutate(body);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1>Professional Profile</h1><PageIntro>What you bring: your experience and skills. Filled from your CV — correct anything that's wrong, because every job is scored against it.</PageIntro><p className="text-xs text-slate-400">Version {profile.data!.version} · updated {formatDateTime(profile.data!.updated_at)} · populate it from a CV on the CVs page, then edit freely.</p></div>
        <button className="btn-primary" onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save profile"}</button>
      </div>
      {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
      {save.isSuccess && <p className="text-sm text-emerald-700">Saved. Existing scores are marked stale until re-analyzed.</p>}
      <Card title="Identity">
        <div className="grid gap-3 sm:grid-cols-3">
          {TEXT.map(([k, label]) => <Field key={k} label={label}><input className="input" value={(form[k] as string) ?? ""} onChange={(e) => set(k, e.target.value as never)} /></Field>)}
          {YEARS.map(([k, label]) => <Field key={k} label={label}><input className="input" type="number" step="0.1" min={0} value={(form[k] as string) ?? ""} onChange={(e) => set(k, e.target.value as never)} /></Field>)}
          <div className="sm:col-span-3"><Field label="Summary"><textarea className="input" rows={4} value={form.summary ?? ""} onChange={(e) => set("summary", e.target.value)} /></Field></div>
        </div>
      </Card>
      <Card title="Skills & experience">
        <div className="grid gap-3 md:grid-cols-2">
          {LISTS.map(([k, label]) => <Field key={k} label={label}><ListInput label={label} value={form[k] as string[]} onChange={(v) => set(k, v as never)} /></Field>)}
          <div className="md:col-span-2"><Field label="Achievements"><ListInput label="Achievements" value={form.achievements} onChange={(v) => set("achievements", v)} /></Field></div>
        </div>
      </Card>
      {profile.data!.projects.length > 0 && (
        <Card title="Projects (from CV)">
          <ul className="space-y-1 text-sm">{profile.data!.projects.map((p) => <li key={p.name}><b>{p.name}</b> {p.platform && <span className="text-slate-500">({p.platform})</span>}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
