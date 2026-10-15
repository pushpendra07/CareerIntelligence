import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, errorMessage } from "../../api/client";
import { Card, Empty, ErrorBox, Spinner } from "../../components/ui";
import { formatDateTime } from "../../utils/format";

interface TabResult { tab: string; kind: string | null; read?: number; created?: number; merged?: number; deleted_skipped?: number; error?: string }
export interface SavedSheet {
  id: number;
  url: string;
  title: string;
  last_imported_at: string | null;
  last_result: { via: string; created: number; merged: number; tabs: TabResult[] } | null;
  last_error: string | null;
}

interface SheetCheck { readable: boolean | null; via: string; reason: string | null; message: string | null }

/** The clear "can't import" message for a private sheet, with what to do about it. */
function PrivateSheetNotice() {
  return (
    <div role="alert" className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
      <p className="font-medium">Can't import — this sheet is private.</p>
      <p className="mt-1 text-xs">
        Google only opens it for signed-in people, and the app has no Google sign-in yet. To import it from here, either:
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
        <li><b>Connect private sheets</b> (one-time setup above), then share the sheet with the service account's email as Viewer — the sheet stays private; or</li>
        <li>in Google Sheets: <b>Share → General access → Anyone with the link → Viewer</b>; or</li>
        <li>ask Claude to import it through its Google connector.</li>
      </ul>
    </div>
  );
}

function SheetRow({ sheet }: { sheet: SavedSheet }) {
  // Asked when the page opens, so a private sheet is flagged before Import is clicked.
  const check = useQuery({
    queryKey: ["sheets", sheet.id, "check"],
    queryFn: () => api.get<SheetCheck>(`/sheets/${sheet.id}/check`),
    staleTime: 5 * 60_000, retry: false,
  }).data;
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  const imp = useMutation({ mutationFn: () => api.post<SavedSheet>(`/sheets/${sheet.id}/import`), onSettled: refresh });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const remove = useMutation({ mutationFn: () => api.delete(`/sheets/${sheet.id}`), onSuccess: refresh });
  const r = sheet.last_result;
  const importFailedPrivate = imp.error instanceof ApiError
    && (imp.error.details as { reason?: string } | undefined)?.reason === "private";
  const isPrivate = importFailedPrivate || (!imp.error && check?.reason === "private");
  const error = isPrivate ? null : imp.error ? errorMessage(imp.error) : check?.message ?? sheet.last_error;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <a className="link font-medium" href={sheet.url} target="_blank" rel="noopener noreferrer">{sheet.title}</a>
          {check?.readable === false && check.reason === "private" && (
            <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Private — can't import</span>
          )}
          {check?.readable === true && (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700" title="Shared by link: Import reads its first tab">Open by link</span>
          )}
          <p className="text-xs text-slate-500">
            {sheet.last_imported_at
              ? <>{isPrivate || error ? "Last successful import" : "Last import"} {formatDateTime(sheet.last_imported_at)}{r?.via === "connector" ? " (by an agent, via Google connector)" : ""}: <b>{r?.created ?? 0} new</b>, {r?.merged ?? 0} already in the app</>
              : "Not imported yet"}
          </p>
          {r && r.tabs.length > 1 && (
            <p className="text-xs text-slate-500">{r.tabs.map((t) => `${t.tab || "sheet"}: ${t.created ?? 0} new / ${t.merged ?? 0} existing`).join(" · ")}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-primary" disabled={imp.isPending} onClick={() => imp.mutate()}>{imp.isPending ? "Importing…" : "Import"}</button>
          {confirmRemove ? (
            <span className="flex items-center gap-1 text-xs">
              Remove from this list?
              <button className="rounded bg-rose-600 px-2 py-0.5 text-white dark:bg-rose-500" onClick={() => remove.mutate()}>Remove</button>
              <button className="rounded px-2 py-0.5 hover:bg-slate-100" onClick={() => setConfirmRemove(false)}>Cancel</button>
            </span>
          ) : <button className="btn-secondary" onClick={() => setConfirmRemove(true)}>Remove</button>}
        </div>
      </div>
      {isPrivate && <PrivateSheetNotice />}
      {error && <p role="alert" className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-800">{error}</p>}
    </li>
  );
}

function PrivateAccess() {
  const access = useQuery({
    queryKey: ["sheets", "access"],
    queryFn: () => api.get<{ service_account: string | null; key_file: string; error: string | null }>("/sheets/access"),
  });
  const [copied, setCopied] = useState(false);
  const a = access.data;
  if (!a) return null;
  if (a.service_account) {
    const copy = () => { navigator.clipboard?.writeText(a.service_account!).then(() => setCopied(true)).catch(() => undefined); };
    return (
      <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900">
        Private sheets connected. The app reads them as <b className="break-all">{a.service_account}</b>{" "}
        <button type="button" className="link text-xs" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <div className="text-xs">In each Google Sheet: <b>Share</b> → add this email → <b>Viewer</b> → Send. Then click Import.</div>
      </div>
    );
  }
  return (
    <details className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" open={!!a.error}>
      <summary className="cursor-pointer font-medium">Connect private sheets (one-time setup)</summary>
      {a.error && <p className="mt-1 text-rose-700">{a.error}</p>}
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
        <li>Open <a className="link" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> and create a project (free; no billing needed).</li>
        <li>Enable the <a className="link" href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noopener noreferrer">Google Sheets API</a> for that project.</li>
        <li>Go to <a className="link" href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer">IAM &amp; Admin → Service accounts</a> → <b>Create service account</b> (no roles needed).</li>
        <li>Open it → <b>Keys</b> → <b>Add key</b> → <b>Create new key</b> → JSON. A file downloads.</li>
        <li>Move that file to <code className="rounded bg-surface px-1">backend/{a.key_file}</code> in this project (it is git-ignored), then restart the app.</li>
        <li>This box then shows the service account's email: share each sheet with it as <b>Viewer</b>.</li>
      </ol>
    </details>
  );
}

export function SavedSheetsSettings() {
  const qc = useQueryClient();
  const sheets = useQuery({ queryKey: ["sheets"], queryFn: () => api.get<SavedSheet[]>("/sheets") });
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const add = useMutation({
    mutationFn: () => api.post<SavedSheet>("/sheets", { url, title: title || null }),
    onSuccess: () => { setUrl(""); setTitle(""); qc.invalidateQueries({ queryKey: ["sheets"] }); },
  });
  return (
    <Card title="Google Sheets">
      <p className="mb-2 text-sm text-slate-600">
        Saved sheets you can import again at any time (all tabs). Rows already in the app are updated, never
        duplicated, and jobs you deleted are skipped.
      </p>
      <PrivateAccess />
      {sheets.isLoading ? <Spinner /> : sheets.error ? <ErrorBox error={sheets.error} /> : !sheets.data?.length
        ? <Empty>No sheets saved yet.</Empty>
        : <ul className="divide-y divide-slate-100">{sheets.data.map((s) => <SheetRow key={s.id} sheet={s} />)}</ul>}
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <input className="input min-w-64 flex-1" placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="Sheet URL"
          value={url} onChange={(e) => setUrl(e.target.value)} />
        <input className="input w-48" placeholder="Name (optional)" aria-label="Sheet name" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn-secondary" disabled={!url || add.isPending}>Save sheet</button>
      </form>
      {add.error && <ErrorBox error={new Error(errorMessage(add.error))} />}
      <p className="mt-2 text-xs text-slate-500">
        Sheets shared as "Anyone with the link → Viewer" also import without the setup above.
      </p>
    </Card>
  );
}
