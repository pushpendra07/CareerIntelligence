import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { ScoreBreakdown } from "../../components/charts";
import { BackButton, Badge, Card, Chips, ErrorBox, KeyValue, ScoreBadge, Spinner, StatusBadge, JobStatusBadge } from "../../components/ui";
import type { Application, CV, Interview, JobDetail, Page } from "../../types/api";
import { experienceRange, formatDate, formatDateTime, humanize, salaryRange } from "../../utils/format";
import { DeleteJobButton } from "./DeleteJobButton";
import { JOB_STATUSES } from "./JobsPage";

const MATCH_TONE: Record<string, "green" | "blue" | "amber" | "red" | "gray"> = {
  EXACT_MATCH: "green", PARTIAL_MATCH: "blue", RELATED: "amber", MISSING: "red", NICE_TO_HAVE: "gray",
};

function MatchPanel({ job }: { job: JobDetail }) {
  const m = job.match;
  if (!m) return <Card title="Match"><p className="text-sm text-slate-500">Not analyzed yet.</p></Card>;
  return (
    <Card title={<span>Match <span className="text-2xl font-bold text-indigo-700">{m.score}</span><span className="text-slate-400"> / 100</span></span>}
      actions={<div className="flex items-center gap-1"><StatusBadge value={m.recommendation} /><Badge tone="indigo">{humanize(m.action)}</Badge></div>}>
      {job.score_stale && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800">This score is stale — your profile, preferences or scoring changed. Re-analyze to refresh it.</p>}
      {m.confidence !== "HIGH" && <p className="mb-2 rounded bg-slate-50 p-2 text-xs text-slate-600">Confidence: {humanize(m.confidence)} — {m.confidence === "LOW" ? "add the job description for a reliable score." : "the job has limited detail."}</p>}
      <ScoreBreakdown components={m.components} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><div className="label">Strong matches</div><Chips items={m.strong_matches} tone="green" /></div>
        <div><div className="label">Missing / weak</div><Chips items={m.missing} tone="red" empty="None" /></div>
      </div>
      <div className="mt-3">
        <div className="label">Blockers</div>
        {m.blockers.length ? (
          <ul className="list-disc pl-5 text-sm text-rose-700">{m.blockers.map((b) => <li key={b.message}>{b.message}{b.severity === "HARD" && " (hard rule)"}</li>)}</ul>
        ) : <span className="text-sm text-slate-500">None</span>}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-600">Skill-by-skill</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {m.skills.map((s) => (
            <li key={`${s.importance}-${s.skill}`} className="flex items-center justify-between gap-2 text-xs">
              <span>{s.skill} <span className="text-slate-400">({s.importance.toLowerCase()})</span></span>
              <span><Badge tone={MATCH_TONE[s.match] ?? "gray"}>{humanize(s.match)}</Badge>{s.via && s.via !== s.skill && <span className="ml-1 text-slate-400">via {s.via}</span>}</span>
            </li>
          ))}
        </ul>
      </details>
      <p className="mt-3 text-xs text-slate-400">Fit: {humanize(m.experience_fit)} · Salary {humanize(m.salary_status)} · Location {humanize(m.location_fit)} · {job.score_version} · analyzed {formatDateTime(job.analyzed_at)}</p>
      {job.recommended_cv && (
        <p className="mt-2 text-sm">Recommended CV: <Link className="link" to={`/cvs/${job.recommended_cv.id}`}>{job.recommended_cv.name}</Link></p>
      )}
    </Card>
  );
}

function CareerOpsPanel({ job }: { job: JobDetail }) {
  const evaluation = job.career_ops_evaluation;
  if (!job.career_ops && !evaluation) return null;
  const ms = evaluation?.machine_summary ?? {};
  const sources = (job.career_ops?.sources as string[] | undefined) ?? [];
  return (
    <Card title="Career-Ops evaluation" actions={job.career_ops_score ? <Badge tone="indigo">{job.career_ops_score} / 5</Badge> : undefined}>
      <p className="mb-2 text-xs text-slate-500">Career-Ops' own 1–5 evaluation, kept separate from the 0–100 match score.</p>
      <KeyValue items={[
        ["Decision", ms.final_decision ?? "—"], ["Legitimacy", evaluation?.legitimacy ?? "—"],
        ["Archetype", evaluation?.archetype ?? "—"], ["Tracker status", job.career_ops_status ?? "—"],
        ["Report", job.career_ops_report ?? "—"], ["Found via", sources.join(", ") || "—"],
      ]} />
      {ms.top_strengths?.length > 0 && <div className="mt-2"><div className="label">Strengths</div><ul className="list-disc pl-5 text-sm">{ms.top_strengths.map((s: string) => <li key={s}>{s}</li>)}</ul></div>}
      {ms.soft_gaps?.length > 0 && <div className="mt-2"><div className="label">Gaps</div><ul className="list-disc pl-5 text-sm">{ms.soft_gaps.map((s: string) => <li key={s}>{s}</li>)}</ul></div>}
    </Card>
  );
}

