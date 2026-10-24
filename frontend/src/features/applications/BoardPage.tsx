import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { ErrorBox, PageIntro, Pagination, ScoreBadge, Spinner, usePageSize } from "../../components/ui";
import { prefs } from "../../utils/storage";
import type { Application, Page } from "../../types/api";
import { formatDate, humanize } from "../../utils/format";
import { APP_STATUSES, followUpDue } from "./ApplicationsPage";

/** The pipeline stages, in order. */
export const BOARD_COLUMNS: { status: string; label: string; dot: string }[] = [
  { status: "APPLIED", label: "Applied", dot: "bg-[#3b82f6]" },
  { status: "RECRUITER_CONTACTED", label: "Recruiter contacted", dot: "bg-[#14b8a6]" },
  { status: "SCREENING", label: "Screening", dot: "bg-[#f59e0b]" },
  { status: "INTERVIEW", label: "Interview", dot: "bg-[#f97316]" },
  { status: "AWAITING_FEEDBACK", label: "Interview done – no reply", dot: "bg-[#d946ef]" },
  { status: "OFFER", label: "Offer", dot: "bg-[#84cc16]" },
  { status: "ACCEPTED", label: "Accepted", dot: "bg-[#10b981]" },
  { status: "REJECTED", label: "Rejected", dot: "bg-[#f43f5e]" },
];
/** "Next stage" for the one-click button in a row. */
const NEXT: Record<string, string> = {
  APPLIED: "RECRUITER_CONTACTED", RECRUITER_CONTACTED: "SCREENING", SCREENING: "INTERVIEW",
  INTERVIEW: "AWAITING_FEEDBACK", AWAITING_FEEDBACK: "OFFER", OFFER: "ACCEPTED",
};
const LABEL = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.status, c.label]));
const SHORT: Record<string, string> = { ...LABEL, RECRUITER_CONTACTED: "Replied", AWAITING_FEEDBACK: "No reply yet" };
/** How far an application got (its current status or any earlier one): for the funnel. */
const RANK: Record<string, number> = { APPLIED: 0, RECRUITER_CONTACTED: 1, SCREENING: 1, INTERVIEW: 2, AWAITING_FEEDBACK: 2, OFFER: 3, ACCEPTED: 3 };
const FINISHED = ["ACCEPTED", "REJECTED", "WITHDRAWN", "CLOSED"];

/** Stage tabs, grouped like the Jobs page: "open" = every unfinished application. */
export const STAGE_GROUPS: { label: string; tabs: { key: string; label: string; statuses: string[] }[] }[] = [
  { label: "Everything", tabs: [
    { key: "open", label: "All open", statuses: APP_STATUSES.filter((s) => !FINISHED.includes(s)) },
    { key: "all", label: "All", statuses: APP_STATUSES }] },
  { label: "Waiting", tabs: ["APPLIED", "RECRUITER_CONTACTED", "SCREENING", "ON_HOLD"].map((s) => ({ key: s, label: LABEL[s] ?? humanize(s), statuses: [s] })) },
  { label: "Interviews", tabs: ["INTERVIEW", "AWAITING_FEEDBACK"].map((s) => ({ key: s, label: LABEL[s]!, statuses: [s] })) },
  { label: "Offers", tabs: ["OFFER", "ACCEPTED"].map((s) => ({ key: s, label: LABEL[s]!, statuses: [s] })) },
  { label: "Finished", tabs: ["REJECTED", "WITHDRAWN", "CLOSED"].map((s) => ({ key: s, label: LABEL[s] ?? humanize(s), statuses: [s] })) },
];
const STAGE_TABS = STAGE_GROUPS.flatMap((g) => g.tabs);
const QUIET_DAYS = 14;

const today = () => new Date(new Date().toDateString());
const daysSince = (iso: string) => Math.floor((today().getTime() - new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).getTime()) / 86_400_000);

type BoardApp = Application & { updated_at?: string };

/** Every application (the pipeline shows them all, not a page). */
async function allApplications(): Promise<BoardApp[]> {
  const out: BoardApp[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await api.get<Page<BoardApp>>("/applications", { page, size: 200 });
    out.push(...r.items);
    if (out.length >= r.total || !r.items.length) break;
  }
  return out;
}

