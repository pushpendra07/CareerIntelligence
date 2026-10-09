import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { BarChart, Funnel } from "../../components/charts";
import { Badge, Card, ErrorBox, Spinner, Stat, PageIntro } from "../../components/ui";
import type { Bar, Priority } from "../../types/api";
import { formatDate, formatDateTime, humanize } from "../../utils/format";
import { BestMatches, ComingUp, GettingStarted, JobSources } from "./widgets";

interface Dashboard {
  summary: Record<string, number>;
  priorities: Priority[];
  funnels: Record<string, { stage: string; value: number }[]>;
}

const PRIORITY_LINK: Record<string, (id: number | null) => string> = {
  job: (id) => `/jobs/${id}`,
  interview: (id) => `/interviews/${id}`,
  followup: () => "/followups",
  offer: () => "/offers",
  reanalyze: () => "/jobs?stale=true",
  jobs_missing_jd: () => "/jobs?sort=-match_score",
};

const PRIORITY_TONE: Record<string, "green" | "blue" | "amber" | "red" | "indigo" | "gray"> = {
  INTERVIEW: "green", FOLLOW_UP: "amber", OFFER: "red", APPLY: "indigo", REANALYZE: "gray", ADD_JD: "gray",
};

export function TodaysPriorities({ items }: { items: Priority[] }) {
  if (!items.length) return <p className="text-sm text-slate-500">Nothing urgent today. Review your best matches above, or scan for new jobs.</p>;
  return (
    <ol className="divide-y divide-slate-100">
      {items.map((p) => (
        <li key={`${p.type}-${p.position}`} className="flex items-start gap-3 py-2">
          <span className="mt-0.5 w-5 text-right text-sm font-semibold text-slate-400">{p.position}.</span>
          <div className="min-w-0 flex-1">
            <Link className="font-medium text-slate-800 hover:text-indigo-700" to={(PRIORITY_LINK[p.link.entity] ?? (() => "/"))(p.link.id)}>
              {p.title}
            </Link>
            {p.detail && <div className="text-xs text-slate-500">{p.detail}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {p.overdue && <Badge tone="red">overdue</Badge>}
            {p.due && <span className="text-xs text-slate-500">{p.due.length > 10 ? formatDateTime(p.due) : formatDate(p.due)}</span>}
            <Badge tone={PRIORITY_TONE[p.type] ?? "gray"}>{p.type.replace("_", " ").toLowerCase()}</Badge>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DashboardPage() {
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/dashboard") });
  const charts = useQuery({ queryKey: ["dashboard", "charts"], queryFn: () => api.get<Record<string, Bar[]>>("/dashboard/charts") });
  const reanalyze = useMutation({
    mutationFn: () => api.post("/matches/reanalyze", { only_stale: true }, { wait: true }),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (dash.isLoading) return <Spinner />;
  if (dash.error) return <ErrorBox error={dash.error} />;
  const s = dash.data!.summary;
  const c = charts.data;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1>Dashboard</h1><PageIntro>What to do today, and how your job search is going. Click any number to see those jobs.</PageIntro></div>
        <div className="flex gap-2">
          {s.stale_scores > 0 && (
            <button className="btn-secondary" disabled={reanalyze.isPending} onClick={() => reanalyze.mutate()}>
              {reanalyze.isPending ? "Re-analyzing…" : `Re-analyze ${s.stale_scores} stale`}
            </button>
          )}
          <Link className="btn-primary" to="/jobs/new">Add Job</Link>
        </div>
      </div>
      <GettingStarted totalJobs={s.total_jobs + (s.closed_jobs ?? 0)} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Jobs">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Jobs</h2>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Open jobs" value={s.total_jobs} to="/jobs" />
            <Stat label="New to review" value={s.new_jobs} to="/jobs?tab=new" />
            <Stat label="Shortlisted" value={s.shortlisted} to="/jobs?tab=pending&status=SHORTLISTED" />
            <Stat label="Excellent fit (90+)" value={s.jobs_90_plus} tone="text-emerald-600" to="/jobs?min_score=90" />
            <Stat label="Strong fit (80+)" value={s.jobs_80_plus} tone="text-sky-600" to="/jobs?min_score=80" />
            <Stat label="Closed positions" value={s.closed_jobs ?? 0} tone="text-zinc-500" to="/jobs/closed" />
          </div>
        </section>
        <section aria-label="Your pipeline">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Your pipeline</h2>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Applications" value={s.applications} to="/applications" />
            <Stat label="Applied this week" value={s.applied_this_week ?? 0} to="/applications" />
            <Stat label="Interviews" value={s.interviews} to="/interviews?upcoming=false" />
            <Stat label="Offers" value={s.offers} tone="text-emerald-600" to="/offers" />
            <Stat label="Rejections" value={s.rejections} tone="text-rose-600" to="/applications?status=REJECTED" />
            <Stat label={s.overdue_followups ? `Follow-ups (${s.overdue_followups} overdue)` : "Follow-ups to do"} value={s.pending_followups}
              tone={s.overdue_followups ? "text-amber-600" : undefined} to="/followups" />
          </div>
        </section>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <BestMatches />
          <Card title="Today's priorities">
            <TodaysPriorities items={dash.data!.priorities} />
          </Card>
        </div>
        <div className="space-y-4">
          <ComingUp />
          <JobSources newThisWeek={s.new_this_week ?? 0} />
          <Card title="Your pipeline">
            <div className="space-y-4">
              {Object.entries(dash.data!.funnels).map(([name, stages]) => (
                <div key={name}>
                  <div className="mb-1 text-xs font-semibold uppercase text-slate-400">{humanize(name)}</div>
                  <Funnel stages={stages} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Insights</h2>
      {c && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card title="Jobs by score"><BarChart data={c.jobs_by_score} color="bg-emerald-500" /></Card>
          <Card title="Jobs by source"><BarChart data={c.jobs_by_source} /></Card>
          <Card title="Applications by status"><BarChart data={c.applications_by_status} color="bg-sky-500" /></Card>
          <Card title="Interviews over time"><BarChart data={c.interviews_over_time} color="bg-emerald-500" /></Card>
          <Card title="Applications by company"><BarChart data={c.applications_by_company} color="bg-sky-500" /></Card>
          <Card title="Jobs by location"><BarChart data={c.jobs_by_location} /></Card>
          <Card title="Jobs by work model"><BarChart data={c.jobs_by_work_model} /></Card>
          <Card title="Top companies (avg score)">
            <BarChart data={c.top_companies} format={(b) => `${b.avg_score ?? "—"} (${b.value})`} color="bg-violet-500" />
          </Card>
          <Card title="Top requested skills"><BarChart data={c.top_requested_skills} color="bg-violet-500" /></Card>
          <Card title="Skill gaps (missing required)" className="md:col-span-2 xl:col-span-3">
            <BarChart data={c.skill_gaps} color="bg-rose-500" format={(b) => `${b.value} jobs · avg ${b.avg_job_score}`} empty="No skill gaps detected yet" />
          </Card>
        </div>
      )}
    </div>
  );
}
