import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

export type RemindersData = {
  followups: { id: number; title: string; due_date: string; late_days: number; job_id: number | null }[];
  interviews: { id: number; job_id: number; round: number; round_type: string; scheduled_at: string;
    meeting_link: string | null; job_title: string; company: string; minutes_until: number }[];
};
export type Note = { key: string; title: string; body: string; url: string };

const ENABLED = "reminders.enabled.v1";
const SENT = "reminders.sent.v1";
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

/** Shows browser notifications while the app is open, when turned on in this browser. */
export function useBrowserReminders() {
  const navigate = useNavigate();
  const on = read(ENABLED) === "1" && supported() && Notification.permission === "granted";
  const q = useQuery({ queryKey: ["reminders"], queryFn: () => api.get<RemindersData>("/reminders"),
    enabled: on, refetchInterval: POLL_MS, refetchIntervalInBackground: true });
  useEffect(() => {
    if (!on || !q.data) return;
    const sent = sentKeys();
    const today = new Date().toDateString();
    for (const n of dueNotes(q.data, sent, today)) {
      const shown = new Notification(n.title, { body: n.body, tag: n.key });
      shown.onclick = () => { window.focus(); navigate(n.url); shown.close(); };
      sent.add(n.key);
    }
    write(SENT, JSON.stringify([...sent].slice(-300)));
  }, [on, q.data, navigate]);
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
    if (result === "granted") new Notification("Reminders are on", { body: "You'll be reminded about follow-ups due and interviews coming up while the app is open.", tag: "reminders-on" });
    rerender((n) => n + 1);
  };
  const turnOff = () => { write(ENABLED, null); rerender((n) => n + 1); };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className={`h-2 w-2 rounded-full ${on ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />
      {on ? (
        <><span>Browser reminders are on: follow-ups due, interviews within 24 hours and 1 hour (while the app is open).</span>
          <button className="link" onClick={turnOff}>Turn off</button></>
      ) : perm === "denied" ? (
        <span>Notifications are blocked for this site. Allow them in the browser's site settings (the icon left of the address), then reload.</span>
      ) : (
        <><span>Get a browser reminder for follow-ups due and interviews coming up.</span>
          <button className="btn-secondary px-2 py-1 text-xs" onClick={turnOn}>Turn on reminders</button></>
      )}
    </div>
  );
}
