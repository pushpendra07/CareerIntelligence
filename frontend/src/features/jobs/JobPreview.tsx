import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { AddedViaTags, Badge, ErrorBox, JobStatusBadge, Spinner, StatusBadge } from "../../components/ui";
import type { JobDetail } from "../../types/api";
import { NextStep } from "./JobDetailPage";
import { FitSummary, JobDescription, KeyFacts, skillMarks } from "./JobParts";

/**
 * A job opened beside the list (click a row): decide on it without leaving the list.
 * ↑ / ↓ (or the arrows) move through the rows on this page; Esc closes.
 */
export function JobPreview({ id, ids, onOpen, onClose, top = 0 }: {
  id: number; ids: number[]; onOpen: (id: number) => void; onClose: () => void; top?: number;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const job = useQuery({ queryKey: ["job", String(id)], queryFn: () => api.get<JobDetail>(`/jobs/${id}`) });
  const status = useMutation({
    mutationFn: (s: string) => api.post(`/jobs/${id}/status`, { status: s }),
    // Done with this job: close the panel and go back to the list (it may have left this tab).
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
    meta: { success: "Status updated", toastError: true },
  });
  const at = ids.indexOf(id);
  const prev = at > 0 ? ids[at - 1] : null;
  const next = at >= 0 && at < ids.length - 1 ? ids[at + 1] : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown" && next) { e.preventDefault(); onOpen(next); }
      else if (e.key === "ArrowUp" && prev) { e.preventDefault(); onOpen(prev); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onOpen, onClose]);
  // A click outside the panel closes it. A job row is left to its own click (which shows that
  // job here, or closes the panel when it's the same job).
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || panel.current?.contains(el) || el.closest("[data-job-row]")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);
  const j = job.data;
  const b = "btn-secondary px-2 py-1 text-xs";
  return (
    <aside ref={panel} role="dialog" aria-label="Job preview" style={{ top }}
      className="fixed bottom-0 right-0 z-30 flex w-full max-w-xl flex-col border-l border-slate-200 bg-surface shadow-2xl">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
        <button className={b} disabled={!prev} onClick={() => prev && onOpen(prev)} aria-label="Previous job in the list" title="Previous (↑)">↑</button>
        <button className={b} disabled={!next} onClick={() => next && onOpen(next)} aria-label="Next job in the list" title="Next (↓)">↓</button>
        <span className="text-xs text-slate-400">{at + 1} of {ids.length}</span>
        <span className="flex-1" />
        <Link className="link text-sm" to={`/jobs/${id}`}>Open full page →</Link>
        <button className="rounded px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close preview" title="Close (Esc)">×</button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {job.isLoading && <Spinner />}
        {job.error && <ErrorBox error={job.error} />}
        {j && <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-snug">{j.title} <span className="text-sm font-normal text-slate-400">#{j.id}</span></h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <Link className="link" to={`/companies/${j.company.id}`}>{j.company.name}</Link>
                {j.company.tier && <Badge>{j.company.tier.replace("TIER_", "Tier ")}</Badge>}
                <JobStatusBadge value={j.status} />
                <AddedViaTags values={j.added_via} />
              </div>
            </div>
            {j.match_score !== null && (
              <span className="shrink-0 text-right">
                <span className="text-2xl font-bold text-indigo-700">{j.match_score}</span><span className="text-slate-400">/100</span>
                {j.match && <div><StatusBadge value={j.match.recommendation} /></div>}
              </span>
            )}
          </div>
          <KeyFacts job={j} />
          <NextStep job={j} busy={status.isPending} setStatus={(s) => status.mutate(s)}
            onApply={() => navigate(`/jobs/${j.id}?apply=1`)} />
          <section><h3 className="mb-2 text-sm font-semibold">Does it fit you?</h3><FitSummary job={j} /></section>
          <section><h3 className="mb-2 text-sm font-semibold">Job description</h3>
            <JobDescription text={j.original_jd} marks={skillMarks(j)} /></section>
        </>}
      </div>
    </aside>
  );
}
