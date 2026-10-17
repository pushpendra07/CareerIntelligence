import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Icon } from "./icons";

/** A job in a notification: company, where, score and whether (and when) you applied. */
export type JobInfo = {
  job_id: number | null; job_title?: string | null; company?: string | null; location?: string | null;
  work_model?: string | null; score?: number | null; job_status?: string | null; applied?: boolean | null;
  applied_on?: string | null; application_status?: string | null; application_id?: number | null; added_on?: string | null;
};
export type RemindersData = {
  followups: (JobInfo & { id: number; title: string; due_date: string; late_days: number })[];
  interviews: { id: number; job_id: number; round: number; round_type: string; scheduled_at: string;
    meeting_link: string | null; job_title: string; company: string; minutes_until: number }[];
  new_jobs?: JobInfo[];
  apply_pending?: JobInfo[];
};
export type ReminderEvent = { id: number; rule_id: string; title: string; body: string; url: string; test: boolean; created_at: string };
export type Note = { key: string; title: string; body: string; url: string };

const ENABLED = "reminders.enabled.v1";
const SENT = "reminders.sent.v1";
const NEW_JOBS = "reminders.newJobs.v1"; // new-job count last seen, to notify when a scan adds more
const SEEN = "bell.seen.v1"; // notifications already seen in the bell
const LAST_EVENT = "reminders.lastEvent.v1"; // last scheduled reminder shown in this browser
const ICON = "/icon-192.png";
const TITLE = "Career Intelligence";
const POLL_MS = 5 * 60_000;

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
};
const supported = () => typeof window !== "undefined" && "Notification" in window;
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * What to notify about now, skipping what was already shown. Follow-ups: once a day each
 * (one summary when more than 3). Interviews: once when within 24 hours, again within the hour.
 */
export function dueNotes(data: RemindersData, sent: Set<string>, today: string): Note[] {
  const out: Note[] = [];
  const fus = data.followups;
  if (fus.length > 3) {
    out.push({ key: `fus:${today}`, title: `${fus.length} follow-ups due`, url: "/followups",
      body: fus.slice(0, 3).map((f) => f.title).join(" · ") + " …" });
  } else {
    for (const f of fus) {
      out.push({ key: `fu:${f.id}:${today}`, title: f.late_days > 0 ? `Follow-up ${f.late_days} day${f.late_days === 1 ? "" : "s"} late` : "Follow-up due today",
        body: f.title, url: f.job_id ? `/jobs/${f.job_id}#follow-ups` : "/followups" });
    }
  }
  for (const iv of data.interviews) {
    const what = `${iv.job_title} at ${iv.company} (round ${iv.round})`;
    if (iv.minutes_until <= 60) {
      out.push({ key: `iv:${iv.id}:hour`, title: `Interview in ${Math.max(iv.minutes_until, 0)} min`, body: what, url: `/interviews/${iv.id}` });
    } else {
      out.push({ key: `iv:${iv.id}:day`, title: `Interview at ${time(iv.scheduled_at)}`, body: what, url: `/interviews/${iv.id}` });
    }
  }
  return out.filter((n) => !sent.has(n.key));
}

function sentKeys(): Set<string> {
  try { return new Set(JSON.parse(read(SENT) ?? "[]") as string[]); } catch { return new Set(); }
}

export const useReminders = () => useQuery({ queryKey: ["reminders"], queryFn: () => api.get<RemindersData>("/reminders"),
  refetchInterval: POLL_MS, refetchIntervalInBackground: true, retry: false });

type Summary = { new_jobs?: number; new_70_plus?: number } | undefined;

function notify(n: Note, navigate: (to: string) => void) {
  const shown = new Notification(n.title, { body: n.body, tag: n.key, icon: ICON, badge: ICON });
  shown.onclick = () => { window.focus(); navigate(n.url); shown.close(); };
}

/** "N new jobs found" when the count of new jobs went up since last time (a scan or import). */
export function newJobsNote(now: number, best: number, last: number | null): Note | null {
  if (last === null || now <= last) return null;
  const added = now - last;
  return { key: `new:${now}`, title: `${added} new job${added === 1 ? "" : "s"} found`,
    body: best ? `${best} new jobs score 70+. Review them now.` : "Review them when you have a minute.", url: "/jobs/review" };
}

/** The unread count in the tab title and on the installed app's icon: the same as the bell. */
export function useUnreadBadge(unread: number) {
  useEffect(() => {
    document.title = unread ? `(${unread > 99 ? "99+" : unread}) ${TITLE}` : TITLE;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    (unread ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => {});
  }, [unread]);
}

