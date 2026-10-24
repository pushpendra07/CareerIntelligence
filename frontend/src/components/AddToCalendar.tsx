import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { API_BASE, api } from "../api/client";
import { Card, CopyButton, Spinner } from "./ui";

type Kind = "interview" | "followup" | "offer" | "deadline";

/** "Google · .ics" links for one interview / follow-up / offer / apply-by date. Google opens its
 * new-event page filled in (you press Save there); .ics opens in Apple Calendar or Outlook. */
export function AddToCalendar({ kind, id, compact = false }: { kind: Kind; id: number; compact?: boolean }) {
  const base = `${API_BASE}/calendar/${kind}/${id}`;
  return (
    <span className={`inline-flex items-center gap-1.5 ${compact ? "text-xs" : "text-sm"}`} role="group" aria-label="Add to calendar">
      {!compact && <span className="text-slate-500">Add to calendar:</span>}
      <a className="link" href={`${base}/google`} target="_blank" rel="noopener noreferrer" title="Add to Google Calendar">
        {compact ? "📅 Google" : "Google"}
      </a>
      <span aria-hidden className="text-slate-300">·</span>
      <a className="link" href={`${base}.ics`} download title="Download for Apple Calendar or Outlook">.ics</a>
    </span>
  );
}

type Feed = { enabled: boolean; path: string | null };

/** Settings: the private feed calendar apps subscribe to. */
export function CalendarFeed() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["calendar", "feed"], queryFn: () => api.get<Feed>("/calendar/feed") });
  const [confirm, setConfirm] = useState(false);
  const set = (data: Feed) => { qc.setQueryData(["calendar", "feed"], data); setConfirm(false); };
  const on = useMutation({ mutationFn: (fresh: boolean) => api.post<Feed>(`/calendar/feed${fresh ? "?new_link=true" : ""}`), onSuccess: set,
    meta: { success: "Calendar link ready", toastError: true } });
  const off = useMutation({ mutationFn: () => api.delete<Feed>("/calendar/feed"), onSuccess: set,
    meta: { success: "Calendar link turned off", toastError: true } });
  const f = q.data;
  const url = f?.path ? `${window.location.origin}${f.path}` : "";
  const local = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
  return (
    <Card title="Calendar">
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Interviews (with a reminder 30 minutes before), follow-ups, offer deadlines, joining dates and apply-by dates.
          Each one has <b>Add to calendar: Google · .ics</b> where it's shown; or subscribe once to all of them and your calendar keeps itself up to date.
        </p>
        {!f ? <Spinner /> : !f.enabled ? (
          <button type="button" className="btn-primary" disabled={on.isPending} onClick={() => on.mutate(false)}>Get my calendar link</button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input className="input font-mono text-xs" readOnly value={url} aria-label="Calendar link" onFocus={(e) => e.target.select()} />
              <CopyButton text={url} label="Copy link" />
            </div>
            <ul className="list-disc space-y-1 pl-5 text-slate-600">
              <li><b>Apple Calendar</b> (this Mac): File → New Calendar Subscription → paste the link.</li>
              <li><b>Outlook</b>: Add calendar → Subscribe from web.</li>
              <li><b>Google Calendar</b>: Other calendars → + → From URL. Google fetches the link from its own servers, so it needs an address
                reachable from the internet{local ? <> — open the app through <code>./start-tunnel.sh</code> and copy the link from there (a tunnel link changes each time it starts)</> : ""}.</li>
            </ul>
            <p className="text-xs text-slate-500">
              The link is private: anyone who has it can see these events, without logging in. It shows only what's listed above, never your CV or notes elsewhere.
            </p>
            {confirm ? (
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-amber-700">Calendars using the current link stop updating.</span>
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => on.mutate(true)}>Make a new link</button>
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => off.mutate()}>Turn the link off</button>
                <button type="button" className="link" onClick={() => setConfirm(false)}>Cancel</button>
              </p>
            ) : (
              <button type="button" className="link text-xs" onClick={() => setConfirm(true)}>New link or turn off…</button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
