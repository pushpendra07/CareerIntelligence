import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, ErrorBox, Field, Spinner } from "../../components/ui";
import { formatDateTime, humanize } from "../../utils/format";

export interface ScannerConfig {
  title_include: string[];
  title_broad: string[];
  jd_keywords: string[];
  title_exclude: string[];
  locations: string[];
  location_exclude: string[];
  keep_unknown_location: boolean;
  max_age_days: number;
  max_new_per_company: number;
  schedule_hours: number;
}

interface RunRow {
  company_id: number; company: string; provider: string | null; board: string | null;
  found?: number; kept?: number; new?: number; error: string | null; careers_url?: string;
}

export interface ScanRun {
  id: number; kind: "SCAN" | "DETECT"; trigger: string; status: string;
  started_at: string; finished_at: string | null;
  stats: Record<string, number | Record<string, number> | string>;
  companies?: RunRow[];
}

interface ScannerStatus {
  supported_boards: string[];
  job_search_enabled: number;
  scannable: number;
  by_provider: Record<string, number>;
  not_scannable: { id: number; name: string; careers_url: string | null }[];
  boards_not_searched?: { id: number; name: string }[];
  running: ScanRun | null;
  last_run: ScanRun | null;
  settings: ScannerConfig;
}

const LISTS: [keyof ScannerConfig, string, string][] = [
  ["title_include", "Titles to keep", "A title containing any of these is kept."],
  ["title_broad", "Generic titles", "Kept only when the job description mentions a stack keyword below."],
  ["jd_keywords", "Stack keywords (job description)", "Used for generic titles."],
  ["title_exclude", "Titles to skip", "A title containing any of these is never kept."],
  ["locations", "Locations to keep", "Cities, countries or 'remote'."],
  ["location_exclude", "Locations to skip", "Skipped unless a specific location above also matches (so 'US - Remote' is skipped)."],
];

const SKIP_LABELS: Record<string, string> = {
  title: "title not relevant", excluded_title: "excluded title", location: "location",
  too_old: "too old", jd_keywords: "stack not in JD", over_limit: "over per-company limit",
};

export function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

const METHOD_LABELS: Record<string, string> = {
  page_link: "linked from the careers page", career_ops: "from Career-Ops' list",
  successfactors: "SuccessFactors sites", job_posting_data: "careers pages with job data",
  name_probe: "matched by company name",
};

export function runSummary(run: ScanRun): string {
  const s = run.stats;
  if (typeof s.error === "string") return s.error;
  if (run.kind === "DETECT") {
    const how = (s.by_method ?? {}) as Record<string, number>;
    const parts = Object.entries(how).map(([k, v]) => `${v} ${METHOD_LABELS[k] ?? k}`);
    return `Found job boards for ${num(s.found)} of ${num(s.checked)} companies` +
      (parts.length ? ` (${parts.join(", ")})` : "") +
      (num(s.careers_urls_found) ? ` · found ${num(s.careers_urls_found)} careers pages on company websites` : "");
  }
  return `${num(s.new)} new · ${num(s.updated)} updated · ${num(s.found)} postings checked at ${num(s.companies)} ${num(s.companies) === 1 ? "company" : "companies"}` +
    (num(s.errors) ? ` · ${num(s.errors)} board errors` : "");
}