/** Browser notifications while the app is open (when turned on in this browser). */
export function useBrowserReminders(summary?: Summary) {
  const navigate = useNavigate();
  const on = read(ENABLED) === "1" && supported() && Notification.permission === "granted";
  const q = useReminders();
  useEffect(() => {
    if (!on || !q.data) return;
    const sent = sentKeys();
    const today = new Date().toDateString();
    for (const n of dueNotes(q.data, sent, today)) { notify(n, navigate); sent.add(n.key); }
    write(SENT, JSON.stringify([...sent].slice(-300)));
  }, [on, q.data, navigate]);
  const newJobs = summary?.new_jobs;
  useEffect(() => {
    if (newJobs === undefined) return;
    const last = read(NEW_JOBS);
    const note = newJobsNote(newJobs, summary?.new_70_plus ?? 0, last === null ? null : Number(last));
    if (on && note) notify(note, navigate);
    write(NEW_JOBS, String(newJobs));
  }, [newJobs, summary?.new_70_plus, on, navigate]);
}

export type BellKind = "interview" | "followup" | "apply" | "new" | "reminder";
export type BellItem = {
  key: string; kind: BellKind; icon: string; tone: string; title: string; company?: string | null;
  details: string[]; status?: { text: string; tone: string }; to: string; when?: string;
};
const KIND_LABEL: Record<BellKind, string> = { interview: "Interviews", followup: "Follow-ups", apply: "Apply pending", new: "New jobs", reminder: "Reminders" };

const shortDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const human = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

function jobDetails(j: JobInfo): string[] {
  return [j.location ?? "", j.work_model && j.work_model !== "UNKNOWN" ? human(j.work_model) : "",
    j.score != null ? `score ${j.score}` : ""].filter(Boolean);
}
function appliedChip(j: JobInfo): BellItem["status"] {
  if (j.applied) return { text: `Applied ${j.applied_on ? shortDate(j.applied_on) : ""}${j.application_status && j.application_status !== "APPLIED" ? ` · ${human(j.application_status)}` : ""}`.trim(), tone: "bg-emerald-50 text-emerald-700" };
  if (j.applied === false) return { text: "Not applied", tone: "bg-slate-100 text-slate-600" };
  return undefined;
}

export function bellItems(data: RemindersData | undefined, summary: Summary, reminders: ReminderEvent[] = []): BellItem[] {
  const out: BellItem[] = [];
  for (const iv of data?.interviews ?? []) {
    out.push({ key: `iv:${iv.id}`, kind: "interview", icon: "calendar", tone: "bg-emerald-50 text-emerald-600",
      title: iv.minutes_until <= 60 ? `Interview in ${Math.max(iv.minutes_until, 0)} min` : `Interview at ${time(iv.scheduled_at)}`,
      company: iv.company, details: [iv.job_title, `round ${iv.round} · ${human(iv.round_type)}`],
      status: { text: "Applied", tone: "bg-emerald-50 text-emerald-700" }, to: `/interviews/${iv.id}` });
  }
  for (const f of data?.followups ?? []) {
    out.push({ key: `fu:${f.id}:${f.late_days}`, kind: "followup", icon: "bell", tone: f.late_days > 0 ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600",
      title: f.job_title ?? f.title.replace(/^follow[ -]?up\s*[:\-—]\s*/i, ""), company: f.company,
      details: [f.late_days > 0 ? `Follow-up ${f.late_days} day${f.late_days === 1 ? "" : "s"} late` : "Follow-up due today", ...jobDetails(f)],
      status: appliedChip(f), to: f.job_id ? `/jobs/${f.job_id}#follow-ups` : "/followups" });
  }
  for (const j of data?.apply_pending ?? []) {
    out.push({ key: `ap:${j.job_id}`, kind: "apply", icon: "star", tone: "bg-violet-50 text-violet-600",
      title: j.job_title ?? "", company: j.company, details: [`${human(j.job_status ?? "SHORTLISTED")}, waiting for your application`, ...jobDetails(j)],
      status: appliedChip(j), to: `/jobs/${j.job_id}?apply=1` });
  }
  for (const j of data?.new_jobs ?? []) {
    out.push({ key: `nj:${j.job_id}`, kind: "new", icon: "sparkles", tone: "bg-indigo-50 text-indigo-600",
      title: j.job_title ?? "", company: j.company, details: [`New${j.added_on ? ` · added ${shortDate(j.added_on)}` : ""}`, ...jobDetails(j)],
      status: appliedChip(j), to: `/jobs/${j.job_id}` });
  }
  if (summary?.new_jobs && (data?.new_jobs?.length ?? 0) < summary.new_jobs) {
    out.push({ key: `new:${summary.new_jobs}`, kind: "new", icon: "jobs", tone: "bg-indigo-50 text-indigo-600",
      title: `All ${summary.new_jobs} new jobs`, details: [summary.new_70_plus ? `${summary.new_70_plus} score 70+ · review them one by one` : "Review them one by one"],
      to: summary.new_70_plus ? "/jobs/review?min_score=70" : "/jobs/review" });
  }
  for (const e of reminders) {
    out.push({ key: `rem:${e.id}`, kind: "reminder", icon: "bell", tone: "bg-sky-50 text-sky-600", title: e.title,
      details: [e.body], to: e.url, when: e.created_at });
  }
  return out;
}

