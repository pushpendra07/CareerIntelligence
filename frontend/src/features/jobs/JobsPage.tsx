import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, CopyLinkButton, Empty, ErrorBox, JobStatusSummary, Pagination, ScoreBadge, Spinner, ADDED_VIA, AddedViaTags, usePageSize } from "../../components/ui";
import type { Job, Page } from "../../types/api";
import { DeleteJobButton } from "./DeleteJobButton";
import { JobPreview } from "./JobPreview";
import { rememberJobList } from "./JobNav";
import { StatusMultiSelect } from "./StatusMultiSelect";
import { experienceRange, formatDate, formatShortDate, humanize, salaryRange } from "../../utils/format";
import { prefs } from "../../utils/storage";
import { usePhone } from "../../utils/media";
import { ARCHIVE_TABS, JOB_STATUSES, JOB_TABS, JOB_TAB_GROUPS, NEW_STATUSES, PENDING_STATUSES, APPLIED_STATUSES, defaultStatuses, tabHref } from "./jobTabs";
export { JOB_STATUSES, JOB_TABS, NEW_STATUSES, PENDING_STATUSES, APPLIED_STATUSES, HIDDEN_BY_DEFAULT, defaultStatuses } from "./jobTabs";

const FILTERS = ["q", "min_score", "recommendation", "tier", "technology", "location", "work_model",
  "source", "status", "posted_after", "posted_within", "experience", "sort", "stale", "has_application", "added_via", "company_id"] as const;

/** Shown first until there's a history of status changes (most people use these most). */
const DEFAULT_MOST_USED = ["APPLIED", "NOT_RELEVANT", "CLOSED", "REJECTED", "INTERVIEW"];

/**
 * Options for a job-status <select>: the statuses you set most often first ("Most used",
 * from GET /jobs/status-usage), then every status in pipeline order.
 */
export function JobStatusOptions() {
  const usage = useQuery({
    queryKey: ["jobs", "status-usage"], staleTime: 300_000, retry: false,
    queryFn: () => api.get<Record<string, number>>("/jobs/status-usage"),
  }).data;
  const used = Object.keys(usage ?? {}).filter((s) => JOB_STATUSES.includes(s));
  const top = (used.length >= 3 ? used : [...used, ...DEFAULT_MOST_USED.filter((s) => !used.includes(s))]).slice(0, 5);
  return (
    <>
      <optgroup label="Most used">{top.map((s) => <option key={`top-${s}`} value={s}>{humanize(s)}</option>)}</optgroup>
      <optgroup label="All statuses">{JOB_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</optgroup>
    </>
  );
}

const RECS = ["HIGHLY_RECOMMENDED", "RECOMMENDED", "CONSIDER", "LOW_PRIORITY", "NOT_RECOMMENDED"];
const SOURCES = ["CAREER_OPS", "LINKEDIN", "NAUKRI", "INDEED", "GLASSDOOR", "GREENHOUSE", "LEVER", "WORKDAY",
  "SMARTRECRUITERS", "SUCCESSFACTORS", "ASHBY", "COMPANY_CAREERS", "REFERRAL", "RECRUITER_EMAIL", "WHATSAPP",
  "TELEGRAM", "DIRECT", "OTHER"];


export const SORT_OPTIONS: [string, string][] = [
  ["-match_score", "Best match first"], ["match_score", "Lowest score"],
  ["-posting_date", "Newest posted"], ["posting_date", "Oldest posted"],
  ["-created_at", "Recently added"], ["title", "Job title A–Z"], ["-title", "Job title Z–A"],
  ["company", "Company A–Z"], ["-company", "Company Z–A"], ["location", "Location A–Z"],
  ["-location", "Location Z–A"], ["experience", "Least experience"], ["-experience", "Most experience"],
  ["-salary", "Highest salary"], ["salary", "Lowest salary"], ["status", "Status (pipeline order)"],
  ["-status", "Status (reverse)"], ["-id", "Job ID (newest first)"], ["id", "Job ID (oldest first)"],
];
/** Newest jobs first, so jobs that just arrived are at the top. */
const DEFAULT_SORT = "-created_at";

/** Remembered in this browser until the user changes them or presses Reset. */
const SORT_KEY = "jobs.sort.v1";
const VIEW_KEY = "jobs.filters.v1";
/** Not remembered: they belong to one visit (tab, page) or one tab (status). */
const NOT_REMEMBERED = ["tab", "page", "status", "sort", "preview"];

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
            className={`border-l border-slate-300 px-2.5 py-1 text-xs first:border-l-0 ${value === v ? "bg-indigo-600 text-white dark:bg-indigo-500" : "bg-surface text-slate-600 hover:bg-slate-50"}`}>
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

function SortHeader({ extra, extraField, ...props }: SortProps & { extra?: ReactNode; extraField?: string }) {
  // A header with two sort buttons (e.g. Posted · Added) reports whichever one is active.
  const field = extraField && props.sort.replace(/^-/, "") === extraField ? extraField : props.field;
  const dir = props.sort === field ? "ascending" : props.sort === `-${field}` ? "descending" : "none";
  return (
    <th className="th" aria-sort={dir}>
      <span className="inline-flex items-center gap-2"><SortButton {...props} />{extra && <span className="text-slate-300">·</span>}{extra}</span>
    </th>
  );
}

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
  const link = (t: (typeof JOB_TABS)[number]) => {
    const on = t.key === active;
    const n = counts ? defaultStatuses(t).reduce((sum, s) => sum + (counts[s] ?? 0), 0) : undefined;
    return (
      <Link key={t.key} to={withFilters(tabHref(t.key))} role="tab" aria-selected={on}
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${on
          ? "bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_var(--color-indigo-200)]"
          : `${ARCHIVE_TABS.includes(t.key) ? "text-slate-400" : "text-slate-600"} hover:bg-slate-100 hover:text-slate-900`}`}>
        {t.label}{n !== undefined && <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? "bg-white/70 text-indigo-600" : "bg-slate-100 text-slate-500"}`}>{n}</span>}
      </Link>
    );
  };
  // One row, grouped by stage: what's left to review, what's in progress, what's finished.
  return (
    <div role="tablist" aria-label="Job status" className="tabs-scroll card flex items-stretch gap-0 p-1.5!">
      {JOB_TAB_GROUPS.map((g, i) => (
        <div key={g.label} className={`flex shrink-0 flex-col gap-0.5 px-2 ${i ? "border-l border-slate-200" : ""} ${g.label === "Finished" ? "ml-auto" : ""}`}>
          <span aria-hidden className="px-3 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{g.label}</span>
          <div className="flex gap-0.5">{g.keys.map((k) => link(JOB_TABS.find((t) => t.key === k)!))}</div>
        </div>
      ))}
    </div>
  );
}