const AVATARS = ["bg-indigo-100 text-indigo-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700", "bg-violet-100 text-violet-700", "bg-teal-100 text-teal-700"];
function CompanyAvatar({ name }: { name: string }) {
  const letters = name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${AVATARS[h % AVATARS.length]}`}>{letters}</span>;
}

const reached = (a: BoardApp) => Math.max(RANK[a.status] ?? -1, ...(a.events ?? []).map((e) => RANK[e.to_status ?? ""] ?? -1));

function attention(a: BoardApp): "late" | "quiet" | null {
  if (FINISHED.includes(a.status)) return null;
  if (followUpDue(a) && daysSince(followUpDue(a)!) >= 0) return "late";
  if (a.updated_at && daysSince(a.updated_at) >= QUIET_DAYS) return "quiet";
  return null;
}

/** Status colour dot for any application status (stopped ones are grey). */
const dotFor = (status: string) => BOARD_COLUMNS.find((c) => c.status === status)?.dot ?? "bg-slate-400";

function AppRow({ app, onMove, busy, selected, onSelect }: {
  app: BoardApp; onMove: (status: string) => void; busy: boolean; selected: boolean; onSelect: (on: boolean) => void;
}) {
  const open = !FINISHED.includes(app.status);
  const applied = daysSince(app.applied_on);
  const followDue = open && followUpDue(app) ? daysSince(followUpDue(app)!) : null;
  const quiet = open && app.updated_at ? daysSince(app.updated_at) >= QUIET_DAYS : false;
  const flag = attention(app);
  const next = NEXT[app.status];
  const updated = app.updated_at ? daysSince(app.updated_at) : null;
  return (
    <tr className={`hover:bg-slate-50 ${selected ? "bg-indigo-50/60" : ""} ${busy ? "opacity-80" : ""}`} aria-label={`${app.job_title} at ${app.company_name}`}>
      <td className={`td w-8 border-l-4 ${flag === "late" ? "border-l-[#f43f5e]" : flag === "quiet" ? "border-l-[#f59e0b]" : "border-l-transparent"}`}>
        <input type="checkbox" checked={selected} aria-label={`Select ${app.job_title}`} onChange={(e) => onSelect(e.target.checked)} />
      </td>
      <td className="td min-w-56">
        <div className="flex items-start gap-2.5">
          <CompanyAvatar name={app.company_name} />
          <div className="min-w-0">
            <Link className="block font-semibold leading-snug text-slate-800 hover:text-indigo-700" to={`/applications/${app.id}`}>{app.job_title}</Link>
            <div className="truncate text-xs text-slate-500">{app.company_name} · <Link className="hover:text-indigo-700" to={`/jobs/${app.job_id}`}>job</Link></div>
          </div>
        </div>
      </td>
      <td className="td">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotFor(app.status)}`} />
          <select className="rounded-lg border border-slate-200 bg-surface px-1.5 py-1 text-xs text-slate-700" aria-label={`Status of ${app.job_title}`}
            value={app.status} disabled={busy} onChange={(e) => e.target.value !== app.status && onMove(e.target.value)}>
            {APP_STATUSES.map((st) => <option key={st} value={st}>{LABEL[st] ?? humanize(st)}</option>)}
          </select>
        </div>
      </td>
      <td className="td">
        {next ? (
          <button type="button" disabled={busy} onClick={() => onMove(next)} title={`Move to ${LABEL[next]}`}
            className="whitespace-nowrap rounded-lg bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100">
            {SHORT[next]} →
          </button>
        ) : <span className="text-xs text-slate-400">—</span>}
      </td>
      <td className="td whitespace-nowrap text-xs text-slate-600"
        title={app.origin === "auto" ? "Recorded automatically when the job was marked Applied — open it to set the real date" : formatDate(app.applied_on)}>
        {applied <= 0 ? "Today" : applied === 1 ? "Yesterday" : `${applied} days ago`}
        {app.origin === "auto" && <span className="block text-amber-700">date approximate</span>}
      </td>
      <td className="td whitespace-nowrap text-xs">
        {followDue === null ? <span className="text-slate-400">—</span> : (
          <Link to="/followups" className={followDue >= 0 ? "font-semibold text-rose-600" : "text-slate-600 hover:text-indigo-700"}>
            {followDue > 0 ? `${followDue} day${followDue === 1 ? "" : "s"} late` : followDue === 0 ? "Today" : formatDate(followUpDue(app))}
          </Link>
        )}
      </td>
      <td className="td whitespace-nowrap text-xs text-slate-600">
        {updated === null ? "—" : updated <= 0 ? "Today" : `${updated} days ago`}
        {quiet && <span className="block text-amber-700">No update in {QUIET_DAYS}+ days</span>}
      </td>
      <td className="td"><ScoreBadge score={app.match_score} /></td>
    </tr>
  );
}

type Sort = "recent" | "score" | "oldest";
const SORTS: Record<Sort, { label: string; cmp: (a: BoardApp, b: BoardApp) => number }> = {
  recent: { label: "Newest first", cmp: (a, b) => b.applied_on.localeCompare(a.applied_on) },
  score: { label: "Best match first", cmp: (a, b) => (b.match_score ?? -1) - (a.match_score ?? -1) },
  oldest: { label: "Waiting longest", cmp: (a, b) => (a.updated_at ?? a.applied_on).localeCompare(b.updated_at ?? b.applied_on) },
};
const VIEW_KEY = "board.view.v1";
/** stage: the stage tab shown (a STAGE_TABS key). */
type View = { sort: Sort; attention: boolean; stage: string };
const DEFAULT_VIEW: View = { sort: "recent", attention: false, stage: "open" };
const loadView = (): View => {
  try { return { ...DEFAULT_VIEW, ...JSON.parse(prefs.get(VIEW_KEY) ?? "{}") }; } catch { return DEFAULT_VIEW; }
};