const seenKeys = (): Set<string> => { try { return new Set(JSON.parse(read(SEEN) ?? "[]") as string[]); } catch { return new Set(); } };

/** Reminders that fired (Settings → Reminders) in the last 24 hours. */
export const useReminderEvents = () => useQuery({
  queryKey: ["reminder-events"], queryFn: () => api.get<ReminderEvent[]>("/reminder-events", { limit: 30 }),
  refetchInterval: 30_000, refetchIntervalInBackground: true, retry: false,
  select: (list) => list.filter((e) => Date.now() - new Date(e.created_at).getTime() < 86_400_000),
});

/**
 * Scheduled reminders, the moment they fire: a toast in the app and (when allowed) a browser
 * notification. The server keeps the schedule; every open tab only shows what's new.
 */
export function useScheduledReminders(onNew: (e: ReminderEvent) => void) {
  const navigate = useNavigate();
  const q = useReminderEvents();
  const latest = useRef<number | null>(null);
  useEffect(() => {
    if (!q.data) return;
    const max = Math.max(0, ...q.data.map((e) => e.id));
    const stored = read(LAST_EVENT);
    const last = latest.current ?? (stored === null ? max : Number(stored));
    const fresh = q.data.filter((e) => e.id > last).sort((a, b) => a.id - b.id);
    for (const e of fresh) {
      onNew(e);
      if (read(ENABLED) === "1" && supported() && Notification.permission === "granted") {
        notify({ key: `rem:${e.id}`, title: e.title, body: e.body, url: e.url }, navigate);
      }
    }
    latest.current = Math.max(last, max);
    write(LAST_EVENT, String(latest.current));
  }, [q.data, onNew, navigate]);
}

