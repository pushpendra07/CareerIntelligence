import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { ReactNode } from "react";
import { Badge, Card, ErrorBox, Spinner, Stat, PageIntro } from "../../components/ui";
import type { Priority } from "../../types/api";
import { formatDate, formatDateTime } from "../../utils/format";
import { FetchDescriptions } from "../jobs/FetchDescriptions";
import { BestMatches, ComingUp, GettingStarted, JobSources } from "./widgets";
import { CVAdviceSummary } from "../cvs/CVAdvice";

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

/** A big, clickable "this is waiting on you" card. */
function ActionCard({ label, value, detail, to, tone = "text-slate-900", children }: {
  label: string; value: number; detail?: string; to: string; tone?: string; children?: ReactNode;
}) {
  return (
    <div className={`card flex flex-col p-3 ${value ? "" : "opacity-70"}`}>
      <Link to={to} aria-label={`${label}: open`} className="group flex-1">
        <div className="text-xs font-medium text-slate-500 group-hover:text-indigo-700">{label}</div>
        <div className={`mt-1 text-3xl font-semibold ${value ? tone : "text-slate-400"}`}>{value}</div>
        {detail && <div className="text-xs text-slate-500">{detail}</div>}
      </Link>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export function DashboardPage() {
  const qc = useQueryClient();
  // While scores are being refreshed in the background, poll so the numbers update by themselves.
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/dashboard"),
    refetchInterval: (q) => (q.state.data?.summary.stale_scores ? 5000 : false) });
  const reanalyze = useMutation({
    mutationFn: () => api.post("/matches/reanalyze", { only_stale: true }, { wait: true }),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (dash.isLoading) return <Spinner />;
  if (dash.error) return <ErrorBox error={dash.error} />;
  const s = dash.data!.summary;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1>Today</h1><PageIntro>{today} — what's waiting on you, and how your search is going.</PageIntro></div>
        <div className="flex items-center gap-2">
          {s.stale_scores > 0 && (s.scores_updating || reanalyze.isPending ? (
            <span className="flex items-center gap-2 rounded-md px-3 text-sm text-slate-500" role="status">
              <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />Updating scores… {s.stale_scores} left
            </span>
          ) : (
            <button className="btn-secondary" title="Scores also update by themselves within a minute"
              onClick={() => reanalyze.mutate()}>Update {s.stale_scores} scores now</button>
          ))}
          {s.new_jobs > 0 && <Link className="btn-primary" to="/jobs/review">Review {s.new_jobs} new jobs</Link>}
          <Link className="btn-secondary" to="/jobs/new">Add Job</Link>
        </div>
      </div>
      <GettingStarted totalJobs={s.total_jobs + (s.closed_jobs ?? 0)} />
      <section aria-label="To do">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">To do</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <ActionCard label="New jobs to review" value={s.new_jobs} tone="text-indigo-700"
            detail={s.new_70_plus ? `${s.new_70_plus} score 70+` : "none score 70+"}
            to={s.new_70_plus ? "/jobs/review?min_score=70" : "/jobs/review"} />
          <ActionCard label="Ready to apply" value={s.ready_to_apply ?? 0} tone="text-indigo-700"
            detail="shortlisted, not applied yet" to="/jobs?tab=pending" />
          <ActionCard label="Follow-ups due" value={s.due_followups ?? 0} tone="text-amber-600"
            detail={s.overdue_followups ? `${s.overdue_followups} late` : `${s.pending_followups} planned in all`} to="/followups" />
          <ActionCard label="Interviews coming up" value={s.upcoming_interviews ?? 0} tone="text-emerald-600"
            detail="prepare with Interview prep" to="/interviews" />
          <ActionCard label="Good jobs without a description" value={s.missing_jd_70_plus ?? 0} tone="text-amber-600"
            detail="score 70+, but only a guess" to="/jobs?min_score=70&sort=-match_score">
            <FetchDescriptions compact />
          </ActionCard>
        </div>
      </section>
      <section aria-label="Progress">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Progress</h2>
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          <Stat label="Applied this week" value={s.applied_this_week ?? 0} to="/applications" />
          <Stat label="Applications" value={s.applications} to="/applications" />
          <Stat label="Response rate" value={pct(s.responses ?? 0, s.applications)} to="/analytics" />
          <Stat label="Interviews" value={s.interviews} to="/interviews?upcoming=false" />
          <Stat label="Offers" value={s.offers} tone="text-emerald-600" to="/offers" />
          <Stat label="Open jobs" value={s.total_jobs} to="/jobs" />
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Today's priorities">
            <TodaysPriorities items={dash.data!.priorities} />
          </Card>
          <BestMatches />
        </div>
        <div className="space-y-4">
          <ComingUp />
          <JobSources newThisWeek={s.new_this_week ?? 0} />
          <CVAdviceSummary />
          <Link to="/analytics" className="card block p-3 text-sm text-slate-600 hover:border-indigo-300">
            <span className="font-medium text-indigo-700">Insights →</span> response rate, which sources bring the best jobs, skill gaps and where your scores are lost.
          </Link>
        </div>
      </div>
    </div>
  );
}
