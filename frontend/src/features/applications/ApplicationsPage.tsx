import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { BackButton, Card, Empty, ErrorBox, KeyValue, Pagination, ScoreBadge, Spinner, StatusBadge, PAGE_SIZE, PageIntro } from "../../components/ui";
import type { Application, Page } from "../../types/api";
import { formatDate, formatDateTime, formatMoney, humanize } from "../../utils/format";

export const APP_STATUSES = ["APPLIED", "RECRUITER_CONTACTED", "SCREENING", "INTERVIEW", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN", "ON_HOLD", "CLOSED"];

export function ApplicationsPage() {
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["applications", { status, q, page }],
    queryFn: () => api.get<Page<Application>>("/applications", { status: status ? [status] : undefined, q, page, size: PAGE_SIZE }),
  });
  return (
    <div className="space-y-4">
      <div><h1>Applications</h1><PageIntro>Every job you applied to and where it stands. Open one to update its status or add a follow-up.</PageIntro></div>
      <Card>
        <div className="mb-3 flex gap-2">
          <input className="input max-w-xs" placeholder="Search job or company" aria-label="Search applications" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <select className="input max-w-xs" aria-label="Application status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>{APP_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </div>
        {list.isLoading && <Spinner />}
        {list.error && <ErrorBox error={list.error} />}
        {list.data && (!list.data.items.length ? <Empty>No applications yet. Use "Apply" on a job.</Empty> : (
          <table className="min-w-full divide-y divide-slate-100">
            <thead><tr><th className="th">Job</th><th className="th">Applied</th><th className="th">Method</th><th className="th">CV</th><th className="th">Score</th><th className="th">Follow-up</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {list.data.items.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="td"><Link className="font-medium hover:text-indigo-700" to={`/applications/${a.id}`}>{a.job_title}</Link><div className="text-xs text-slate-500">{a.company_name}</div></td>
                  <td className="td text-xs">{formatDate(a.applied_on)}</td>
                  <td className="td text-xs">{humanize(a.method)}</td>
                  <td className="td text-xs">{a.cv_name ?? "—"}</td>
                  <td className="td"><ScoreBadge score={a.match_score} /></td>
                  <td className="td text-xs">{formatDate(a.follow_up_date)}</td>
                  <td className="td"><StatusBadge value={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {list.data && <Pagination page={page} size={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}

export function ApplicationDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const app = useQuery({ queryKey: ["application", id], queryFn: () => api.get<Application>(`/applications/${id}`) });
  const [note, setNote] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const setStatus = useMutation({
    mutationFn: (status: string) => api.post(`/applications/${id}/status`, { status, note: statusNote || null }),
    onSuccess: () => { setStatusNote(""); qc.invalidateQueries(); },
  });
  const addNote = useMutation({ mutationFn: () => api.post(`/applications/${id}/notes`, { note }), onSuccess: () => { setNote(""); qc.invalidateQueries(); } });
  if (app.isLoading) return <Spinner />;
  if (app.error) return <ErrorBox error={app.error} />;
  const a = app.data!;
  return (
    <div className="space-y-4">
      <BackButton fallback="/applications" label="Back to applications" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1>{a.job_title}</h1><p className="text-sm text-slate-600">{a.company_name} · <Link className="link" to={`/jobs/${a.job_id}`}>View job</Link></p></div>
        <div className="flex gap-2">
          <input className="input w-56" placeholder="Note for status change" aria-label="Status note" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
          <select className="input w-48" aria-label="Change status" value={a.status} onChange={(e) => setStatus.mutate(e.target.value)}>
            {APP_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
          <Link className="btn-secondary" to={`/interviews/new?job_id=${a.job_id}`}>Schedule interview</Link>
        </div>
      </div>
      {setStatus.error && <ErrorBox error={new Error(errorMessage(setStatus.error))} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Application" className="lg:col-span-2">
          <KeyValue items={[
            ["Status", <StatusBadge key="s" value={a.status} />], ["Applied on", formatDate(a.applied_on)],
            ["Method", humanize(a.method)], ["CV version", a.cv_name ?? "—"], ["Recruiter", a.recruiter_name ?? "—"],
            ["Referral", a.referral_name ?? "—"], ["Expected salary", formatMoney(a.expected_salary, a.salary_currency)],
            ["Notice period", a.notice_period_days !== null ? `${a.notice_period_days} days` : "—"],
            ["Follow-up", formatDate(a.follow_up_date)], ["Origin", humanize(a.origin)],
          ]} />
          {a.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{a.notes}</p>}
        </Card>
        <Card title="History">
          <ol className="space-y-2 text-sm">
            {a.events.map((e) => (
              <li key={e.id}>
                <div className="text-xs text-slate-400">{formatDateTime(e.occurred_at)}</div>
                <div>{humanize(e.event_type)} {e.to_status && <>→ <StatusBadge value={e.to_status} /></>}</div>
                {e.note && <div className="text-xs text-slate-600">{e.note}</div>}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex gap-2">
            <input className="input" placeholder="Add a note" aria-label="Add note" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn-secondary" disabled={!note || addNote.isPending} onClick={() => addNote.mutate()}>Add</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
