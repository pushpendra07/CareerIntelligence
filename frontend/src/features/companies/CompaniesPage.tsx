import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Card, Empty, ErrorBox, Pagination, SkeletonList, StatusBadge, PageIntro, usePageSize } from "../../components/ui";
import type { Company, Page } from "../../types/api";
import { formatDateTime, humanize } from "../../utils/format";
import { prefs } from "../../utils/storage";
import { ExtraLinkList, portalLabel } from "./ExtraLinks";

export const VERIFICATION = ["DISCOVERED", "RESEARCHED", "VERIFIED", "PARTIALLY_VERIFIED", "NEEDS_REVIEW",
  "INVALID", "STALE", "REJECTED"];

const FILTER_KEYS = ["q", "tier", "verification_status", "india_presence", "job_search_enabled", "hiring_status", "has_jobs",
  "portal", "industry", "company_size", "sort"];

// Filters in the panel behind "Filters" (search, tier, job search and sort are always shown).
const PANEL_KEYS = ["industry", "company_size", "portal", "hiring_status", "verification_status", "india_presence", "has_jobs"];

/** Columns you can hide (Columns menu); ID, the company and its jobs are always shown. */
const COLUMNS: [string, string][] = [["rating", "Rating"], ["size", "Size"], ["tier", "Tier"], ["verification", "Verification"],
  ["india", "India"], ["careers", "Careers"], ["hiring", "Hiring"], ["search", "Search"], ["added", "Added"]];
const DEFAULT_HIDDEN = ["size", "hiring"];
const COLUMNS_KEY = "companies.columns.v1";

function useHiddenColumns(): [Set<string>, (key: string) => void] {
  const [hidden, setHidden] = useState(() => new Set((prefs.get(COLUMNS_KEY) ?? DEFAULT_HIDDEN.join(",")).split(",").filter(Boolean)));
  const toggle = (key: string) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(key)) n.delete(key); else n.add(key);
    prefs.set(COLUMNS_KEY, [...n].join(",") || ",");
    return n;
  });
  return [hidden, toggle];
}

