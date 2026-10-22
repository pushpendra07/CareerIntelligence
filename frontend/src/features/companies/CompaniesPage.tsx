import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Card, Empty, ErrorBox, Pagination, Spinner, StatusBadge, PageIntro, usePageSize } from "../../components/ui";
import type { Company, Page } from "../../types/api";
import { formatDateTime, humanize } from "../../utils/format";
import { ExtraLinkList, portalLabel } from "./ExtraLinks";

export const VERIFICATION = ["DISCOVERED", "RESEARCHED", "VERIFIED", "PARTIALLY_VERIFIED", "NEEDS_REVIEW",
  "INVALID", "STALE", "REJECTED"];

const FILTER_KEYS = ["q", "tier", "verification_status", "india_presence", "job_search_enabled", "hiring_status", "has_jobs",
  "portal", "industry", "company_size", "sort"];

type Facet = { value: string; count: number };
type Facets = { industries: Facet[]; company_sizes: Facet[]; portals: Facet[] };

export function Rating({ value, reviews }: { value?: number | null; reviews?: number | null }) {
  if (value == null) return <span className="text-slate-300">—</span>;
  const tone = value >= 4 ? "text-emerald-700" : value >= 3.5 ? "text-slate-700" : "text-amber-700";
  return (
    <span className={`whitespace-nowrap ${tone}`} title={`Employee rating on Naukri${reviews ? ` from ${reviews.toLocaleString()} reviews` : ""}`}>
      ★ {value.toFixed(1)}{reviews ? <span className="text-slate-400"> · {reviews >= 1000 ? `${(reviews / 1000).toFixed(1)}k` : reviews}</span> : null}
    </span>
  );
}

/** Act on the ticked companies: job search on/off, tier, delete (only ones nothing points at). */
function BulkBar({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const run = useMutation({
    mutationFn: (body: { action: string; tier?: string | null }) =>
      api.post<{ updated: number; deleted: number; skipped: { name: string }[] }>("/companies/bulk", { company_ids: ids, ...body }),
    onSuccess: (r) => {
      setConfirm(false);
      setMessage(r.deleted
        ? `Deleted ${r.deleted} compan${r.deleted === 1 ? "y" : "ies"}.${r.skipped.length ? ` Kept ${r.skipped.length} that have jobs, recruiters or applications (merge those instead): ${r.skipped.map((s) => s.name).join(", ")}.` : ""}`
        : r.skipped.length ? `Kept all ${r.skipped.length}: they have jobs, recruiters or applications.` : `Updated ${r.updated} compan${r.updated === 1 ? "y" : "ies"}.`);
      qc.invalidateQueries({ queryKey: ["companies"] });
      onDone();
    },
  });
  if (!ids.length) return message ? <p className="mb-2 rounded bg-emerald-50 p-2 text-sm text-emerald-800" role="status">{message}</p> : null;
  const b = "btn-secondary px-2 py-1 text-xs";
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 p-2 text-sm dark:bg-indigo-950" role="region" aria-label="Selected companies">
      <b>{ids.length} selected</b>
      <button className={b} disabled={run.isPending} onClick={() => run.mutate({ action: "job_search_on" })}>Turn job search on</button>
      <button className={b} disabled={run.isPending} onClick={() => run.mutate({ action: "job_search_off" })}>Turn job search off</button>
      <select className="input w-auto py-1 text-xs" aria-label="Set tier of selected companies" value="" disabled={run.isPending}
        onChange={(e) => e.target.value && run.mutate({ action: "tier", tier: e.target.value === "none" ? null : e.target.value })}>
        <option value="">Set tier…</option><option value="TIER_A">Tier A</option><option value="TIER_B">Tier B</option><option value="TIER_C">Tier C</option><option value="none">No tier</option>
      </select>
      {confirm ? (
        <span className="flex items-center gap-1 text-xs" role="alertdialog" aria-label="Confirm delete">
          Delete {ids.length} compan{ids.length === 1 ? "y" : "ies"}? Ones with jobs, recruiters or applications are kept.
          <button className="rounded bg-rose-600 px-2 py-1 text-white dark:bg-rose-500" disabled={run.isPending} onClick={() => run.mutate({ action: "delete" })}>Delete</button>
          <button className="rounded px-2 py-1 hover:bg-slate-100" onClick={() => setConfirm(false)}>Cancel</button>
        </span>
      ) : <button className={`${b} text-rose-700`} onClick={() => setConfirm(true)}>Delete…</button>}
      <span className="flex-1" />
      <button className="link text-xs" onClick={onDone}>Clear selection</button>
      {run.error && <ErrorBox error={new Error(errorMessage(run.error))} />}
    </div>
  );
}