/** Inside a tab with several statuses: one chip per status with its count (Pending → Reviewing,
 * Shortlisted, Ready to apply, On hold). Picking one shows only that status. */
function StatusChips({ tab, query, picked, onPick }: { tab: { key: string; statuses: string[] };
  query: Record<string, string | string[]>; picked: string[]; onPick: (values: string[]) => void }) {
  const shared = Object.fromEntries(Object.entries(query).filter(([k]) => k !== "status"));
  const counts = useQuery({
    queryKey: ["jobs", "status-counts", shared],
    queryFn: () => api.get<Record<string, number>>("/jobs/status-counts", shared),
  }).data;
  const n = (statuses: string[]) => (counts ? statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0) : undefined);
  const chip = (label: string, on: boolean, count: number | undefined, onClick: () => void) => (
    <button key={label} type="button" aria-pressed={on} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${on
        ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-surface text-slate-600 hover:border-slate-300 hover:text-slate-900"}`}>
      {label}{count !== undefined && <span className={`tabular-nums ${on ? "text-indigo-500" : "text-slate-400"}`}>{count}</span>}
    </button>
  );
  return (
    <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-1.5">
      {chip("All", !picked.length, n(tab.statuses), () => onPick([]))}
      {tab.statuses.map((s) => chip(humanize(s), picked.length === 1 && picked[0] === s, n([s]), () => onPick([s])))}
    </div>
  );
}

/** Less-used actions for a row, behind "⋯": posting link, copy, delete. */
function RowMenu({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const item = "block w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-white/10";
  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" className="btn-secondary px-2 py-1 text-xs" aria-haspopup="menu" aria-expanded={open}
        aria-label={`More actions for ${job.title}`} title="More actions" onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && (
        <span role="menu" className="absolute right-0 top-full z-30 mt-1 flex w-52 flex-col gap-0.5 whitespace-normal rounded-md border border-slate-200 bg-surface p-1 shadow-lg">
          {job.source_url && <a role="menuitem" className={item} href={job.source_url} target="_blank" rel="noopener noreferrer"
            aria-label={`Open posting: ${job.title}`}>Open posting ↗</a>}
          {job.source_url && <CopyLinkButton url={job.source_url} className={`${item} inline-flex items-center gap-1`} />}
          <span className="px-1 py-0.5"><DeleteJobButton jobId={job.id} title={job.title} /></span>
        </span>
      )}
    </span>
  );
}