function ApplyForm({ job, onDone }: { job: JobDetail; onDone: () => void }) {
  const cvs = useQuery({ queryKey: ["cvs"], queryFn: () => api.get<Page<CV>>("/cvs") });
  const [form, setForm] = useState({ method: "COMPANY_SITE", cv_version_id: "", notes: "", expected_salary: "", notice_period_days: "" });
  const apply = useMutation({
    mutationFn: () => api.post("/applications", {
      job_id: job.id, method: form.method,
      cv_version_id: form.cv_version_id ? Number(form.cv_version_id) : undefined,
      notes: form.notes || undefined,
      expected_salary: form.expected_salary || undefined,
      notice_period_days: form.notice_period_days ? Number(form.notice_period_days) : undefined,
    }),
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <select className="input" aria-label="Method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
        {["COMPANY_SITE", "ATS", "LINKEDIN", "NAUKRI", "INDEED", "EMAIL", "REFERRAL", "RECRUITER", "OTHER"].map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
      </select>
      <select className="input" aria-label="CV version" value={form.cv_version_id} onChange={(e) => setForm({ ...form, cv_version_id: e.target.value })}>
        <option value="">Recommended CV{job.recommended_cv ? ` (${job.recommended_cv.name})` : ""}</option>
        {cvs.data?.items.flatMap((cv) => cv.versions.map((v) => <option key={v.id} value={v.id}>{cv.name} v{v.version_number}</option>))}
      </select>
      <input className="input" placeholder="Expected CTC (e.g. 4000000)" value={form.expected_salary} onChange={(e) => setForm({ ...form, expected_salary: e.target.value })} />
      <input className="input" placeholder="Notice period (days)" value={form.notice_period_days} onChange={(e) => setForm({ ...form, notice_period_days: e.target.value })} />
      <input className="input sm:col-span-2" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      {apply.error && <div className="sm:col-span-3"><ErrorBox error={new Error(errorMessage(apply.error))} /></div>}
      <button className="btn-primary" disabled={apply.isPending} onClick={() => apply.mutate()}>Record application</button>
    </div>
  );
}

export function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [applying, setApplying] = useState(false);
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api.get<JobDetail>(`/jobs/${id}`) });
  const apps = useQuery({ queryKey: ["applications", { job_id: id }], queryFn: () => api.get<Page<Application>>("/applications", { job_id: id }) });
  const ivs = useQuery({ queryKey: ["interviews", { job_id: id }], queryFn: () => api.get<Page<Interview>>("/interviews", { job_id: id }) });
  const refresh = () => qc.invalidateQueries();
  const status = useMutation({ mutationFn: (s: string) => api.post(`/jobs/${id}/status`, { status: s }), onSuccess: refresh });
  const analyze = useMutation({ mutationFn: () => api.post(`/matches/jobs/${id}`), onSuccess: refresh });
  const fetchJd = useMutation({ mutationFn: () => api.post(`/career-ops/jobs/${id}/fetch-jd`), onSuccess: refresh });
  if (job.isLoading) return <Spinner />;
  if (job.error) return <ErrorBox error={job.error} />;
  const j = job.data!;
  const dup = (location.state as { duplicate?: boolean; matchedBy?: string } | null)?.duplicate;
  return (
    <div className="space-y-4">
      <BackButton fallback="/jobs" label="Back to jobs" />
      {dup && <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">This job already existed — the new source was added to it (matched by {humanize((location.state as { matchedBy?: string }).matchedBy)}).</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{j.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Link className="link" to={`/companies/${j.company.id}`}>{j.company.name}</Link>
            {j.company.tier && <StatusBadge value={j.company.tier} />}
            <StatusBadge value={j.company.verification_status} />
            <ScoreBadge score={j.match_score} stale={j.score_stale} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <JobStatusBadge value={j.status} />
          <select className="input w-48" aria-label="Job status" value={j.status} onChange={(e) => status.mutate(e.target.value)}>
            {JOB_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
          <button className="btn-secondary" onClick={() => analyze.mutate()} disabled={analyze.isPending}>Re-analyze</button>
          <Link className="btn-secondary" to={`/jobs/${j.id}/prep`}>Interview prep</Link>
          <button className="btn-primary" onClick={() => setApplying((a) => !a)}>Apply</button>
          <DeleteJobButton jobId={j.id} title={j.title} onDeleted={() => navigate(j.status === "CLOSED" ? "/jobs/closed" : "/jobs")} />
        </div>
      </div>
      {applying && <Card title="Record application"><ApplyForm job={j} onDone={() => { setApplying(false); refresh(); }} /></Card>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <MatchPanel job={j} />
          <Card title="Job information">
            <KeyValue items={[
              ["Location", j.location ?? j.locations.join(", ")], ["Work model", humanize(j.work_model)],
              ["Employment", j.employment_type ?? "—"], ["Seniority", humanize(j.seniority)],
              ["Experience", experienceRange(j.experience_min, j.experience_max)],
              ["Salary", j.salary_text ?? salaryRange(j.salary_min, j.salary_max, j.salary_currency)],
              ["Posted", formatDate(j.posting_date)], ["Deadline", formatDate(j.application_deadline)],
            ]} />
          </Card>
          <Card title="Parsed requirements">
            <div className="space-y-3 text-sm">
              <div><div className="label">Required skills</div><Chips items={j.required_skills} tone="indigo" /></div>
              <div><div className="label">Preferred skills</div><Chips items={j.preferred_skills} /></div>
              {j.responsibilities.length > 0 && <div><div className="label">Responsibilities</div><ul className="list-disc pl-5">{j.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul></div>}
              {j.qualifications.length > 0 && <div><div className="label">Qualifications</div><ul className="list-disc pl-5">{j.qualifications.map((r) => <li key={r}>{r}</li>)}</ul></div>}
              {(j.parsed_jd.certifications ?? []).length > 0 && <div><div className="label">Certifications</div><Chips items={j.parsed_jd.certifications ?? []} /></div>}
              {j.manual_fields.length > 0 && <p className="text-xs text-slate-400">Entered manually (kept over JD parsing): {j.manual_fields.join(", ")}</p>}
            </div>
          </Card>
          <Card title="Original job description" actions={j.jd_status !== "OK" ? (
            <button className="btn-secondary" onClick={() => fetchJd.mutate()} disabled={fetchJd.isPending}>Fetch via Career-Ops</button>) : undefined}>
            {fetchJd.error && <ErrorBox error={new Error(errorMessage(fetchJd.error))} />}
            {j.original_jd ? <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap text-xs text-slate-700">{j.original_jd}</pre>
              : <p className="text-sm text-slate-500">No JD stored. Edit the job to paste it, or fetch it via Career-Ops.</p>}
          </Card>
        </div>
        <div className="space-y-4">
          <CareerOpsPanel job={j} />
          <Card title="Sources">
            <ul className="space-y-2 text-sm">
              {j.source_links.map((s) => (
                <li key={s.id}>
                  <Badge tone="indigo">{humanize(s.source)}</Badge> {s.detail && <span className="text-xs text-slate-500">{s.detail}</span>}
                  {s.original_url && <a className="link block truncate text-xs" href={s.original_url} target="_blank" rel="noopener noreferrer">{s.original_url}</a>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Recruiter">
            {j.recruiter ? <div className="text-sm">{j.recruiter.name} <StatusBadge value={j.recruiter.status} />
              {j.recruiter.email && <div className="text-xs">{j.recruiter.email}</div>}
              {j.recruiter.linkedin_url && <a className="link text-xs" href={j.recruiter.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
            </div> : <p className="text-sm text-slate-500">None linked</p>}
          </Card>
          <Card title="Applications">
            {apps.data?.items.length ? apps.data.items.map((a) => (
              <div key={a.id} className="text-sm"><Link className="link" to={`/applications/${a.id}`}>Applied {formatDate(a.applied_on)}</Link> <StatusBadge value={a.status} /><div className="text-xs text-slate-500">{a.cv_name ?? "CV not recorded"}</div></div>
            )) : <p className="text-sm text-slate-500">Not applied yet</p>}
          </Card>
          <Card title="Interviews" actions={<Link className="btn-secondary" to={`/interviews/new?job_id=${j.id}`}>Schedule</Link>}>
            {ivs.data?.items.length ? ivs.data.items.map((iv) => (
              <div key={iv.id} className="text-sm"><Link className="link" to={`/interviews/${iv.id}`}>Round {iv.round_number}: {humanize(iv.round_type)}</Link> <StatusBadge value={iv.status} /><div className="text-xs text-slate-500">{formatDateTime(iv.scheduled_at)}</div></div>
            )) : <p className="text-sm text-slate-500">None</p>}
          </Card>
          {j.notes && <Card title="Notes"><p className="whitespace-pre-wrap text-sm">{j.notes}</p></Card>}
          <Card title="Activity">
            <ul className="space-y-1 text-xs">
              {j.activity.map((a, i) => <li key={i}><span className="text-slate-400">{formatDateTime(a.occurred_at)}</span> {humanize(a.action.replace(".", "_"))} {a.summary && <span className="text-slate-500">— {a.summary}</span>}</li>)}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
