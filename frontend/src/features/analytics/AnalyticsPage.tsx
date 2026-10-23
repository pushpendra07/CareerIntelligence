import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { BarChart, Funnel } from "../../components/charts";
import { Card, ErrorBox, Spinner, PageIntro, Stat, WeekChange } from "../../components/ui";
import type { Bar } from "../../types/api";
import { formatDate, humanize, sourceName } from "../../utils/format";
import { CVAdviceSummary } from "../cvs/CVAdvice";
import { Findings, KpiCard, ReportChart, type Finding, type Kpi, type Report } from "../reports/ReportsPage";

interface Analytics {
  scores: {
    average_component_factor: Record<string, number>;
    by_recommendation: Bar[];
    average_score: string | null;
    average_score_applied: string | null;
    interview_rate_by_score: { label: string; applications: number; answers: number; interviews: number }[];
  };
  skill_gaps: Bar[];
  top_requested_skills: Bar[];
}
type SourceQuality = { label: string; value: number; avg_score: number | null; strong: number; applied: number };
type TopCompany = { id: number; label: string; value: number; jobs: number; avg_score: number | null; tier: string | null };
type Charts = Record<string, Bar[]> & { source_quality?: SourceQuality[]; top_companies?: TopCompany[] };

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

type Summary = { from: string; to: string; days: number; previous: { from: string; to: string };
  kpis: (Kpi & { report: string })[]; findings: Finding[] };
/** Periods for the summary; each matches a quick range on the Reports page. */
const PERIODS = [{ days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 90, label: "90 days" }];
const reportLink = (days: number) => (report: string) => `/reports/${report}?range=${days}d`;

/** The executive summary: the KPIs that matter most against the period before, and what the
 * numbers say (problems first), each linking to the report or the place to act. */
function ExecutiveSummary({ days }: { days: number }) {
  const s = useQuery({ queryKey: ["reports", "summary", days], queryFn: () => api.get<Summary>("/reports/summary", { days }),
    placeholderData: (prev) => prev });
  if (s.isLoading) return <Spinner />;
  if (s.error) return <ErrorBox error={s.error} />;
  const d = s.data!;
  return (
    <>
      <p className="text-xs text-slate-500">
        {formatDate(d.from)} – {formatDate(d.to)}, compared with {formatDate(d.previous.from)} – {formatDate(d.previous.to)}.
        {s.isFetching && " Updating…"}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {d.kpis.map((k) => <KpiCard key={`${k.report}-${k.key}`} k={k} to={reportLink(days)(k.report)} />)}
      </div>
      <Findings items={d.findings} title="What the numbers say" reportLink={reportLink(days)} />
    </>
  );
}

/** Charts from one report for the same period, by chart id. */
function ReportCharts({ name, days, ids, title }: { name: string; days: number; ids: string[]; title: string }) {
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - days + 1);
  const r = useQuery({ queryKey: ["reports", name, "insights", days],
    queryFn: () => api.get<Report>(`/reports/${name}`, { from: iso(from), to: iso(to) }), placeholderData: (prev) => prev });
  if (r.isLoading) return <Card title={title}><Spinner /></Card>;
  const charts = ids.map((id) => r.data?.charts.find((c) => c.id === id)).filter((c) => !!c);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {charts.map((c) => <ReportChart key={c.id} c={{ ...c, filter: null }} />)}
    </div>
  );
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Jobs found and applications per week, for the last 12 weeks (from the Overview report). */
function WeeklyActivity() {
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - 7 * 12 + 1);
  const r = useQuery({
    queryKey: ["reports", "overview", "weekly-12"],
    queryFn: () => api.get<Report>("/reports/overview", { from: iso(from), to: iso(to), group: "week" }),
    retry: false,
  });
  const charts = r.data?.charts ?? [];
  const jobs = charts.find((c) => c.id === "jobs")?.data ?? [];
  const activity = charts.find((c) => c.id === "activity")?.data ?? [];
  if (r.isLoading) return <Card title="Last 12 weeks"><Spinner /></Card>;
  if (!jobs.length) return null;
  const rows = jobs.map((j, i) => ({ label: j.label, "Jobs found": Number(j.value ?? 0), Applications: Number(activity[i]?.Applications ?? 0) }));
  return (
    <ReportChart c={{
      id: "weekly", title: "Last 12 weeks: jobs found and applications sent", kind: "bar", filter: null,
      note: "Each bar is one week (Monday to Sunday).",
      series: [{ key: "Jobs found", label: "Jobs found" }, { key: "Applications", label: "Applications" }], data: rows,
    }} />
  );
}

