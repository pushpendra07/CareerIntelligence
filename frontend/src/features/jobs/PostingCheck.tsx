import { useMutation } from "@tanstack/react-query";
import { api, errorMessage } from "../../api/client";
import { Badge, ErrorBox } from "../../components/ui";
import type { JobDetail } from "../../types/api";
import { formatDateTime } from "../../utils/format";
import { postingUrl } from "./JobParts";

const STATE: Record<string, { label: string; tone: "green" | "red" | "amber" | "gray" }> = {
  OPEN: { label: "Still open", tone: "green" },
  CLOSED: { label: "Closed", tone: "red" },
  LIKELY_CLOSED: { label: "Probably closed", tone: "amber" },
  UNKNOWN: { label: "Couldn't tell", tone: "gray" },
};
const OLD_DAYS = 60;

/** "Posted 3 months ago" for postings older than two months, else null. */
export function postingAge(posted: string | null, today = new Date()): string | null {
  if (!posted) return null;
  const days = Math.floor((today.getTime() - new Date(`${posted}T00:00:00`).getTime()) / 86_400_000);
  if (days < OLD_DAYS) return null;
  const years = Math.floor(days / 365);
  if (years >= 1) return `Posted ${years} year${years > 1 ? "s" : ""} ago`;
  return `Posted ${Math.floor(days / 30)} months ago`;
}

/** Ask the posting's site whether the job is still open; offer to close it if not. */
export function PostingCheck({ job, onMarkClosed, busy }: { job: JobDetail; onMarkClosed: () => void; busy: boolean }) {
  const check = useMutation({ mutationFn: () => api.post<JobDetail>(`/jobs/${job.id}/check-posting`) });
  const result = job.posting_check;
  const age = postingAge(job.posting_date);
  const state = result ? STATE[result.state] ?? STATE.UNKNOWN : null;
  const gone = result && (result.state === "CLOSED" || result.state === "LIKELY_CLOSED");
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {postingUrl(job) ? (
          <button className="btn-secondary px-2 py-1 text-xs" disabled={check.isPending} onClick={() => check.mutate()}
            title="Ask the job's own site whether the posting still exists">
            {check.isPending ? "Checking…" : result ? "Check again" : "Check if still open"}
          </button>
        ) : <span className="text-xs text-slate-500">No posting link to check</span>}
        {state && <Badge tone={state.tone}>{state.label}</Badge>}
        {age && <Badge tone="amber" title="Old postings are usually filled or taken down">{age}</Badge>}
        {gone && job.status !== "CLOSED" && (
          <button className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={onMarkClosed}>Mark as closed</button>
        )}
      </div>
      {result && (
        <p className="text-xs text-slate-500">
          {result.reason}. <span title={result.url}>Checked {formatDateTime(result.checked_at)}.</span>
        </p>
      )}
      {!result && age && <p className="text-xs text-slate-500">This posting is old — check whether it's still open before applying.</p>}
      {check.error && <ErrorBox error={new Error(errorMessage(check.error))} />}
    </div>
  );
}
