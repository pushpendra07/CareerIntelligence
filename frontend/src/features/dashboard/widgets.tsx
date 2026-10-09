import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, ScoreBadge, Spinner } from "../../components/ui";
import type { FollowUp, Interview, Job, Page } from "../../types/api";
import { formatDate, formatDateTime, humanize } from "../../utils/format";

type Profile = { core_skills?: string[] | null; total_experience_years?: number | string | null };
type Prefs = { target_titles?: string[] | null; target_salary?: number | string | null; min_salary?: number | string | null };
type ScannerStatus = {
  scannable: number;
  running: { started_at: string } | null;
  last_run: { started_at: string; status: string; stats: Record<string, unknown> } | null;
};
type CareerOpsStatus = { configured: boolean; last_import: { started_at: string; status: string; stats?: Record<string, number> } | null };
type Sheet = { id: number; title: string; last_imported_at: string | null; last_result: { created: number } | null };

const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** Setup steps for a new user; hidden once everything is done. */
export function GettingStarted({ totalJobs }: { totalJobs: number }) {
  const cvs = useQuery({ queryKey: ["cvs", "count"], queryFn: () => api.get<Page<unknown>>("/cvs", { size: 1 }) });
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile>("/profile") });
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: () => api.get<Prefs>("/preferences") });
  const scanner = useQuery({ queryKey: ["scanner"], queryFn: () => api.get<ScannerStatus>("/scanner/status") });
  if (!cvs.data || !profile.data || !prefs.data || !scanner.data) return null;
  const steps: { done: boolean; title: string; detail: string; to: string }[] = [
    { done: cvs.data.total > 0, title: "Upload your CV", detail: "PDF or Word. It fills your profile automatically.", to: "/cvs" },
    { done: (profile.data.core_skills?.length ?? 0) > 0 && !!profile.data.total_experience_years,
      title: "Check your profile", detail: "Years of experience and core skills — every job is scored against them.", to: "/profile" },
    { done: (prefs.data.target_titles?.length ?? 0) > 0, title: "Say what roles you want",
      detail: "Target job titles, skills and locations.", to: "/preferences" },
    { done: !!(prefs.data.target_salary || prefs.data.min_salary), title: "Set your salary target",
      detail: "Until you do, salary fit is scored as unknown.", to: "/preferences" },
    { done: scanner.data.scannable > 0, title: "Pick companies to scan",
      detail: "Tick Job search on companies whose job boards we can read.", to: "/companies" },
    { done: totalJobs > 0, title: "Get your first jobs", detail: "Scan now, import a Google Sheet, or add a job by hand.", to: "/settings" },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  return (
    <Card title={`Getting started — ${steps.length - left} of ${steps.length} done`}>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link to={s.to} className={`flex gap-2 rounded-md border p-2 text-sm transition ${s.done ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"}`}>
              <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"}`}>{s.done ? "✓" : i + 1}</span>
              <span>
                <span className={`font-medium ${s.done ? "text-emerald-800 line-through decoration-emerald-300" : "text-slate-800"}`}>{s.title}</span>
                <span className="block text-xs text-slate-500">{s.detail}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Top new jobs you haven't applied to, with one-click triage. */
export function BestMatches() {
  const qc = useQueryClient();
  const query = { status: ["NEW", "DISCOVERED"], min_score: 70, has_application: "false", closed: "false", sort: "-match_score", size: 8 };
  const jobs = useQuery({ queryKey: ["jobs", "best-matches"], queryFn: () => api.get<Page<Job>>("/jobs", query) });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/jobs/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const all = "/jobs?tab=new&min_score=70&has_application=false";
  return (
    <Card title="Best new matches to review" actions={<Link className="link text-sm" to={all}>See all {jobs.data ? `(${jobs.data.total})` : ""}</Link>}>
      {!jobs.data ? <Spinner /> : !jobs.data.items.length ? (
        <p className="text-sm text-slate-500">No new jobs scoring 70+ right now. Run a scan or import your sheets to find more.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {jobs.data.items.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-3 py-2">
              <ScoreBadge score={j.match_score} stale={j.score_stale} />
              <div className="min-w-0 flex-1">
                <Link to={`/jobs/${j.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{j.title}</Link>
                <div className="text-xs text-slate-500">
                  {j.company.name}{j.location ? ` · ${j.location}` : ""}{j.jd_status !== "OK" && <> · <span className="text-amber-700">no description</span></>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                  disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: j.id, status: "SHORTLISTED" })} title="Move to Pending → Shortlisted">
                  ★ Shortlist
                </button>
                <button type="button" className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                  disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: j.id, status: "NOT_RELEVANT" })} title="Move to Not pursuing">
                  Not relevant
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {setStatus.error && <p className="mt-2 text-sm text-rose-600">{errorMessage(setStatus.error)}</p>}
    </Card>
  );
}

/** Next interviews and follow-ups due. */
export function ComingUp() {
  const interviews = useQuery({
    queryKey: ["interviews", "upcoming", "dashboard"],
    queryFn: () => api.get<Page<Interview>>("/interviews", { upcoming: true, sort: "scheduled_at", size: 5 }),
  });
  const followups = useQuery({
    queryKey: ["followups", "open", "dashboard"],
    queryFn: () => api.get<Page<FollowUp>>("/followups", { completed: false, size: 50 }),
  });
  const due = (followups.data?.items ?? []).slice().sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
  return (
    <Card title="Coming up">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Interviews</h3>
      {!interviews.data ? <Spinner /> : !interviews.data.items.length ? (
        <p className="mb-3 text-sm text-slate-500">No interviews scheduled.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {interviews.data.items.map((i) => (
            <li key={i.id} className="text-sm">
              <Link className="font-medium text-slate-800 hover:text-indigo-700" to={`/interviews/${i.id}`}>{i.company_name} — Round {i.round_number}</Link>
              <div className="text-xs text-slate-500">{i.scheduled_at ? formatDateTime(i.scheduled_at) : "Time not set"} · {humanize(i.round_type)}</div>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Follow-ups</h3>
      {!followups.data ? <Spinner /> : !due.length ? (
        <p className="text-sm text-slate-500">Nothing to chase. <Link className="link" to="/followups">Add a reminder</Link></p>
      ) : (
        <ul className="space-y-1.5">
          {due.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-2 text-sm">
              <Link className="text-slate-800 hover:text-indigo-700" to="/followups">{f.title}{f.company_name ? ` · ${f.company_name}` : ""}</Link>
              <span className="shrink-0 text-xs">{f.overdue ? <Badge tone="red">overdue</Badge> : <span className="text-slate-500">{formatDate(f.due_date)}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** When each job source last ran, with a one-click scan. */
export function JobSources({ newThisWeek }: { newThisWeek: number }) {
  const qc = useQueryClient();
  const scanner = useQuery({
    queryKey: ["scanner"],
    queryFn: () => api.get<ScannerStatus>("/scanner/status"),
    refetchInterval: (q) => (q.state.data?.running ? 4000 : false),
    refetchIntervalInBackground: true,
  });
  const careerOps = useQuery({ queryKey: ["career-ops"], queryFn: () => api.get<CareerOpsStatus>("/career-ops/status") });
  const sheets = useQuery({ queryKey: ["sheets"], queryFn: () => api.get<Sheet[]>("/sheets") });
  const scan = useMutation({ mutationFn: () => api.post("/scanner/run", {}), onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner"] }) });
  const s = scanner.data;
  const lastSheet = (sheets.data ?? []).filter((x) => x.last_imported_at).sort((a, b) => (b.last_imported_at ?? "").localeCompare(a.last_imported_at ?? ""))[0];
  const row = (label: string, value: string, to: string) => (
    <li className="flex items-start justify-between gap-2 py-1.5 text-sm">
      <Link className="text-slate-700 hover:text-indigo-700" to={to}>{label}</Link>
      <span className="text-right text-xs text-slate-500">{value}</span>
    </li>
  );
  return (
    <Card title="Job sources" actions={
      <button className="btn-primary px-2 py-1 text-xs" disabled={!s || !!s.running || scan.isPending || s.scannable === 0} onClick={() => scan.mutate()}>
        {s?.running ? "Scanning…" : "Scan now"}
      </button>}>
      <p className="mb-1 text-sm"><b className="text-lg text-slate-900">{newThisWeek}</b> <span className="text-slate-500">new jobs in the last 7 days</span></p>
      <ul className="divide-y divide-slate-100">
        {row("Job scanner", !s ? "…" : s.running ? "scanning now…" : s.last_run
          ? `${formatDateTime(s.last_run.started_at)} · ${num(s.last_run.stats.new)} new · ${s.scannable} companies`
          : `never run · ${s.scannable} companies ready`, "/settings")}
        {row("Google Sheets", lastSheet ? `${formatDateTime(lastSheet.last_imported_at!)} · ${lastSheet.last_result?.created ?? 0} new` : "not imported yet", "/settings")}
        {careerOps.data?.configured && row("Career-Ops", careerOps.data.last_import
          ? `${formatDateTime(careerOps.data.last_import.started_at)} · ${careerOps.data.last_import.stats?.created ?? 0} new` : "not imported yet", "/settings")}
      </ul>
      {scan.error && <p className="mt-1 text-xs text-rose-600">{errorMessage(scan.error)}</p>}
    </Card>
  );
}