function Funnel({ apps, onAttention }: { apps: BoardApp[]; onAttention: () => void }) {
  const total = apps.length;
  const r = apps.map(reached);
  const steps = [
    { label: "Applied", n: total, hint: "every application" },
    { label: "Got a reply", n: r.filter((x) => x >= 1).length, hint: "recruiter contact, screening or further" },
    { label: "Interviewed", n: r.filter((x) => x >= 2).length, hint: "reached an interview" },
    { label: "Offers", n: r.filter((x) => x >= 3).length, hint: "offer or accepted" },
  ];
  const late = apps.filter((a) => attention(a) === "late").length;
  const quiet = apps.filter((a) => attention(a) === "quiet").length;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Pipeline summary">
      {steps.map((s, i) => (
        <div key={s.label} className="card p-4" title={s.hint}>
          <div className="text-xs font-medium text-slate-500">{s.label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold tabular-nums text-slate-900">{s.n}</span>
            {i > 0 && <span className="text-xs font-semibold text-indigo-600">{total ? Math.round((s.n / total) * 100) : 0}%</span>}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#a855f7]" style={{ width: `${total ? Math.max(3, (s.n / total) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
      <button type="button" onClick={onAttention} className="card lift col-span-2 p-4 text-left md:col-span-1" disabled={!late && !quiet}>
        <div className="text-xs font-medium text-slate-500">Needs attention</div>
        <div className="mt-1 font-display text-2xl font-bold tabular-nums text-rose-600">{late + quiet}</div>
        <div className="mt-1 text-xs text-slate-500">{late} follow-up{late === 1 ? "" : "s"} due · {quiet} quiet {QUIET_DAYS}+ days</div>
      </button>
    </div>
  );
}

/** Stage tabs grouped like the Jobs page's status tabs, each with its count. */
function StageTabs({ active, apps, onPick }: { active: string; apps: BoardApp[]; onPick: (key: string) => void }) {
  const tab = (t: (typeof STAGE_TABS)[number]) => {
    const on = t.key === active;
    const n = apps.filter((a) => t.statuses.includes(a.status)).length;
    return (
      <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onPick(t.key)}
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${on
          ? "bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_var(--color-indigo-200)]"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
        {t.statuses.length === 1 && <span aria-hidden className={`h-2 w-2 rounded-full ${dotFor(t.statuses[0]!)}`} />}
        {t.label}<span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>{n}</span>
      </button>
    );
  };
  return (
    <div role="tablist" aria-label="Application stage" className="tabs-scroll card flex items-stretch gap-0 p-1.5!">
      {STAGE_GROUPS.map((g, i) => (
        <div key={g.label} className={`flex shrink-0 flex-col gap-0.5 px-2 ${i ? "border-l border-slate-200" : ""} ${g.label === "Finished" ? "ml-auto" : ""}`}>
          <span aria-hidden className="px-3 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{g.label}</span>
          <div className="flex gap-0.5">{g.tabs.map(tab)}</div>
        </div>
      ))}
    </div>
  );
}

/** Every application in one list: stage tabs, a status menu in each row, several at once, pages. */
export function BoardPage() {
  const list = useQuery({ queryKey: ["applications", "board"], queryFn: allApplications });
  const [q, setQ] = useState("");
  const [view, setViewState] = useState<View>(loadView);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize("pipeline.pageSize.v1");
  const setView = (v: Partial<View>) => {
    setPage(1);
    setViewState((old) => { const n = { ...old, ...v }; prefs.set(VIEW_KEY, JSON.stringify(n)); return n; });
  };
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  // Shown right away while the server saves; replaced by the refreshed list.
  const [moved, setMoved] = useState<Record<number, string>>({});
  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/applications/${id}/status`, { status, note: "Updated on the pipeline" }),
    onMutate: ({ id, status }) => setMoved((m) => ({ ...m, [id]: status })),
    onSettled: (_d, _e, { id }) => setMoved((m) => { const n = { ...m }; delete n[id]; return n; }),
    meta: { success: "Status updated" },
  });
  const bulk = useMutation({
    mutationFn: async ({ ids, status }: { ids: number[]; status: string }) => {
      for (const id of ids) await api.post(`/applications/${id}/status`, { status, note: "Updated on the pipeline" });
      return ids.length;
    },
    onSuccess: () => { setSelected(new Set()); setBulkStatus(""); },
    meta: { success: "Statuses updated", toastError: true },
  });
  if (list.isLoading) return <Spinner />;
  if (list.error) return <ErrorBox error={list.error} />;
  const needle = q.trim().toLowerCase();
  const all = (list.data ?? []).map((a) => (moved[a.id] ? { ...a, status: moved[a.id] } : a));
  const matching = all
    .filter((a) => !needle || `${a.job_title} ${a.company_name}`.toLowerCase().includes(needle))
    .filter((a) => !view.attention || attention(a) !== null);
  const stage = STAGE_TABS.find((t) => t.key === view.stage) ?? STAGE_TABS[0]!;
  const rows = matching.filter((a) => stage.statuses.includes(a.status)).sort(SORTS[view.sort].cmp);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * size, current * size);
  const open = matching.filter((a) => !FINISHED.includes(a.status));
  const picked = rows.filter((a) => selected.has(a.id)).map((a) => a.id);
  const allPicked = shown.length > 0 && shown.every((a) => selected.has(a.id));
  const select = (id: number, on: boolean) => setSelected((old) => { const n = new Set(old); if (on) n.add(id); else n.delete(id); return n; });
  const busy = move.isPending || bulk.isPending;
  const noun = rows.length === 1 ? "application" : "applications";

  return (
    <div className="space-y-5">
      <div><h1>Pipeline</h1><PageIntro>Every application and where it stands. Change a status in its row (or <b>Next stage →</b>), or tick several and change them together; follow-ups and the job's status update with it.</PageIntro></div>
      {!!list.data?.length && <Funnel apps={all} onAttention={() => setView({ attention: true })} />}
      {!!list.data?.length && <StageTabs active={stage.key} apps={matching} onPick={(key) => { setView({ stage: key }); setSelected(new Set()); }} />}
      <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
        <input className="input w-full sm:w-64" placeholder="Search job or company" aria-label="Search applications" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input w-auto" aria-label="Sort applications" value={view.sort} onChange={(e) => setView({ sort: e.target.value as Sort })}>
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 ring-1 ring-inset ${view.attention ? "bg-rose-50 text-rose-700 ring-rose-200" : "text-slate-600 ring-slate-200"}`}>
          <input type="checkbox" checked={view.attention} onChange={(e) => setView({ attention: e.target.checked })} />Needs attention only
        </label>
        <span className="text-slate-600"><b data-testid="open-count">{open.length}</b> open · <b>{matching.length - open.length}</b> finished</span>
      </div>
      {(move.error || bulk.error) && <ErrorBox error={new Error(errorMessage(move.error ?? bulk.error))} />}
      {!list.data?.length ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No applications yet. Open a job and click <b>Apply</b> — or mark it Applied — and it appears here.
        </p>
      ) : (
        <section id="pipeline-list" className="card scroll-mt-16 overflow-hidden p-3">
          {rows.length > 0 && <Pagination position="top" page={current} size={size} total={rows.length} onPage={setPage} noun={noun} />}
          {picked.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50/60 px-3 py-2 text-sm" aria-label="Change selected">
              <b>{picked.length} selected</b>
              <select className="input w-auto py-1 text-xs" aria-label="New status for selected" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                <option value="">Set status to…</option>
                {APP_STATUSES.map((st) => <option key={st} value={st}>{LABEL[st] ?? humanize(st)}</option>)}
              </select>
              <button className="btn-primary px-3 py-1 text-xs" disabled={!bulkStatus || busy} onClick={() => bulk.mutate({ ids: picked, status: bulkStatus })}>
                {bulk.isPending ? "Updating…" : "Update"}
              </button>
              <button className="link text-xs" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
          {!rows.length ? <p className="p-6 text-center text-sm text-slate-500">No applications here.</p> : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead><tr>
                  <th className="th w-8"><input type="checkbox" aria-label="Select all on this page" checked={allPicked}
                    onChange={(e) => setSelected((old) => { const n = new Set(old); for (const a of shown) { if (e.target.checked) n.add(a.id); else n.delete(a.id); } return n; })} /></th>
                  <th className="th">Job</th><th className="th">Status</th><th className="th">Next stage</th><th className="th">Applied</th>
                  <th className="th">Follow-up</th><th className="th">Last update</th><th className="th">Score</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {shown.map((a) => <AppRow key={a.id} app={a} busy={busy} selected={selected.has(a.id)}
                    onSelect={(on) => select(a.id, on)} onMove={(st) => move.mutate({ id: a.id, status: st })} />)}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && <Pagination page={current} size={size} total={rows.length} onPage={setPage} scrollTo="pipeline-list"
            onSize={(n) => { setSize(n); setPage(1); }} noun={noun} />}
        </section>
      )}
    </div>
  );
}
