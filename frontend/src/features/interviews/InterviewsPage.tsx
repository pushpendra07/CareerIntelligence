import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Card, Empty, ErrorBox, Field, KeyValue, Spinner, StatusBadge } from "../../components/ui";
import type { Interview, Job, Page } from "../../types/api";
import { formatDateTime, humanize } from "../../utils/format";

export const ROUNDS = ["RECRUITER_SCREEN", "HR", "TECHNICAL", "CODING", "SYSTEM_DESIGN", "MANAGERIAL", "CLIENT", "FINAL", "OFFER_HR"];

export function InterviewsPage() {
  const [upcoming, setUpcoming] = useState(true);
  const list = useQuery({
    queryKey: ["interviews", upcoming],
    queryFn: () => api.get<Page<Interview>>("/interviews", { upcoming: upcoming || undefined, sort: upcoming ? "scheduled_at" : "-scheduled_at", size: 100 }),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1>Interviews</h1>
        <Link className="btn-primary" to="/interviews/new">Schedule interview</Link>
      </div>
      <Card actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={upcoming} onChange={(e) => setUpcoming(e.target.checked)} />Upcoming only</label>}>
        {list.isLoading && <Spinner />}
        {list.data && (!list.data.items.length ? <Empty>No interviews {upcoming ? "coming up" : "yet"}.</Empty> : (
          <table className="min-w-full divide-y divide-slate-100">
            <thead><tr><th className="th">When</th><th className="th">Job</th><th className="th">Round</th><th className="th">Status</th><th className="th">Result</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {list.data.items.map((iv) => (
                <tr key={iv.id}>
                  <td className="td text-sm">{formatDateTime(iv.scheduled_at)}</td>
                  <td className="td"><Link className="font-medium hover:text-indigo-700" to={`/interviews/${iv.id}`}>{iv.job_title}</Link><div className="text-xs text-slate-500">{iv.company_name}</div></td>
                  <td className="td text-sm">#{iv.round_number} {humanize(iv.round_type)}</td>
                  <td className="td"><StatusBadge value={iv.status} /></td>
                  <td className="td"><StatusBadge value={iv.result} /></td>
                  <td className="td"><Link className="link text-sm" to={`/interviews/${iv.id}/prep`}>Prep</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </Card>
    </div>
  );
}

export function NewInterviewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [jobId, setJobId] = useState(params.get("job_id") ?? "");
  const [jobSearch, setJobSearch] = useState("");
  const jobs = useQuery({ queryKey: ["jobs", "pick", jobSearch], queryFn: () => api.get<Page<Job>>("/jobs", { q: jobSearch, size: 20 }) });
  const [form, setForm] = useState({ round_type: "TECHNICAL", mode: "VIDEO", scheduled_at: "", duration_minutes: "60", interviewers: "", meeting_link: "", topics: "", notes: "" });
  const create = useMutation({
    mutationFn: () => api.post<Interview>("/interviews", {
      job_id: Number(jobId), round_type: form.round_type, mode: form.mode,
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      interviewers: form.interviewers || null, meeting_link: form.meeting_link || null,
      topics: form.topics.split(",").map((t) => t.trim()).filter(Boolean), notes: form.notes || null,
    }),
    onSuccess: (iv) => navigate(`/interviews/${iv.id}`),
  });
  return (
    <div className="space-y-4">
      <h1>Schedule interview</h1>
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Find job"><input className="input" placeholder="Search title or company" value={jobSearch} onChange={(e) => setJobSearch(e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Job *">
              <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">Select a job</option>
                {jobs.data?.items.map((j) => <option key={j.id} value={j.id}>{j.title} — {j.company.name}</option>)}
                {jobId && !jobs.data?.items.some((j) => String(j.id) === jobId) && <option value={jobId}>Job #{jobId}</option>}
              </select>
            </Field>
          </div>
          <Field label="Round"><select className="input" value={form.round_type} onChange={(e) => setForm({ ...form, round_type: e.target.value })}>{ROUNDS.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</select></Field>
          <Field label="Mode"><select className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="VIDEO">Video</option><option value="PHONE">Phone</option><option value="ONSITE">Onsite</option></select></Field>
          <Field label="Date & time"><input className="input" type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} /></Field>
          <Field label="Duration (min)"><input className="input" type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></Field>
          <Field label="Interviewer(s)"><input className="input" value={form.interviewers} onChange={(e) => setForm({ ...form, interviewers: e.target.value })} /></Field>
          <Field label="Meeting link"><input className="input" value={form.meeting_link} onChange={(e) => setForm({ ...form, meeting_link: e.target.value })} /></Field>
          <div className="sm:col-span-3"><Field label="Topics" hint="comma separated"><input className="input" value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} /></Field></div>
          <div className="sm:col-span-3"><Field label="Notes"><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
        </div>
        {create.error && <div className="mt-2"><ErrorBox error={new Error(errorMessage(create.error))} /></div>}
        <button className="btn-primary mt-3" disabled={!jobId || create.isPending} onClick={() => create.mutate()}>Schedule</button>
      </Card>
    </div>
  );
}

export function InterviewDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const iv = useQuery({ queryKey: ["interview", id], queryFn: () => api.get<Interview>(`/interviews/${id}`) });
  const [feedback, setFeedback] = useState("");
  const [nextRound, setNextRound] = useState("");
  const complete = useMutation({
    mutationFn: (result: string) => api.post(`/interviews/${id}/complete`, { result, feedback: feedback || null, next_round: nextRound || null }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/interviews/${id}`, body), onSuccess: () => qc.invalidateQueries() });
  if (iv.isLoading) return <Spinner />;
  if (iv.error) return <ErrorBox error={iv.error} />;
  const i = iv.data!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1>Round {i.round_number}: {humanize(i.round_type)}</h1><p className="text-sm text-slate-600"><Link className="link" to={`/jobs/${i.job_id}`}>{i.job_title}</Link> · {i.company_name}</p></div>
        <div className="flex gap-2">
          <Link className="btn-primary" to={`/interviews/${i.id}/prep`}>Open prep</Link>
          {i.status !== "CANCELLED" && i.status !== "COMPLETED" && <button className="btn-secondary" onClick={() => update.mutate({ status: "CANCELLED" })}>Cancel</button>}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Details">
          <KeyValue items={[
            ["When", formatDateTime(i.scheduled_at)], ["Duration", i.duration_minutes ? `${i.duration_minutes} min` : "—"],
            ["Mode", humanize(i.mode)], ["Interviewers", i.interviewers],
            ["Meeting", i.meeting_link ? <a key="m" className="link" href={i.meeting_link} target="_blank" rel="noopener noreferrer">Join link</a> : "—"],
            ["Status", <StatusBadge key="s" value={i.status} />], ["Result", <StatusBadge key="r" value={i.result} />],
            ["Next round", i.next_round],
          ]} />
          {i.topics.length > 0 && <p className="mt-3 text-sm"><span className="label inline">Topics: </span>{i.topics.join(", ")}</p>}
          {i.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{i.notes}</p>}
          {i.feedback && <div className="mt-3"><div className="label">Feedback</div><p className="whitespace-pre-wrap text-sm">{i.feedback}</p></div>}
        </Card>
        <Card title="Record outcome">
          <Field label="Feedback / notes"><textarea className="input" rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></Field>
          <div className="mt-2"><Field label="Next round"><input className="input" value={nextRound} onChange={(e) => setNextRound(e.target.value)} /></Field></div>
          {complete.error && <div className="mt-2"><ErrorBox error={new Error(errorMessage(complete.error))} /></div>}
          <div className="mt-3 flex gap-2">
            {["PASSED", "FAILED", "ON_HOLD", "PENDING"].map((r) => <button key={r} className={r === "PASSED" ? "btn-primary" : "btn-secondary"} onClick={() => complete.mutate(r)}>{humanize(r)}</button>)}
          </div>
          <p className="mt-2 text-xs text-slate-500">Add the questions you were asked to the <Link className="link" to="/questions">question bank</Link>.</p>
        </Card>
      </div>
    </div>
  );
}
