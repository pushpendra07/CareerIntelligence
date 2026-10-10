import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Card, Empty, ErrorBox, Pagination, Spinner, StatusBadge, PAGE_SIZE, PageIntro } from "../../components/ui";
import type { Company, Page } from "../../types/api";

export const VERIFICATION = ["DISCOVERED", "RESEARCHED", "VERIFIED", "PARTIALLY_VERIFIED", "NEEDS_REVIEW",
  "INVALID", "STALE", "REJECTED"];

export function CompaniesPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const filters = Object.fromEntries(["q", "tier", "verification_status", "india_presence", "job_search_enabled", "hiring_status", "has_jobs", "sort"]
    .map((k) => [k, params.get(k) ?? undefined]));
  const { data, isLoading, error } = useQuery({
    queryKey: ["companies", filters, page],
    queryFn: () => api.get<Page<Company>>("/companies", { ...filters, page, size: PAGE_SIZE }),
  });
  const stats = useQuery({ queryKey: ["companies", "stats"], queryFn: () => api.get<Record<string, unknown>>("/companies/stats") });
  const [newName, setNewName] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<Company>("/companies", { name: newName }),
    onSuccess: () => { setNewName(""); qc.invalidateQueries({ queryKey: ["companies"] }); },
  });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    n.delete("page");
    setParams(n);
  };
  const byStatus = (stats.data?.by_verification_status ?? {}) as Record<string, number>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1>Companies</h1><PageIntro>Companies you track. Turn on Job search for a company to have its jobs found automatically by the job scanner.</PageIntro></div>
        <div className="flex gap-2">
          <input className="input w-56" placeholder="New company name" aria-label="New company name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn-primary" disabled={!newName.trim() || create.isPending} onClick={() => create.mutate()}>Add</button>
          <a className="btn-secondary" href="/api/v1/companies/export?format=csv">Export CSV</a>
        </div>
      </div>
      {create.error && <ErrorBox error={new Error(errorMessage(create.error))} />}
      {stats.data && (
        <p className="text-sm text-slate-600">
          {String(stats.data.total)} companies · {byStatus.VERIFIED ?? 0} verified · {byStatus.PARTIALLY_VERIFIED ?? 0} partially verified ·
          {" "}{byStatus.RESEARCHED ?? 0} researched · {byStatus.DISCOVERED ?? 0} discovered · {String(stats.data.job_search_enabled)} job-search enabled
        </p>
      )}
      <Card>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
          <input className="input col-span-2" placeholder="Search name, domain, alias" aria-label="Search companies" defaultValue={params.get("q") ?? ""}
            onKeyDown={(e) => e.key === "Enter" && set("q", e.currentTarget.value)} />
          <select className="input" aria-label="Tier" value={params.get("tier") ?? ""} onChange={(e) => set("tier", e.target.value)}>
            <option value="">Any tier</option><option value="TIER_A">Tier A</option><option value="TIER_B">Tier B</option><option value="TIER_C">Tier C</option>
          </select>
          <select className="input" aria-label="Verification" value={params.get("verification_status") ?? ""} onChange={(e) => set("verification_status", e.target.value)}>
            <option value="">Any verification</option>{VERIFICATION.map((v) => <option key={v} value={v}>{v.replace("_", " ").toLowerCase()}</option>)}
          </select>
          <select className="input" aria-label="India presence" value={params.get("india_presence") ?? ""} onChange={(e) => set("india_presence", e.target.value)}>
            <option value="">India presence: any</option><option value="true">In India</option><option value="false">Not in India</option>
          </select>
          <select className="input" aria-label="Job search" value={params.get("job_search_enabled") ?? ""} onChange={(e) => set("job_search_enabled", e.target.value)}>
            <option value="">Job search: any</option><option value="true">Enabled</option><option value="false">Disabled</option>
          </select>
          <select className="input" aria-label="Jobs in app" value={params.get("has_jobs") ?? ""} onChange={(e) => set("has_jobs", e.target.value)}>
            <option value="">Jobs: any</option><option value="true">Has jobs in the app</option><option value="false">No jobs yet</option>
          </select>
          <select className="input" aria-label="Sort companies" value={params.get("sort") ?? "name"} onChange={(e) => set("sort", e.target.value)}>
            <option value="name">Name</option><option value="-jobs">Most jobs</option><option value="-verification_score">Verification score</option><option value="tier">Tier</option><option value="-updated_at">Recently updated</option>
          </select>
        </div>
      </Card>
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} />}
      {data && (
        <Card>
          {!data.items.length ? <Empty>No companies found.</Empty> : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead><tr><th className="th">Company</th><th className="th" title="Jobs for this company in Career Intelligence">Jobs</th><th className="th">Tier</th><th className="th">Verification</th><th className="th">India</th><th className="th">Careers</th><th className="th">Hiring</th><th className="th">Search</th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {data.items.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="td"><Link className="font-medium hover:text-indigo-700" to={`/companies/${c.id}`}>{c.name}</Link><div className="text-xs text-slate-500">{c.company_type ?? c.industry ?? ""}</div></td>
                      <td className="td text-sm">
                        {c.job_count ? (
                          <Link className="link" to={`/companies/${c.id}#jobs`} title={`${c.open_job_count ?? 0} open · ${c.job_count} in total`}>
                            {c.open_job_count ?? 0}<span className="text-xs text-slate-400"> / {c.job_count}</span>
                          </Link>
                        ) : <span className="text-slate-300">0</span>}
                      </td>
                      <td className="td"><StatusBadge value={c.tier} /></td>
                      <td className="td"><StatusBadge value={c.verification_status} /> <span className="text-xs text-slate-500">{c.verification_score}</span></td>
                      <td className="td text-xs">{c.india_presence === null ? "—" : c.india_presence ? (c.india_locations.join(", ") || "Yes") : "No"}</td>
                      <td className="td text-xs">{c.careers_url ? <a className="link" href={c.careers_url} target="_blank" rel="noopener noreferrer">{c.ats_provider ?? "careers"}</a> : "—"}</td>
                      <td className="td"><StatusBadge value={c.hiring_status === "UNKNOWN" ? null : c.hiring_status} /></td>
                      <td className="td text-xs">{c.job_search_enabled ? "On" : "Off"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} size={PAGE_SIZE} total={data.total} onPage={(p) => { const n = new URLSearchParams(params); n.set("page", String(p)); setParams(n); }} />
        </Card>
      )}
    </div>
  );
}
