import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { ScoreBreakdown } from "../../components/charts";
import { BackButton, Badge, Card, Chips, ErrorBox, KeyValue, Spinner, StatusBadge, JobStatusBadge, AddedViaTags } from "../../components/ui";
import type { Application, CV, FollowUp, Interview, JobDetail, Page } from "../../types/api";
import { formatDate, formatDateTime, humanize } from "../../utils/format";
import { FollowUpRow, QuickFollowUp } from "../followups/FollowUpParts";
import { FitSummary, JobDescription, KeyFacts, postingUrl } from "./JobParts";
import { DeleteJobButton } from "./DeleteJobButton";
import { JobComments } from "./JobComments";
import { APPLIED_STATUSES, JOB_STATUSES, NEW_STATUSES, PENDING_STATUSES } from "./JobsPage";

const MATCH_TONE: Record<string, "green" | "blue" | "amber" | "red" | "gray"> = {
  EXACT_MATCH: "green", PARTIAL_MATCH: "blue", RELATED: "amber", MISSING: "red", NICE_TO_HAVE: "gray",
};

/** The full scoring detail, for when the summary isn't enough. */
function ScoreDetails({ job }: { job: JobDetail }) {
  const m = job.match;
  if (!m) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-slate-600">How the score was calculated</summary>
      <div className="mt-3 space-y-3">
        <ScoreBreakdown components={m.components} />
        <ul className="grid gap-1 sm:grid-cols-2">
          {m.skills.map((s) => (
            <li key={`${s.importance}-${s.skill}`} className="flex items-center justify-between gap-2 text-xs">
              <span>{s.skill} <span className="text-slate-400">({s.importance.toLowerCase()})</span></span>
              <span><Badge tone={MATCH_TONE[s.match] ?? "gray"}>{humanize(s.match)}</Badge>{s.via && s.via !== s.skill && <span className="ml-1 text-slate-400">via {s.via}</span>}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-400">Fit: {humanize(m.experience_fit)} · Salary {humanize(m.salary_status)} · Location {humanize(m.location_fit)} · {job.score_version} · scored {formatDateTime(job.analyzed_at)}</p>
      </div>
    </details>
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

/** The one thing to do next, depending on where the job is in your search. */
function NextStep({ job, onApply, setStatus, busy }: { job: JobDetail; onApply: () => void; setStatus: (s: string) => void; busy: boolean }) {
  const url = postingUrl(job);
  const posting = url && <a className="btn-secondary" href={url} target="_blank" rel="noopener noreferrer">Open posting ↗</a>;
  let text: string;
  let actions: ReactNode;
  if (NEW_STATUSES.includes(job.status) || job.status === "REVIEWING") {
    text = "Is this worth applying to?";
    actions = <>
      <button className="btn-primary" disabled={busy} onClick={() => setStatus("SHORTLISTED")}>★ Shortlist</button>
      <button className="btn-secondary" disabled={busy} onClick={() => setStatus("NOT_RELEVANT")}>Not relevant</button>
      {posting}
    </>;
  } else if (PENDING_STATUSES.includes(job.status)) {
    text = job.recommended_cv ? `Ready to apply — send your “${job.recommended_cv.name}” CV.` : "Ready to apply.";
    actions = <>
      {url && <a className="btn-secondary" href={url} target="_blank" rel="noopener noreferrer">1. Apply on the site ↗</a>}
      <button className="btn-primary" onClick={onApply}>{url ? "2. Record that I applied" : "Record application"}</button>
    </>;
  } else if (["APPLIED", "RECRUITER_CONTACTED", "SCREENING"].includes(job.status)) {
    text = "Applied — waiting for a reply. Keep a follow-up date so it doesn't go quiet.";
    actions = <>
      <a className="btn-secondary" href="#follow-ups">Plan a follow-up</a>
      <Link className="btn-secondary" to={`/interviews/new?job_id=${job.id}`}>Got an interview</Link>
      {posting}
    </>;
  } else if (job.status === "INTERVIEW") {
    text = "Interviewing — prepare for the next round.";
    actions = <>
      <Link className="btn-primary" to={`/jobs/${job.id}/prep`}>Interview prep</Link>
      <Link className="btn-secondary" to={`/interviews/new?job_id=${job.id}`}>Add a round</Link>
    </>;
  } else if (["OFFER", "ACCEPTED"].includes(job.status)) {
    text = "You have an offer.";
    actions = <Link className="btn-primary" to="/offers">Compare offers</Link>;
  } else {
    text = `This job is ${humanize(job.status).toLowerCase()}.`;
    actions = <button className="btn-secondary" disabled={busy} onClick={() => setStatus("REVIEWING")}>Look at it again</button>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
      <span className="text-sm font-medium text-indigo-900">Next step: <span className="font-normal">{text}</span></span>
      <span className="flex-1" />
      <span className="flex flex-wrap gap-2">{actions}</span>
    </div>
  );
}

export function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const qc = useQueryClient();
  const applying = search.get("apply") === "1";
  const setApplying = (on: boolean) => { const n = new URLSearchParams(search); if (on) n.set("apply", "1"); else n.delete("apply"); setSearch(n, { replace: true }); };
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api.get<JobDetail>(`/jobs/${id}`) });
  const apps = useQuery({ queryKey: ["applications", { job_id: id }], queryFn: () => api.get<Page<Application>>("/applications", { job_id: id }) });
  const ivs = useQuery({ queryKey: ["interviews", { job_id: id }], queryFn: () => api.get<Page<Interview>>("/interviews", { job_id: id }) });
  const followups = useQuery({ queryKey: ["followups", { job_id: id }], queryFn: () => api.get<Page<FollowUp>>("/followups", { job_id: id, completed: false }) });
  const refresh = () => qc.invalidateQueries();
  const status = useMutation({ mutationFn: (s: string) => api.post(`/jobs/${id}/status`, { status: s }), onSuccess: refresh });
  const fetchJd = useMutation({ mutationFn: () => api.post(`/career-ops/jobs/${id}/fetch-jd`), onSuccess: refresh });
  // Arriving from "Follow up" in the list: jump to the follow-ups card.
  const loaded = !!job.data;
  useEffect(() => {
    if (loaded && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView?.({ block: "start" });
  }, [loaded, location.hash]);
  if (job.isLoading) return <Spinner />;
  if (job.error) return <ErrorBox error={job.error} />;
  const j = job.data!;
  const dup = (location.state as { duplicate?: boolean; matchedBy?: string } | null)?.duplicate;
  const applied = APPLIED_STATUSES.includes(j.status) || (apps.data?.items.length ?? 0) > 0;
  return (
    <div className="space-y-4">
      <BackButton fallback="/jobs" label="Back to jobs" />
      {dup && <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">This job already existed — the new source was added to it (matched by {humanize((location.state as { matchedBy?: string }).matchedBy)}).</div>}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1>{j.title} <span className="text-base font-normal text-slate-400" title="Job ID">#{j.id}</span></h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <Link className="link" to={`/companies/${j.company.id}`}>{j.company.name}</Link>
              {j.company.tier && <Badge>{j.company.tier.replace("TIER_", "Tier ")}</Badge>}
              <AddedViaTags values={j.added_via} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {j.match_score !== null && (
              <span className="text-right" title="How well this job fits you, 0–100">
                <span className="text-3xl font-bold text-indigo-700">{j.match_score}</span><span className="text-slate-400">/100</span>
                {j.match && <div><StatusBadge value={j.match.recommendation} /></div>}
              </span>
            )}
          </div>
        </div>
        <div className="mt-3"><KeyFacts job={j} /></div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
          <span className="text-slate-500">Status</span>
          <JobStatusBadge value={j.status} />
          <select className="input w-auto py-1 text-xs" aria-label="Job status" value={j.status} onChange={(e) => status.mutate(e.target.value)}>
            {JOB_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
          {j.score_stale && <Badge tone="amber" title="Your profile changed; the score refreshes by itself shortly">score updating</Badge>}
        </div>
      </Card>
      <NextStep job={j} onApply={() => setApplying(true)} setStatus={(s) => status.mutate(s)} busy={status.isPending} />
      {applying && <Card title="Record application"><ApplyForm job={j} onDone={() => { setApplying(false); refresh(); }} /></Card>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Does it fit you?">
            {j.match && j.match.confidence !== "HIGH" && (
              <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
                {j.match.confidence === "LOW" ? "No job description, so this score is a rough guess from the title. Add the description for a reliable score." : "The job has limited detail, so the score is less certain."}
              </p>
            )}
            <FitSummary job={j} />
            {j.recommended_cv && <p className="mt-3 text-sm">Best CV for this job: <Link className="link" to={`/cvs/${j.recommended_cv.id}`}>{j.recommended_cv.name}</Link></p>}
            <div className="mt-3"><ScoreDetails job={j} /></div>
          </Card>
          <Card title="Job description" actions={j.jd_status !== "OK" ? (
            <button className="btn-secondary" onClick={() => fetchJd.mutate()} disabled={fetchJd.isPending} title="Download the description from the posting">
              {fetchJd.isPending ? "Fetching…" : "Fetch description"}</button>) : undefined}>
            {fetchJd.error && <ErrorBox error={new Error(errorMessage(fetchJd.error))} />}
            <JobDescription text={j.original_jd} empty="No description saved yet. Fetch it from the posting, or edit the job to paste it." />
          </Card>
        </div>
        <div className="space-y-4">
          <div id="follow-ups" className="scroll-mt-16">
            <Card title="Follow-ups">
              {followups.data?.items.length ? (
                <ul className="mb-3 divide-y divide-slate-100">{followups.data.items.map((f) => <FollowUpRow key={f.id} f={f} showJob={false} />)}</ul>
              ) : <p className="mb-3 text-sm text-slate-500">{applied ? "No follow-up planned. Add one so this doesn't go quiet." : "Nothing planned."}</p>}
              <QuickFollowUp key={j.id} jobId={j.id} jobTitle={j.title} applied={applied} />
            </Card>
          </div>
          {(apps.data?.items.length || ivs.data?.items.length) ? (
            <Card title="Your progress">
              <ul className="space-y-2 text-sm">
                {apps.data?.items.map((a) => (
                  <li key={`a${a.id}`}><Link className="link" to={`/applications/${a.id}`}>Applied {formatDate(a.applied_on)}</Link> <StatusBadge value={a.status} />
                    <div className="text-xs text-slate-500">{a.cv_name ?? "CV not recorded"} · {humanize(a.method)}</div></li>
                ))}
                {ivs.data?.items.map((iv) => (
                  <li key={`i${iv.id}`}><Link className="link" to={`/interviews/${iv.id}`}>Round {iv.round_number}: {humanize(iv.round_type)}</Link> <StatusBadge value={iv.status} />
                    <div className="text-xs text-slate-500">{formatDateTime(iv.scheduled_at)}</div></li>
                ))}
              </ul>
            </Card>
          ) : null}
          <JobComments jobId={j.id} comments={j.comments ?? []} />
          {j.recruiter && (
            <Card title="Recruiter">
              <div className="text-sm">{j.recruiter.name} <StatusBadge value={j.recruiter.status} />
                {j.recruiter.email && <div className="text-xs"><a className="link" href={`mailto:${j.recruiter.email}`}>{j.recruiter.email}</a></div>}
                {j.recruiter.linkedin_url && <a className="link text-xs" href={j.recruiter.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
              </div>
            </Card>
          )}
          <CareerOpsPanel job={j} />
          <Card>
            <details>
              <summary className="cursor-pointer text-sm font-medium text-slate-700">More details</summary>
              <div className="mt-3 space-y-4 text-sm">
                <KeyValue items={[
                  ["Employment", j.employment_type ?? "—"], ["Seniority", humanize(j.seniority)],
                  ["Deadline", formatDate(j.application_deadline)], ["Added", formatDateTime(j.created_at)],
                ]} />
                <div><div className="label">Required skills</div><Chips items={j.required_skills} tone="indigo" /></div>
                <div><div className="label">Preferred skills</div><Chips items={j.preferred_skills} /></div>
                {j.manual_fields.length > 0 && <p className="text-xs text-slate-400">Entered by hand (kept over the description): {j.manual_fields.join(", ")}</p>}
                <div>
                  <div className="label">Found on</div>
                  <ul className="space-y-1">
                    {j.source_links.map((s) => (
                      <li key={s.id}>
                        <Badge tone="indigo">{humanize(s.source)}</Badge> {s.detail && <span className="text-xs text-slate-500">{s.detail}</span>}
                        {s.original_url && <a className="link block truncate text-xs" href={s.original_url} target="_blank" rel="noopener noreferrer">{s.original_url}</a>}
                      </li>
                    ))}
                  </ul>
                </div>
                {j.notes && <div><div className="label">Notes</div><p className="whitespace-pre-wrap">{j.notes}</p></div>}
                <div>
                  <div className="label">History</div>
                  <ul className="space-y-1 text-xs">
                    {j.activity.map((a, i) => <li key={i}><span className="text-slate-400">{formatDateTime(a.occurred_at)}</span> {humanize(a.action.replace(".", "_"))} {a.summary && <span className="text-slate-500">— {a.summary}</span>}</li>)}
                  </ul>
                </div>
                <div className="flex gap-2 border-t border-slate-100 pt-3">
                  <Link className="btn-secondary" to={`/jobs/${j.id}/prep`}>Interview prep</Link>
                  <DeleteJobButton jobId={j.id} title={j.title} onDeleted={() => navigate(j.status === "CLOSED" ? "/jobs/closed" : "/jobs")} />
                </div>
              </div>
            </details>
          </Card>
        </div>
      </div>
    </div>
  );
}