/** Pick which columns the table shows (remembered in this browser). */
function ColumnsMenu({ hidden, onToggle }: { hidden: Set<string>; onToggle: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn-secondary" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Columns{hidden.size ? <span className="text-xs text-slate-500">({COLUMNS.length - hidden.size}/{COLUMNS.length})</span> : null}
      </button>
      {open && (
        <div role="group" aria-label="Columns shown" className="menu-pop absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-surface p-2 shadow-lift">
          {COLUMNS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-white/10">
              <input type="checkbox" checked={!hidden.has(key)} onChange={() => onToggle(key)} />{label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const panelActive = PANEL_KEYS.filter((k) => params.get(k)).length;
  const [showFilters, setShowFilters] = useState(panelActive > 0);
  const [hidden, toggleColumn] = useHiddenColumns();
  const show = (key: string) => !hidden.has(key);
  const filter = (key: string, label: string, options: ReactNode) => (
    <select className="input" aria-label={label} value={params.get(key) ?? ""} onChange={(e) => set(key, e.target.value)}>{options}</select>
  );
  // The company name stays in view while the table scrolls sideways.
  const pin = (selectedRow: boolean) => `sticky left-0 z-[1] ${selectedRow ? "bg-indigo-50" : "bg-surface group-hover:bg-slate-50"}`;
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
      <section className="card space-y-3 p-3!">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input min-w-56 flex-1" placeholder="Search name, domain, alias" aria-label="Search companies" key={params.get("q") ?? ""} defaultValue={params.get("q") ?? ""}
            onKeyDown={(e) => e.key === "Enter" && set("q", e.currentTarget.value)}
            onBlur={(e) => e.target.value !== (params.get("q") ?? "") && set("q", e.target.value)} />
          <select className="input w-auto" aria-label="Tier" value={params.get("tier") ?? ""} onChange={(e) => set("tier", e.target.value)}>
            <option value="">Any tier</option><option value="TIER_A">Tier A</option><option value="TIER_B">Tier B</option><option value="TIER_C">Tier C</option>
          </select>
          <select className="input w-auto" aria-label="Job search" value={params.get("job_search_enabled") ?? ""} onChange={(e) => set("job_search_enabled", e.target.value)}>
            <option value="">Job search: any</option><option value="true">Enabled</option><option value="false">Disabled</option>
          </select>
          <select className="input w-auto" aria-label="Sort companies" value={params.get("sort") ?? "name"} onChange={(e) => set("sort", e.target.value)}>
            <option value="name">Name</option><option value="-jobs">Most jobs</option><option value="-rating">Best rated</option><option value="-id">Company ID (newest first)</option><option value="id">Company ID (oldest first)</option><option value="-verification_score">Verification score</option><option value="tier">Tier</option><option value="-updated_at">Recently updated</option><option value="-created_at">Recently added</option>
          </select>
          <button type="button" aria-expanded={showFilters} aria-controls="company-filters" onClick={() => setShowFilters((v) => !v)}
            className={`btn-secondary gap-1.5 ${showFilters || panelActive ? "border-indigo-300 text-indigo-700" : ""}`}>
            <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M3 4.75A.75.75 0 0 1 3.75 4h12.5a.75.75 0 0 1 .53 1.28L12 10.06v4.19a.75.75 0 0 1-.33.62l-2.5 1.67A.75.75 0 0 1 8 15.92v-5.86L3.22 5.28A.75.75 0 0 1 3 4.75Z" /></svg>
            Filters{panelActive ? <span className="rounded-full bg-indigo-600 px-1.5 text-[11px] font-semibold text-white">{panelActive}</span> : null}
          </button>
          {active > 0 && (
            <button type="button" className="link text-sm" onClick={() => setParams(params.get("sort") ? new URLSearchParams({ sort: params.get("sort")! }) : new URLSearchParams())}>
              Clear {active} filter{active === 1 ? "" : "s"}
            </button>
          )}
        </div>
        {showFilters && (
          <div id="company-filters" className="panel-in grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 md:grid-cols-4 lg:grid-cols-7" aria-label="Filters">
            {filter("industry", "Industry", <><option value="">Any industry</option>
              {facets?.industries.map((f) => <option key={f.value} value={f.value}>{f.value} ({f.count})</option>)}</>)}
            {filter("company_size", "Company size", <><option value="">Any size</option>
              {(facets?.company_sizes ?? []).map((f) => <option key={f.value} value={f.value}>{f.value} employees ({f.count})</option>)}</>)}
            {filter("portal", "Portal link", <><option value="">Portal links: any</option><option value="any">Has a portal link</option>
              {facets?.portals.map((f) => <option key={f.value} value={f.value}>On {portalLabel(f.value)} ({f.count})</option>)}</>)}
            {filter("hiring_status", "Hiring", <><option value="">Hiring: any</option><option value="HIRING">Hiring now</option><option value="NOT_HIRING">Not hiring</option><option value="UNKNOWN">Unknown</option></>)}
            {filter("verification_status", "Verification", <><option value="">Any verification</option>{VERIFICATION.map((v) => <option key={v} value={v}>{v.replace("_", " ").toLowerCase()}</option>)}</>)}
            {filter("india_presence", "India presence", <><option value="">India presence: any</option><option value="true">In India</option><option value="false">Not in India</option></>)}
            {filter("has_jobs", "Jobs in app", <><option value="">Jobs: any</option><option value="true">Has jobs in the app</option><option value="false">No jobs yet</option></>)}
          </div>
        )}
      </section>
      {isLoading && <SkeletonList rows={8} label="Loading companies…" />}
      {error && <ErrorBox error={error} />}
      {data && (
        <Card className="scroll-mt-16" id="companies-list">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">{data.total > 0 && <Pagination position="top" page={page} size={size} total={data.total} onPage={setPage} noun={data.total === 1 ? "company" : "companies"} />}</div>
            <ColumnsMenu hidden={hidden} onToggle={toggleColumn} />
          </div>
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
                  <th className="th sticky left-0 z-[2]">Company</th>
                  <th className="th" title="Jobs for this company in Career Intelligence">{sortHead("Jobs", "jobs")}</th>
                  {show("rating") && <th className="th">{sortHead("Rating", "rating")}</th>}
                  {show("size") && <th className="th">Size</th>}
                  {show("tier") && <th className="th">Tier</th>}
                  {show("verification") && <th className="th">Verification</th>}
                  {show("india") && <th className="th">India</th>}
                  {show("careers") && <th className="th">Careers</th>}
                  {show("hiring") && <th className="th">Hiring</th>}
                  {show("search") && <th className="th">Search</th>}
                  {show("added") && <th className="th">{sortHead("Added", "created_at")}</th>}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {data.items.map((c) => (
                    <tr key={c.id} className={`group ${selected.has(c.id) ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                      <td className="td w-8"><input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                      <td className="td text-xs tabular-nums text-slate-500" title="Company ID">#{c.id}</td>
                      <td className={`td max-w-xs ${pin(selected.has(c.id))}`}>
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
                      {show("rating") && <td className="td text-xs"><Rating value={c.rating} reviews={c.rating_reviews} /></td>}
                      {show("size") && <td className="td whitespace-nowrap text-xs text-slate-600">{c.employee_range ?? "—"}</td>}
                      {show("tier") && <td className="td"><StatusBadge value={c.tier} /></td>}
                      {show("verification") && <td className="td"><StatusBadge value={c.verification_status} /> <span className="text-xs text-slate-500">{c.verification_score}</span></td>}
                      {show("india") && <td className="td text-xs">{c.india_presence === null ? "—" : c.india_presence ? (c.india_locations.join(", ") || "Yes") : "No"}</td>}
                      {show("careers") && <td className="td text-xs">{c.careers_url ? <a className="link" href={c.careers_url} target="_blank" rel="noopener noreferrer">{c.ats_provider ? humanize(c.ats_provider) : "careers"}</a> : "—"}</td>}
                      {show("hiring") && <td className="td"><StatusBadge value={c.hiring_status === "UNKNOWN" ? null : c.hiring_status} /></td>}
                      {show("search") && <td className="td text-xs">{c.job_search_enabled ? "On" : "Off"}</td>}
                      {show("added") && <td className="td whitespace-nowrap text-xs text-slate-500" title="Added to this app">{formatDateTime(c.created_at, true)}</td>}
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
