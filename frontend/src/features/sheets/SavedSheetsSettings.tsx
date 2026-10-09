import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api/client";
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

function SheetRow({ sheet }: { sheet: SavedSheet }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  const imp = useMutation({ mutationFn: () => api.post<SavedSheet>(`/sheets/${sheet.id}/import`), onSettled: refresh });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const remove = useMutation({ mutationFn: () => api.delete(`/sheets/${sheet.id}`), onSuccess: refresh });
  const r = sheet.last_result;
  const error = imp.error ? errorMessage(imp.error) : sheet.last_error;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <a className="link font-medium" href={sheet.url} target="_blank" rel="noopener noreferrer">{sheet.title}</a>
          <p className="text-xs text-slate-500">
            {sheet.last_imported_at
              ? <>Last import {formatDateTime(sheet.last_imported_at)}{r?.via === "connector" ? " (by Claude, via Google Drive)" : ""}: <b>{r?.created ?? 0} new</b>, {r?.merged ?? 0} already in the app</>
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
              <button className="rounded bg-rose-600 px-2 py-0.5 text-white" onClick={() => remove.mutate()}>Remove</button>
              <button className="rounded px-2 py-0.5 hover:bg-slate-100" onClick={() => setConfirmRemove(false)}>Cancel</button>
            </span>
          ) : <button className="btn-secondary" onClick={() => setConfirmRemove(true)}>Remove</button>}
        </div>
      </div>
      {error && <p className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-800">{error}</p>}
    </li>
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
      <p className="text-sm text-slate-600">
        Saved sheets you can import again at any time. Rows already in the app are updated, never duplicated,
        and jobs you deleted are skipped.
      </p>
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
        Private sheets: ask Claude to "import my Google Sheets" — it reads them through your Google Drive connector.
        Sheets shared as "Anyone with the link → Viewer" import directly with the button.
      </p>
    </Card>
  );
}
