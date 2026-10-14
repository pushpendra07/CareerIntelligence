import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Badge, JobStatusBadge } from "../../components/ui";
import type { FollowUp } from "../../types/api";
import { formatDate, humanize } from "../../utils/format";

/** A date `days` from today, as YYYY-MM-DD (local time). */
export function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Plain-words due date: "today", "tomorrow", "in 3 days", "2 days late". */
export function dueLabel(due: string): string {
  const days = Math.round((new Date(`${due}T00:00:00`).getTime() - new Date(`${inDays(0)}T00:00:00`).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "1 day late";
  if (days < 0) return `${-days} days late`;
  if (days < 7) return `in ${days} days`;
  return formatDate(due);
}

const SNOOZES: [number, string][] = [[1, "+1 day"], [3, "+3 days"], [7, "+1 week"]];

/** Job statuses where a follow-up no longer makes sense. */
const FINISHED = ["REJECTED", "CLOSED", "NOT_RELEVANT", "WITHDRAWN", "ACCEPTED"];

/** One reminder with its context and one-click actions: Done, or push it out. */
export function FollowUpRow({ f, showJob = true }: { f: FollowUp; showJob?: boolean }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  const complete = useMutation({ mutationFn: () => api.post(`/followups/${f.id}/complete`), onSuccess: refresh });
  const snooze = useMutation({ mutationFn: (days: number) => api.patch(`/followups/${f.id}`, { due_date: inDays(days) }), onSuccess: refresh });
  const busy = complete.isPending || snooze.isPending;
  const late = !f.completed && f.overdue;
  const finished = !!f.job_status && FINISHED.includes(f.job_status);
  // The automatic title just repeats the job ("Follow up: <job>"), so lead with the job instead.
  const auto = !!f.job_title && f.title === `Follow up: ${f.job_title}`;
  const heading = showJob && f.job_id
    ? <Link className="hover:text-indigo-700" to={`/jobs/${f.job_id}`}>{auto ? f.job_title : f.title}</Link>
    : auto ? "Follow up" : f.title;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium ${f.completed ? "text-slate-400 line-through" : "text-slate-800"}`}>{heading}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          {showJob && f.company_name && <span>{f.company_name}</span>}
          {f.contact_name && <span>· {f.contact_name}</span>}
          {showJob && f.job_status && <JobStatusBadge value={f.job_status} />}
          {showJob && f.job_id && !auto && <span className="text-slate-400">{f.job_title}</span>}
          {f.kind !== "OTHER" && <span className="text-slate-400">{humanize(f.kind)} follow-up</span>}
        </div>
        {f.notes && <div className="mt-0.5 whitespace-pre-line text-xs text-slate-500">{f.notes}</div>}
        {finished && !f.completed && <div className="mt-0.5 text-xs text-amber-700">No longer needed — this job is {humanize(f.job_status).toLowerCase()}.</div>}
      </div>
      <span className={`text-xs ${late ? "font-medium text-rose-600" : "text-slate-500"}`} title={formatDate(f.due_date)}>
        {f.completed ? "done" : dueLabel(f.due_date)}
      </span>
      {!f.completed && (finished ? (
        <button className="btn-secondary px-2 py-1 text-xs" disabled={busy} aria-label={`Dismiss: ${f.title}`} onClick={() => complete.mutate()}>Dismiss</button>
      ) : (
        <span className="flex items-center gap-1">
          {f.job_url && <a className="btn-secondary px-2 py-1 text-xs" href={f.job_url} target="_blank" rel="noopener noreferrer" title="Open the job posting">Posting ↗</a>}
          {SNOOZES.map(([days, label]) => (
            <button key={days} className="btn-secondary px-2 py-1 text-xs" disabled={busy} title={`Remind me ${label.slice(1)} from today`}
              onClick={() => snooze.mutate(days)}>{label}</button>
          ))}
          <button className="btn-primary px-2 py-1 text-xs" disabled={busy} aria-label={`Done: ${f.title}`} onClick={() => complete.mutate()}>✓ Done</button>
        </span>
      ))}
      {late && !finished && <Badge tone="red">late</Badge>}
    </li>
  );
}

/** "Remind me in …" for one job: one click picks the date, the title is filled in. */
export function QuickFollowUp({ jobId, jobTitle, applied }: { jobId?: number; jobTitle?: string; applied?: boolean }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(jobTitle ? `Follow up: ${jobTitle}` : "");
  const [due, setDue] = useState(inDays(7));
  const create = useMutation({
    mutationFn: (date: string) => api.post("/followups", {
      title: title.trim() || `Follow up: ${jobTitle ?? "job"}`, due_date: date,
      kind: applied ? "APPLICATION" : "OTHER", ...(jobId ? { job_id: jobId } : {}),
    }),
    onSuccess: () => { if (!jobTitle) setTitle(""); return qc.invalidateQueries(); },
  });
  return (
    <div className="space-y-2">
      <input className="input" aria-label="Reminder" placeholder="What to do (e.g. Email the recruiter)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500">Remind me</span>
        {([[1, "tomorrow"], [3, "in 3 days"], [7, "in a week"]] as [number, string][]).map(([days, label]) => (
          <button key={days} className="btn-secondary px-2 py-1 text-xs" disabled={create.isPending || !(title.trim() || jobTitle)}
            onClick={() => create.mutate(inDays(days))}>{label}</button>
        ))}
        <input className="input w-auto py-1 text-xs" type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn-primary px-2 py-1 text-xs" disabled={create.isPending || !due || !(title.trim() || jobTitle)} onClick={() => create.mutate(due)}>Add</button>
      </div>
      {create.error && <p className="text-xs text-rose-600">{errorMessage(create.error)}</p>}
    </div>
  );
}
