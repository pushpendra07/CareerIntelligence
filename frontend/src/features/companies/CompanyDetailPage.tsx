import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { BackButton, Badge, Card, Chips, ErrorBox, KeyValue, ScoreBadge, Spinner, StatusBadge, PAGE_SIZE } from "../../components/ui";
import type { CompanyDetail, Contact, Job, Page } from "../../types/api";
import { formatDate, humanize } from "../../utils/format";
import { type ScanRun, num, runSummary } from "../scanner/ScannerSettings";
import { VERIFICATION } from "./CompaniesPage";

const FIELDS = ["website", "careers_url", "linkedin_url", "headquarters", "industry", "company_type", "employee_range", "india_locations", "india_presence", "legal_name"];
const KINDS = ["OFFICIAL_WEBSITE", "OFFICIAL_CAREERS", "OFFICIAL_LINKEDIN", "OFFICIAL_ATS", "SECONDARY", "AGGREGATOR", "MANUAL"];

function EvidenceForm({ companyId, onDone }: { companyId: number; onDone: () => void }) {
  const [f, setF] = useState({ field: "website", value: "", source_kind: "OFFICIAL_WEBSITE", verification_status: "VERIFIED", source_url: "", note: "" });
  const add = useMutation({
    mutationFn: () => api.post(`/companies/${companyId}/evidence`, { ...f, source_url: f.source_url || null, note: f.note || null }),
    onSuccess: () => { setF({ ...f, value: "", source_url: "", note: "" }); onDone(); },
  });
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <select className="input" aria-label="Field" value={f.field} onChange={(e) => setF({ ...f, field: e.target.value })}>{FIELDS.map((x) => <option key={x}>{x}</option>)}</select>
      <input className="input sm:col-span-2" placeholder="Value" aria-label="Value" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
      <select className="input" aria-label="Source kind" value={f.source_kind} onChange={(e) => setF({ ...f, source_kind: e.target.value })}>{KINDS.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>
      <select className="input" aria-label="Status" value={f.verification_status} onChange={(e) => setF({ ...f, verification_status: e.target.value })}>{VERIFICATION.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>
      <input className="input" placeholder="Source URL (required to verify)" aria-label="Source URL" value={f.source_url} onChange={(e) => setF({ ...f, source_url: e.target.value })} />
      {add.error && <div className="sm:col-span-3"><ErrorBox error={new Error(errorMessage(add.error))} /></div>}
      <button className="btn-primary sm:col-span-3 sm:w-fit" disabled={!f.value || add.isPending} onClick={() => add.mutate()}>Add evidence</button>
    </div>
  );
}

export function CompanyDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  const c = useQuery({ queryKey: ["company", id], queryFn: () => api.get<CompanyDetail>(`/companies/${id}`) });
  const jobs = useQuery({ queryKey: ["jobs", { company_id: id }], queryFn: () => api.get<Page<Job>>("/jobs", { company_id: id, sort: "-match_score", size: PAGE_SIZE }) });
  const contacts = useQuery({ queryKey: ["recruiters", { company_id: id }], queryFn: () => api.get<Page<Contact>>("/recruiters", { company_id: id }) });
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/companies/${id}`, body), onSuccess: refresh });
  const check = useMutation({ mutationFn: () => api.post<{ results: Record<string, string> }>(`/companies/${id}/check`), onSuccess: refresh });
  const board = useQuery({ queryKey: ["company-board", id], queryFn: () => api.get<{ provider: string; url: string } | null>(`/scanner/companies/${id}/board`) });
  const scan = useMutation({
    mutationFn: () => api.post<{ board: { provider: string; url: string } | null; run: ScanRun }>(`/scanner/companies/${id}/scan`),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (c.isLoading) return <Spinner />;
  if (c.error) return <ErrorBox error={c.error} />;
  const co = c.data!;
  return (
    <div className="space-y-4">
      <BackButton fallback="/companies" label="Back to companies" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1>{co.name}</h1>
          <div className="mt-1 flex flex-wrap gap-2 text-sm"><StatusBadge value={co.verification_status} /><Badge>score {co.verification_score}</Badge>{co.tier && <StatusBadge value={co.tier} />}</div>
          {co.aliases.length > 0 && <p className="mt-1 text-xs text-slate-500">Also known as: {co.aliases.join(", ")}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input w-32" aria-label="Tier" value={co.tier ?? ""} onChange={(e) => patch.mutate({ tier: e.target.value || null })}>
            <option value="">No tier</option><option value="TIER_A">Tier A</option><option value="TIER_B">Tier B</option><option value="TIER_C">Tier C</option>
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={co.job_search_enabled} onChange={(e) => patch.mutate({ job_search_enabled: e.target.checked })} />Job search</label>
          <button className="btn-secondary" disabled={scan.isPending} onClick={() => scan.mutate()} title="Search this company's job board now">{scan.isPending ? "Scanning…" : "Scan jobs"}</button>
          <button className="btn-secondary" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? "Checking…" : "Run verification check"}</button>
        </div>
      </div>
      {scan.data && (
        <div className="rounded bg-slate-50 p-2 text-sm">
          {scan.data.board
            ? <>{humanize(scan.data.board.provider)} board: {runSummary(scan.data.run)}.{" "}{num(scan.data.run.stats.new) > 0 && <Link className="link" to={`/jobs?q=${encodeURIComponent(co.name)}`}>View jobs</Link>}</>
            : <>No supported job board found on the careers page. Set the careers URL to the company's Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee, Pinpoint or Teamtailor page.</>}
        </div>
      )}
      {scan.error && <ErrorBox error={new Error(errorMessage(scan.error))} />}
      {check.data && <div className="rounded bg-slate-50 p-2 text-xs">{Object.entries(check.data.results).map(([k, v]) => <div key={k}>{k}: {v}</div>)}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Overview">
            <KeyValue items={[
              ["Website", co.website ? <a className="link" href={co.website} target="_blank" rel="noopener noreferrer">{co.website}</a> : "—"],
              ["Careers", co.careers_url ? <a className="link" href={co.careers_url} target="_blank" rel="noopener noreferrer">{co.careers_url}</a> : "—"],
              ["LinkedIn", co.linkedin_url ? <a className="link" href={co.linkedin_url} target="_blank" rel="noopener noreferrer">{co.linkedin_url}</a> : "—"],
              ["ATS", co.ats_provider ?? "—"],
              ["Job board", board.data ? <a className="link" href={board.data.url} target="_blank" rel="noopener noreferrer">{humanize(board.data.provider)}</a> : "not detected"], ["Headquarters", co.headquarters], ["Industry", co.industry],
              ["Type", co.company_type], ["Employees", co.employee_range],
              ["India presence", co.india_presence === null ? "Unknown" : co.india_presence ? "Yes" : "No"],
              ["Hiring", humanize(co.hiring_status)], ["Priority", co.priority], ["Last verified", formatDate(co.last_verified_at)],
            ]} />
            <div className="mt-3"><div className="label">India locations</div><Chips items={co.india_locations} /></div>
            {co.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{co.notes}</p>}
          </Card>
          <Card title="Verification evidence">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead><tr><th className="th">Field</th><th className="th">Value</th><th className="th">Source</th><th className="th">Status</th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {co.sources.map((s) => (
                    <tr key={s.id}>
                      <td className="td text-xs">{s.field}</td>
                      <td className="td max-w-xs truncate text-xs" title={s.value ?? ""}>{s.value}</td>
                      <td className="td text-xs">{humanize(s.source_kind)}{s.source_name && ` · ${s.source_name}`}{s.source_url && <a className="link ml-1" href={s.source_url} target="_blank" rel="noopener noreferrer">↗</a>}{s.note && <div className="text-slate-400">{s.note}</div>}</td>
                      <td className="td"><StatusBadge value={s.verification_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3"><EvidenceForm companyId={co.id} onDone={refresh} /></div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={`Jobs (${jobs.data?.total ?? 0})`}
            actions={(jobs.data?.total ?? 0) > PAGE_SIZE ? <Link className="link text-sm" to={`/jobs?q=${encodeURIComponent(co.name)}`}>See all</Link> : undefined}>
            {jobs.data?.items.map((j) => <div key={j.id} className="flex justify-between gap-2 py-0.5 text-sm"><Link className="link truncate" to={`/jobs/${j.id}`}>{j.title}</Link><ScoreBadge score={j.match_score} /></div>)}
          </Card>
          <Card title="Recruiters">
            {contacts.data?.items.length ? contacts.data.items.map((r) => <div key={r.id} className="text-sm">{r.name} <span className="text-xs text-slate-500">{r.job_title}</span> <StatusBadge value={r.status} /></div>)
              : <p className="text-sm text-slate-500">None</p>}
          </Card>
          <Card title="Verification status override">
            <select className="input" aria-label="Override" value={co.verification_override ?? ""} onChange={(e) => patch.mutate({ verification_override: e.target.value || null })}>
              <option value="">Derived from evidence</option><option value="NEEDS_REVIEW">Needs review</option><option value="REJECTED">Rejected</option><option value="INVALID">Invalid</option>
            </select>
          </Card>
          {Object.keys(co.attributes).length > 0 && (
            <Card title="Imported research"><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(co.attributes, null, 2)}</pre></Card>
          )}
        </div>
      </div>
    </div>
  );
}
