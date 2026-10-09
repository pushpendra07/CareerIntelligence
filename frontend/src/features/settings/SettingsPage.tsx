import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import { Card, ErrorBox, Field, KeyValue, Spinner } from "../../components/ui";
import { formatDateTime, humanize } from "../../utils/format";
import { ScannerSettings } from "../scanner/ScannerSettings";

interface ScoringConfig {
  weights: Record<string, number>;
  thresholds: Record<string, number>;
  tier_factors: Record<string, number>;
  hard_blockers: string[];
  [k: string]: unknown;
}

const BLOCKER_TYPES = ["MINIMUM_EXPERIENCE", "MANDATORY_TECHNOLOGY", "CERTIFICATION", "LANGUAGE", "WORK_AUTHORIZATION",
  "NOTICE_PERIOD", "LOCATION", "EXCLUDED_ROLE", "EXCLUDED_TECHNOLOGY", "EXCLUDED_INDUSTRY"];

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
  return (
    <Card title={`Scoring (version ${cfg.data?.version})`} actions={<button className="btn-primary" disabled={total !== 100 || save.isPending} onClick={() => save.mutate()}>Save as new version</button>}>
      <p className="mb-3 text-xs text-slate-500">Weights must add up to 100. Saving creates a new scoring version and marks all scores stale.</p>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Object.entries(draft.weights).map(([k, v]) => (
          <Field key={k} label={humanize(k)}>
            <input className="input" type="number" min={0} max={100} value={v} onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, [k]: Number(e.target.value) } })} />
          </Field>
        ))}
      </div>
      <p className={`mt-1 text-sm ${total === 100 ? "text-emerald-700" : "text-rose-600"}`}>Total: {total}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {Object.entries(draft.thresholds).map(([k, v]) => (
          <Field key={k} label={`${humanize(k)} ≥`}>
            <input className="input" type="number" min={1} max={100} value={v} onChange={(e) => setDraft({ ...draft, thresholds: { ...draft.thresholds, [k]: Number(e.target.value) } })} />
          </Field>
        ))}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {Object.entries(draft.tier_factors).map(([k, v]) => (
          <Field key={k} label={`Company ${humanize(k)} (0–1)`}>
            <input className="input" type="number" step="0.1" min={0} max={1} value={v} onChange={(e) => setDraft({ ...draft, tier_factors: { ...draft.tier_factors, [k]: Number(e.target.value) } })} />
          </Field>
        ))}
      </div>
      <div className="mt-4">
        <div className="label">Hard rules — these blockers force “Not recommended” (none = blockers are only shown)</div>
        <div className="flex flex-wrap gap-3">
          {BLOCKER_TYPES.map((b) => (
            <label key={b} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={draft.hard_blockers.includes(b)} onChange={(e) => setDraft({ ...draft, hard_blockers: e.target.checked ? [...draft.hard_blockers, b] : draft.hard_blockers.filter((x) => x !== b) })} />
              {humanize(b)}
            </label>
          ))}
        </div>
      </div>
      {save.error && <div className="mt-2"><ErrorBox error={new Error(errorMessage(save.error))} /></div>}
    </Card>
  );
}

