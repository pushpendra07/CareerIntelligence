import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Card, ErrorBox, Field, KeyValue, Spinner, PageIntro } from "../../components/ui";
import { formatDateTime, humanize } from "../../utils/format";
import type { ChatStatus } from "../chat/Chat";
import { collectorOutdated, collectorVersion, extensionDownloadUrl } from "../jobs/collector";
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
      {s?.configured && <CareerOpsAutomation automation={s.automation} />}
      {s?.configured && <CareerOpsPortals />}
      <p className="mt-2 text-xs text-slate-500">Uses Career-Ops' scanner only — no AI, no tokens. Career Intelligence only reads Career-Ops' files; Career-Ops' own scanner updates its pipeline as usual.</p>
    </Card>
  );
}

interface CareerOpsAuto { schedule_hours: number; auto_import: boolean; scan_ready: boolean; next_scan_at: string | null }

/** Run Career-Ops by itself: Scan + import every N hours, and import whenever its files change. */
function CareerOpsAutomation({ automation }: { automation?: CareerOpsAuto }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState(automation?.schedule_hours ?? 0);
  const [autoImport, setAutoImport] = useState(automation?.auto_import ?? false);
  useEffect(() => {
    setHours(automation?.schedule_hours ?? 0);
    setAutoImport(automation?.auto_import ?? false);
  }, [automation?.schedule_hours, automation?.auto_import]);
  const save = useMutation({
    mutationFn: () => api.patch("/settings/app", { career_ops: { schedule_hours: hours, auto_import: autoImport } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["career-ops"] }),
    meta: { success: "Career-Ops automation saved", toastError: true },
  });
  const changed = hours !== (automation?.schedule_hours ?? 0) || autoImport !== (automation?.auto_import ?? false);
  return (
    <div className="mt-3 rounded-lg border border-slate-200 p-3">
      <h3 className="mb-2 text-sm font-semibold">Run automatically</h3>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Scan + import every (hours, 0 = off)">
          <input className="input w-28" type="number" min={0} max={168} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoImport} onChange={(e) => setAutoImport(e.target.checked)} />
          Import as soon as Career-Ops finds something new (e.g. after <code>npm run scan</code> in a terminal)
        </label>
        <button className="btn-primary" disabled={!changed || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {hours > 0 && !automation?.scan_ready
          ? "Scheduled scans need Node.js and CAREER_OPS_SCAN_ENABLED=true."
          : automation?.next_scan_at && automation.schedule_hours > 0
            ? `Next scan: ${new Date(automation.next_scan_at) <= new Date() ? "within 5 minutes" : formatDateTime(automation.next_scan_at)}.`
            : "Checked every 5 minutes while the app is running."}
      </p>
    </div>
  );
}

interface CareerOpsPortalsData {
  path: string | null; max_posting_age_days: number | null; title_keep: string[]; title_skip: string[]; locations: string[];
  companies: { name: string; careers_url: string | null; enabled: boolean; notes: string | null }[];
}