/** The bell in the top bar: what needs you now, with details, and what you haven't read. */
export function NotificationBell({ summary }: { summary: Summary }) {
  const q = useReminders();
  const events = useReminderEvents();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<BellKind | "all">("all");
  const [showRead, setShowRead] = useState(false);
  const [seen, setSeen] = useState(seenKeys);
  const box = useRef<HTMLDivElement>(null);
  const items = bellItems(q.data, summary, events.data ?? []);
  const unseen = items.filter((i) => !seen.has(i.key)).length;
  // Wait for the list before touching the title (no flash of a wrong count).
  useUnreadBadge(q.data ? unseen : 0);
  // Read notifications leave the list (Show read brings them back).
  const visible = showRead ? items : items.filter((i) => !seen.has(i.key));
  const readCount = items.length - unseen;
  const kinds = (Object.keys(KIND_LABEL) as BellKind[]).filter((k) => visible.some((i) => i.kind === k));
  const shown = filter === "all" || !kinds.includes(filter) ? visible : visible.filter((i) => i.kind === filter);
  const markRead = (keys: string[]) => {
    const next = new Set([...seen, ...keys]);
    setSeen(next);
    write(SEEN, JSON.stringify([...next].slice(-800)));
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  let lastKind: BellKind | null = null;
  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label={unseen ? `Notifications: ${unseen} new` : "Notifications"} aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-200/60 hover:text-slate-900">
        <Icon name="bell" className="h-5 w-5" />
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#f43f5e] px-1 text-[10px] font-bold text-white ring-2 ring-page">
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-(--shadow-lift)">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2>Notifications{unseen > 0 && <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">{unseen} new</span>}</h2>
            {unseen > 0 && <button type="button" className="link text-xs" onClick={() => markRead(items.map((i) => i.key))}>Mark all as read</button>}
          </div>
          {kinds.length > 1 && (
            <div className="tabs-scroll flex gap-1.5 border-b border-slate-100 px-3 py-2" role="group" aria-label="Show">
              {(["all", ...kinds] as const).map((k) => {
                const n = k === "all" ? visible.length : visible.filter((i) => i.kind === k).length;
                return (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${filter === k ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200" : "text-slate-500 hover:bg-slate-100"}`}>
                    {k === "all" ? "All" : KIND_LABEL[k]} <span className="opacity-60">{n}</span>
                  </button>
                );
              })}
            </div>
          )}
          <ul className="max-h-[60vh] overflow-y-auto">
            {!shown.length && <li className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up. 🎉</li>}
            {shown.map((i) => {
              const unread = !seen.has(i.key);
              const header = (filter === "all" || !kinds.includes(filter)) && i.kind !== lastKind ? (lastKind = i.kind) : null;
              return (
                <li key={i.key}>
                  {header && <div className="bg-slate-50/80 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{KIND_LABEL[header]}</div>}
                  <div className={`group flex items-start gap-1 border-b border-slate-100 pr-2 ${unread ? "bg-indigo-50/40" : ""}`}>
                    <Link to={i.to} onClick={() => { markRead([i.key]); setOpen(false); }}
                      aria-label={`${i.title}${i.company ? ` at ${i.company}` : ""}: ${i.details.join(", ")}${i.status ? `, ${i.status.text}` : ""}${unread ? " (unread)" : ""}`}
                      className={`flex min-w-0 flex-1 gap-3 px-4 py-3 hover:bg-slate-50 ${unread ? "" : "opacity-60"}`}>
                      <span aria-hidden className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${i.tone}`}><Icon name={i.icon} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className={`text-sm leading-snug text-slate-800 ${unread ? "font-semibold" : "font-medium"}`}>{i.title}</span>
                          {i.status && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${i.status.tone}`}>{i.status.text}</span>}
                        </span>
                        {i.company && <span className="block truncate text-xs font-medium text-slate-600">{i.company}</span>}
                        <span className="block text-xs text-slate-500">{i.details.join(" · ")}</span>
                        {i.when && <span className="block text-[11px] text-slate-400">{new Date(i.when).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>}
                      </span>
                    </Link>
                    {unread ? (
                      <button type="button" title="Mark as read" aria-label={`Mark as read: ${i.title}`} onClick={() => markRead([i.key])}
                        className="mt-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-100 hover:text-indigo-700">
                        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-indigo-500 group-hover:hidden" />
                        <Icon name="check" className="hidden h-4 w-4 group-hover:block" />
                      </button>
                    ) : <span className="w-7 shrink-0" />}
                  </div>
                </li>
              );
            })}
          </ul>
          {readCount > 0 && (
            <button type="button" className="w-full border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              onClick={() => setShowRead((v) => !v)}>
              {showRead ? "Hide read notifications" : `Show ${readCount} read`}
            </button>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
            <ReminderToggle />
            <Link to="/settings/reminders" onClick={() => setOpen(false)} className="link text-xs">Reminder schedule →</Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Turn browser reminders on or off for this browser (asks the browser for permission). */
export function ReminderToggle() {
  const [, rerender] = useState(0);
  if (!supported()) return <p className="text-xs text-slate-500">This browser can't show notifications.</p>;
  const perm = Notification.permission;
  const on = read(ENABLED) === "1" && perm === "granted";
  const turnOn = async () => {
    const result = perm === "granted" ? perm : await Notification.requestPermission();
    write(ENABLED, result === "granted" ? "1" : null);
    if (result === "granted") new Notification("Reminders are on", { body: "You'll be reminded about follow-ups due, interviews coming up and new jobs while the app is open.", tag: "reminders-on", icon: ICON });
    rerender((n) => n + 1);
  };
  const turnOff = () => { write(ENABLED, null); rerender((n) => n + 1); };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className={`h-2 w-2 rounded-full ${on ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />
      {on ? (
        <><span>Browser notifications are on: follow-ups due, interviews (24 hours and 1 hour before) and new jobs found, while the app is open.</span>
          <button className="link" onClick={turnOff}>Turn off</button></>
      ) : perm === "denied" ? (
        <span>Notifications are blocked for this site. Allow them in the browser's site settings (the icon left of the address), then reload.</span>
      ) : (
        <><span>Get browser notifications for follow-ups due, interviews coming up and new jobs.</span>
          <button className="btn-secondary px-2 py-1 text-xs" onClick={turnOn}>Turn on notifications</button></>
      )}
    </div>
  );
}
