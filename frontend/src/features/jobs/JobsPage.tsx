import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { Badge, Card, Empty, ErrorBox, JobStatusBadge, Pagination, ScoreBadge, Spinner, PAGE_SIZE, ADDED_VIA, AddedViaTags } from "../../components/ui";
import type { Job, Page } from "../../types/api";
import { DeleteJobButton } from "./DeleteJobButton";
import { StatusMultiSelect } from "./StatusMultiSelect";
import { experienceRange, formatDate, humanize, salaryRange } from "../../utils/format";
import { prefs } from "../../utils/storage";

const FILTERS = ["q", "min_score", "recommendation", "tier", "technology", "location", "work_model",
  "source", "status", "posted_after", "posted_within", "experience", "sort", "stale", "has_application", "added_via", "company_id"] as const;

export const JOB_STATUSES = ["DISCOVERED", "NEW", "REVIEWING", "SHORTLISTED", "READY_TO_APPLY", "APPLIED",
  "RECRUITER_CONTACTED", "SCREENING", "INTERVIEW", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN", "ON_HOLD",
  "CLOSED", "NOT_RELEVANT"];
const RECS = ["HIGHLY_RECOMMENDED", "RECOMMENDED", "CONSIDER", "LOW_PRIORITY", "NOT_RECOMMENDED"];
const SOURCES = ["CAREER_OPS", "LINKEDIN", "NAUKRI", "INDEED", "GLASSDOOR", "GREENHOUSE", "LEVER", "WORKDAY",
  "SMARTRECRUITERS", "SUCCESSFACTORS", "ASHBY", "COMPANY_CAREERS", "REFERRAL", "RECRUITER_EMAIL", "WHATSAPP",
  "TELEGRAM", "DIRECT", "OTHER"];

const OPEN_STATUSES = JOB_STATUSES.filter((s) => s !== "CLOSED");
export const NEW_STATUSES = ["NEW", "DISCOVERED"];
export const PENDING_STATUSES = ["REVIEWING", "SHORTLISTED", "READY_TO_APPLY", "ON_HOLD"];
export const APPLIED_STATUSES = ["APPLIED", "RECRUITER_CONTACTED", "SCREENING", "INTERVIEW"];

/** Status tabs: every job is in exactly one tab (plus "All open"). */
export const JOB_TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: "all", label: "All open", statuses: OPEN_STATUSES },
  { key: "new", label: "New", statuses: NEW_STATUSES },
  { key: "pending", label: "Pending", statuses: PENDING_STATUSES },
  { key: "applied", label: "Applied", statuses: ["APPLIED", "RECRUITER_CONTACTED", "SCREENING"] },
  { key: "interview", label: "Interview", statuses: ["INTERVIEW"] },
  { key: "selected", label: "Selected", statuses: ["OFFER", "ACCEPTED"] },
  { key: "rejected", label: "Rejected", statuses: ["REJECTED"] },
  { key: "not-pursuing", label: "Not pursuing", statuses: ["WITHDRAWN", "NOT_RELEVANT"] },
  { key: "closed", label: "Closed", statuses: ["CLOSED"] },
];
/** Tabs for finished jobs, shown apart from the active ones. */
const ARCHIVE_TABS = ["rejected", "not-pursuing", "closed"];

export const SORT_OPTIONS: [string, string][] = [
  ["-match_score", "Best match first"], ["match_score", "Lowest score"],
  ["-posting_date", "Newest posted"], ["posting_date", "Oldest posted"],
  ["-created_at", "Recently added"], ["title", "Job title A–Z"], ["-title", "Job title Z–A"],
  ["company", "Company A–Z"], ["-company", "Company Z–A"], ["location", "Location A–Z"],
  ["-location", "Location Z–A"], ["experience", "Least experience"], ["-experience", "Most experience"],
  ["-salary", "Highest salary"], ["salary", "Lowest salary"], ["status", "Status (pipeline order)"],
  ["-status", "Status (reverse)"], ["-id", "Job ID (newest first)"], ["id", "Job ID (oldest first)"],
];
const DEFAULT_SORT = "-match_score";

