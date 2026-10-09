import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, Spinner } from "../../components/ui";

interface SkillAdvice {
  skill: string;
  jobs: number;
  required: number;
  preferred: number;
  avg_job_score: number | null;
  examples: { id: number; title: string; company: string; score: number }[];
  in_search: boolean;
}
export interface CVAdviceData {
  cv: string | null;
  jobs_considered: number;
  add_to_cv: SkillAdvice[];
  missing: SkillAdvice[];
  hidden: string[];
}

type Action = "add-to-profile" | "add-to-search" | "hide" | "unhide";

export function useCVAdvice() {
  return useQuery({ queryKey: ["cv-advice"], queryFn: () => api.get<CVAdviceData>("/cv-advice") });
}

function demand(s: SkillAdvice): string {
  const parts = [];
  if (s.required) parts.push(`required in ${s.required} job${s.required === 1 ? "" : "s"}`);
  if (s.preferred) parts.push(`nice to have in ${s.preferred}`);
  return parts.join(", ");
}

function SkillRow({ s, kind, act, busy }: {
  s: SkillAdvice; kind: "cv" | "missing"; act: (action: Action, skill: string) => void; busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-800">{s.skill}</span>
        <span className="text-xs text-slate-500">{demand(s)}{s.avg_job_score !== null ? ` · those jobs score ${s.avg_job_score} on average` : ""}</span>
        {s.in_search && <Badge tone="indigo" title="In your Target Profile skills">in job search</Badge>}
        <div className="ml-auto flex flex-wrap gap-1">
          {kind === "missing" && (
            <button type="button" disabled={busy} onClick={() => act("add-to-profile", s.skill)}
              className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              title="You know this skill: add it to your profile and re-score jobs">I have it — add to my skills</button>
          )}
          {!s.in_search && (
            <button type="button" disabled={busy} onClick={() => act("add-to-search", s.skill)}
              className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              title="Add to your Target Profile's preferred skills: jobs using it score higher">Add to job search</button>
          )}
          <button type="button" className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide jobs" : "Which jobs?"}
          </button>
          <button type="button" disabled={busy} onClick={() => act("hide", s.skill)} title="Don't suggest this skill again"
            className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50">Hide</button>
        </div>
      </div>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-3 text-xs">
          {s.examples.map((e) => (
            <li key={e.id}><Link className="link" to={`/jobs/${e.id}`}>{e.title}</Link> <span className="text-slate-500">· {e.company} · score {e.score}</span></li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** "Improve your CV": skills to add to the CV, skills you lack, with one-click actions. */
export function CVAdvice() {
  const qc = useQueryClient();
  const advice = useCVAdvice();
  const [message, setMessage] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: ({ action, skill }: { action: Action; skill: string }) =>
      api.post<{ skill: string; rescored: number }>(`/cv-advice/skills/${action}`, { skill }).then((r) => ({ ...r, action })),
    onSuccess: (r) => {
      setMessage({
        "add-to-profile": `${r.skill} added to your skills${r.rescored ? ` — ${r.rescored} jobs re-scored` : ""}. Remember to add it to your CV too.`,
        "add-to-search": `${r.skill} added to your job search${r.rescored ? ` — ${r.rescored} jobs re-scored` : ""}.`,
        hide: `${r.skill} hidden.`,
        unhide: `${r.skill} shown again.`,
      }[r.action]);
      qc.invalidateQueries();
    },
  });
  const act = (action: Action, skill: string) => run.mutate({ action, skill });
  const a = advice.data;
  return (
    <Card title="Improve your CV">
      {!a ? <Spinner /> : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Based on the skills asked for in your {a.jobs_considered} open jobs{a.cv ? <> and your active CV <b>{a.cv}</b></> : ""}.
            Only jobs with a description list their skills, so add descriptions to more jobs for better advice.
          </p>
          {message && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-800">{message}</p>}
          {run.error && <p className="text-sm text-rose-600">{errorMessage(run.error)}</p>}

          <section>
            <h3 className="font-semibold text-slate-800">Add to your CV</h3>
            <p className="text-xs text-slate-500">
              You have these skills (they're on your profile) and employers ask for them, but your CV doesn't mention them.
              Add them to your CV's skills and to the projects where you used them, then upload the new version.
            </p>
            {!a.cv ? <p className="mt-2 text-sm text-slate-500">Upload and activate a CV to see this.</p>
              : !a.add_to_cv.length ? <p className="mt-2 text-sm text-emerald-700">Your CV already mentions every skill you have that these jobs ask for.</p>
              : <ul className="divide-y divide-slate-100">{a.add_to_cv.map((s) => <SkillRow key={s.skill} s={s} kind="cv" act={act} busy={run.isPending} />)}</ul>}
          </section>

          <section>
            <h3 className="font-semibold text-slate-800">Skills your jobs ask for that you don't have yet</h3>
            <p className="text-xs text-slate-500">
              If you do know one, click <b>I have it</b> — it's added to your skills and your jobs are re-scored.
              Otherwise these are the skills worth learning first.
            </p>
            {!a.missing.length ? <p className="mt-2 text-sm text-emerald-700">No missing skills found in your open jobs.</p>
              : <ul className="divide-y divide-slate-100">{a.missing.map((s) => <SkillRow key={s.skill} s={s} kind="missing" act={act} busy={run.isPending} />)}</ul>}
          </section>

          {a.hidden.length > 0 && (
            <p className="text-xs text-slate-500">
              Hidden: {a.hidden.map((h, i) => (
                <span key={h}>{i > 0 && ", "}{h} <button type="button" className="link" onClick={() => act("unhide", h)}>show</button></span>
              ))}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** Small dashboard card pointing to the full advice on the CVs page. */
export function CVAdviceSummary() {
  const advice = useCVAdvice();
  const a = advice.data;
  if (!a || (!a.add_to_cv.length && !a.missing.length)) return null;
  return (
    <Card title="Improve your CV" actions={<Link className="link text-sm" to="/cvs">Open</Link>}>
      {a.add_to_cv.length > 0 && (
        <p className="text-sm">
          <b>{a.add_to_cv.length}</b> skill{a.add_to_cv.length === 1 ? "" : "s"} you have but your CV doesn't mention:{" "}
          <span className="text-slate-700">{a.add_to_cv.slice(0, 5).map((s) => s.skill).join(", ")}{a.add_to_cv.length > 5 ? "…" : ""}</span>
        </p>
      )}
      {a.missing.length > 0 && (
        <p className="mt-1 text-sm">
          Most-asked skills you don't have: <span className="text-slate-700">{a.missing.slice(0, 4).map((s) => s.skill).join(", ")}</span>
        </p>
      )}
    </Card>
  );
}
