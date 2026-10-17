import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Card, ErrorBox, Field, KeyValue, Spinner, PageIntro } from "../../components/ui";
import { formatDateTime, humanize } from "../../utils/format";
import { ScannerSettings } from "../scanner/ScannerSettings";
import { SavedSheetsSettings } from "../sheets/SavedSheetsSettings";
import { BackupSettings } from "./BackupSettings";

interface ScoringConfig {
  weights: Record<string, number>;
  thresholds: Record<string, number>;
  tier_factors: Record<string, number>;
  hard_blockers: string[];
  [k: string]: unknown;
}

const BLOCKER_TYPES = ["MINIMUM_EXPERIENCE", "MANDATORY_TECHNOLOGY", "CERTIFICATION", "LANGUAGE", "WORK_AUTHORIZATION",
  "NOTICE_PERIOD", "LOCATION", "EXCLUDED_ROLE", "EXCLUDED_TECHNOLOGY", "EXCLUDED_INDUSTRY"];

/** What each part of the 0–100 score looks at, in plain words. */
const WEIGHT_HINTS: Record<string, string> = {
  role: "Job title vs your target roles", skills: "Required skills you have", experience: "Years asked vs your years",
  domain: "Industry / platform you know", location: "City and remote / hybrid / on-site fit", seniority: "Level (senior, lead…)",
  salary: "Pay vs your minimum", company: "Company tier and preferred companies", other: "Everything else in the description",
};
const WEIGHT_ORDER = ["skills", "role", "experience", "domain", "location", "seniority", "salary", "company", "other"];
const THRESHOLD_ORDER = ["highly_recommended", "recommended", "consider", "low_priority"];

