import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { ErrorBox, PageIntro, ScoreBadge, Spinner } from "../../components/ui";
import { prefs } from "../../utils/storage";
import type { Application, Page } from "../../types/api";
import { formatDate, humanize } from "../../utils/format";
import { APP_STATUSES } from "./ApplicationsPage";

/** The board's columns, in pipeline order. */
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
/** "Next stage" for the one-click button on a card. */
const NEXT: Record<string, string> = {
  APPLIED: "RECRUITER_CONTACTED", RECRUITER_CONTACTED: "SCREENING", SCREENING: "INTERVIEW",
  INTERVIEW: "AWAITING_FEEDBACK", AWAITING_FEEDBACK: "OFFER", OFFER: "ACCEPTED",
};
const LABEL = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.status, c.label]));
const SHORT: Record<string, string> = { ...LABEL, RECRUITER_CONTACTED: "Replied", AWAITING_FEEDBACK: "No reply yet" };
/** How far an application got (its current status or any earlier one): for the funnel. */
const RANK: Record<string, number> = { APPLIED: 0, RECRUITER_CONTACTED: 1, SCREENING: 1, INTERVIEW: 2, AWAITING_FEEDBACK: 2, OFFER: 3, ACCEPTED: 3 };
/** Stopped applications: a slim row under the board. */
const SIDE_STATUSES = APP_STATUSES.filter((s) => !BOARD_COLUMNS.some((c) => c.status === s));
const FINISHED = ["ACCEPTED", "REJECTED", "WITHDRAWN", "CLOSED"];
const QUIET_DAYS = 14;

const today = () => new Date(new Date().toDateString());
const daysSince = (iso: string) => Math.floor((today().getTime() - new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).getTime()) / 86_400_000);

type BoardApp = Application & { updated_at?: string };

/** Every application (the board shows them all, not a page). */
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
  if (a.follow_up_date && daysSince(a.follow_up_date) >= 0) return "late";
  if (a.updated_at && daysSince(a.updated_at) >= QUIET_DAYS) return "quiet";
  return null;
}

