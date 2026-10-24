import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Badge, Card, Empty, ErrorBox, PageIntro, Spinner, Stat } from "../../components/ui";

type Example = { id: number; title: string; company: string; before: number; after: number };
export type RoadmapSkill = {
  skill: string; required: number; preferred: number; jobs: number; strong_share: number | null;
  new_good: number; jobs_raised: number; avg_gain: number; close_to: string | null; in_search: boolean; examples: Example[];
};
export type RoadmapStep = { step: number; skill: string; new_good: number; jobs_raised: number; total_good: number; examples: Example[] };
export type Roadmap = {
  threshold: number; strong_threshold: number; jobs_considered: number; good_now: number; strong_now: number;
  skills: RoadmapSkill[]; roadmap: RoadmapStep[]; hidden: string[];
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Examples({ items }: { items: Example[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {items.map((e) => (
        <li key={e.id}><Link className="link" to={`/jobs/${e.id}`}>{e.title}</Link>
          <span className="text-slate-500"> · {e.company} · {e.before} → <b className="text-slate-700">{e.after}</b></span></li>
      ))}
    </ul>
  );
}

/** The learning path: one bar per step, good jobs in total after learning it (one series). */
function Path({ r }: { r: Roadmap }) {
  const max = Math.max(r.good_now, ...r.roadmap.map((s) => s.total_good), 1);
  const bar = (value: number, label: string, tip: string, muted = false) => (
    <div className="flex items-center gap-2" title={tip}>
      <div className="h-2.5 flex-1 rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${muted ? "bg-slate-400" : "bg-indigo-500"}`} style={{ width: `${(100 * value) / max}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-600">{label}</span>
    </div>
  );
  return (
    <ol className="space-y-3" aria-label="Learning path">
      <li className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center">
        <span className="text-sm text-slate-500">Today</span>
        {bar(r.good_now, `${r.good_now} jobs`, `${r.good_now} jobs score ${r.threshold}+ now`, true)}
      </li>
      {r.roadmap.map((s) => {
        const info = r.skills.find((x) => x.skill === s.skill);
        return (
          <li key={s.step} className="grid gap-1 sm:grid-cols-[14rem_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">{s.step}</span>
                <span className="font-medium text-slate-800">{s.skill}</span>
              </div>
              <p className="ml-8 text-xs text-slate-500">
                {s.new_good ? <b className="text-emerald-700">+{plural(s.new_good, "good job")}</b> : "no new good jobs"} · raises {plural(s.jobs_raised, "job")}
                {info?.close_to && <> · you know {info.close_to}</>}
              </p>
            </div>
            <div className="sm:pt-1.5">
              {bar(s.total_good, `${s.total_good} jobs`, `After step ${s.step}: ${s.total_good} jobs score ${r.threshold}+ (${s.new_good} more)`)}
              <Examples items={s.examples} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** My profile → Skill roadmap: which missing skills are worth learning, in what order. */
export function SkillRoadmapPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cv-advice", "roadmap"], queryFn: () => api.get<Roadmap>("/cv-advice/roadmap"), staleTime: 5 * 60_000 });
  const act = useMutation({
    mutationFn: ({ action, skill }: { action: "add-to-profile" | "hide" | "unhide"; skill: string }) =>
      api.post(`/cv-advice/skills/${action}`, { skill }),
    onSuccess: () => qc.invalidateQueries(),
    meta: { success: "Saved — scores and the roadmap are updated", toastError: true },
  });
  const r = q.data;
  const after = r?.roadmap.length ? r.roadmap[r.roadmap.length - 1].total_good : r?.good_now ?? 0;
  return (
    <div className="space-y-4">
      <div>
        <h1>Skill roadmap</h1>
        <PageIntro>
          Each missing skill is tried out on your open jobs: they're scored again, by the same rules, as if the skill were on your profile.
          The path picks the skill that brings the most jobs to a good score first, then the next best on top of it. Nothing is changed until you say you have a skill.
        </PageIntro>
      </div>
      {q.error ? <ErrorBox error={q.error} /> : !r ? <Card><Spinner label="Working out what each skill is worth…" /></Card> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Open jobs scored" value={r.jobs_considered} icon="jobs" />
            <Stat label={`Good matches now (${r.threshold}+)`} value={r.good_now} icon="star" accent="emerald" />
            <Stat label="After the path" value={after > r.good_now ? `${after} (+${after - r.good_now})` : after} icon="trend" accent="violet" />
          </div>

          <Card title="Your learning path">
            {r.roadmap.length ? <Path r={r} />
              : <Empty>No missing skill would raise a job's score. Add descriptions to more jobs, or check Skills & targets.</Empty>}
          </Card>

          <Card title="Every missing skill, by what it's worth">
            {!r.skills.length ? <Empty>Your open jobs don't ask for skills you lack.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr>
                    <th className="th">Skill</th><th className="th">Asked for in</th>
                    <th className="th" title={`Share of your ${r.strong_now} jobs scoring ${r.strong_threshold}+ that ask for it`}>{r.strong_threshold}+ jobs</th>
                    <th className="th" title={`Jobs that would reach ${r.threshold}+`}>New good jobs</th>
                    <th className="th">Jobs raised</th><th className="th">Avg gain</th><th className="th"><span className="sr-only">Actions</span></th>
                  </tr></thead>
                  <tbody>
                    {r.skills.map((s) => (
                      <tr key={s.skill} className="row-hover border-t border-slate-100">
                        <td className="td">
                          <span className="font-medium text-slate-800">{s.skill}</span>
                          {s.close_to && <span className="block text-xs text-slate-500">close to {s.close_to}</span>}
                          {s.in_search && <Badge tone="indigo" title="In your Skills & targets">in job search</Badge>}
                        </td>
                        <td className="td text-slate-600">{s.required ? `${s.required} required` : ""}{s.required && s.preferred ? ", " : ""}{s.preferred ? `${s.preferred} nice to have` : ""}</td>
                        <td className="td tabular-nums text-slate-600">{s.strong_share !== null ? `${s.strong_share}%` : "—"}</td>
                        <td className="td tabular-nums">{s.new_good ? <b className="text-emerald-700">+{s.new_good}</b> : <span className="text-slate-400">0</span>}</td>
                        <td className="td tabular-nums text-slate-600">{s.jobs_raised}</td>
                        <td className="td tabular-nums text-slate-600">{s.avg_gain ? `+${s.avg_gain}` : "—"}</td>
                        <td className="td whitespace-nowrap text-right">
                          <button type="button" className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            disabled={act.isPending} title="You know it: add it to your profile and re-score jobs"
                            onClick={() => act.mutate({ action: "add-to-profile", skill: s.skill })}>I have it</button>
                          <button type="button" className="ml-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                            disabled={act.isPending} title="Don't suggest this skill again"
                            onClick={() => act.mutate({ action: "hide", skill: s.skill })}>Hide</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {r.hidden.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">Hidden: {r.hidden.map((h, i) => (
                <span key={h}>{i > 0 && ", "}{h} <button type="button" className="link" onClick={() => act.mutate({ action: "unhide", skill: h })}>show</button></span>
              ))}</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
