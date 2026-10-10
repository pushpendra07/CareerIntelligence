import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { AddedViaTags, Card, JobStatusBadge, PAGE_SIZE, Pagination, ScoreBadge, Spinner } from "../../components/ui";
import type { Job, Page } from "../../types/api";
import { formatDate } from "../../utils/format";

/** The jobs for one company that are in Career Intelligence (from any source). */
export function CompanyJobs({ companyId, companyName, total, open, onScan, scanning }: {
  companyId: number;
  companyName: string;
  total: number;
  open: number;
  onScan: () => void;
  scanning: boolean;
}) {
  const [openOnly, setOpenOnly] = useState(open > 0);
  const [page, setPage] = useState(1);
  const query = { company_id: companyId, sort: "-match_score", page, size: PAGE_SIZE,
    ...(openOnly ? { status: ["DISCOVERED", "NEW", "REVIEWING", "SHORTLISTED", "READY_TO_APPLY", "ON_HOLD", "APPLIED",
      "RECRUITER_CONTACTED", "SCREENING", "INTERVIEW", "OFFER", "ACCEPTED"] } : {}) };
  const jobs = useQuery({ queryKey: ["jobs", "company", companyId, openOnly, page], queryFn: () => api.get<Page<Job>>("/jobs", query) });
  return (
    <section id="jobs">
      <Card title={`Jobs in Career Intelligence (${open} open · ${total} total)`}
        actions={total > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={openOnly} onChange={(e) => { setOpenOnly(e.target.checked); setPage(1); }} />
            Open only
          </label>
        ) : undefined}>
        {total === 0 ? (
          <div className="text-sm text-slate-600">
            <p>No jobs for {companyName} in the app yet.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={scanning} onClick={onScan}>{scanning ? "Scanning…" : "Scan its job board"}</button>
              <Link className="btn-secondary" to="/jobs/new">Add a job by hand</Link>
            </div>
          </div>
        ) : !jobs.data ? <Spinner /> : !jobs.data.items.length ? (
          <p className="text-sm text-slate-500">No open jobs. Untick <b>Open only</b> to see closed, rejected and not-relevant ones.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead><tr><th className="th">Score</th><th className="th">Job</th><th className="th">Location</th><th className="th">Added via</th><th className="th">Posted</th><th className="th">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-50">
                {jobs.data.items.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="td"><ScoreBadge score={j.match_score} stale={j.score_stale} /></td>
                    <td className="td"><Link className="font-medium text-slate-800 hover:text-indigo-700" to={`/jobs/${j.id}`}>{j.title}</Link></td>
                    <td className="td text-xs">{j.location ?? "—"}</td>
                    <td className="td"><AddedViaTags values={j.added_via} /></td>
                    <td className="td text-xs">{formatDate(j.posting_date)}</td>
                    <td className="td"><JobStatusBadge value={j.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {jobs.data.total > PAGE_SIZE && <Pagination page={page} size={PAGE_SIZE} total={jobs.data.total} onPage={setPage} />}
          </div>
        )}
      </Card>
    </section>
  );
}