/** The one thing to do next with a job, right in the list: Closed and Not relevant first, then
 * the step forward. The rest is under "⋯". */
function NextStep({ job }: { job: Job }) {
  const qc = useQueryClient();
  const status = useMutation({
    mutationFn: (s: string) => api.post(`/jobs/${job.id}/status`, { status: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
    meta: { toastError: true },
  });
  // Actions are plain buttons with verbs, so they never look like the status pill above them.
  const b = "btn-secondary whitespace-nowrap px-2 py-0.5 text-xs font-medium";
  const applied = (
    <button className={b} disabled={status.isPending} aria-label={`Applied: ${job.title}`}
      title="Already applied — records the application" onClick={() => status.mutate("APPLIED")}>Mark applied</button>
  );
  const dismiss = <>
    <button className={b} disabled={status.isPending} aria-label={`Closed: ${job.title}`}
      title="The posting is no longer open" onClick={() => status.mutate("CLOSED")}>Mark closed</button>
    <button className={b} disabled={status.isPending} aria-label={`Not relevant: ${job.title}`}
      title="Not a fit — hides it from the open lists" onClick={() => status.mutate("NOT_RELEVANT")}>Not relevant</button>
  </>;
  let main: ReactNode = null;
  if (NEW_STATUSES.includes(job.status)) {
    main = <>
      {dismiss}
      <button className={b} disabled={status.isPending} aria-label={`Shortlist ${job.title}`}
        title="Worth applying to" onClick={() => status.mutate("SHORTLISTED")}>Shortlist</button>
      {applied}
    </>;
  } else if (PENDING_STATUSES.includes(job.status)) {
    main = <>
      {dismiss}
      <Link className="btn-primary whitespace-nowrap px-2 py-0.5 text-xs" to={`/jobs/${job.id}?apply=1`} aria-label={`Apply to ${job.title}`}>Apply</Link>
      {applied}
    </>;
  } else if (APPLIED_STATUSES.includes(job.status)) {
    main = <Link className={b} to={`/jobs/${job.id}#follow-ups`} aria-label={`Follow up on ${job.title}`}>Follow up</Link>;
  }
  return (
    <span className="inline-flex max-w-[15rem] flex-wrap items-center gap-1">
      {main}
      <RowMenu job={job} />
    </span>
  );
}

/** The job's skills under its title: required first, then preferred (lighter), the rest as "+N".
 * With onPick, each skill is a button that filters the list by it (again: clears the filter). */
export function JobSkills({ job, max = 6, active, onPick }: { job: Pick<Job, "required_skills" | "preferred_skills">;
  max?: number; active?: string | null; onPick?: (skill: string) => void }) {
  const all = [...(job.required_skills ?? []).map((s) => ({ s, req: true })),
    ...(job.preferred_skills ?? []).filter((s) => !job.required_skills?.includes(s)).map((s) => ({ s, req: false }))];
  if (!all.length) return null;
  const rest = all.slice(max);
  const isActive = (s: string) => !!active && s.toLowerCase() === active.toLowerCase();
  const look = (s: string, req: boolean) => `rounded-md px-1.5 py-px text-[11px] leading-4 ${isActive(s)
    ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300"
    : req ? "bg-slate-100 text-slate-700" : "border border-dashed border-slate-200 text-slate-500"}`;
  return (
    <ul aria-label="Skills" className="mt-1 flex flex-wrap gap-1">
      {all.slice(0, max).map(({ s, req }) => (
        <li key={s}>
          {onPick
            ? <button type="button" aria-pressed={isActive(s)} onClick={() => onPick(isActive(s) ? "" : s)}
                title={`${req ? "Required" : "Preferred"} · ${isActive(s) ? "click to show all jobs" : `show only jobs with ${s}`}`}
                className={`${look(s, req)} transition hover:bg-indigo-50 hover:text-indigo-700`}>{s}</button>
            : <span title={req ? "Required" : "Preferred"} className={`inline-block ${look(s, req)}`}>{s}</span>}
        </li>
      ))}
      {rest.length > 0 && <li className="px-1 text-[11px] leading-4 text-slate-400" title={rest.map((r) => r.s).join(", ")}>+{rest.length}</li>}
    </ul>
  );
}

/** Phones: one card per job instead of an 11-column table. */
function JobCards({ jobs, selected, toggle, skill, onSkill }: { jobs: Job[]; selected: Set<number>; toggle: (id: number) => void;
  skill: string | null; onSkill: (skill: string) => void }) {
  return (
    <ul className="divide-y divide-slate-100">
      {jobs.map((j) => (
        <li key={j.id} className={`flex gap-3 py-3 ${selected.has(j.id) ? "bg-indigo-50/60" : ""}`}>
          <input type="checkbox" className="mt-1 self-start" aria-label={`Select ${j.title}`} checked={selected.has(j.id)} onChange={() => toggle(j.id)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <Link to={`/jobs/${j.id}`} className="font-medium leading-snug text-slate-800 hover:text-indigo-700">{j.title}</Link>
              <ScoreBadge score={j.match_score} stale={j.score_stale} />
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {j.company.name} {j.company.tier && <Badge>{j.company.tier.replace("TIER_", "Tier ")}</Badge>}
              {j.jd_status !== "OK" && <Badge tone="amber">no JD</Badge>}
            </div>
            <JobSkills job={j} max={4} active={skill} onPick={onSkill} />
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
              <span>{j.location ?? "Location unknown"}{j.work_model !== "UNKNOWN" && ` · ${humanize(j.work_model)}`}</span>
              {(j.experience_min != null || j.experience_max != null) && <span>{experienceRange(j.experience_min, j.experience_max)}</span>}
              {j.salary_text && <span>{j.salary_text}</span>}
              <span className="text-slate-400">posted {formatDate(j.posting_date)} · #{j.id}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <JobStatusSummary status={j.status} since={j.status_changed_at} /><AddedViaTags values={j.added_via} />
            </div>
            <div className="mt-2 border-t border-dashed border-slate-200 pt-2"><NextStep job={j} /></div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Act on the jobs ticked in the list: change their status or delete them. */
function BulkBar({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const run = useMutation({
    mutationFn: (body: { action: "status" | "delete"; status?: string }) =>
      api.post<{ updated?: number; deleted?: number; skipped?: { title: string }[] }>("/jobs/bulk", { job_ids: ids, ...body }),
    onSuccess: (r) => {
      setConfirm(false);
      setMessage(r.deleted !== undefined
        ? `Deleted ${r.deleted} job${r.deleted === 1 ? "" : "s"}.${r.skipped?.length ? ` Kept ${r.skipped.length} with an application — delete those from the job page.` : ""}`
        : `Updated ${r.updated} job${r.updated === 1 ? "" : "s"}.`);
      onDone();
    },
  });
  const set = (status: string) => run.mutate({ action: "status", status });
  if (!ids.length) return message ? <p className="mb-2 rounded bg-emerald-50 p-2 text-sm text-emerald-800" role="status">{message}</p> : null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 p-2 text-sm dark:bg-indigo-950" role="region" aria-label="Selected jobs">
      <b>{ids.length} selected</b>
      <button className="btn-slate px-2 py-1 text-xs" disabled={run.isPending} onClick={() => set("CLOSED")}>Closed</button>
      <button className="btn-rose px-2 py-1 text-xs" disabled={run.isPending} onClick={() => set("NOT_RELEVANT")}>Not relevant</button>
      <button className="btn-amber px-2 py-1 text-xs" disabled={run.isPending} onClick={() => set("SHORTLISTED")}>★ Shortlist</button>
      <select className="input w-auto py-1 text-xs" aria-label="Set status of selected jobs" value="" disabled={run.isPending}
        onChange={(e) => e.target.value && set(e.target.value)}>
        <option value="">Set status…</option>
        <JobStatusOptions />
      </select>
      {confirm ? (
        <span className="flex items-center gap-1 text-xs">
          Delete {ids.length} job{ids.length === 1 ? "" : "s"}? Jobs with an application are kept.
          <button className="rounded bg-rose-600 px-2 py-1 text-white dark:bg-rose-500" disabled={run.isPending} onClick={() => run.mutate({ action: "delete" })}>Delete</button>
          <button className="rounded px-2 py-1 hover:bg-slate-100" onClick={() => setConfirm(false)}>Cancel</button>
        </span>
      ) : <button className="btn-secondary px-2 py-1 text-xs text-rose-700" onClick={() => setConfirm(true)}>Delete…</button>}
      <span className="flex-1" />
      <button className="link text-xs" onClick={onDone}>Clear selection</button>
      {run.error && <ErrorBox error={new Error(errorMessage(run.error))} />}
    </div>
  );
}

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export function JobsPage({ view = "open" }: { view?: "open" | "closed" }) {
  const [params, setParams] = useSearchParams();
  // Plain /jobs opens on New: jobs that just arrived and haven't been decided yet. Setting a
  // status moves a job to its own tab. Links with filters (Today, Insights) search all open jobs.
  const filtered = FILTERS.some((f) => f !== "sort" && params.has(f));
  const tabKey = view === "closed" ? "closed" : params.get("tab") ?? (filtered ? "all" : "new");
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
    if (view !== "closed") next.set("tab", params.get("tab") ?? "new");
    setParams(next, { replace: true });
  }, [restored, params, setParams, view]);

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
  const [size, setSize] = usePageSize("jobs.pageSize.v1");
  const { data, isLoading, error } = useQuery({
    queryKey: ["jobs", listQuery, page, size],
    queryFn: () => api.get<Page<Job>>("/jobs", { ...listQuery, page, size }),
    enabled: restored,
    // Scores marked "updating" are re-scored in the background: poll until they're fresh.
    // Otherwise check now and then for jobs added by scans and imports.
    refetchInterval: (q) => (q.state.data?.items.some((j) => j.score_stale) ? 5000 : 60_000),
  });
  // Ticked jobs; cleared when the page, filters or rows-per-page change.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const phone = usePhone();
  const stickyTop = useHeaderHeight(!phone);
  const sticky = stickyTop !== undefined;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarHeight = useElementHeight(toolbarRef, sticky);
  const headerBottom = (stickyTop ?? 0) + toolbarHeight; // where the column headers stick
  // Column headers stick to the page only when the table fits its card (no inner scroll box);
  // otherwise the table scrolls sideways inside the card, as on small windows.
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const fits = useTableFits(tableWrapRef, sticky && !!data?.items.length);
  const stickyHead = sticky && fits;
  const listKey = JSON.stringify([listQuery, page, size]);
  useEffect(() => setSelected(new Set()), [listKey]);
  // The job page's ← → (and J / K) follow this list.
  const listParams = new URLSearchParams(params);
  listParams.delete("preview");
  const here = `${closed ? "/jobs/closed" : "/jobs"}${listParams.toString() ? `?${listParams}` : ""}`;
  useEffect(() => { if (data) rememberJobList(data.items.map((j) => j.id), here); }, [data, here]);
  // A job opened beside the list; kept in the URL so Back closes it.
  const previewParam = Number(params.get("preview") ?? 0);
  const preview = previewParam || null;
  const setPreview = (id: number | null) => {
    const n = new URLSearchParams(params);
    if (id) n.set("preview", String(id)); else n.delete("preview");
    setParams(n, { replace: preview !== null && id !== null });
  };
  const openPreview = (e: ReactMouseEvent, id: number) => {
    // Links, buttons and checkboxes in the row keep their own job.
    if ((e.target as HTMLElement).closest("a,button,input,select,label") || phone) return;
    setPreview(preview === id ? null : id);
  };
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setPage = (p: number) => {
    const n = new URLSearchParams(params);
    if (p > 1) n.set("page", String(p)); else n.delete("page");
    setParams(n);
  };
  // Filters or a bigger page can leave the page number past the end: go to the last page.
  const lastPage = data ? Math.max(1, Math.ceil(data.total / size)) : 1;
  useEffect(() => {
    if (data && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Apply a change made by the user, and remember it for next time. */
  const update = (next: URLSearchParams) => {
    next.delete("page");
    setParams(next);
    const keep = new URLSearchParams(next);
    for (const k of NOT_REMEMBERED) keep.delete(k);
    prefs.set(VIEW_KEY, keep.toString());
  };
  const set = (key: string, value: string) => {
    // Leaving a filter box unchanged (e.g. clicking a blank area) must not reset the page or
    // clear the ticked jobs.
    if ((params.get(key) ?? "") === value.trim()) return;
    const next = new URLSearchParams(params);
    if (value.trim()) next.set(key, value.trim()); else next.delete(key);
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
    setParams(closed ? new URLSearchParams() : new URLSearchParams({ tab: tab.key }));
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
        <h1>{tab.key === "all" ? "All open jobs" : closed ? "Closed positions" : `${tab.label} jobs`}</h1>
        <div className="flex items-center gap-2">
          <DuplicatesLink />
          <Link className="btn-primary sm:hidden" to="/jobs/new">Add Job</Link>
        </div>
      </div>
      <StatusTabs active={tab.key} query={query} />
      {tab.key !== "all" && tab.statuses.length > 1 && <StatusChips tab={tab} query={query} picked={picked} onPick={setStatuses} />}
      {/* Like Magento's admin grid: search, sort, paging and bulk actions stay under the top bar
          while the list scrolls; the filter panel below scrolls away (not on phones). */}
      <div ref={toolbarRef} data-testid="jobs-toolbar" style={sticky ? { top: stickyTop } : undefined}
        className={sticky ? "sticky z-20 -mx-2 bg-page/85 px-2 py-1 backdrop-blur-md" : ""}>
      <section className="card space-y-2 p-3!">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input min-w-56 flex-1" placeholder="Search title, company, location or job ID (#123)" aria-label="Search jobs"
            key={params.get("q") ?? ""} defaultValue={params.get("q") ?? ""} onKeyDown={(e) => e.key === "Enter" && set("q", e.currentTarget.value)}
            onBlur={(e) => e.target.value !== (params.get("q") ?? "") && set("q", e.target.value)} />
          {tab.key === "all" && <div className="w-56"><StatusMultiSelect options={tab.statuses} value={picked} onChange={setStatuses}
            emptyLabel="All except applied, rejected, not relevant" /></div>}
          <select className="input w-auto" aria-label="Sort" value={sort} onChange={(e) => sortBy(e.target.value)} title="Remembered until you change it or press Reset">
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {data && data.total > 0 && <Pagination position="top" page={page} size={size} total={data.total} onPage={setPage} noun={data.total === 1 ? "job" : "jobs"} />}
        {data && data.items.length > 0 && <BulkBar ids={[...selected]} onDone={() => setSelected(new Set())} />}
      </section>
      </div>
      <Card>
        <QuickViews params={params} onApply={(view) => {
          const next = new URLSearchParams(tab.key === "all" || closed ? "" : `tab=${tab.key}`);
          if (params.get("sort")) next.set("sort", params.get("sort")!);
          for (const [k, v] of Object.entries(view)) next.set(k, v);
          update(next);
        }} />
        <ActiveFilters params={params} tab={tab} onRemove={(key, value) => {
          if (key === "status") setStatuses(picked.filter((x) => x !== value)); else set(key, "");
        }} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
        <section id="jobs-list" className="card" style={{ scrollMarginTop: sticky ? headerBottom + 8 : 64 }}>
          {!data.items.length ? <Empty>{closed ? "No closed positions. Set a job's status to Closed when the posting is taken down." : tab.key === "all" ? "No jobs match these filters." : `No ${tab.label.toLowerCase()} jobs match these filters.`}</Empty> : (<>
            {/* Wide screens: no inner scroll box, so the column headers can stick to the page. */}
            <div ref={tableWrapRef} className={stickyHead ? "" : "overflow-x-auto"}>
              {phone ? <JobCards jobs={data.items} selected={selected} toggle={toggle} skill={params.get("technology")} onSkill={(v) => set("technology", v)} /> : <>
              <p className="mb-2 text-xs text-slate-500"><b>Click a row</b> to preview it here (↑ ↓ move, Esc closes) · <b>Posted</b> = on the job site, <b>Added</b> = to this app · score: <span className="text-emerald-600">90+ excellent</span> · <span className="text-sky-600">80+ strong</span> · <span className="text-indigo-600">70+ worth a look</span> · <span className="text-amber-600">60+ weak</span>. <Badge tone="amber">no JD</Badge> = no description, score is a rough guess.</p>
              <table className="min-w-full divide-y divide-slate-100 [&_td]:px-2 [&_th]:px-2">
                <thead className={stickyHead ? "sticky z-10" : ""} style={stickyHead ? { top: headerBottom } : undefined}><tr>
                  <th className="th w-8">
                    <input type="checkbox" aria-label="Select all jobs on this page"
                      checked={data.items.length > 0 && data.items.every((j) => selected.has(j.id))}
                      ref={(el) => { if (el) el.indeterminate = selected.size > 0 && !data.items.every((j) => selected.has(j.id)); }}
                      onChange={(e) => setSelected(e.target.checked ? new Set(data.items.map((j) => j.id)) : new Set())} />
                  </th>
                  <SortHeader label="ID" field="id" first="desc" sort={sort} onSort={sortBy} />
                  <SortHeader label="Score" field="match_score" first="desc" sort={sort} onSort={sortBy} />
                  <SortHeader label="Job" field="title" first="asc" sort={sort} onSort={sortBy}
                    extraField="company" extra={<SortButton label="Company" field="company" first="asc" sort={sort} onSort={sortBy} />} />
                  <SortHeader label="Location" field="location" first="asc" sort={sort} onSort={sortBy} />
                  <SortHeader label="Exp" field="experience" first="asc" sort={sort} onSort={sortBy}
                    extraField="salary" extra={<SortButton label="Salary" field="salary" first="desc" sort={sort} onSort={sortBy} />} />
                  <SortHeader label="Posted" field="posting_date" first="desc" sort={sort} onSort={sortBy}
                    extraField="created_at" extra={<SortButton label="Added" field="created_at" first="desc" sort={sort} onSort={sortBy} />} />
                  <SortHeader label="Status" field="status" first="asc" sort={sort} onSort={sortBy}
                    extra={<span className="font-medium uppercase tracking-wide">Next step</span>} />
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {data.items.map((j) => (
                    <tr key={j.id} onClick={(e) => openPreview(e, j.id)}
                      className={`cursor-pointer ${preview === j.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-300" : selected.has(j.id) ? "bg-indigo-50/60" : "row-hover hover:bg-slate-50"}`}>
                      <td className="td w-8"><input type="checkbox" aria-label={`Select ${j.title}`} checked={selected.has(j.id)} onChange={() => toggle(j.id)} /></td>
                      <td className="td text-xs tabular-nums text-slate-500"><Link to={`/jobs/${j.id}`} className="hover:text-indigo-700" title="Job ID">#{j.id}</Link></td>
                      <td className="td"><ScoreBadge score={j.match_score} stale={j.score_stale} /></td>
                      <td className="td min-w-56 max-w-md [overflow-wrap:anywhere]">
                        <Link to={`/jobs/${j.id}`} className="line-clamp-2 font-medium text-slate-800 hover:text-indigo-700" title={j.title}>{j.title}</Link>
                        <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                          <span>{j.company.name}</span> {j.company.tier && <Badge>{j.company.tier.replace("TIER_", "Tier ")}</Badge>}
                          {j.jd_status !== "OK" && <Badge tone="amber">no JD</Badge>}
                          <AddedViaTags values={j.added_via} />
                        </div>
                      </td>
                        <JobSkills job={j} active={params.get("technology")} onPick={(v) => set("technology", v)} />
                      <td className="td max-w-32 text-xs" title={[j.location, j.work_model !== "UNKNOWN" ? humanize(j.work_model) : ""].filter(Boolean).join(" · ")}>
                        <div className="truncate">{j.location ?? "—"}</div>
                        {j.work_model !== "UNKNOWN" && <div className="text-slate-500">{humanize(j.work_model)}</div>}
                      </td>
                      <td className="td max-w-32 text-xs" title={j.salary_text ?? undefined}>
                        <div className="whitespace-nowrap">{experienceRange(j.experience_min, j.experience_max)}</div>
                        <div className="truncate text-slate-500">{j.salary_text ?? salaryRange(j.salary_min, j.salary_max, j.salary_currency)}</div>
                      </td>
                      <td className="td whitespace-nowrap text-xs">
                        <div title={`Posted on the job site: ${formatDate(j.posting_date)}`}>{formatShortDate(j.posting_date)}</div>
                        <div className="text-slate-500" title={`Added to this app: ${formatDate(j.created_at)}`}>added {formatShortDate(j.created_at)}</div>
                      </td>
                      <td className="td min-w-[15rem]">
                        <JobStatusSummary status={j.status} since={j.status_changed_at} />
                        <div className="mt-1.5 border-t border-dashed border-slate-200 pt-1.5"><NextStep job={j} /></div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </>}
            </div>
          </>)}
          <Pagination page={page} size={size} total={data.total} onPage={setPage} scrollTo="jobs-list"
            onSize={(n) => { setSize(n); setPage(1); }} noun={data.total === 1 ? "job" : "jobs"} />
        </section>
      )}
      {preview !== null && !phone && data && (
        <JobPreview id={preview} ids={data.items.map((j) => j.id)} top={stickyTop ?? 0}
          onOpen={setPreview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

/** One-click views: each sets a few filters at once (the tab and sort stay). */
const QUICK_VIEWS: { label: string; title: string; view: Record<string, string> }[] = [
  { label: "Top matches", title: "Score 80 or more", view: { min_score: "80" } },
  { label: "Fresh this week", title: "Posted in the last 7 days", view: { posted_within: "7" } },
  { label: "Not applied, 70+", title: "Score 70+ and no application yet", view: { min_score: "70", has_application: "false" } },
  { label: "Remote 70+", title: "Remote jobs scoring 70+", view: { work_model: "REMOTE", min_score: "70" } },
];

function QuickViews({ params, onApply }: { params: URLSearchParams; onApply: (view: Record<string, string>) => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick views">
      <span className="text-xs font-medium text-slate-500">Quick views</span>
      {QUICK_VIEWS.map((q) => {
        const on = Object.entries(q.view).every(([k, v]) => params.get(k) === v);
        return (
          <button key={q.label} type="button" title={q.title} aria-pressed={on} onClick={() => onApply(q.view)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-700"}`}>
            {q.label}
          </button>
        );
      })}
    </div>
  );
}

/** Each active filter as a chip; × removes just that one. */
function ActiveFilters({ params, tab, onRemove }: {
  params: URLSearchParams; tab: { statuses: string[] }; onRemove: (key: string, value: string) => void;
}) {
  const label = (k: string, v: string): string | null => {
    switch (k) {
      case "q": return `“${v}”`;
      case "min_score": return `Score ${v}+`;
      case "posted_within": return `Posted ≤ ${v} days`;
      case "posted_after": return `Posted after ${formatDate(v)}`;
      case "experience": return `Fits ${v} yrs`;
      case "stale": return "Scores updating";
      case "has_application": return v === "true" ? "Already applied" : "Not applied yet";
      case "added_via": return `Added via ${ADDED_VIA[v]?.label ?? v}`;
      case "company_id": return `Company #${v}`;
      case "technology": case "location": return `${humanize(k)}: ${v}`;
      case "recommendation": case "tier": case "work_model": case "source": return humanize(v);
      default: return null;
    }
  };
  const chips: [string, string, string][] = [];
  for (const k of FILTERS) {
    if (k === "sort") continue;
    for (const v of params.getAll(k).filter(Boolean)) {
      if (k === "status") { if (tab.statuses.includes(v)) chips.push([k, v, humanize(v)]); continue; }
      const text = label(k, v);
      if (text) chips.push([k, v, text]);
    }
  }
  if (!chips.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      <span className="text-xs font-medium text-slate-500">Filtered by</span>
      {chips.map(([k, v, text]) => (
        <span key={`${k}=${v}`} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-0.5 pl-2.5 pr-1 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
          {text}
          <button type="button" className="rounded-full px-1 hover:bg-indigo-100 dark:hover:bg-indigo-900" aria-label={`Remove filter ${text}`} onClick={() => onRemove(k, v)}>×</button>
        </span>
      ))}
    </div>
  );
}

/** "3 duplicates" next to the title when jobs were saved more than once; opens the merge page. */
function DuplicatesLink() {
  const dups = useQuery({
    queryKey: ["jobs", "duplicates"],
    queryFn: () => api.get<{ extra_jobs: number }>("/jobs/duplicates"),
    retry: false,
  });
  const n = dups.data?.extra_jobs ?? 0;
  if (!n) return null;
  return (
    <Link className="btn-secondary px-2.5 py-1 text-xs" to="/jobs/duplicates" title="The same job saved more than once — review and merge">
      {n} duplicate{n === 1 ? "" : "s"}
    </Link>
  );
}

/** Height of the app's sticky top bar, so content can stick right under it; undefined when off. */
function useHeaderHeight(enabled: boolean): number | undefined {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const header = document.querySelector("header");
    if (!enabled || !header || typeof ResizeObserver === "undefined") { setHeight(undefined); return; }
    const update = () => setHeight(Math.round(header.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, [enabled]);
  return height;
}

/** Current height of an element (follows resizes); 0 when off or not measurable. */
function useElementHeight(ref: RefObject<HTMLElement | null>, enabled: boolean): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === "undefined") { setHeight(0); return; }
    const update = () => setHeight(Math.round(el.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return height;
}

/** Whether the table inside `ref` is no wider than its container (follows resizes). */
function useTableFits(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const wrap = ref.current;
    const table = wrap?.querySelector("table");
    if (!enabled || !wrap || !table || typeof ResizeObserver === "undefined") return;
    const update = () => setFits(table.scrollWidth <= wrap.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    observer.observe(table);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return fits;
}