function AppCard({ app, onMove, busy }: { app: BoardApp; onMove: (status: string) => void; busy: boolean }) {
  const open = !FINISHED.includes(app.status);
  const applied = daysSince(app.applied_on);
  const followDue = open && app.follow_up_date ? daysSince(app.follow_up_date) : null;
  const quiet = open && app.updated_at ? daysSince(app.updated_at) >= QUIET_DAYS : false;
  const flag = attention(app);
  const next = NEXT[app.status];
  return (
    <li draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(app.id)); e.dataTransfer.effectAllowed = "move"; }}
      className={`group relative cursor-grab overflow-hidden rounded-xl border border-slate-200/80 bg-surface p-3 text-sm shadow-(--shadow-card) transition hover:-translate-y-px hover:shadow-(--shadow-lift) active:cursor-grabbing ${busy ? "opacity-80" : ""}`}
      aria-label={`${app.job_title} at ${app.company_name}`}>
      {flag && <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${flag === "late" ? "bg-[#f43f5e]" : "bg-[#f59e0b]"}`} />}
      <div className="flex items-start gap-2.5">
        <CompanyAvatar name={app.company_name} />
        <div className="min-w-0 flex-1">
          <Link className="block font-semibold leading-snug text-slate-800 hover:text-indigo-700" to={`/applications/${app.id}`}>{app.job_title}</Link>
          <div className="truncate text-xs text-slate-500">{app.company_name}</div>
        </div>
        <ScoreBadge score={app.match_score} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500"
        title={app.origin === "auto" ? "Recorded automatically when the job was marked Applied — open it to set the real date" : formatDate(app.applied_on)}>
        <span>Applied {applied <= 0 ? "today" : applied === 1 ? "yesterday" : `${applied} days ago`}</span>
        {app.origin === "auto" && <span className="text-amber-700">· date approximate</span>}
      </div>
      {followDue !== null && (
        <div className={`mt-0.5 text-xs ${followDue >= 0 ? "font-semibold text-rose-600" : "text-slate-500"}`}>
          {followDue > 0 ? `Follow-up ${followDue} day${followDue === 1 ? "" : "s"} late` : followDue === 0 ? "Follow up today" : `Follow up ${formatDate(app.follow_up_date)}`}
        </div>
      )}
      {quiet && <div className="mt-0.5 text-xs text-amber-700">No update in {QUIET_DAYS}+ days</div>}
      <div className="mt-2.5 flex items-center gap-1.5">
        {next && (
          <button type="button" disabled={busy} onClick={() => onMove(next)} title={`Move to ${LABEL[next]}`}
            className="min-w-0 flex-1 truncate rounded-lg bg-indigo-50 px-2 py-1 text-left text-xs font-medium text-indigo-700 hover:bg-indigo-100">
            {SHORT[next]} →
          </button>
        )}
        <select className={`rounded-lg border border-slate-200 bg-surface px-1.5 py-1 text-xs text-slate-600 ${next ? "w-24" : "w-full"}`}
          aria-label={`Move ${app.job_title} to`} value="" disabled={busy} onChange={(e) => e.target.value && onMove(e.target.value)}>
          <option value="">Move to…</option>
          {APP_STATUSES.filter((s) => s !== app.status).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
      </div>
    </li>
  );
}

type Sort = "recent" | "score" | "oldest";
const SORTS: Record<Sort, { label: string; cmp: (a: BoardApp, b: BoardApp) => number }> = {
  recent: { label: "Newest first", cmp: (a, b) => b.applied_on.localeCompare(a.applied_on) },
  score: { label: "Best match first", cmp: (a, b) => (b.match_score ?? -1) - (a.match_score ?? -1) },
  oldest: { label: "Waiting longest", cmp: (a, b) => (a.updated_at ?? a.applied_on).localeCompare(b.updated_at ?? b.applied_on) },
};
const VIEW_KEY = "board.view.v1";
type View = { sort: Sort; attention: boolean; hideFinished: boolean };
const loadView = (): View => {
  try { return { sort: "recent", attention: false, hideFinished: false, ...JSON.parse(prefs.get(VIEW_KEY) ?? "{}") }; } catch { return { sort: "recent", attention: false, hideFinished: false }; }
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

/** Applications as columns by stage: drag a card (or use Move to…) to change its status. */
export function BoardPage() {
  const list = useQuery({ queryKey: ["applications", "board"], queryFn: allApplications });
  const [q, setQ] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(loadView);
  const setView = (v: Partial<View>) => setViewState((old) => { const n = { ...old, ...v }; prefs.set(VIEW_KEY, JSON.stringify(n)); return n; });
  // Shown right away while the server saves; replaced by the refreshed list.
  const [moved, setMoved] = useState<Record<number, string>>({});
  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/applications/${id}/status`, { status, note: "Moved on the board" }),
    onMutate: ({ id, status }) => setMoved((m) => ({ ...m, [id]: status })),
    onSettled: (_d, _e, { id }) => setMoved((m) => { const n = { ...m }; delete n[id]; return n; }),
    meta: { success: "Moved" },
  });
  if (list.isLoading) return <Spinner />;
  if (list.error) return <ErrorBox error={list.error} />;
  const needle = q.trim().toLowerCase();
  const all = (list.data ?? []).map((a) => (moved[a.id] ? { ...a, status: moved[a.id] } : a));
  const apps = all
    .filter((a) => !needle || `${a.job_title} ${a.company_name}`.toLowerCase().includes(needle))
    .filter((a) => !view.attention || attention(a) !== null);
  const by = (status: string) => apps.filter((a) => a.status === status).sort(SORTS[view.sort].cmp);
  const open = apps.filter((a) => !FINISHED.includes(a.status));
  const columns = BOARD_COLUMNS.filter((c) => !view.hideFinished || !FINISHED.includes(c.status));

  const dropProps = (status: string) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); setOver(status); },
    onDragLeave: () => setOver((o) => (o === status ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      const id = Number(e.dataTransfer.getData("text/plain"));
      const app = apps.find((a) => a.id === id);
      if (app && app.status !== status) move.mutate({ id, status });
    },
  });

  return (
    <div className="space-y-5">
      <div><h1>Pipeline board</h1><PageIntro>Every application by stage. Drag a card to another column, or use <b>Next stage →</b> / <b>Move to…</b>; follow-ups and the job's status update with it.</PageIntro></div>
      {!!list.data?.length && <Funnel apps={all} onAttention={() => setView({ attention: true })} />}
      <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
        <input className="input w-full sm:w-64" placeholder="Search job or company" aria-label="Search applications" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" aria-label="Sort cards" value={view.sort} onChange={(e) => setView({ sort: e.target.value as Sort })}>
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 ring-1 ring-inset ${view.attention ? "bg-rose-50 text-rose-700 ring-rose-200" : "text-slate-600 ring-slate-200"}`}>
          <input type="checkbox" checked={view.attention} onChange={(e) => setView({ attention: e.target.checked })} />Needs attention only
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-slate-600 ring-1 ring-inset ring-slate-200">
          <input type="checkbox" checked={view.hideFinished} onChange={(e) => setView({ hideFinished: e.target.checked })} />Hide accepted & rejected
        </label>
        <span className="text-slate-600"><b data-testid="open-count">{open.length}</b> open · <b>{apps.length - open.length}</b> finished</span>
        <Link className="link ml-auto text-xs" to="/applications">List view</Link>
      </div>
      {move.error && <ErrorBox error={new Error(errorMessage(move.error))} />}
      {!list.data?.length ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No applications yet. Open a job and click <b>Apply</b> — or mark it Applied — and it appears here.
        </p>
      ) : (
        <div className="tabs-scroll flex gap-4 pb-2">
          {columns.map((c) => {
            const cards = by(c.status);
            const flagged = cards.filter((a) => attention(a)).length;
            return (
              <section key={c.status} aria-label={c.label} {...dropProps(c.status)}
                className={`flex w-72 shrink-0 flex-col rounded-2xl bg-slate-100/70 p-2.5 ring-1 ring-inset transition ${over === c.status ? "bg-indigo-50 ring-2 ring-indigo-400" : "ring-slate-200/70"}`}>
                <h2 className="mb-2.5 flex items-center gap-2 px-1 text-sm font-semibold text-slate-700">
                  <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {flagged > 0 && <span className="rounded-full bg-rose-100 px-1.5 text-[11px] font-semibold text-rose-700" title="Need attention">{flagged}!</span>}
                  <span className="rounded-full bg-surface px-2 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">{cards.length}</span>
                </h2>
                <ul className="min-h-24 space-y-2.5">
                  {cards.map((a) => <AppCard key={a.id} app={a} busy={move.isPending} onMove={(s) => move.mutate({ id: a.id, status: s })} />)}
                  {!cards.length && <li aria-hidden className="rounded-xl border-2 border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Drop here</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {!!list.data?.length && (
        <div className="flex flex-wrap gap-2 text-xs">
          {SIDE_STATUSES.map((s) => (
            <Link key={s} to={`/applications?status=${s}`} {...dropProps(s)} aria-label={`${humanize(s)}: ${by(s).length}`}
              className={`rounded-xl border border-dashed border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50 ${over === s ? "ring-2 ring-indigo-400" : ""}`}>
              {humanize(s)} <b>{by(s).length}</b>
            </Link>
          ))}
          <span className="self-center text-slate-400">Drop a card here to put it on hold, withdraw or close it.</span>
        </div>
      )}
    </div>
  );
}
