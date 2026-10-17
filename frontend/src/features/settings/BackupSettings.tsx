import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api/client";
import { Card, ErrorBox } from "../../components/ui";
import { formatDateTime } from "../../utils/format";

type Backup = { name: string; size: number; created_at: string; trigger: string | null; database_dump: boolean | null; note: string | null; files: number | null; rows: number | null };
export type BackupStatus = {
  settings: { enabled: boolean; every_hours: number; keep: number };
  folder: string; pg_dump: boolean; last: string | null; next_due: string | null; running: boolean; backups: Backup[];
};

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const HOURS = [6, 12, 24, 48, 168];

/** Automatic backups: schedule, how many to keep, back up now, and the list to download. */
export function BackupSettings() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["backups"], queryFn: () => api.get<BackupStatus>("/backups") });
  const [error, setError] = useState<unknown>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["backups"] });
  const now = useMutation({ mutationFn: () => api.post<Backup>("/backups"), onSuccess: refresh, onError: setError });
  const save = useMutation({
    mutationFn: (backups: Partial<BackupStatus["settings"]>) => api.patch("/settings/app", { backups }),
    onSuccess: refresh, onError: setError,
  });
  if (status.error) return <ErrorBox error={status.error} />;
  if (!status.data) return null;
  const s = status.data;
  const cfg = s.settings;
  return (
    <Card title="Automatic backups">
      <p className="mb-3 text-sm text-slate-600">
        A zip with your whole database, a readable copy of your data (data.json) and your uploaded CVs, saved on this computer
        in <code className="break-all text-xs">{s.folder}</code>. Backups run while the app is running.
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => save.mutate({ enabled: e.target.checked })} />
          Back up automatically
        </label>
        <label className="flex items-center gap-1">every
          <select className="input w-auto py-1" aria-label="Backup every" value={cfg.every_hours} disabled={!cfg.enabled}
            onChange={(e) => save.mutate({ every_hours: Number(e.target.value) })}>
            {[...new Set([...HOURS, cfg.every_hours])].sort((a, b) => a - b).map((h) => <option key={h} value={h}>{h === 168 ? "week" : h === 24 ? "day" : h === 48 ? "2 days" : `${h} hours`}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">keep the last
          <input className="input w-16 py-1" type="number" min={1} max={365} aria-label="Backups to keep" defaultValue={cfg.keep}
            onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 365 && n !== cfg.keep) save.mutate({ keep: n }); }} />
        </label>
        <button className="btn-primary ml-auto" onClick={() => { setError(null); now.mutate(); }} disabled={now.isPending || s.running}>
          {now.isPending || s.running ? "Backing up…" : "Back up now"}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {s.last ? <>Last backup {formatDateTime(s.last)}.</> : "No backup yet."}
        {cfg.enabled && s.next_due && <> Next {new Date(s.next_due) <= new Date() ? "within 10 minutes" : formatDateTime(s.next_due)}.</>}
        {!s.pg_dump && <span className="text-amber-700"> pg_dump isn't installed, so backups hold data.json and files but no database dump.</span>}
      </p>
      {!!error && <ErrorBox error={new Error(errorMessage(error))} />}
      {s.backups.length > 0 && (
        <table className="mt-3 min-w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-4">Backup</th><th className="py-1 pr-4">Size</th><th className="py-1 pr-4">Contents</th><th className="py-1" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {s.backups.map((b) => (
              <tr key={b.name}>
                <td className="py-1.5 pr-4">{formatDateTime(b.created_at)} <span className="text-xs text-slate-400">{b.trigger === "schedule" ? "automatic" : b.trigger ?? ""}</span></td>
                <td className="py-1.5 pr-4 tabular-nums">{mb(b.size)}</td>
                <td className="py-1.5 pr-4 text-xs text-slate-600" title={b.note ?? undefined}>
                  {b.database_dump ? "database" : <span className="text-amber-700">no database dump</span>}{b.rows ? ` · ${b.rows} rows` : ""}{b.files ? ` · ${b.files} files` : ""}
                </td>
                <td className="py-1.5 text-right"><a className="link text-xs" href={`/api/v1/backups/${b.name}`} download>Download</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-slate-500">To restore one: stop the app (<code>./stop.sh --keep-db</code>), then run <code>./scripts/restore-backup.sh backend/backups/&lt;file&gt;.zip</code>. It replaces all current data.</p>
    </Card>
  );
}
