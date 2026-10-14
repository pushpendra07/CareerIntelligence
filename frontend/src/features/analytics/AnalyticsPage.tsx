import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { BarChart, Funnel } from "../../components/charts";
import { Card, ErrorBox, Spinner, PageIntro, Stat } from "../../components/ui";
import type { Bar } from "../../types/api";
import { humanize, sourceName } from "../../utils/format";
import { CVAdviceSummary } from "../cvs/CVAdvice";

interface Analytics {
  scores: {
    average_component_factor: Record<string, number>;
    by_recommendation: Bar[];
    average_score: string | null;
    average_score_applied: string | null;
    interview_rate_by_score: { label: string; applications: number; interviews: number }[];
  };
  skill_gaps: Bar[];
  top_requested_skills: Bar[];
}
type SourceQuality = { label: string; value: number; avg_score: number | null; strong: number; applied: number };
type Charts = Record<string, Bar[]> & { source_quality?: SourceQuality[] };

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

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
  const a = useQuery({ queryKey: ["analytics"], queryFn: () => api.get<Analytics>("/dashboard/analytics") });
  const f = useQuery({ queryKey: ["funnels"], queryFn: () => api.get<Record<string, { stage: string; value: number }[]>>("/dashboard/funnels") });
  const c = useQuery({ queryKey: ["dashboard", "charts"], queryFn: () => api.get<Charts>("/dashboard/charts") });
  const d = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<{ summary: Record<string, number> }>("/dashboard") });
  if (a.isLoading) return <Spinner />;
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
  const avg = s.average_score ? Number(s.average_score) : null;
  const avgApplied = s.average_score_applied ? Number(s.average_score_applied) : null;

  return (
    <div className="space-y-8">
      <div><h1>Insights</h1><PageIntro>What's working in your search, where good jobs come from, and what to improve.</PageIntro></div>

      <Section title="How your search is going">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Applications" value={apps} to="/applications" />
          <Stat label="Response rate" value={apps ? `${pct(responses, apps)}%` : "—"} />
          <Stat label="Interview rate" value={apps ? `${pct(sum.interviews ?? 0, apps)}%` : "—"} />
          <Stat label="Offers" value={sum.offers ?? 0} tone="text-emerald-600" to="/offers" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="From application to offer">
            {apps ? (
              <Takeaway>
                {responses
                  ? `${responses} of ${apps} applications got an answer (${pct(responses, apps)}%).`
                  : `None of your ${apps} applications has an answer yet — follow-ups help.`}
              </Takeaway>
            ) : <Takeaway>Apply to a few shortlisted jobs to see how your applications convert.</Takeaway>}
            {f.data?.application && <Funnel stages={f.data.application} />}
          </Card>
          <Card title="Do higher scores get more interviews?">
            {bands.length ? (
              <Takeaway>Interview rate by the score the job had when you applied — trust the score more if the top bands win.</Takeaway>
            ) : null}
            <BarChart data={s.interview_rate_by_score.map((r) => ({ ...r, value: pct(r.interviews, r.applications) }))}
              format={(b) => `${b.value}% of ${b.applications}`} color="bg-emerald-500"
              empty="Apply to some jobs to see whether higher scores get more interviews." />
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
          <Card title="Companies with the best matches">
            <BarChart data={charts?.top_companies} format={(b) => `${b.avg_score ?? "—"} (${b.value})`} color="bg-violet-500" />
          </Card>
          <Card title="Locations"><BarChart data={charts?.jobs_by_location} /></Card>
          <Card title="Work model"><BarChart data={charts?.jobs_by_work_model} codes /></Card>
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
                {weakest[0].includes("location") ? " Check your preferred locations in Target roles." : ""}
                {weakest[0].includes("salary") ? " Set a salary target so salary fit can be judged." : ""}
                {weakest[0].includes("company") ? " Most companies have no tier yet: mark the ones you'd love to join as Tier A in Companies." : ""}
              </Takeaway>
            )}
            <BarChart data={lost.map(([k, v]) => ({ label: humanize(k), value: Math.round(v * 100) }))}
              format={(b) => `${b.value}%`} color="bg-sky-500" />
          </Card>
        </div>
      </Section>

      <Section title="Skills">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Skills you're missing most">
            {gap && <Takeaway><b>{gap.label}</b> is required in {gap.value} jobs you don't fully match. If you have it, add it to your profile; if not, it's the one to learn.</Takeaway>}
            <BarChart data={a.data!.skill_gaps.slice(0, 10)} color="bg-rose-500" format={(b) => `${b.value} jobs · avg ${b.avg_job_score}`} empty="No gaps detected." />
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