function ScoringSettings() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["scoring"], queryFn: () => api.get<{ version: number; config: ScoringConfig }>("/settings/scoring") });
  const [draft, setDraft] = useState<ScoringConfig | null>(null);
  useEffect(() => { if (cfg.data) setDraft(cfg.data.config); }, [cfg.data]);
  const save = useMutation({
    mutationFn: () => api.put("/settings/scoring", { config: draft, note: "Edited in settings" }),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (!draft) return <Spinner />;
  const total = Object.values(draft.weights).reduce((a, b) => a + Number(b), 0);
  const changed = JSON.stringify(draft) !== JSON.stringify(cfg.data?.config);
  const weights = [...WEIGHT_ORDER.filter((k) => k in draft.weights), ...Object.keys(draft.weights).filter((k) => !WEIGHT_ORDER.includes(k))];
  return (
    <Card title="How jobs are scored" actions={
      <>
        {changed && <button className="btn-secondary" onClick={() => setDraft(cfg.data!.config)}>Undo changes</button>}
        <button className="btn-primary" disabled={!changed || total !== 100 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</button>
      </>}>
      <p className="mb-3 text-sm text-slate-600">
        Every job gets a 0–100 match score from these parts. Raise a part to make it count more; they must add up to 100.
        Saving re-scores all jobs within a minute (version {cfg.data?.version} now). What you want — roles, skills, locations, salary — is set in{" "}
        <Link className="link" to="/preferences">My profile → Target roles</Link>.
      </p>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {weights.map((k) => (
          <Field key={k} label={humanize(k)} hint={WEIGHT_HINTS[k]}>
            <input className="input" type="number" min={0} max={100} aria-label={`${humanize(k)} weight`} value={draft.weights[k]}
              onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, [k]: Number(e.target.value) } })} />
          </Field>
        ))}
      </div>
      <p className={`mt-1 text-sm ${total === 100 ? "text-emerald-700" : "text-rose-600"}`}>Total: {total}{total !== 100 && " — must be 100 to save"}</p>

      <div className="mt-4">
        <div className="label">Recommendation labels — a job gets the label when its score is at least:</div>
        <div className="grid gap-2 sm:grid-cols-4">
          {[...THRESHOLD_ORDER.filter((k) => k in draft.thresholds), ...Object.keys(draft.thresholds).filter((k) => !THRESHOLD_ORDER.includes(k))].map((k) => (
            <Field key={k} label={humanize(k)}>
              <input className="input" type="number" min={1} max={100} value={draft.thresholds[k]} onChange={(e) => setDraft({ ...draft, thresholds: { ...draft.thresholds, [k]: Number(e.target.value) } })} />
            </Field>
          ))}
        </div>
      </div>

      <details className="mt-4 rounded border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">Advanced: company tiers and deal-breakers</summary>
        <p className="mt-2 text-xs text-slate-500">How much each company tier earns in the Company part (1 = full points, 0 = none).</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-4">
          {Object.entries(draft.tier_factors).map(([k, v]) => (
            <Field key={k} label={humanize(k)}>
              <input className="input" type="number" step="0.1" min={0} max={1} value={v} onChange={(e) => setDraft({ ...draft, tier_factors: { ...draft.tier_factors, [k]: Number(e.target.value) } })} />
            </Field>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Deal-breakers: when a job has one of these problems it is always marked “Not recommended”. Unticked problems are still shown on the job, but only lower the score.</p>
        <div className="mt-1 flex flex-wrap gap-3">
          {BLOCKER_TYPES.map((b) => (
            <label key={b} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={draft.hard_blockers.includes(b)} onChange={(e) => setDraft({ ...draft, hard_blockers: e.target.checked ? [...draft.hard_blockers, b] : draft.hard_blockers.filter((x) => x !== b) })} />
              {humanize(b)}
            </label>
          ))}
        </div>
      </details>
      {save.isSuccess && !changed && <p className="mt-2 text-xs text-emerald-700">Saved — scores update within a minute.</p>}
      {save.error && <div className="mt-2"><ErrorBox error={new Error(errorMessage(save.error))} /></div>}
    </Card>
  );
}

function CareerOpsSettings() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["career-ops"],
    queryFn: () => api.get<Record<string, any>>("/career-ops/status"), // eslint-disable-line @typescript-eslint/no-explicit-any
    refetchInterval: (q) => (q.state.data?.running ? 5000 : false),
    refetchIntervalInBackground: true, // a Career-Ops scan can take 15+ minutes
  });
  const run = useMutation({ mutationFn: (kind: "import" | "sync") => api.post<Record<string, any>>(`/career-ops/${kind}`), onSuccess: () => qc.invalidateQueries() }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = status.data;
  const running = s?.running;
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (running) setWasRunning(true);
    else if (wasRunning) {
      setWasRunning(false);
      qc.invalidateQueries(); // the scan finished: new jobs, dashboard counts
    }
  }, [running, wasRunning, qc]);
  const last = s?.last_import;
  const busy = run.isPending || !!running;
  return (
    <Card title="Career-Ops (optional)" actions={<>
      <button className="btn-primary" disabled={!s?.configured || busy} onClick={() => run.mutate("import")}>{run.isPending && run.variables === "import" ? "Importing…" : "Import now"}</button>
      <button className="btn-secondary" disabled={!s?.scan_enabled || busy} title={s?.scan_enabled ? "Run Career-Ops' own scanner (no AI, no tokens), then import" : "Set CAREER_OPS_SCAN_ENABLED=true"} onClick={() => run.mutate("sync")}>{running ? "Scanning…" : "Scan + import"}</button>
    </>}>
      <p className="mb-2 text-sm text-slate-600">Career-Ops is a separate job-search toolkit. If you use it, <b>Import now</b> brings in the jobs it found and its evaluations; <b>Scan + import</b> runs its scanner first (15–20 minutes).</p>
      {!s ? <Spinner /> : (
        <KeyValue items={[
          ["Path", s.code_root ?? "Not configured (CAREER_OPS_PATH)"], ["Version", s.version ?? "—"],
          ["Node.js", s.node_available ? "available" : "not found"], ["Scanning", s.scan_enabled ? "enabled" : "disabled"],
          ["Pending in pipeline", s.counts?.pipeline_pending ?? "—"], ["Reports", s.counts?.reports ?? "—"],
          ["Tracker rows", s.counts?.tracker_rows ?? "—"], ["Imported jobs", s.imported_jobs ?? 0],
          ["Last import", last ? `${formatDateTime(last.started_at)} · ${last.status}${last.scan_triggered ? " (with scan)" : ""}` : "never"],
        ]} />
      )}
      {running && <p className="mt-2 rounded bg-indigo-50 p-2 text-sm text-indigo-800">Career-Ops is scanning job boards (started {formatDateTime(running.started_at)}). This can take 15–30 minutes; you can keep using the app.</p>}
      {!running && last && (
        <p className="mt-2 text-sm">
          Last result: {last.stats?.created ?? 0} new, {last.stats?.merged ?? 0} updated from {last.stats?.records ?? 0} Career-Ops records.
          {(last.errors ?? []).filter((e: { stage?: string }) => e.stage).map((e: { stage: string; error: string }, i: number) => (
            <span key={i} className="block text-rose-600">{humanize(e.stage)}: {e.error}</span>
          ))}
        </p>
      )}
      {s?.error && <p className="mt-2 text-sm text-rose-600">{s.error}</p>}
      {run.error && <ErrorBox error={new Error(errorMessage(run.error))} />}
      <p className="mt-2 text-xs text-slate-500">Uses Career-Ops' scanner only — no AI, no tokens. Career Intelligence only reads Career-Ops' files; Career-Ops' own scanner updates its pipeline as usual.</p>
    </Card>
  );
}