/** "33 possible duplicates" next to the title; opens the review page. */
function DuplicatesLink() {
  const dups = useQuery({ queryKey: ["companies", "duplicates"], queryFn: () => api.get<{ total: number }>("/companies/duplicates"), retry: false });
  const n = dups.data?.total ?? 0;
  if (!n) return null;
  return (
    <Link className="btn-secondary" to="/companies/duplicates" title="Companies that may be the same one — review and merge">
      {n} possible duplicate{n === 1 ? "" : "s"}
    </Link>
  );
}

export function CompaniesPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]));
  const [size, setSize] = usePageSize("companies.pageSize.v1");
  const { data, isLoading, error } = useQuery({
    queryKey: ["companies", filters, page, size],
    queryFn: () => api.get<Page<Company>>("/companies", { ...filters, page, size }),
  });
  const facets = useQuery({ queryKey: ["companies", "facets"], queryFn: () => api.get<Facets>("/companies/facets"), retry: false }).data;
  const setPage = (p: number) => {
    const n = new URLSearchParams(params);
    if (p > 1) n.set("page", String(p)); else n.delete("page");
    setParams(n);
  };
  const lastPage = data ? Math.max(1, Math.ceil(data.total / size)) : 1;
  useEffect(() => {
    if (data && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const listKey = JSON.stringify([filters, page, size]);
  useEffect(() => setSelected(new Set()), [listKey]);
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const stats = useQuery({ queryKey: ["companies", "stats"], queryFn: () => api.get<Record<string, unknown>>("/companies/stats") });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    n.delete("page");
    setParams(n);
  };
  const active = FILTER_KEYS.filter((k) => k !== "sort" && params.get(k)).length;
  const byStatus = (stats.data?.by_verification_status ?? {}) as Record<string, number>;
  const sortHead = (label: string, field: string) => {
    const sort = params.get("sort") ?? "name";
    const dir = sort === field ? "▲" : sort === `-${field}` ? "▼" : "↕";
    return (
      <button type="button" aria-label={`Sort by ${label.toLowerCase()}`} className={`uppercase tracking-wide hover:text-indigo-700 ${sort.replace("-", "") === field ? "text-indigo-700" : ""}`}
        onClick={() => set("sort", sort === `-${field}` && field === "id" ? "id" : `-${field}`)}>
        {label} {dir}
      </button>
    );
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1>Companies</h1><PageIntro>Companies you track. Turn on Job search for a company to have its jobs found automatically by Job board search.</PageIntro></div>
        <div className="flex flex-wrap gap-2">
          <DuplicatesLink />
          <Link className="btn-primary" to="/companies/new">+ Add company</Link>
          <a className="btn-secondary" href="/api/v1/companies/export?format=csv">Export CSV</a>
        </div>
      </div>
      {stats.data && (
        <p className="text-sm text-slate-600">
          {String(stats.data.total)} companies · {byStatus.VERIFIED ?? 0} verified · {byStatus.PARTIALLY_VERIFIED ?? 0} partially verified ·
          {" "}{byStatus.RESEARCHED ?? 0} researched · {byStatus.DISCOVERED ?? 0} discovered · {String(stats.data.job_search_enabled)} job-search enabled
        </p>
      )}
      <Card>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
          <input className="input col-span-2" placeholder="Search name, domain, alias" aria-label="Search companies" key={params.get("q") ?? ""} defaultValue={params.get("q") ?? ""}
            onKeyDown={(e) => e.key === "Enter" && set("q", e.currentTarget.value)} />
          <select className="input" aria-label="Industry" value={params.get("industry") ?? ""} onChange={(e) => set("industry", e.target.value)}>
            <option value="">Any industry</option>
            {facets?.industries.map((f) => <option key={f.value} value={f.value}>{f.value} ({f.count})</option>)}
          </select>
          <select className="input" aria-label="Company size" value={params.get("company_size") ?? ""} onChange={(e) => set("company_size", e.target.value)}>
            <option value="">Any size</option>
            {(facets?.company_sizes ?? []).map((f) => <option key={f.value} value={f.value}>{f.value} employees ({f.count})</option>)}
          </select>
          <select className="input" aria-label="Portal link" value={params.get("portal") ?? ""} onChange={(e) => set("portal", e.target.value)}>
            <option value="">Portal links: any</option><option value="any">Has a portal link</option>
            {facets?.portals.map((f) => <option key={f.value} value={f.value}>On {portalLabel(f.value)} ({f.count})</option>)}
          </select>
          <select className="input" aria-label="Hiring" value={params.get("hiring_status") ?? ""} onChange={(e) => set("hiring_status", e.target.value)}>
            <option value="">Hiring: any</option><option value="HIRING">Hiring now</option><option value="NOT_HIRING">Not hiring</option><option value="UNKNOWN">Unknown</option>
          </select>
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
            <option value="name">Name</option><option value="-jobs">Most jobs</option><option value="-rating">Best rated</option><option value="-id">Company ID (newest first)</option><option value="id">Company ID (oldest first)</option><option value="-verification_score">Verification score</option><option value="tier">Tier</option><option value="-updated_at">Recently updated</option><option value="-created_at">Recently added</option>
          </select>
        </div>
        {active > 0 && (
          <div className="mt-2 text-right">
            <button type="button" className="link text-sm" onClick={() => setParams(params.get("sort") ? new URLSearchParams({ sort: params.get("sort")! }) : new URLSearchParams())}>
              Clear {active} filter{active === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </Card>
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} />}
      {data && (
        <Card className="scroll-mt-16" id="companies-list">
          {data.total > 0 && <Pagination position="top" page={page} size={size} total={data.total} onPage={setPage} noun={data.total === 1 ? "company" : "companies"} />}
          <BulkBar ids={[...selected]} onDone={() => setSelected(new Set())} />
          {!data.items.length ? <Empty>No companies found.</Empty> : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 [&_td]:px-2 [&_th]:px-2">
                <thead><tr>
                  <th className="th w-8">
                    <input type="checkbox" aria-label="Select all companies on this page"
                      checked={data.items.every((c) => selected.has(c.id))}
                      ref={(el) => { if (el) el.indeterminate = selected.size > 0 && !data.items.every((c) => selected.has(c.id)); }}
                      onChange={(e) => setSelected(e.target.checked ? new Set(data.items.map((c) => c.id)) : new Set())} />
                  </th>
                  <th className="th" aria-sort={params.get("sort") === "id" ? "ascending" : params.get("sort") === "-id" ? "descending" : "none"}>{sortHead("ID", "id")}</th>
                  <th className="th">Company</th>
                  <th className="th" title="Jobs for this company in Career Intelligence">{sortHead("Jobs", "jobs")}</th>
                  <th className="th">{sortHead("Rating", "rating")}</th>
                  <th className="th">Size</th>
                  <th className="th">Tier</th><th className="th">Verification</th><th className="th">India</th><th className="th">Careers</th>
                  <th className="th">Hiring</th><th className="th">Search</th>
                  <th className="th">{sortHead("Added", "created_at")}</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {data.items.map((c) => (
                    <tr key={c.id} className={selected.has(c.id) ? "bg-indigo-50/60" : "hover:bg-slate-50"}>
                      <td className="td w-8"><input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                      <td className="td text-xs tabular-nums text-slate-500" title="Company ID">#{c.id}</td>
                      <td className="td max-w-xs">
                        <Link className="font-medium hover:text-indigo-700" to={`/companies/${c.id}`}>{c.name}</Link>
                        <div className="truncate text-xs text-slate-500" title={[c.industry, c.company_type].filter(Boolean).join(" · ")}>
                          {[c.industry, c.company_type].filter(Boolean).join(" · ")}
                        </div>
                        {!!c.extra_links?.length && <div className="text-xs"><ExtraLinkList links={c.extra_links} /></div>}
                      </td>
                      <td className="td text-sm">
                        {c.job_count ? (
                          <Link className="link" to={`/companies/${c.id}#jobs`} title={`${c.open_job_count ?? 0} open · ${c.job_count} in total`}>
                            {c.open_job_count ?? 0}<span className="text-xs text-slate-400"> / {c.job_count}</span>
                          </Link>
                        ) : <span className="text-slate-300">0</span>}
                      </td>
                      <td className="td text-xs"><Rating value={c.rating} reviews={c.rating_reviews} /></td>
                      <td className="td whitespace-nowrap text-xs text-slate-600">{c.employee_range ?? "—"}</td>
                      <td className="td"><StatusBadge value={c.tier} /></td>
                      <td className="td"><StatusBadge value={c.verification_status} /> <span className="text-xs text-slate-500">{c.verification_score}</span></td>
                      <td className="td text-xs">{c.india_presence === null ? "—" : c.india_presence ? (c.india_locations.join(", ") || "Yes") : "No"}</td>
                      <td className="td text-xs">{c.careers_url ? <a className="link" href={c.careers_url} target="_blank" rel="noopener noreferrer">{c.ats_provider ? humanize(c.ats_provider) : "careers"}</a> : "—"}</td>
                      <td className="td"><StatusBadge value={c.hiring_status === "UNKNOWN" ? null : c.hiring_status} /></td>
                      <td className="td text-xs">{c.job_search_enabled ? "On" : "Off"}</td>
                      <td className="td whitespace-nowrap text-xs text-slate-500" title="Added to this app">{formatDateTime(c.created_at, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} size={size} total={data.total} onPage={setPage} scrollTo="companies-list"
            onSize={(n) => { setSize(n); setPage(1); }} noun={data.total === 1 ? "company" : "companies"} />
        </Card>
      )}
    </div>
  );
}