/** Companies with the most good (70+) jobs you haven't applied to yet, linked to the company. */
function TopCompanies({ items }: { items: TopCompany[] }) {
  if (!items.length) return <p className="py-4 text-center text-sm text-slate-400">No company has a job scoring 70+ waiting for you.</p>;
  const max = Math.max(...items.map((c) => c.value), 1);
  return (
    <ul className="space-y-1.5">
      {items.map((c) => (
        <li key={c.id} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-xs">
          <Link className="truncate text-slate-700 hover:text-indigo-700" to={`/companies/${c.id}`} title={c.label}>{c.label}</Link>
          <span className="h-3 rounded bg-slate-100"><span className="block h-3 rounded bg-violet-500" style={{ width: `${(c.value / max) * 100}%` }} /></span>
          <span className="whitespace-nowrap text-right tabular-nums text-slate-700">{c.value} of {c.jobs} · avg {c.avg_score ?? "—"}</span>
        </li>
      ))}
    </ul>
  );
}

/** One plain-words conclusion above a chart. */
function Takeaway({ children }: { children: ReactNode }) {
  return <p className="mb-3 rounded-md bg-indigo-50/60 px-3 py-2 text-sm text-indigo-900">{children}</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </section>
  );
}

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const days = PERIODS.some((p) => String(p.days) === params.get("days")) ? Number(params.get("days")) : 30;
  const a = useQuery({ queryKey: ["analytics"], queryFn: () => api.get<Analytics>("/dashboard/analytics") });
  const f = useQuery({ queryKey: ["funnels"], queryFn: () => api.get<Record<string, { stage: string; value: number }[]>>("/dashboard/funnels") });
  const c = useQuery({ queryKey: ["dashboard", "charts"], queryFn: () => api.get<Charts>("/dashboard/charts") });
  const d = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<{ summary: Record<string, number> }>("/dashboard") });
  // Wait for the counts too, so the cards never flash "0" before the real numbers.
  if (a.isLoading || d.isLoading) return <Spinner />;
  if (a.error) return <ErrorBox error={a.error} />;
  const s = a.data!.scores;
  const sum = d.data?.summary ?? {};
  const charts = c.data;
  const apps = sum.applications ?? 0;
  const responses = sum.responses ?? 0;

  const sources = (charts?.source_quality ?? []).filter((q) => q.value > 0);
  const bestSource = sources.filter((q) => q.value >= 3 && q.avg_score !== null)
    .sort((x, y) => (y.avg_score ?? 0) - (x.avg_score ?? 0))[0];
  const lost = Object.entries(s.average_component_factor).sort((x, y) => x[1] - y[1]);
  const weakest = lost[0];
  const gap = a.data!.skill_gaps[0];
  const bands = s.interview_rate_by_score.filter((r) => r.applications > 0);
  const high = bands.filter((b) => b.label === "90-100" || b.label === "80-89");
  const low = bands.filter((b) => !high.includes(b));
  const rate = (rows: typeof bands) => {
    const n = rows.reduce((t, b) => t + b.applications, 0);
    return { n, answers: rows.reduce((t, b) => t + b.answers, 0), pct: pct(rows.reduce((t, b) => t + b.answers, 0), n) };
  };
  const hi = rate(high), lo = rate(low);
  const workModels = (charts?.jobs_by_work_model ?? []).filter((w) => w.label !== "UNKNOWN");
  const unknownModel = charts?.jobs_by_work_model?.find((w) => w.label === "UNKNOWN")?.value ?? 0;
  const avg = s.average_score ? Number(s.average_score) : null;
  const avgApplied = s.average_score_applied ? Number(s.average_score_applied) : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1>Insights</h1><PageIntro>What's working in your search, where good jobs come from, and what to improve.</PageIntro></div>
        <Link className="btn-secondary" to="/reports">Reports for any period →</Link>
      </div>

      <Section title="Executive summary">
        <div role="group" aria-label="Period" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-slate-500">Last</span>
          {PERIODS.map((p) => (
            <button key={p.days} type="button" aria-pressed={p.days === days}
              onClick={() => setParams((old) => { const n = new URLSearchParams(old); n.set("days", String(p.days)); return n; }, { replace: true })}
              className={`rounded-full px-3 py-1 text-sm ${p.days === days ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <ExecutiveSummary days={days} />
      </Section>

      <Section title="Pipeline health">
        <ReportCharts name="pipeline" days={days} ids={["stages", "age"]} title="Pipeline health" />
        <p className="text-xs"><Link className="link" to={reportLink(days)("pipeline")}>Cohorts, conversion and every active application →</Link></p>
      </Section>

      <Section title="How your search is going">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Applications" value={apps} to="/applications" />
          <Stat label="Applied this week" value={<>{sum.applied_this_week ?? 0}<WeekChange now={sum.applied_this_week ?? 0} before={sum.applied_last_week} /></>} to="/applications" />
          <Stat label="Response rate" value={apps ? `${pct(responses, apps)}%` : "—"} />
          <Stat label="Interview rate" value={apps ? `${pct(sum.interviews ?? 0, apps)}%` : "—"} />
          <Stat label="Good jobs not applied (70+)" value={sum.unapplied_70_plus ?? 0} tone="text-indigo-700" to="/jobs?min_score=70&has_application=false" />
        </div>
        <WeeklyActivity />
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="From application to offer">
            {apps ? (
              <Takeaway>
                {responses
                  ? `${responses} of ${apps} applications got an answer (${pct(responses, apps)}%).`
                  : `None of your ${apps} applications has an answer yet.`}
                {pct(responses, apps) < 10 && (sum.due_followups ?? 0) > 0 && <>
                  {" "}<Link className="link" to="/followups">{sum.due_followups} follow-up{sum.due_followups === 1 ? " is" : "s are"} due</Link> — a short note to the recruiter often gets a reply.
                </>}
              </Takeaway>
            ) : <Takeaway>Apply to a few shortlisted jobs to see how your applications convert.</Takeaway>}
            {f.data?.application && <Funnel stages={f.data.application} />}
          </Card>
          <Card title="Do higher scores get more answers?">
            {hi.n > 0 && lo.n > 0 ? (
              <Takeaway>
                Jobs scored 80+ got an answer {hi.pct}% of the time ({hi.answers} of {hi.n}); below 80, {lo.pct}% ({lo.answers} of {lo.n}).
                {hi.pct > lo.pct ? " The score is a good guide — apply to high scores first." : hi.pct < lo.pct ? " Lower scores do as well here — the score may be missing something; check Skills & targets." : ""}
              </Takeaway>
            ) : bands.length ? <Takeaway>Applications by the score the job had. Once some get answers, you'll see whether high scores do better.</Takeaway> : null}
            <BarChart data={bands.map((r) => ({ ...r, value: r.applications }))} color="bg-emerald-500"
              format={(b) => `${b.applications} · ${b.answers} · ${b.interviews}`} valueWidth="5rem"
              empty="Apply to some jobs to see whether higher scores get more answers." />
            {bands.length > 0 && <p className="mt-2 text-xs text-slate-500">Score band · applications · answers (incl. rejections) · interviews</p>}
          </Card>
        </div>
      </Section>

      <Section title="Where good jobs come from">
        <Card title="Job sources, by how well their jobs fit you">
          {bestSource && (
            <Takeaway>
              <b>{sourceName(bestSource.label)}</b> brings your best matches (average score {bestSource.avg_score}). Check it first.
            </Takeaway>
          )}
          {!sources.length ? <p className="text-sm text-slate-500">No jobs yet.</p> : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-4">Source</th><th className="py-1 pr-4 text-right">Jobs</th>
                  <th className="py-1 pr-4 text-right">Average score</th><th className="py-1 pr-4 text-right">Score 80+</th>
                  <th className="py-1 text-right">Applied</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {sources.map((q) => (
                    <tr key={q.label}>
                      <td className="py-1.5 pr-4"><Link className="hover:text-indigo-700" to={`/jobs?source=${q.label}`}>{sourceName(q.label)}</Link></td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{q.value}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{q.avg_score ?? "—"}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{q.strong}</td>
                      <td className="py-1.5 text-right tabular-nums">{q.applied}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Companies with the most good jobs">
            <p className="-mt-1 mb-2 text-xs text-slate-500">Jobs scoring 70+ you haven't applied to, of all their open jobs · average score</p>
            <TopCompanies items={charts?.top_companies ?? []} />
          </Card>
          <Card title="Locations"><BarChart data={charts?.jobs_by_location} /></Card>
          <Card title="Work model">
            <BarChart data={workModels} codes />
            {unknownModel > 0 && <p className="mt-2 text-xs text-slate-500">{unknownModel} jobs don't say.</p>}
          </Card>
        </div>
      </Section>

      <Section title="Your matches">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Score spread (all jobs)">
            {avg !== null && (
              <Takeaway>
                Average score {avg.toFixed(0)}{avgApplied !== null ? `; jobs you applied to average ${avgApplied.toFixed(0)}` : ""}.
                {avgApplied !== null && avg !== null && avgApplied < avg ? " You're applying below your average fit — focus on higher scores." : ""}
              </Takeaway>
            )}
            <BarChart data={charts?.jobs_by_score} color="bg-emerald-500" />
          </Card>
          <Card title="Where scores are lost">
            {weakest && (
              <Takeaway>
                Jobs lose the most points on <b>{humanize(weakest[0])}</b> (average fit {Math.round(weakest[1] * 100)}%).
                {weakest[0].includes("skill") ? " Adding missing skills to your profile or CV helps most." : ""}
                {weakest[0].includes("location") ? " Check your preferred locations in Skills & targets." : ""}
                {weakest[0].includes("salary") ? " Set a salary target so salary fit can be judged." : ""}
                {weakest[0].includes("company") ? " Most companies have no tier yet: mark the ones you'd love to join as Tier A in Companies." : ""}
              </Takeaway>
            )}
            <BarChart data={lost.map(([k, v]) => ({ label: humanize(k), value: Math.round(v * 100) }))}
              format={(b) => `${b.value}%`} color="bg-sky-500" />
          </Card>
        </div>
      </Section>

      <Section title="Market & pay">
        <ReportCharts name="market" days={days} ids={["salary", "pay_by_level", "experience", "hiring"]} title="Market & pay" />
        <p className="text-xs"><Link className="link" to={reportLink(days)("market")}>All market figures and the jobs behind them →</Link></p>
      </Section>

      <Section title="Skills">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Skills you're missing most">
            {gap && <Takeaway><b>{gap.label}</b> is required in {gap.value} jobs you don't fully match. If you have it, add it to your profile; if not, it's the one to learn.</Takeaway>}
            <BarChart data={a.data!.skill_gaps.slice(0, 10)} color="bg-rose-500" format={(b) => `${b.value} jobs · avg ${b.avg_job_score}`} valueWidth="7rem" empty="No gaps detected." />
            <p className="mt-3 text-xs"><Link className="link" to="/profile">Update your skills</Link></p>
          </Card>
          <div className="space-y-4">
            <CVAdviceSummary />
            <Card title="Most requested skills"><BarChart data={a.data!.top_requested_skills.slice(0, 10)} color="bg-violet-500" /></Card>
          </div>
        </div>
      </Section>
    </div>
  );
}