/** Remembered in this browser until the user changes them or presses Reset. */
const SORT_KEY = "jobs.sort.v1";
const VIEW_KEY = "jobs.filters.v1";
/** Not remembered: they belong to one visit (tab, page) or one tab (status). */
const NOT_REMEMBERED = ["tab", "page", "status", "sort"];

const SCORE_CHIPS: [string, string][] = [["", "Any"], ["60", "60+"], ["70", "70+"], ["80", "80+"]];
const WORK_CHIPS: [string, string][] = [["", "Any"], ["REMOTE", "Remote"], ["HYBRID", "Hybrid"], ["ONSITE", "On-site"]];
const POSTED_CHIPS: [string, string][] = [["", "Any time"], ["7", "7 days"], ["14", "14 days"], ["30", "30 days"]];

/** A row of toggle buttons for one filter. */
function Chips({ label, options, value, onChange }: { label: string; options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
        {options.map(([v, text]) => (
          <button key={v || "any"} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
            className={`border-l border-slate-300 px-2.5 py-1 text-xs first:border-l-0 ${value === v ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

type SortProps = { label: string; field: string; first: "asc" | "desc"; sort: string; onSort: (v: string) => void };

/** Click to sort by this column; click again to reverse. */
function SortButton({ label, field, first, sort, onSort }: SortProps) {
  const dir = sort === field ? "asc" : sort === `-${field}` ? "desc" : null;
  const next = dir ? (dir === "asc" ? `-${field}` : field) : first === "asc" ? field : `-${field}`;
  return (
    <button type="button" onClick={() => onSort(next)} title={`Sort by ${label.toLowerCase()}`} aria-label={`Sort by ${label.toLowerCase()}`}
      className={`inline-flex items-center gap-0.5 uppercase tracking-wide hover:text-indigo-700 ${dir ? "text-indigo-700" : ""}`}>
      {label}<span aria-hidden className="text-[10px]">{dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}</span>
    </button>
  );
}

function SortHeader({ extra, ...props }: SortProps & { extra?: ReactNode }) {
  const dir = props.sort === props.field ? "ascending" : props.sort === `-${props.field}` ? "descending" : "none";
  return (
    <th className="th" aria-sort={dir}>
      <span className="inline-flex items-center gap-2"><SortButton {...props} />{extra && <span className="text-slate-300">·</span>}{extra}</span>
    </th>
  );
}

/** Shown only when picked in the Status filter (or in their own tab), like Closed jobs. */
export const HIDDEN_BY_DEFAULT = ["APPLIED", "REJECTED", "NOT_RELEVANT"];

/** The statuses a tab lists when no status is picked. */
export const defaultStatuses = (tab: { key: string; statuses: string[] }) =>
  tab.key === "all" ? tab.statuses.filter((s) => !HIDDEN_BY_DEFAULT.includes(s)) : tab.statuses;

const tabHref = (key: string) => (key === "closed" ? "/jobs/closed" : key === "all" ? "/jobs" : `/jobs?tab=${key}`);

/** Tabs with counts; search and filters (except status) carry over between tabs. */
function StatusTabs({ active, query }: { active: string; query: Record<string, string | string[]> }) {
  const [params] = useSearchParams();
  const shared = Object.fromEntries(Object.entries(query).filter(([k]) => k !== "status"));
  const counts = useQuery({
    queryKey: ["jobs", "status-counts", shared],
    queryFn: () => api.get<Record<string, number>>("/jobs/status-counts", shared),
  }).data;
  const carry = new URLSearchParams(params);
  for (const k of ["status", "page", "tab"]) carry.delete(k);
  const withFilters = (href: string) => {
    const extra = carry.toString();
    return extra ? `${href}${href.includes("?") ? "&" : "?"}${extra}` : href;
  };
  return (
    <div role="tablist" aria-label="Job status" className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {JOB_TABS.map((t) => {
        const on = t.key === active;
        const n = counts ? defaultStatuses(t).reduce((sum, s) => sum + (counts[s] ?? 0), 0) : undefined;
        const archive = ARCHIVE_TABS.includes(t.key);
        return (
          <Link key={t.key} to={withFilters(tabHref(t.key))} role="tab" aria-selected={on}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${t.key === ARCHIVE_TABS[0] ? "ml-auto" : ""} ${on ? "border-indigo-600 text-indigo-700" : `border-transparent ${archive ? "text-slate-400" : "text-slate-500"} hover:text-slate-700`}`}>
            {t.label}{n !== undefined && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${on ? "bg-indigo-50" : "bg-slate-100"}`}>{n}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/** The one thing to do next with a job, right in the list. */
function NextStep({ job }: { job: Job }) {
  const qc = useQueryClient();
  const status = useMutation({
    mutationFn: (s: string) => api.post(`/jobs/${job.id}/status`, { status: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
  if (NEW_STATUSES.includes(job.status)) {
    return (
      <span className="inline-flex gap-1">
        <button className="btn-secondary px-2 py-1 text-xs" disabled={status.isPending} aria-label={`Shortlist ${job.title}`}
          title="Worth applying to" onClick={() => status.mutate("SHORTLISTED")}>★ Shortlist</button>
        <button className="btn-secondary px-2 py-1 text-xs" disabled={status.isPending} aria-label={`Not relevant: ${job.title}`}
          title="Not relevant — hide it" onClick={() => status.mutate("NOT_RELEVANT")}>✕</button>
      </span>
    );
  }
  if (PENDING_STATUSES.includes(job.status)) {
    return <Link className="btn-primary px-2 py-1 text-xs" to={`/jobs/${job.id}?apply=1`} aria-label={`Apply to ${job.title}`}>Apply</Link>;
  }
  if (APPLIED_STATUSES.includes(job.status)) {
    return <Link className="btn-secondary px-2 py-1 text-xs" to={`/jobs/${job.id}#follow-ups`} aria-label={`Follow up on ${job.title}`}>Follow up</Link>;
  }
  return null;
}

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export function JobsPage({ view = "open" }: { view?: "open" | "closed" }) {
  const [params, setParams] = useSearchParams();
  const tabKey = view === "closed" ? "closed" : params.get("tab") ?? "all";
  const tab = JOB_TABS.find((t) => t.key === tabKey) ?? JOB_TABS[0];
  const closed = tab.key === "closed";
  const page = Number(params.get("page") ?? 1);

  // Opening plain /jobs brings back the filters used last time (links with filters win).
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored) return;
    setRestored(true);
    const saved = prefs.get(VIEW_KEY);
    if (!saved || FILTERS.some((f) => f !== "sort" && params.has(f))) return;
    const next = new URLSearchParams(saved);
    for (const k of ["tab"]) if (params.get(k)) next.set(k, params.get(k)!);
    setParams(next, { replace: true });
  }, [restored, params, setParams]);

  const sort = params.get("sort") ?? prefs.get(SORT_KEY) ?? DEFAULT_SORT;
  const query: Record<string, string | string[]> = {};
  for (const f of FILTERS) {
    const values = params.getAll(f).filter(Boolean);
    if (values.length) query[f] = f === "status" ? values : values[0];
  }
  const within = Number(params.get("posted_within") ?? 0);
  delete query.posted_within;
  if (within) query.posted_after = daysAgo(within);
  query.sort = sort;
  // The tab limits the statuses; the Status filter can narrow further inside the tab.
  const picked = params.getAll("status").filter((s) => tab.statuses.includes(s));
  const statuses = picked.length ? picked : defaultStatuses(tab);
  const listQuery = { ...query, status: statuses, closed: String(closed) };
  const { data, isLoading, error } = useQuery({
    queryKey: ["jobs", listQuery, page],
    queryFn: () => api.get<Page<Job>>("/jobs", { ...listQuery, page, size: PAGE_SIZE }),
    enabled: restored,
  });

  /** Apply a change made by the user, and remember it for next time. */
  const update = (next: URLSearchParams) => {
    next.delete("page");
    setParams(next);
    const keep = new URLSearchParams(next);
    for (const k of NOT_REMEMBERED) keep.delete(k);
    prefs.set(VIEW_KEY, keep.toString());
  };
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    update(next);
  };
  const setStatuses = (values: string[]) => {
    const next = new URLSearchParams(params);
    next.delete("status");
    values.forEach((v) => next.append("status", v));
    update(next);
  };
  const sortBy = (value: string) => {
    prefs.set(SORT_KEY, value === DEFAULT_SORT ? null : value);
    set("sort", value === DEFAULT_SORT ? "" : value);
  };
  const reset = () => {
    prefs.set(SORT_KEY, null);
    prefs.set(VIEW_KEY, null);
    setParams(tab.key === "all" || closed ? new URLSearchParams() : new URLSearchParams({ tab: tab.key }));
  };
  const MORE_KEYS = ["recommendation", "tier", "technology", "location", "source", "posted_after", "experience", "has_application", "stale"];
  const moreActive = MORE_KEYS.filter((k) => params.get(k)).length;
  const [showMore, setShowMore] = useState(moreActive > 0);
  const customized = sort !== DEFAULT_SORT || FILTERS.some((f) => f !== "sort" && params.has(f));
  const select = (key: string, options: string[], label: string) => (
    <select className="input" aria-label={label} value={params.get(key) ?? ""} onChange={(e) => set(key, e.target.value)}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
    </select>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1>{tab.key === "all" ? "Jobs" : closed ? "Closed positions" : `${tab.label} jobs`}</h1>
        <Link className="btn-primary" to="/jobs/new">Add Job</Link>
      </div>
      <StatusTabs active={tab.key} query={query} />
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input min-w-56 flex-1" placeholder="Search job title, company or location" aria-label="Search jobs"
            key={params.get("q") ?? ""} defaultValue={params.get("q") ?? ""} onKeyDown={(e) => e.key === "Enter" && set("q", e.currentTarget.value)}
            onBlur={(e) => e.target.value !== (params.get("q") ?? "") && set("q", e.target.value)} />
          {tab.statuses.length > 1 && <div className="w-56"><StatusMultiSelect options={tab.statuses} value={picked} onChange={setStatuses}
            emptyLabel={tab.key === "all" ? "All except applied, rejected, not relevant" : "All statuses"} /></div>}
          <select className="input w-auto" aria-label="Sort" value={sort} onChange={(e) => sortBy(e.target.value)} title="Remembered until you change it or press Reset">
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Chips label="Score" options={SCORE_CHIPS} value={params.get("min_score") ?? ""} onChange={(v) => set("min_score", v)} />
          <Chips label="Work" options={WORK_CHIPS} value={params.get("work_model") ?? ""} onChange={(v) => set("work_model", v)} />
          <Chips label="Posted" options={POSTED_CHIPS} value={params.get("posted_within") ?? ""} onChange={(v) => set("posted_within", v)} />
          <select className="input w-auto py-1 text-xs" aria-label="Added via" value={params.get("added_via") ?? ""} onChange={(e) => set("added_via", e.target.value)}
            title="How the job came into the app">
            <option value="">Added via: any</option>
            {Object.entries(ADDED_VIA).map(([value, t]) => <option key={value} value={value}>Added via: {t.label}</option>)}
          </select>
          <span className="flex-1" />
          <button type="button" className="link text-sm" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
            {showMore ? "Fewer filters" : `More filters${moreActive ? ` (${moreActive})` : ""}`}
          </button>
          {customized && (
            <button type="button" className="link text-sm" title="Clear filters and go back to best match first" onClick={reset}>Reset</button>
          )}
        </div>
        {showMore && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 md:grid-cols-4 lg:grid-cols-5">
            <input className="input" type="number" min={0} max={100} placeholder="Min score (e.g. 75)" aria-label="Min score"
              key={params.get("min_score") ?? ""} defaultValue={params.get("min_score") ?? ""} onBlur={(e) => e.target.value !== (params.get("min_score") ?? "") && set("min_score", e.target.value)} />
            {select("recommendation", RECS, "Any recommendation")}
            {select("tier", ["TIER_A", "TIER_B", "TIER_C"], "Any company tier")}
            <input className="input" placeholder="Technology (e.g. magento2)" aria-label="Technology" defaultValue={params.get("technology") ?? ""}
              onBlur={(e) => set("technology", e.target.value)} />
            <input className="input" placeholder="Location (e.g. Bengaluru)" aria-label="Location" defaultValue={params.get("location") ?? ""}
              onBlur={(e) => set("location", e.target.value)} />
            {select("source", SOURCES, "Any source")}
            <input className="input" type="number" step="0.5" placeholder="Fits my years (e.g. 12)" aria-label="Experience fits"
              defaultValue={params.get("experience") ?? ""} onBlur={(e) => set("experience", e.target.value)} />
            <select className="input" aria-label="Application" value={params.get("has_application") ?? ""} onChange={(e) => set("has_application", e.target.value)}>
              <option value="">Applied or not</option><option value="false">Not applied yet</option><option value="true">Already applied</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-600" title="Scores waiting to be refreshed after a profile change">
              <input type="checkbox" checked={params.get("stale") === "true"} onChange={(e) => set("stale", e.target.checked ? "true" : "")} />
              Scores updating only
            </label>
          </div>
        )}
      </Card>
      {(isLoading || !restored) && <Spinner />}
      {error && <ErrorBox error={error} />}
      {data && (
        <Card>
          {!data.items.length ? <Empty>{closed ? "No closed positions. Set a job's status to Closed when the posting is taken down." : tab.key === "all" ? "No jobs match these filters." : `No ${tab.label.toLowerCase()} jobs match these filters.`}</Empty> : (
            <div className="overflow-x-auto">
              <p className="mb-2 text-xs text-slate-500">{data.total} job{data.total === 1 ? "" : "s"} · score: <span className="text-emerald-600">90+ excellent</span> · <span className="text-sky-600">80+ strong</span> · <span className="text-indigo-600">70+ worth a look</span> · <span className="text-amber-600">60+ weak</span>. <Badge tone="amber">no JD</Badge> = no description, score is a rough guess.</p>
              <table className="min-w-full divide-y divide-slate-100">
                <thead><tr>
                  <SortHeader label="Score" field="match_score" first="desc" sort={sort} onSort={sortBy} />
                  <SortHeader label="Job" field="title" first="asc" sort={sort} onSort={sortBy}
                    extra={<SortButton label="Company" field="company" first="asc" sort={sort} onSort={sortBy} />} />
                  <SortHeader label="Location" field="location" first="asc" sort={sort} onSort={sortBy} />
                  <SortHeader label="Exp" field="experience" first="asc" sort={sort} onSort={sortBy} />
                  <SortHeader label="Salary" field="salary" first="desc" sort={sort} onSort={sortBy} />
                  <SortHeader label="Posted" field="posting_date" first="desc" sort={sort} onSort={sortBy} />
                  <SortHeader label="Status" field="status" first="asc" sort={sort} onSort={sortBy} />
                  <th className="th">Next step</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {data.items.map((j) => (
                    <tr key={j.id} className="hover:bg-slate-50">
                      <td className="td"><ScoreBadge score={j.match_score} stale={j.score_stale} /></td>
                      <td className="td max-w-md">
                        <Link to={`/jobs/${j.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{j.title}</Link>
                        <div className="text-xs text-slate-500">
                          {j.company.name} {j.company.tier && <Badge>{j.company.tier.replace("TIER_", "Tier ")}</Badge>}
                          {j.jd_status !== "OK" && <Badge tone="amber">no JD</Badge>}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
                          <span title="Job ID">#{j.id}</span><AddedViaTags values={j.added_via} />
                        </div>
                      </td>
                      <td className="td text-xs">{j.location ?? "—"}{j.work_model !== "UNKNOWN" && <div className="text-slate-500">{humanize(j.work_model)}</div>}</td>
                      <td className="td text-xs">{experienceRange(j.experience_min, j.experience_max)}</td>
                      <td className="td text-xs">{j.salary_text ?? salaryRange(j.salary_min, j.salary_max, j.salary_currency)}</td>
                      <td className="td text-xs" title={`Added ${formatDate(j.created_at)}`}>{formatDate(j.posting_date)}</td>
                      <td className="td"><JobStatusBadge value={j.status} /></td>
                      <td className="td whitespace-nowrap">
                        <span className="inline-flex items-center gap-2"><NextStep job={j} /><DeleteJobButton jobId={j.id} title={j.title} compact /></span>
                      </td>
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
