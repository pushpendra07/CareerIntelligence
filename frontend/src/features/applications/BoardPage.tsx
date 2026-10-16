import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { ErrorBox, PageIntro, ScoreBadge, Spinner } from "../../components/ui";
import type { Application, Page } from "../../types/api";
import { formatDate, humanize } from "../../utils/format";
import { APP_STATUSES } from "./ApplicationsPage";

/** The board's columns, in pipeline order. */
export const BOARD_COLUMNS: { status: string; label: string; tone: string }[] = [
  { status: "APPLIED", label: "Applied", tone: "border-t-blue-500" },
  { status: "RECRUITER_CONTACTED", label: "Recruiter contacted", tone: "border-t-teal-500" },
  { status: "SCREENING", label: "Screening", tone: "border-t-amber-500" },
  { status: "INTERVIEW", label: "Interview", tone: "border-t-orange-500" },
  { status: "AWAITING_FEEDBACK", label: "Interview done – no reply", tone: "border-t-fuchsia-500" },
  { status: "OFFER", label: "Offer", tone: "border-t-lime-500" },
  { status: "ACCEPTED", label: "Accepted", tone: "border-t-emerald-600" },
  { status: "REJECTED", label: "Rejected", tone: "border-t-rose-500" },
];
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

function AppCard({ app, onMove, busy }: { app: BoardApp; onMove: (status: string) => void; busy: boolean }) {
  const open = !FINISHED.includes(app.status);
  const applied = daysSince(app.applied_on);
  const followDue = open && app.follow_up_date ? daysSince(app.follow_up_date) : null;
  const quiet = open && app.updated_at ? daysSince(app.updated_at) >= QUIET_DAYS : false;
  return (
    <li draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(app.id)); e.dataTransfer.effectAllowed = "move"; }}
      className="cursor-grab rounded-md border border-slate-200 bg-surface p-2 text-sm shadow-sm active:cursor-grabbing" aria-label={`${app.job_title} at ${app.company_name}`}>
      <div className="flex items-start justify-between gap-2">
        <Link className="font-medium leading-snug hover:text-indigo-700" to={`/applications/${app.id}`}>{app.job_title}</Link>
        <ScoreBadge score={app.match_score} />
      </div>
      <div className="text-xs text-slate-500">{app.company_name}</div>
      <div className="mt-1 text-xs text-slate-500" title={app.origin === "auto" ? "Recorded automatically when the job was marked Applied — open it to set the real date" : formatDate(app.applied_on)}>
        Applied {applied <= 0 ? "today" : applied === 1 ? "yesterday" : `${applied} days ago`}{app.origin === "auto" && <span className="text-amber-700"> · date approximate</span>}
      </div>
      {followDue !== null && (
        <div className={`text-xs ${followDue >= 0 ? "font-medium text-rose-600" : "text-slate-500"}`}>
          {followDue > 0 ? `Follow-up ${followDue} day${followDue === 1 ? "" : "s"} late` : followDue === 0 ? "Follow up today" : `Follow up ${formatDate(app.follow_up_date)}`}
        </div>
      )}
      {quiet && <div className="text-xs text-amber-700">No update in {QUIET_DAYS}+ days</div>}
      <select className="input mt-1.5 w-full py-0.5 text-xs" aria-label={`Move ${app.job_title} to`} value="" disabled={busy}
        onChange={(e) => e.target.value && onMove(e.target.value)}>
        <option value="">Move to…</option>
        {APP_STATUSES.filter((s) => s !== app.status).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
      </select>
    </li>
  );
}

/** Applications as columns by stage: drag a card (or use Move to…) to change its status. */
export function BoardPage() {
  const list = useQuery({ queryKey: ["applications", "board"], queryFn: allApplications });
  const [q, setQ] = useState("");
  const [over, setOver] = useState<string | null>(null);
  // Shown right away while the server saves; replaced by the refreshed list.
  const [moved, setMoved] = useState<Record<number, string>>({});
  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/applications/${id}/status`, { status, note: "Moved on the board" }),
    onMutate: ({ id, status }) => setMoved((m) => ({ ...m, [id]: status })),
    onSettled: (_d, _e, { id }) => setMoved((m) => { const n = { ...m }; delete n[id]; return n; }),
  });
  if (list.isLoading) return <Spinner />;
  if (list.error) return <ErrorBox error={list.error} />;
  const needle = q.trim().toLowerCase();
  const apps = (list.data ?? [])
    .map((a) => (moved[a.id] ? { ...a, status: moved[a.id] } : a))
    .filter((a) => !needle || `${a.job_title} ${a.company_name}`.toLowerCase().includes(needle));
  const by = (status: string) => apps.filter((a) => a.status === status).sort((a, b) => b.applied_on.localeCompare(a.applied_on));
  const open = apps.filter((a) => !FINISHED.includes(a.status));
  const due = open.filter((a) => a.follow_up_date && daysSince(a.follow_up_date) >= 0).length;
  const quiet = open.filter((a) => a.updated_at && daysSince(a.updated_at) >= QUIET_DAYS).length;

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
    <div className="space-y-3">
      <div><h1>Pipeline board</h1><PageIntro>Every application by stage. Drag a card to another column (or use <b>Move to…</b>) when something happens; follow-ups and the job's status update with it.</PageIntro></div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input className="input w-64" placeholder="Search job or company" aria-label="Search applications" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-slate-600"><b>{open.length}</b> open · <b>{apps.length - open.length}</b> finished</span>
        {due > 0 && <span className="font-medium text-rose-600">{due} follow-up{due === 1 ? "" : "s"} due</span>}
        {quiet > 0 && <span className="text-amber-700">{quiet} quiet for {QUIET_DAYS}+ days</span>}
        <Link className="link ml-auto text-xs" to="/applications">List view</Link>
      </div>
      {move.error && <ErrorBox error={new Error(errorMessage(move.error))} />}
      {!list.data?.length ? (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No applications yet. Open a job and click <b>Apply</b> — or mark it Applied — and it appears here.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {BOARD_COLUMNS.map((c) => {
            const cards = by(c.status);
            return (
              <section key={c.status} aria-label={c.label} {...dropProps(c.status)}
                className={`flex w-60 shrink-0 flex-col rounded-lg border-t-4 bg-slate-50 p-2 ${c.tone} ${over === c.status ? "ring-2 ring-indigo-400" : ""}`}>
                <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-700">
                  {c.label}<span className="rounded-full bg-slate-200 px-2 text-xs font-medium text-slate-600">{cards.length}</span>
                </h2>
                <ul className="min-h-16 space-y-2">
                  {cards.map((a) => <AppCard key={a.id} app={a} busy={move.isPending} onMove={(s) => move.mutate({ id: a.id, status: s })} />)}
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
              className={`rounded-md border border-dashed border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50 ${over === s ? "ring-2 ring-indigo-400" : ""}`}>
              {humanize(s)} <b>{by(s).length}</b>
            </Link>
          ))}
          <span className="self-center text-slate-400">Drop a card here to put it on hold, withdraw or close it.</span>
        </div>
      )}
    </div>
  );
}