/** What Career-Ops searches (its portals.yml), read-only — edit it in Career-Ops. */
function CareerOpsPortals() {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["career-ops", "portals"], queryFn: () => api.get<CareerOpsPortalsData>("/career-ops/portals"), enabled: open });
  const p = q.data;
  const on = p?.companies.filter((c) => c.enabled) ?? [];
  return (
    <details className="mt-3 rounded-lg border border-slate-200 p-3" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-semibold">What Career-Ops searches</summary>
      {!p ? (q.isError ? <ErrorBox error={q.error} /> : <Spinner />) : !p.path ? (
        <p className="mt-2 text-sm text-slate-600">No portals.yml found in the Career-Ops folder.</p>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <KeyValue items={[
            ["Companies", `${on.length} on${p.companies.length > on.length ? ` · ${p.companies.length - on.length} off` : ""}`],
            ["Titles to keep", p.title_keep.join(", ") || "—"],
            ["Titles to skip", p.title_skip.join(", ") || "—"],
            ["Locations", p.locations.join(", ") || "—"],
            ["Max posting age", p.max_posting_age_days ? `${p.max_posting_age_days} days` : "—"],
          ]} />
          <ul className="max-h-72 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
            {p.companies.map((c) => (
              <li key={c.name} className={`flex flex-wrap items-baseline gap-x-2 px-2 py-1 ${c.enabled ? "" : "text-slate-400"}`}>
                <span className="font-medium">{c.name}</span>
                {!c.enabled && <span className="text-xs">(off)</span>}
                {c.careers_url && <a className="link truncate text-xs" href={c.careers_url} target="_blank" rel="noopener noreferrer">{c.careers_url}</a>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">Read from <code>{p.path}</code>. To change companies or filters, edit that file in Career-Ops.</p>
        </div>
      )}
    </details>
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
        <p className="mt-1 text-sm">With AI on, the <b>Assistant</b> (chat button at the bottom right, ⌘J) answers anything about your data in your own words; without it, it understands built-in commands.</p>
        <div className="mt-2 text-xs text-slate-500">
          <p>To turn it on, add to <code>backend/.env</code> and restart (<code>./stop.sh --keep-db && ./start.sh</code>). It costs tokens with your provider:</p>
          <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 text-[11px] leading-relaxed dark:bg-white/5">{`# Claude:     AI_PROVIDER=anthropic   AI_API_KEY=sk-ant-…   (AI_MODEL optional)
# Gemini:     AI_PROVIDER=gemini      AI_API_KEY=…          AI_MODEL=<a Gemini model>
# OpenAI:     AI_PROVIDER=openai      AI_API_KEY=sk-…       AI_MODEL=<an OpenAI model>
# OmniRoute:  AI_PROVIDER=omniroute   AI_MODEL=<model or combo in OmniRoute>
#             AI_API_KEY=<only if OmniRoute requires one>   AI_BASE_URL=http://localhost:20128/v1 (default)`}</pre>
        </div>
      </Card>
      <AssistantSettings />
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

/** Turn the Assistant chat on/off, and whether it may use AI (tokens) or only built-in commands. */
function AssistantSettings() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["chat", "status"], queryFn: () => api.get<ChatStatus>("/chat/status") });
  const save = useMutation({
    mutationFn: (patch: { enabled?: boolean; use_ai?: boolean }) => api.patch("/settings/app", { assistant: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat"] }),
    meta: { success: "Assistant settings saved", toastError: true },
  });
  const s = status.data;
  if (!s) return <Card title="Assistant"><Spinner /></Card>;
  const enabled = s.enabled !== false;
  return (
    <Card title="Assistant">
      <p className="mb-3 text-sm text-slate-600">The chat at the bottom right of every page (⌘J): finds jobs, checks statuses, applies and more —
        changes always wait for your Confirm.</p>
      <div className="space-y-3 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={enabled} disabled={save.isPending} onChange={(e) => save.mutate({ enabled: e.target.checked })} />
          <span><b>Show the Assistant</b><span className="block text-xs text-slate-500">Off hides the chat button and ⌘J.</span></span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={s.use_ai !== false} disabled={!enabled || !s.ai_configured || save.isPending}
            onChange={(e) => save.mutate({ use_ai: e.target.checked })} />
          <span><b>Use AI in the Assistant</b>
            <span className="block text-xs text-slate-500">{!s.ai_configured
              ? "No AI provider is set up (see Optional AI above), so it uses built-in commands."
              : s.mode === "ai" ? `On — answers in your own words with ${s.provider}${s.model ? ` (${s.model})` : ""}; costs tokens.`
                : "Off — built-in commands only (free). Your AI key stays set for the other AI features."}</span></span>
        </label>
      </div>
    </Card>
  );
}

/** The Job collector Chrome extension: download (set up for this app) and install steps. */
function ExtensionSettings() {
  const [installed, setInstalled] = useState<string | null>(collectorVersion);
  useEffect(() => {
    const t = window.setTimeout(() => setInstalled(collectorVersion()), 800); // its script may load after the page
    return () => window.clearTimeout(t);
  }, []);
  return (
    <Card title="Chrome extension: Job collector" actions={<a className="btn-primary" href={extensionDownloadUrl()} download>Download extension (.zip)</a>}>
      <p className="mb-2 text-sm text-slate-600">
        On any job page — LinkedIn, Naukri, Indeed, Glassdoor, a company careers page — click the extension's icon and the job is added here
        (duplicates are merged). It can also collect a portal's search results from <Link className="link" to="/jobs/ai-search">Jobs → AI search</Link>. No AI, no tokens.
      </p>
      <p className="mb-2 text-sm">{installed
        ? collectorOutdated(installed)
          ? <span className="text-amber-700">Installed, but an older version ({installed}): click the reload icon on it in <code>chrome://extensions</code>, or download again.</span>
          : <span className="text-emerald-700">Installed in this browser (version {installed}).</span>
        : <span className="text-slate-500">Not installed in this browser.</span>}</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li><b>Download</b> the zip (it is set up for this app's address) and unzip it.</li>
        <li>In Chrome, open <code>chrome://extensions</code> and turn on <b>Developer mode</b> (top right).</li>
        <li>Click <b>Load unpacked</b> and choose the unzipped <code>career-intelligence-extension</code> folder.</li>
        <li>Pin it: puzzle-piece icon in the toolbar → pin <b>Career Intelligence – Job collector</b>. Reload this page.</li>
      </ol>
      <p className="mt-2 text-xs text-slate-500">To update it later, download again, replace the folder, and click the reload icon on its card in <code>chrome://extensions</code>.</p>
    </Card>
  );
}

/** One line per job source: is it set up, and when did it last bring jobs in. */
function SourcesOverview() {
  const scanner = useQuery({ queryKey: ["scanner"], queryFn: () => api.get<{ scannable: number; search_all_companies?: boolean; last_run: { started_at: string } | null; running: unknown }>("/scanner/status") }).data;
  const sheets = useQuery({ queryKey: ["sheets"], queryFn: () => api.get<{ last_imported_at: string | null }[]>("/sheets") }).data;
  const access = useQuery({ queryKey: ["sheets", "access"], queryFn: () => api.get<{ service_account: string | null }>("/sheets/access") }).data;
  const co = useQuery({ queryKey: ["career-ops"], queryFn: () => api.get<{ configured?: boolean; last_import?: { started_at: string } | null }>("/career-ops/status") }).data;
  const lastSheet = (sheets ?? []).map((x) => x.last_imported_at).filter(Boolean).sort().at(-1) ?? null;
  const row = (href: string, name: string, state: ReactNode, last: string | null | undefined | false, ok: boolean) => (
    <a href={href} className="flex items-start gap-2 rounded-md border border-slate-200 p-3 hover:bg-slate-50">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />
      <span className="min-w-0 text-sm">
        <b>{name}</b>
        <span className="block text-xs text-slate-500">{state}</span>
        {last !== false && <span className="block text-xs text-slate-400">{last ? `Last run ${formatDateTime(last)}` : "Never run"}</span>}
      </span>
    </a>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Job sources">
      {row("#scanner", "Built-in job scanner", scanner ? `${scanner.scannable} companies scanned${scanner.search_all_companies ? " (all companies)" : ""}` : "…", scanner?.last_run?.started_at, !!scanner?.scannable)}
      {row("#sheets", "Google Sheets", sheets ? `${sheets.length} saved · ${access?.service_account ? "private sheets connected" : "only link-shared sheets"}` : "…", lastSheet, !!sheets?.length)}
      {row("#career-ops", "Career-Ops", co ? (co.configured ? "Set up" : "Not set up (optional)") : "…", co?.last_import?.started_at, !!co?.configured)}
      {row("#extension", "Chrome extension", collectorVersion() ? "Installed — click it on any job page" : "Not installed — download it below", false, !!collectorVersion())}
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
        <section id="extension" className="scroll-mt-16"><ExtensionSettings /></section>
      </>}
      {view === "scoring" && <ScoringSettings />}
      {view === "data" && <DataSettings />}
      {view === "about" && <AboutSettings />}
    </div>
  );
}
