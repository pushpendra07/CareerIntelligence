import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { ReactNode } from "react";
import { Badge, Card, ErrorBox, IconChip, Spinner, Stat, type Accent } from "../../components/ui";
import { Icon } from "../../components/icons";
import type { Priority } from "../../types/api";
import { formatDate, formatDateTime } from "../../utils/format";
import { FetchDescriptions } from "../jobs/FetchDescriptions";
import { BestMatches, ComingUp, GettingStarted, JobSources } from "./widgets";
import { WeeklyGoals } from "./WeeklyGoals";
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
function ActionCard({ label, value, detail, to, tone = "text-slate-900", icon, accent, children }: {
  label: string; value: number; detail?: string; to: string; tone?: string; icon: string; accent: Accent; children?: ReactNode;
}) {
  return (
    <div className={`card lift flex flex-col p-4 ${value ? "" : "bg-surface/60"}`}>
      <Link to={to} aria-label={`${label}: open`} className="group flex-1">
        <div className="flex items-start justify-between gap-2">
          <IconChip icon={icon} accent={value ? accent : "slate"} />
          <span aria-hidden className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500">→</span>
        </div>
        <div className={`mt-3 font-display text-3xl font-bold tracking-tight tabular-nums ${value ? tone : "text-slate-300"}`}>{value}</div>
        <div className="mt-0.5 text-sm font-medium text-slate-700">{label}</div>
        {detail && <div className="text-xs text-slate-500">{detail}</div>}
      </Link>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function greeting(hour: number): string {
  return hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export function DashboardPage() {
  const qc = useQueryClient();
  // While scores are being refreshed in the background, poll so the numbers update by themselves.
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<{ full_name?: string | null }>("/profile"), retry: false });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/dashboard"),
    refetchInterval: (q) => (q.state.data?.summary.stale_scores ? 5000 : false) });
  const reanalyze = useMutation({
    mutationFn: () => api.post("/matches/reanalyze", { only_stale: true }, { wait: true }),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (dash.isLoading) return <Spinner />;
  if (dash.error) return <ErrorBox error={dash.error} />;
  const s = dash.data!.summary;
  const now = new Date();
  const today = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const first = profile.data?.full_name?.trim().split(/\s+/)[0];
  const facts = [
    s.new_jobs ? `${s.new_jobs} new jobs to review` : null,
    s.due_followups ? `${s.due_followups} follow-up${s.due_followups === 1 ? "" : "s"} due` : null,
    s.upcoming_interviews ? `${s.upcoming_interviews} interview${s.upcoming_interviews === 1 ? "" : "s"} coming up` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#4f46e5] via-[#6d4ee8] to-[#a855f7] p-6 text-white shadow-[0_20px_40px_-20px_rgb(79_70_229/0.7)] sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 right-40 h-56 w-56 rounded-full bg-[#f0abfc]/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="text-sm font-medium text-white/70">{today}</div>
            <h1 className="mt-1 text-3xl text-white sm:text-[34px]">{greeting(now.getHours())}{first ? `, ${first}` : ""} 👋</h1>
            <p className="mt-2 text-[15px] text-white/80">
              {facts.length ? `You have ${facts.join(", ")}.` : "Nothing urgent today: a good moment to scan for new jobs."}
              {" "}{s.applied_this_week ? `${s.applied_this_week} applications sent this week.` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {s.stale_scores > 0 && (s.scores_updating || reanalyze.isPending ? (
              <span className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm text-white/90 ring-1 ring-white/20" role="status">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />Updating scores… {s.stale_scores} left
              </span>
            ) : (
              <button className="btn bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/20" title="Scores also update by themselves within a minute"
                onClick={() => reanalyze.mutate()}>Update {s.stale_scores} scores now</button>
            ))}
            {s.new_jobs > 0 && (
              <Link className="btn bg-white text-[#4338ca] shadow-lg shadow-black/10 hover:bg-[#eef2ff]" to="/jobs/review">
                <Icon name="sparkles" />Review {s.new_jobs} new jobs
              </Link>
            )}
          </div>
        </div>
      </section>
      <GettingStarted totalJobs={s.total_jobs + (s.closed_jobs ?? 0)} />
      <section aria-label="To do">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">To do</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <ActionCard label="New jobs to review" value={s.new_jobs} tone="text-indigo-700" icon="sparkles" accent="indigo"
            detail={s.new_70_plus ? `${s.new_70_plus} score 70+` : "none score 70+"}
            to={s.new_70_plus ? "/jobs/review?min_score=70" : "/jobs/review"} />
          <ActionCard label="Ready to apply" value={s.ready_to_apply ?? 0} tone="text-violet-700" icon="star" accent="violet"
            detail="shortlisted, not applied yet" to="/jobs?tab=pending" />
          <ActionCard label="Follow-ups due" value={s.due_followups ?? 0} tone="text-amber-600" icon="bell" accent="amber"
            detail={s.overdue_followups ? `${s.overdue_followups} late` : `${s.pending_followups} planned in all`} to="/followups" />
          <ActionCard label="Interviews coming up" value={s.upcoming_interviews ?? 0} tone="text-emerald-600" icon="calendar" accent="emerald"
            detail="prepare with Interview prep" to="/interviews" />
          <ActionCard label="Good jobs without a description" value={s.missing_jd_70_plus ?? 0} tone="text-rose-600" icon="doc" accent="rose"
            detail="score 70+, but only a guess" to="/jobs?min_score=70&sort=-match_score">
            <FetchDescriptions compact />
          </ActionCard>
        </div>
      </section>
      <section aria-label="Progress">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Progress</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Applied this week" value={s.applied_this_week ?? 0} to="/applications" icon="send" accent="indigo" />
          <Stat label="Applications" value={s.applications} to="/applications" icon="inbox" accent="sky" />
          <Stat label="Response rate" value={pct(s.responses ?? 0, s.applications)} to="/analytics" icon="trend" accent="violet" />
          <Stat label="Interviews" value={s.interviews} to="/interviews?upcoming=false" icon="calendar" accent="emerald" />
          <Stat label="Offers" value={s.offers} tone="text-emerald-600" to="/offers" icon="trophy" accent="amber" />
          <Stat label="Open jobs" value={s.total_jobs} to="/jobs" icon="jobs" accent="slate" />
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card title="Today's priorities">
            <TodaysPriorities items={dash.data!.priorities} />
          </Card>
          <BestMatches />
        </div>
        <div className="min-w-0 space-y-4">
          <WeeklyGoals />
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
