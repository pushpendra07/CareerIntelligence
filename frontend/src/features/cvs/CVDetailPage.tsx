import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { BackButton, Badge, Card, Chips, ErrorBox, KeyValue, Spinner, StatusBadge } from "../../components/ui";
import type { Application, CV, CVVersionDetail, Page } from "../../types/api";
import { formatDate } from "../../utils/format";
import { ACCEPT } from "./CVsPage";

interface Comparison {
  skills_added: string[]; skills_removed: string[]; roles_added: string[]; roles_removed: string[];
  projects_added: string[]; projects_removed: string[]; summary_changed: boolean; text_diff: string[];
}

export function CVDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  const cv = useQuery({ queryKey: ["cv", id], queryFn: () => api.get<CV>(`/cvs/${id}`) });
  const [versionId, setVersionId] = useState<number | null>(null);
  const vid = versionId ?? cv.data?.current_version_id ?? null;
  const version = useQuery({ queryKey: ["cv-version", id, vid], queryFn: () => api.get<CVVersionDetail>(`/cvs/${id}/versions/${vid}`), enabled: vid !== null });
  const apps = useQuery({ queryKey: ["applications", { cv_version_id: vid }], queryFn: () => api.get<Page<Application>>("/applications", { cv_version_id: vid! }), enabled: vid !== null });
  const [compare, setCompare] = useState<{ left: number; right: number } | null>(null);
  const diff = useQuery({ queryKey: ["cv-compare", compare], queryFn: () => api.get<Comparison>("/cvs/compare", compare!), enabled: compare !== null });
  const activate = useMutation({ mutationFn: () => api.post(`/cvs/${id}/activate`), onSuccess: refresh });
  const archive = useMutation({ mutationFn: (v: boolean) => api.patch(`/cvs/${id}`, { is_archived: v }), onSuccess: refresh });
  const importProfile = useMutation({ mutationFn: (mode: string) => api.post("/profile/import-cv", { cv_version_id: vid, mode }), onSuccess: refresh });
  const [file, setFile] = useState<File | null>(null);
  const addVersion = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append("file", file!); return api.post(`/cvs/${id}/versions`, fd); },
    onSuccess: () => { setFile(null); setVersionId(null); refresh(); },
  });
  if (cv.isLoading) return <Spinner />;
  if (cv.error) return <ErrorBox error={cv.error} />;
  const c = cv.data!;
  const p = version.data?.parsed;
  const mutationError = activate.error ?? archive.error ?? importProfile.error ?? addVersion.error;
  return (
    <div className="space-y-4">
      <BackButton fallback="/cvs" label="Back to CVs" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1>{c.name}</h1><p className="text-sm text-slate-600">{c.target_role ?? "No target role"} {c.is_active && <Badge tone="green">active</Badge>} {c.is_archived && <Badge>archived</Badge>}</p></div>
        <div className="flex flex-wrap gap-2">
          {!c.is_active && !c.is_archived && <button className="btn-secondary" onClick={() => activate.mutate()}>Activate</button>}
          {!c.is_active && <button className="btn-secondary" onClick={() => archive.mutate(!c.is_archived)}>{c.is_archived ? "Unarchive" : "Archive"}</button>}
          <button className="btn-secondary" onClick={() => importProfile.mutate("merge")} disabled={!vid}>Merge into profile</button>
          <button className="btn-secondary" onClick={() => importProfile.mutate("replace")} disabled={!vid}>Replace profile from CV</button>
        </div>
      </div>
      {importProfile.isSuccess && <p className="text-sm text-emerald-700">Profile updated. <Link className="link" to="/profile">Review it</Link> — scores are now stale until re-analyzed.</p>}
      {mutationError && <ErrorBox error={new Error(errorMessage(mutationError))} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {p && (
            <Card title="Parsed profile">
              <KeyValue items={[
                ["Name", p.name], ["Headline", p.headline], ["Location", p.location],
                ["Total experience", p.total_experience_years ? `${p.total_experience_years} yrs` : "—"],
                ["Relevant experience", p.relevant_experience_years ? `${p.relevant_experience_years} yrs` : "—"],
                ["Leadership experience", p.leadership_experience_years ? `${p.leadership_experience_years} yrs` : "—"],
                ["Roles", (p.roles ?? []).join(", ")], ["Companies", (p.companies ?? []).join(", ")],
              ]} />
              <div className="mt-3 space-y-2">
                <div><div className="label">Technologies</div><Chips items={p.technologies ?? []} tone="indigo" /></div>
                <div><div className="label">Databases & search</div><Chips items={p.databases ?? []} /></div>
                <div><div className="label">Leadership</div><Chips items={p.leadership ?? []} /></div>
                <div><div className="label">Domains</div><Chips items={p.domains ?? []} /></div>
                <div><div className="label">Certifications</div><Chips items={p.certifications ?? []} tone="green" /></div>
              </div>
              {p.projects?.length > 0 && (
                <div className="mt-3"><div className="label">Projects</div>
                  <ul className="text-sm">{p.projects.map((pr: { name: string; platform?: string; skills: string[] }) => <li key={pr.name}><b>{pr.name}</b> {pr.platform && <span className="text-slate-500">({pr.platform})</span>} <span className="text-xs text-slate-400">{pr.skills.slice(0, 6).join(", ")}</span></li>)}</ul>
                </div>
              )}
              {p.warnings?.length > 0 && <p className="mt-2 text-xs text-amber-700">{p.warnings.join(" ")}</p>}
            </Card>
          )}
          {diff.data && (
            <Card title="Version comparison" actions={<button className="btn-secondary" onClick={() => setCompare(null)}>Close</button>}>
              <KeyValue items={[
                ["Skills added", diff.data.skills_added.join(", ") || "—"], ["Skills removed", diff.data.skills_removed.join(", ") || "—"],
                ["Roles added", diff.data.roles_added.join(", ") || "—"], ["Projects added", diff.data.projects_added.join(", ") || "—"],
                ["Summary changed", diff.data.summary_changed ? "Yes" : "No"],
              ]} />
              <pre className="mt-3 max-h-80 overflow-auto text-xs">{diff.data.text_diff.map((l, i) => <div key={i} className={l.startsWith("+") ? "text-emerald-700" : l.startsWith("-") ? "text-rose-700" : "text-slate-400"}>{l}</div>)}</pre>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Versions">
            <ul className="space-y-2 text-sm">
              {c.versions.map((v) => (
                <li key={v.id} className={`rounded p-2 ${v.id === vid ? "bg-indigo-50" : ""}`}>
                  <button className="font-medium hover:text-indigo-700" onClick={() => setVersionId(v.id)}>v{v.version_number}</button> {v.label && <span className="text-slate-500">{v.label}</span>}
                  {v.id === c.current_version_id && <Badge tone="green">current</Badge>}
                  <div className="text-xs text-slate-500">{v.original_filename} · {formatDate(v.created_at)}</div>
                  <div className="flex gap-2 text-xs">
                    <a className="link" href={`/api/v1/cvs/${c.id}/versions/${v.id}/file`}>Download original</a>
                    {vid && v.id !== vid && <button className="link" onClick={() => setCompare({ left: v.id, right: vid })}>Compare with selected</button>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
              <input className="input" type="file" accept={ACCEPT} aria-label="New version file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button className="btn-primary" disabled={!file || addVersion.isPending} onClick={() => addVersion.mutate()}>Add version</button>
            </div>
          </Card>
          <Card title="Applications using this version">
            {apps.data?.items.length ? apps.data.items.map((a) => <div key={a.id} className="text-sm"><Link className="link" to={`/applications/${a.id}`}>{a.job_title}</Link> <span className="text-xs text-slate-500">{a.company_name}</span> <StatusBadge value={a.status} /></div>)
              : <p className="text-sm text-slate-500">None yet</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