function RunDetails({ runId }: { runId: number }) {
  const run = useQuery({ queryKey: ["scan-run", runId], queryFn: () => api.get<ScanRun>(`/scanner/runs/${runId}`) });
  if (!run.data) return <Spinner />;
  const rows = [...(run.data.companies ?? [])].sort((a, b) => (b.new ?? 0) - (a.new ?? 0) || (b.kept ?? 0) - (a.kept ?? 0));
  const skipped = run.data.stats.skipped as Record<string, number> | undefined;
  return (
    <div className="mt-2 space-y-2">
      {skipped && Object.keys(skipped).length > 0 && (
        <p className="text-xs text-slate-600">Skipped: {Object.entries(skipped).map(([k, v]) => `${v} ${SKIP_LABELS[k] ?? humanize(k)}`).join(" · ")}</p>
      )}
      <div className="max-h-72 overflow-auto rounded border border-slate-200">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50"><tr>
            <th className="th">Company</th><th className="th">Board</th>
            {run.data.kind === "SCAN" ? <><th className="th">Postings</th><th className="th">Relevant</th><th className="th">New</th></> : null}
            <th className="th">Result</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.company_id} className="border-t border-slate-100">
                <td className="td"><Link className="link" to={`/companies/${r.company_id}`}>{r.company}</Link></td>
                <td className="td">{r.board ? <a className="link" href={r.board} target="_blank" rel="noopener noreferrer">{humanize(r.provider ?? "")}</a> : "—"}</td>
                {run.data.kind === "SCAN" ? <><td className="td">{r.found}</td><td className="td">{r.kept}</td><td className="td font-semibold">{r.new || ""}</td></> : null}
                <td className="td">{r.error ? <span className="text-rose-600">{r.error}</span> : run.data.kind === "DETECT" ? (r.board ? "found" : "no supported board") : "ok"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterForm({ initial }: { initial: ScannerConfig }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string | number | boolean>>({});
  useEffect(() => {
    setForm(Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v])));
  }, [initial]);
  const save = useMutation({
    mutationFn: () => api.patch("/settings/app", { scanner: Object.fromEntries(Object.entries(form).map(([k, v]) =>
      [k, LISTS.some(([key]) => key === k) ? String(v).split(",").map((x) => x.trim()).filter(Boolean) : v])) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner"] }),
  });
  const set = (k: string, v: string | number | boolean) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <details className="mt-3 rounded border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-medium">What to keep (filters & schedule)</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {LISTS.map(([key, label, hint]) => (
          <Field key={key} label={label} hint={hint}>
            <textarea className="input min-h-16 text-xs" aria-label={label} value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value)} />
          </Field>
        ))}
        <Field label="Ignore postings older than (days)" hint="0 = no limit">
          <input className="input" type="number" min={0} max={365} value={Number(form.max_age_days ?? 0)} onChange={(e) => set("max_age_days", Number(e.target.value))} />
        </Field>
        <Field label="Max jobs per company per scan">
          <input className="input" type="number" min={1} max={500} value={Number(form.max_new_per_company ?? 50)} onChange={(e) => set("max_new_per_company", Number(e.target.value))} />
        </Field>
        <Field label="Scan automatically every (hours)" hint="0 = only when you click Scan now. Runs while the app is running.">
          <input className="input" type="number" min={0} max={168} value={Number(form.schedule_hours ?? 0)} onChange={(e) => set("schedule_hours", Number(e.target.value))} />
        </Field>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={Boolean(form.keep_unknown_location)} onChange={(e) => set("keep_unknown_location", e.target.checked)} />
          Keep jobs with no location
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save filters"}</button>
        {save.isSuccess && <span className="text-xs text-emerald-700">Saved — used from the next scan.</span>}
      </div>
      {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
    </details>
  );
}

