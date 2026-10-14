import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, ErrorBox, PageIntro, ScoreBadge, Spinner, StatusBadge } from "../../components/ui";
import type { JobDetail, Page, Job } from "../../types/api";
import { humanize } from "../../utils/format";
import { FitSummary, JobDescription, KeyFacts, postingUrl } from "./JobParts";

const MIN_SCORES = [0, 60, 70, 80] as const;

type Done = { id: number; title: string; from: string; to: string };

/** Keyboard shortcuts, shown on the buttons and in the help line. */
const KEYS = { shortlist: "s", notRelevant: "n", skip: "k", open: "o", undo: "u" } as const;

/**
 * Quick review: new jobs one at a time, best match first, with the facts needed to decide.
 * Shortlist or Not relevant moves the job out of "New"; Skip leaves it for later.
 */
export function ReviewPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const minScore = Number(params.get("min_score") ?? 0);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [done, setDone] = useState<Done[]>([]);

  const query = { status: ["NEW", "DISCOVERED"], closed: "false", has_application: "false", sort: "-match_score",
    size: 50, ...(minScore ? { min_score: minScore } : {}) };
  const list = useQuery({ queryKey: ["jobs", "review", minScore], queryFn: () => api.get<Page<Job>>("/jobs", query) });
  const queue = (list.data?.items ?? []).filter((j) => !skipped.includes(j.id));
  const currentId = queue[0]?.id;
  const job = useQuery({
    queryKey: ["job", currentId], enabled: currentId !== undefined,
    queryFn: () => api.get<JobDetail>(`/jobs/${currentId}`),
  });
  // Load the next job early so moving on is instant.
  const nextId = queue[1]?.id;
  useEffect(() => {
    if (nextId !== undefined) void qc.prefetchQuery({ queryKey: ["job", nextId], queryFn: () => api.get<JobDetail>(`/jobs/${nextId}`) });
  }, [nextId, qc]);

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; title: string; from: string; status: string }) =>
      api.post(`/jobs/${id}/status`, { status }),
    onSuccess: (_, v) => {
      setDone((d) => [{ id: v.id, title: v.title, from: v.from, to: v.status }, ...d].slice(0, 20));
      return qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const undo = useMutation({
    mutationFn: (d: Done) => api.post(`/jobs/${d.id}/status`, { status: d.from }),
    onSuccess: (_, d) => {
      setDone((all) => all.filter((x) => x !== d));
      setSkipped((s) => s.filter((id) => id !== d.id));
      return qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const current = job.data && job.data.id === currentId ? job.data : undefined;
  const busy = setStatus.isPending || undo.isPending;
  const decide = useCallback((status: string) => {
    if (current && !busy) setStatus.mutate({ id: current.id, title: current.title, from: current.status, status });
  }, [current, busy, setStatus]);
  const skip = useCallback(() => { if (current) setSkipped((s) => [...s, current.id]); }, [current]);
  const postingLink = current ? postingUrl(current) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === KEYS.shortlist) decide("SHORTLISTED");
      else if (k === KEYS.notRelevant) decide("NOT_RELEVANT");
      else if (k === KEYS.skip || e.key === "ArrowRight") skip();
      else if (k === KEYS.open && postingLink) window.open(postingLink, "_blank", "noopener");
      else if (k === KEYS.undo && done[0] && !busy) undo.mutate(done[0]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, skip, postingLink, done, busy, undo]);

  const left = Math.max((list.data?.total ?? 0) - skipped.length, 0);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Review new jobs</h1>
          <PageIntro>One job at a time, best match first. Shortlist the ones worth applying to and mark the rest
            not relevant — your Jobs list stays short and useful.</PageIntro>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600" htmlFor="review-min">Show</label>
          <select id="review-min" className="input w-auto" value={minScore}
            onChange={(e) => { setSkipped([]); setParams(e.target.value === "0" ? {} : { min_score: e.target.value }); }}>
            {MIN_SCORES.map((s) => <option key={s} value={s}>{s ? `Score ${s}+` : "All new jobs"}</option>)}
          </select>
        </div>
      </div>

      {list.error ? <ErrorBox error={list.error} /> : !list.data ? <Spinner /> : !currentId ? (
        <Card>
          <div className="py-8 text-center">
            <div className="text-lg font-semibold text-slate-800">
              {list.data.total ? "You've seen every job in this list" : "All caught up — nothing new to review"}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {skipped.length ? `${skipped.length} skipped for later. ` : ""}
              Your shortlist is in <Link className="link" to="/jobs?tab=pending&status=SHORTLISTED">Jobs → Pending</Link>.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {skipped.length > 0 && <button className="btn-secondary" onClick={() => setSkipped([])}>Review skipped again</button>}
              <Link className="btn-secondary" to="/settings">Find more jobs</Link>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm text-slate-500" aria-live="polite">
            <span><strong className="text-slate-800">{left}</strong> left to review{done.length ? ` · ${done.length} decided this session` : ""}</span>
            {done[0] && (
              <button className="link" disabled={busy} onClick={() => undo.mutate(done[0])}>
                Undo “{humanize(done[0].to)}” on {done[0].title} <kbd className="kbd">U</kbd>
              </button>
            )}
          </div>
          {setStatus.error && <p className="text-sm text-rose-600">{errorMessage(setStatus.error)}</p>}
          {!current ? <Spinner /> : <ReviewCard job={current} />}
          <div className="sticky bottom-0 -mx-2 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50/95 px-2 py-3 backdrop-blur">
            <button className="btn-primary" disabled={!current || busy} onClick={() => decide("SHORTLISTED")}>
              ★ Shortlist <kbd className="kbd">S</kbd>
            </button>
            <button className="btn-secondary" disabled={!current || busy} onClick={() => decide("NOT_RELEVANT")}>
              Not relevant <kbd className="kbd">N</kbd>
            </button>
            <button className="btn-secondary" disabled={!current || busy} onClick={skip}>
              Skip for now <kbd className="kbd">K</kbd>
            </button>
            <span className="flex-1" />
            {postingLink && (
              <a className="btn-secondary" href={postingLink} target="_blank" rel="noopener noreferrer">
                Open posting ↗ <kbd className="kbd">O</kbd>
              </a>
            )}
            {current && <Link className="btn-secondary" to={`/jobs/${current.id}`}>All details</Link>}
          </div>
        </>
      )}
    </div>
  );
}

function ReviewCard({ job }: { job: JobDetail }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-900">{job.title}</h2>
          <div className="mt-0.5 text-sm text-slate-600">
            <Link className="hover:text-indigo-700" to={`/companies/${job.company.id}`}>{job.company.name}</Link>
            {job.company.tier && <> <Badge tone="gray">{job.company.tier.replace("TIER_", "Tier ")}</Badge></>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ScoreBadge score={job.match_score} stale={job.score_stale} />
          {job.match && <StatusBadge value={job.match.recommendation} />}
        </div>
      </div>
      <div className="mt-3"><KeyFacts job={job} /></div>
      {job.match && <div className="mt-4"><FitSummary job={job} /></div>}
      <div className="mt-4">
        <div className="label">Job description</div>
        <JobDescription key={job.id} text={job.original_jd} />
      </div>
    </Card>
  );
}
