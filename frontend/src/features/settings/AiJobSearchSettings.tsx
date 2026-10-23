import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Card, ErrorBox, KeyValue, Spinner } from "../../components/ui";
import { formatDateTime } from "../../utils/format";

interface ImportResult {
  started_at: string; finished_at: string;
  stats: Record<string, number>;
  errors: { title: string; company: string; error: string }[];
}
export interface AiJobSearchStatus {
  configured: boolean; path: string | null; available: boolean; version: string | null; error: string | null;
  counts: { seen: number; new: number; ranked: number; skipped: number; tracker: number } | null;
  running: boolean; auto_import: boolean; changed_since_import?: boolean; last_import: ImportResult | null;
}

export const aiJobSearchStatus = () => api.get<AiJobSearchStatus>("/ai-job-search/status");

/** AI Job Search (a Claude Code job-search workflow) as an optional, read-only job source. */
export function AiJobSearchSettings() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["ai-job-search"], queryFn: aiJobSearchStatus });
  const run = useMutation({
    mutationFn: () => api.post<ImportResult>("/ai-job-search/import"),
    onSuccess: () => qc.invalidateQueries(),
    meta: { success: "AI Job Search imported" },
  });
  const auto = useMutation({
    mutationFn: (on: boolean) => api.put("/ai-job-search/settings", { auto_import: on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-job-search"] }),
    meta: { success: "Saved", toastError: true },
  });
  const s = status.data;
  const last = s?.last_import;
  const st = last?.stats ?? {};
  return (
    <Card title="AI Job Search (optional)" actions={
      <button className="btn-primary" disabled={!s?.available || run.isPending || s?.running} onClick={() => run.mutate()}>
        {run.isPending || s?.running ? "Importing…" : "Import now"}
      </button>}>
      <p className="mb-2 text-sm text-slate-600">
        <a className="link" href="https://github.com/ai-job-search-dev/ai-job-search" target="_blank" rel="noreferrer">AI Job Search</a> is
        a separate job-search workflow you run in Claude Code (<code>/scrape</code>, <code>/rank</code>, <code>/apply</code>, <code>/outcome</code>).
        <b> Import now</b> brings in the jobs it found, its 0–100 rank with strengths and gaps (kept in the job's notes), and the applications in its tracker.
      </p>
      {!s ? <Spinner /> : (
        <KeyValue items={[
          ["Path", s.path ?? "Not set up — run ./scripts/setup-ai-job-search.sh"],
          ["Framework version", s.version ?? "—"],
          ["Jobs found by /scrape", s.counts ? `${s.counts.seen} (${s.counts.new} new, ${s.counts.ranked} ranked, ${s.counts.skipped} skipped)` : "—"],
          ["Tracker rows", s.counts?.tracker ?? "—"],
          ["Last import", last ? `${formatDateTime(last.started_at)}${s.changed_since_import ? " · its files changed since" : ""}` : "never"],
        ]} />
      )}
      {last && (
        <p className="mt-2 text-sm">
          Last result: {st.created ?? 0} new, {st.merged ?? 0} already in your list (merged), {st.applications ?? 0} applications
          {st.vetoed ? `; ${st.vetoed} marked Not relevant (failed its location or language check)` : ""}
          {st.deleted_skipped ? `; ${st.deleted_skipped} you deleted before, skipped` : ""}
          {st.filtered_skipped ? `; ${st.filtered_skipped} skipped by your import rules` : ""}.
          {" "}<Link className="link" to="/jobs?added_via=ai_job_search">See these jobs</Link>
          {last.errors.map((e, i) => <span key={i} className="block text-rose-600">{e.title} at {e.company}: {e.error}</span>)}
        </p>
      )}
      {s?.configured && s.error && <p className="mt-2 text-sm text-rose-600">{s.error}</p>}
      {run.error && <ErrorBox error={new Error(errorMessage(run.error))} />}
      {s?.available && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.auto_import} disabled={auto.isPending} onChange={(e) => auto.mutate(e.target.checked)} />
          Import as soon as AI Job Search finds something new (checked every 5 minutes while the app runs)
        </label>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Career Intelligence only reads <code>job_scraper/seen_jobs.json</code> and <code>job_search_tracker.csv</code>; it never changes
        the AI Job Search folder or runs its AI commands (those use your Claude Code and its tokens). Every job goes through the same
        duplicate checks as every other source.
      </p>
    </Card>
  );
}
