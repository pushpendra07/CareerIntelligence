import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { BarChart, Funnel } from "../../components/charts";
import { Card, ErrorBox, Spinner } from "../../components/ui";
import type { Bar } from "../../types/api";
import { humanize } from "../../utils/format";

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

export function AnalyticsPage() {
  const a = useQuery({ queryKey: ["analytics"], queryFn: () => api.get<Analytics>("/dashboard/analytics") });
  const f = useQuery({ queryKey: ["funnels"], queryFn: () => api.get<Record<string, { stage: string; value: number }[]>>("/dashboard/funnels") });
  if (a.isLoading) return <Spinner />;
  if (a.error) return <ErrorBox error={a.error} />;
  const s = a.data!.scores;
  return (
    <div className="space-y-4">
      <h1>Career analytics</h1>
      <div className="grid gap-4 md:grid-cols-3">
        {f.data && Object.entries(f.data).map(([name, stages]) => <Card key={name} title={`${humanize(name)} funnel`}><Funnel stages={stages} /></Card>)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Match score analytics">
          <p className="mb-3 text-sm text-slate-600">
            Average score {s.average_score ? Number(s.average_score).toFixed(1) : "—"} · average of jobs you applied to {s.average_score_applied ? Number(s.average_score_applied).toFixed(1) : "—"}
          </p>
          <BarChart data={s.by_recommendation.map((b) => ({ ...b, label: humanize(b.label) }))} />
        </Card>
        <Card title="Where scores are lost (average component fit)">
          <BarChart data={Object.entries(s.average_component_factor).map(([k, v]) => ({ label: humanize(k), value: Math.round(v * 100) }))}
            format={(b) => `${b.value}%`} color="bg-sky-500" />
        </Card>
        <Card title="Interview rate by score band">
          <BarChart data={s.interview_rate_by_score.map((r) => ({ ...r, label: r.label, value: r.applications ? Math.round((r.interviews / r.applications) * 100) : 0 }))}
            format={(b) => `${b.value}% of ${b.applications}`} color="bg-emerald-500" empty="Apply to some jobs to see whether higher scores get more interviews." />
        </Card>
        <Card title="Most requested skills"><BarChart data={a.data!.top_requested_skills} color="bg-violet-500" /></Card>
        <Card title="Skill gaps (required skills you miss most)" className="md:col-span-2">
          <BarChart data={a.data!.skill_gaps} color="bg-rose-500" format={(b) => `${b.value} jobs · avg score ${b.avg_job_score}`} empty="No gaps detected." />
        </Card>
      </div>
    </div>
  );
}