function DataSettings() {
  const qc = useQueryClient();
  const [entity, setEntity] = useState<"jobs" | "recruiters">("jobs");
  const [file, setFile] = useState<File | null>(null);
  const imp = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append("file", file!); return api.post<Record<string, unknown>>(`/import/${entity}`, fd); },
    onSuccess: () => qc.invalidateQueries(),
  });
  const entities = ["jobs", "companies", "applications", "recruiters", "interviews", "questions", "offers", "followups"];
  const result = imp.data as { created?: number; merged?: number; skipped?: number; errors?: unknown[] } | undefined;
  return (
    <div className="space-y-4">
      <BackupSettings />
      <Card title="Download your data">
        <p className="mb-3 text-sm text-slate-600">Download everything in one file to keep a copy, or one list as a spreadsheet (CSV).</p>
        <div className="flex flex-wrap gap-2 text-sm">
          <a className="btn-primary" href="/api/v1/export/all">Download full backup (JSON)</a>
          {entities.map((e) => <a key={e} className="btn-secondary" href={`/api/v1/export/${e}?format=csv`}>{humanize(e)} (CSV)</a>)}
        </div>
      </Card>
      <Card title="Import a file">
        <p className="mb-3 text-sm text-slate-600">
          Add jobs or recruiters from a CSV or JSON file. Rows already in the app are merged, never duplicated.
          For Google Sheets use <Link className="link" to="/settings#sheets">Job sources → Google Sheets</Link>; for a single job use <Link className="link" to="/jobs/new">Add Job</Link>.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="What's in the file"><select className="input" value={entity} onChange={(e) => setEntity(e.target.value as "jobs" | "recruiters")}><option value="jobs">Jobs</option><option value="recruiters">Recruiters</option></select></Field>
          <input className="input max-w-xs" type="file" accept=".csv,.json" aria-label="Import file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="btn-secondary" disabled={!file || imp.isPending} onClick={() => imp.mutate()}>{imp.isPending ? "Importing…" : "Import"}</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Jobs need at least <b>title</b> and <b>company</b>; also read: url, jd, location, work_model, salary_min, salary_max, required_skills, status.</p>
        {result && (
          <p className="mt-2 rounded bg-emerald-50 p-2 text-sm text-emerald-800">
            Imported: {result.created ?? 0} new, {result.merged ?? 0} already in the app{result.skipped ? `, ${result.skipped} skipped` : ""}{result.errors?.length ? `, ${result.errors.length} rows with errors` : ""}.
          </p>
        )}
        {imp.error && <ErrorBox error={new Error(errorMessage(imp.error))} />}
      </Card>
    </div>
  );
}

function AboutSettings() {
  const sys = useQuery({ queryKey: ["system"], queryFn: () => api.get<Record<string, any>>("/settings/system") }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<{ enabled: boolean; provider?: string; reason?: string }>("/ai/status") });
  const google = useQuery({ queryKey: ["sheets", "access"], queryFn: () => api.get<{ service_account: string | null }>("/sheets/access") });
  const d = sys.data;
  return (
    <div className="space-y-4">
      <Card title="Optional AI">
        <p className="text-sm">{ai.data?.enabled ? <>On — using <b>{ai.data.provider}</b>.</> : <>Off. Everything in the app works without AI; scoring, email drafts and job checks are built in.</>}</p>
        <p className="mt-1 text-xs text-slate-500">To turn it on, set AI_PROVIDER (anthropic, openai, gemini or ollama), AI_MODEL and AI_API_KEY in <code>backend/.env</code> and restart the app. It costs tokens with your provider.</p>
      </Card>
      <Card title="About this app">
        {!d ? <Spinner /> : (
          <KeyValue items={[
            ["Scoring engine", d.engine_version], ["Skills catalog", d.skills_catalog_version],
            ["Google account", google.data?.service_account ?? "not connected"],
            ["Career-Ops", d.career_ops?.path ? `${d.career_ops.path}${d.career_ops.scan_enabled ? " (scanning on)" : ""}` : "not set up"],
            ["CV storage", d.storage_path], ["Max upload", `${d.max_upload_mb} MB`], ["Environment", d.environment],
          ]} />
        )}
      </Card>
    </div>
  );
}