export function ScannerSettings() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["scanner"],
    queryFn: () => api.get<ScannerStatus>("/scanner/status"),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
    refetchIntervalInBackground: true, // a scan takes minutes; people switch tabs meanwhile
  });
  const running = status.data?.running;
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (running) setWasRunning(true);
    else if (wasRunning) {
      setWasRunning(false);
      qc.invalidateQueries(); // a scan just finished: jobs, dashboard and companies changed
    }
  }, [running, wasRunning, qc]);
  const start = useMutation({
    mutationFn: (kind: "run" | "detect-boards") => api.post<ScanRun>(`/scanner/${kind}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner"] }),
  });
  const enableFound = useMutation({
    mutationFn: () => api.post<{ enabled: number }>("/scanner/enable-found", {}),
    onSuccess: () => qc.invalidateQueries(),
  });
  const s = status.data;
  const [showRun, setShowRun] = useState(false);
  return (
    <Card title="Job scanner" actions={<>
      <button className="btn-primary" disabled={!s || !!running || start.isPending || s.scannable === 0} onClick={() => start.mutate("run")}>
        {running?.kind === "SCAN" ? "Scanning…" : "Scan now"}
      </button>
      <button className="btn-secondary" disabled={!s || !!running || start.isPending} onClick={() => start.mutate("detect-boards")}
        title="Open each company's careers page and look for a Greenhouse, Lever, Workday… board">
        {running?.kind === "DETECT" ? "Looking…" : "Find job boards"}
      </button>
    </>}>
      {!s ? <Spinner /> : (
        <div className="space-y-2 text-sm">
          <p>
            Searches the job boards of companies marked <b>Job search</b> and adds relevant jobs, already scored.{" "}
            <b>{s.scannable}</b> of {s.job_search_enabled} job-search companies have a supported board
            {Object.keys(s.by_provider).length > 0 && <>: {Object.entries(s.by_provider).map(([p, n]) => <Badge key={p}>{humanize(p)} {n}</Badge>)}</>}
          </p>
          {running && <p className="rounded bg-indigo-50 p-2 text-indigo-800">{running.kind === "SCAN" ? "Scanning job boards" : "Looking for job boards"}… started {formatDateTime(running.started_at)}. You can keep using the app.</p>}
          {s.last_run && !running && (
            <div>
              <p>
                Last scan {formatDateTime(s.last_run.started_at)}{s.last_run.trigger === "schedule" ? " (scheduled)" : ""}:{" "}
                <span className={s.last_run.status === "FAILED" ? "text-rose-600" : ""}>{runSummary(s.last_run)}</span>{" "}
                {num(s.last_run.stats.new) > 0 && <Link className="link" to="/jobs?status=NEW&sort=-match_score">View new jobs</Link>}{" "}
                <button className="link text-xs" onClick={() => setShowRun((v) => !v)}>{showRun ? "Hide details" : "Details"}</button>
              </p>
              {showRun && <RunDetails runId={s.last_run.id} />}
            </div>
          )}
          {start.data?.kind === "DETECT" && !running && <DetectResult />}
          {!!s.boards_not_searched?.length && (
            <div className="flex flex-wrap items-center gap-2 rounded bg-amber-50 p-2 text-amber-900">
              <span><b>{s.boards_not_searched.length}</b> companies have a known job board but <b>Job search</b> is off, so they aren't scanned.</span>
              <button className="btn-secondary px-2 py-1 text-xs" disabled={enableFound.isPending} onClick={() => enableFound.mutate()}>
                {enableFound.isPending ? "Turning on…" : "Turn on job search for them"}
              </button>
            </div>
          )}
          {s.not_scannable.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-slate-600">{s.not_scannable.length} job-search companies without a supported board</summary>
              <p className="mt-1 text-xs text-slate-500">Click <b>Find job boards</b>: it looks for links to a job board, SuccessFactors / Oracle career sites, job data on the company's own careers pages, Career-Ops' list, and the company's name on the job boards' public listings. Companies whose openings are only on LinkedIn or Naukri can't be scanned — add those jobs with <b>Add Job</b> or a Google Sheet.</p>
              <ul className="mt-1 max-h-48 overflow-auto text-xs">
                {s.not_scannable.map((c) => <li key={c.id}><Link className="link" to={`/companies/${c.id}`}>{c.name}</Link> <span className="text-slate-400">{c.careers_url ?? "no careers URL"}</span></li>)}
              </ul>
            </details>
          )}
          <FilterForm initial={s.settings} />
        </div>
      )}
      {start.error && <ErrorBox error={new Error(errorMessage(start.error))} />}
    </Card>
  );
}

function DetectResult() {
  const runs = useQuery({ queryKey: ["scanner", "runs"], queryFn: () => api.get<ScanRun[]>("/scanner/runs?limit=5") });
  const last = runs.data?.find((r) => r.kind === "DETECT");
  if (!last) return null;
  return <p className="rounded bg-emerald-50 p-2 text-emerald-800">{runSummary(last)}. Companies with Job search on are now included in Scan now.</p>;
}
