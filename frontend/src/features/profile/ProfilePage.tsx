import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Card, ErrorBox, Field, Spinner, PageIntro } from "../../components/ui";
import type { Profile } from "../../types/api";
import { formatDateTime } from "../../utils/format";

// Skills, experience and achievements are edited on Skills & targets (/preferences), next to what you want.
type Editable = Pick<Profile, "full_name" | "headline" | "email" | "phone" | "linkedin_url" | "location" | "summary">;
const pick = (p: Profile): Editable => ({ full_name: p.full_name, headline: p.headline, email: p.email, phone: p.phone,
  linkedin_url: p.linkedin_url, location: p.location, summary: p.summary });

const TEXT: [keyof Editable, string][] = [
  ["full_name", "Name"], ["headline", "Headline"], ["email", "Email"], ["phone", "Phone"],
  ["linkedin_url", "LinkedIn"], ["location", "Location"],
];

export function ProfilePage() {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile>("/profile") });
  const [form, setForm] = useState<Editable | null>(null);
  useEffect(() => { if (profile.data) setForm(pick(profile.data)); }, [profile.data]);
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
        <div><h1>Professional Profile</h1><PageIntro>Who you are: name, contact details and summary, used on applications and the apply assistant. Your skills and experience are on <Link className="link" to="/preferences#skills">Skills & targets</Link>.</PageIntro><p className="text-xs text-slate-400">Version {profile.data!.version} · updated {formatDateTime(profile.data!.updated_at)} · populate it from a CV on the CVs page, then edit freely.</p></div>
        <button className="btn-primary" onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save profile"}</button>
      </div>
      {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
      {save.isSuccess && <p className="text-sm text-emerald-700">Saved. Existing scores are marked stale until re-analyzed.</p>}
      <Card title="Identity">
        <div className="grid gap-3 sm:grid-cols-3">
          {TEXT.map(([k, label]) => <Field key={k} label={label}><input className="input" value={(form[k] as string) ?? ""} onChange={(e) => set(k, e.target.value as never)} /></Field>)}
          <div className="sm:col-span-3"><Field label="Summary"><textarea className="input" rows={4} value={form.summary ?? ""} onChange={(e) => set("summary", e.target.value)} /></Field></div>
        </div>
      </Card>
      <Card title="Skills & experience">
        <p className="text-sm text-slate-600">
          Your skills, experience years, domains, certifications and achievements are now edited on{" "}
          <Link className="link" to="/preferences#skills">Skills & targets</Link>, next to the roles and skills you want — one page that decides your scores.
        </p>
      </Card>
      {profile.data!.projects.length > 0 && (
        <Card title="Projects (from CV)">
          <ul className="space-y-1 text-sm">{profile.data!.projects.map((p) => <li key={p.name}><b>{p.name}</b> {p.platform && <span className="text-slate-500">({p.platform})</span>}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