function CareerOpsSettings() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["career-ops"], queryFn: () => api.get<Record<string, any>>("/career-ops/status") }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const run = useMutation({ mutationFn: (kind: "import" | "sync") => api.post<Record<string, any>>(`/career-ops/${kind}`), onSuccess: () => qc.invalidateQueries() }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = status.data;
  return (
    <Card title="Career-Ops integration (optional)" actions={<>
      <button className="btn-primary" disabled={!s?.configured || run.isPending} onClick={() => run.mutate("import")}>{run.isPending ? "Working…" : "Import now"}</button>
      <button className="btn-secondary" disabled={!s?.scan_enabled || run.isPending} title={s?.scan_enabled ? "" : "Set CAREER_OPS_SCAN_ENABLED=true"} onClick={() => run.mutate("sync")}>Scan + import</button>
    </>}>
      {!s ? <Spinner /> : (
        <KeyValue items={[
          ["Path", s.code_root ?? "Not configured (CAREER_OPS_PATH)"], ["Version", s.version ?? "—"],
          ["Node.js", s.node_available ? "available" : "not found"], ["Scanning", s.scan_enabled ? "enabled" : "disabled"],
          ["Pending in pipeline", s.counts?.pipeline_pending ?? "—"], ["Reports", s.counts?.reports ?? "—"],
          ["Tracker rows", s.counts?.tracker_rows ?? "—"], ["Imported jobs", s.imported_jobs ?? 0],
          ["Last import", s.last_import ? `${formatDateTime(s.last_import.started_at)} · ${s.last_import.status}` : "never"],
        ]} />
      )}
      {s?.error && <p className="mt-2 text-sm text-rose-600">{s.error}</p>}
      {run.data && <pre className="mt-2 rounded bg-slate-50 p-2 text-xs">{JSON.stringify(run.data.stats, null, 2)}</pre>}
      {run.error && <ErrorBox error={new Error(errorMessage(run.error))} />}
      <p className="mt-2 text-xs text-slate-500">Career-Ops files are only read; nothing is written back.</p>
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
  const [sheetUrl, setSheetUrl] = useState("");
  const sheet = useMutation({
    mutationFn: () => api.post<Record<string, unknown>>("/import/google-sheet", { url: sheetUrl, label: "Google Sheet" }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const entities = ["jobs", "companies", "applications", "recruiters", "interviews", "questions", "offers", "followups"];
  return (
    <Card title="Import & export">
      <div className="flex flex-wrap gap-2 text-sm">
        <a className="btn-primary" href="/api/v1/export/all">Export everything (JSON)</a>
        {entities.map((e) => <a key={e} className="btn-secondary" href={`/api/v1/export/${e}?format=csv`}>{humanize(e)} CSV</a>)}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Field label="Import"><select className="input" value={entity} onChange={(e) => setEntity(e.target.value as "jobs" | "recruiters")}><option value="jobs">Jobs</option><option value="recruiters">Recruiters</option></select></Field>
        <input className="input max-w-xs" type="file" accept=".csv,.json" aria-label="Import file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn-secondary" disabled={!file || imp.isPending} onClick={() => imp.mutate()}>Import</button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Jobs CSV columns: title, company, url, jd, location, work_model, salary_min, salary_max, required_skills… Companies import from the Companies API.</p>
      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="label">Import from Google Sheet (one tab; jobs or companies detected automatically)</div>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-80 flex-1" placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" aria-label="Google Sheet URL"
            value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
          <button className="btn-secondary" disabled={!sheetUrl || sheet.isPending} onClick={() => sheet.mutate()}>{sheet.isPending ? "Importing…" : "Import sheet"}</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">The sheet must be shared as “Anyone with the link → Viewer”. Re-importing is safe: duplicates merge into existing jobs and companies.</p>
        {sheet.data && <pre className="mt-2 rounded bg-slate-50 p-2 text-xs">{JSON.stringify(sheet.data, null, 2)}</pre>}
        {sheet.error && <ErrorBox error={new Error(errorMessage(sheet.error))} />}
      </div>
      {imp.data && <pre className="mt-2 rounded bg-slate-50 p-2 text-xs">{JSON.stringify(imp.data, null, 2)}</pre>}
      {imp.error && <ErrorBox error={new Error(errorMessage(imp.error))} />}
    </Card>
  );
}

function AppPreferences() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["app-settings"], queryFn: () => api.get<{ notifications: Record<string, boolean | number> }>("/settings/app") });
  const sys = useQuery({ queryKey: ["system"], queryFn: () => api.get<Record<string, any>>("/settings/system") }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<{ enabled: boolean; provider?: string; reason?: string }>("/ai/status") });
  const patch = useMutation({ mutationFn: (n: Record<string, unknown>) => api.patch("/settings/app", { notifications: n }), onSuccess: () => qc.invalidateQueries({ queryKey: ["app-settings"] }) });
  const n = s.data?.notifications;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Notifications">
        {n && (
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(n.followup_reminders)} onChange={(e) => patch.mutate({ followup_reminders: e.target.checked })} />Follow-up reminders in Today's Priorities</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(n.daily_digest)} onChange={(e) => patch.mutate({ daily_digest: e.target.checked })} />Daily digest (stored preference; email delivery not built yet)</label>
            <label className="flex items-center gap-2">Interview reminder lead time
              <input className="input w-20" type="number" min={1} value={Number(n.interview_reminder_hours)} onChange={(e) => patch.mutate({ interview_reminder_hours: Number(e.target.value) })} /> hours</label>
          </div>
        )}
      </Card>
      <Card title="AI providers (optional)">
        <p className="text-sm">{ai.data?.enabled ? `Enabled: ${ai.data.provider}` : `Off — ${ai.data?.reason ?? ""}`}</p>
        <p className="mt-1 text-xs text-slate-500">Configure with AI_PROVIDER (anthropic, openai, gemini, ollama), AI_MODEL, AI_API_KEY and AI_BASE_URL in backend/.env. Core features never need AI.</p>
        {sys.data && <div className="mt-3"><KeyValue items={[["Engine", sys.data.engine_version], ["Skills catalog", sys.data.skills_catalog_version], ["Storage", sys.data.storage_path], ["Max upload", `${sys.data.max_upload_mb} MB`]]} /></div>}
      </Card>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1>Settings</h1>
      <p className="text-sm text-slate-600">Profile, target roles, skills, locations, salary and work model live on the Profile and Target Profile pages.</p>
      <ScannerSettings />
      <ScoringSettings />
      <CareerOpsSettings />
      <AppPreferences />
      <DataSettings />
    </div>
  );
}
