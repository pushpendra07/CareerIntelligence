import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api, errorMessage } from "../../api/client";

type Run = { id: number; status: string; started_at: string; finished_at: string | null;
  stats: { total?: number; checked?: number; fetched?: number; failed?: number; not_allowed?: number; no_link?: number } };
export type DescriptionStatus = { missing: number; missing_70_plus: number; running: Run | null; last_run: Run | null };

/**
 * Fill in missing job descriptions from each job's own link, best scores first, so their
 * scores stop being guesses. Shows live progress while it runs.
 */
export function FetchDescriptions({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["descriptions"],
    queryFn: () => api.get<DescriptionStatus>("/jobs/fetch-descriptions"),
    refetchInterval: (q) => (q.state.data?.running ? 2500 : false),
  });
  const start = useMutation({
    mutationFn: () => api.post("/jobs/fetch-descriptions", { limit: 40 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["descriptions"] }),
  });
  const s = status.data;
  const running = s?.running;
  const last = s?.last_run;
  // When a run finishes, the scores and counts it changed are refreshed everywhere.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "descriptions" });
    wasRunning.current = !!running;
  }, [running, qc]);
  if (!s) return null;
  const st = (running ?? last)?.stats ?? {};
  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {running ? (
        <div className="text-sm text-slate-600" role="status">
          <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
          Reading descriptions… {st.checked ?? 0} of {st.total ?? "?"} · {st.fetched ?? 0} found
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100">
            <div className="h-1.5 bg-indigo-500 transition-all" style={{ width: `${st.total ? ((st.checked ?? 0) / st.total) * 100 : 5}%` }} />
          </div>
        </div>
      ) : (
        <button className={compact ? "btn-secondary px-2 py-1 text-xs" : "btn-secondary"} disabled={start.isPending || s.missing === 0}
          title="Reads each job's own link (not LinkedIn, Indeed, Glassdoor or Naukri — those you paste yourself)"
          onClick={() => start.mutate()}>
          {s.missing === 0 ? "All descriptions fetched" : `Fetch for ${Math.min(40, s.missing)} best jobs`}
        </button>
      )}
      {!running && last?.stats.total !== undefined && (
        <p className="text-xs text-slate-500">
          Last run: {last.stats.fetched ?? 0} of {last.stats.total} found
          {last.stats.not_allowed ? ` · ${last.stats.not_allowed} on sites that don't allow it (open and paste)` : ""}
          {last.stats.failed ? ` · ${last.stats.failed} pages had none` : ""}
        </p>
      )}
      {start.error && <p className="text-xs text-rose-600">{errorMessage(start.error)}</p>}
    </div>
  );
}