/** One line per job source: is it set up, and when did it last bring jobs in. */
function SourcesOverview() {
  const scanner = useQuery({ queryKey: ["scanner"], queryFn: () => api.get<{ scannable: number; search_all_companies?: boolean; last_run: { started_at: string } | null; running: unknown }>("/scanner/status") }).data;
  const sheets = useQuery({ queryKey: ["sheets"], queryFn: () => api.get<{ last_imported_at: string | null }[]>("/sheets") }).data;
  const access = useQuery({ queryKey: ["sheets", "access"], queryFn: () => api.get<{ service_account: string | null }>("/sheets/access") }).data;
  const co = useQuery({ queryKey: ["career-ops"], queryFn: () => api.get<{ configured?: boolean; last_import?: { started_at: string } | null }>("/career-ops/status") }).data;
  const lastSheet = (sheets ?? []).map((x) => x.last_imported_at).filter(Boolean).sort().at(-1) ?? null;
  const row = (href: string, name: string, state: ReactNode, last: string | null | undefined, ok: boolean) => (
    <a href={href} className="flex items-start gap-2 rounded-md border border-slate-200 p-3 hover:bg-slate-50">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />
      <span className="min-w-0 text-sm">
        <b>{name}</b>
        <span className="block text-xs text-slate-500">{state}</span>
        <span className="block text-xs text-slate-400">{last ? `Last run ${formatDateTime(last)}` : "Never run"}</span>
      </span>
    </a>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Job sources">
      {row("#scanner", "Built-in job scanner", scanner ? `${scanner.scannable} companies scanned${scanner.search_all_companies ? " (all companies)" : ""}` : "…", scanner?.last_run?.started_at, !!scanner?.scannable)}
      {row("#sheets", "Google Sheets", sheets ? `${sheets.length} saved · ${access?.service_account ? "private sheets connected" : "only link-shared sheets"}` : "…", lastSheet, !!sheets?.length)}
      {row("#career-ops", "Career-Ops", co ? (co.configured ? "Set up" : "Not set up (optional)") : "…", co?.last_import?.started_at, !!co?.configured)}
      <Link to="/jobs/new" className="flex items-start gap-2 rounded-md border border-slate-200 p-3 hover:bg-slate-50">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        <span className="text-sm"><b>Add Job by hand</b><span className="block text-xs text-slate-500">For LinkedIn, Naukri, Indeed — paste the link and description.</span></span>
      </Link>
    </div>
  );
}

export type SettingsView = "sources" | "scoring" | "data" | "about";

const INTRO: Record<SettingsView, string> = {
  sources: "Where new jobs come from. Every source adds jobs to Jobs, already scored; the same job from two sources is merged.",
  scoring: "How the 0–100 match score is worked out.",
  data: "Back up your data, or bring jobs and recruiters in from a file.",
  about: "Optional AI and technical details.",
};

export function SettingsPage({ view = "sources" }: { view?: SettingsView }) {
  return (
    <div className="space-y-4">
      <div><h1>Settings</h1><PageIntro>{INTRO[view]}</PageIntro></div>
      {view === "sources" && <>
        <SourcesOverview />
        <section id="scanner" className="scroll-mt-16"><ScannerSettings /></section>
        <section id="sheets" className="scroll-mt-16"><SavedSheetsSettings /></section>
        <section id="career-ops" className="scroll-mt-16"><CareerOpsSettings /></section>
      </>}
      {view === "scoring" && <ScoringSettings />}
      {view === "data" && <DataSettings />}
      {view === "about" && <AboutSettings />}
    </div>
  );
}
