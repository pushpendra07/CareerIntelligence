import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { ReminderToggle } from "../../components/Reminders";
import { Card, ErrorBox } from "../../components/ui";
import { formatDate } from "../../utils/format";

type Goal = { key: string; label: string; hint: string; to: string; target: number; done: number; left: number; per_day: number; last_week: number; approximate?: number };
export type Week = { week_start: string; week_end: string; days_left: number; goals: Goal[]; streak: number; all_met: boolean };

function GoalRow({ g, daysLeft }: { g: Goal; daysLeft: number }) {
  const pct = g.target ? Math.min(100, Math.round((g.done / g.target) * 100)) : 0;
  const met = g.done >= g.target;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <Link className="font-medium hover:text-indigo-700" to={g.to} title={g.hint}>{g.label}</Link>
        <span className="tabular-nums text-slate-600"><b className={met ? "text-emerald-600" : ""}>{g.done}</b> / {g.target}</span>
      </div>
      <div className="mt-1 h-2 rounded bg-slate-100" role="progressbar" aria-label={g.label} aria-valuenow={g.done} aria-valuemax={g.target}>
        <div className={`h-2 rounded ${met ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 text-xs text-slate-500">
        {met ? "Done for this week ✓" : `${g.left} to go${daysLeft > 1 ? ` · about ${g.per_day} a day` : " · last day"}`}
        <span className="text-slate-400"> · last week {g.last_week}</span>
      </div>
      {!!g.approximate && (
        <div className="text-xs text-amber-700" title="Recorded when a job was set to Applied (e.g. by a sheet import), so the date may not be when you applied. Open them on the Pipeline page to set the real date.">
          incl. {g.approximate} recorded automatically · dates approximate
        </div>
      )}
    </li>
  );
}

/** This week's goals on Today: progress, pace, last week, streak; targets are editable. */
export function WeeklyGoals() {
  const qc = useQueryClient();
  const week = useQuery({ queryKey: ["goals", "week"], queryFn: () => api.get<Week>("/goals/week") });
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const save = useMutation({
    mutationFn: (goals: Record<string, number>) => api.patch("/settings/app", { goals }),
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ["goals"] }); },
  });
  if (week.error) return <ErrorBox error={week.error} />;
  if (!week.data) return null;
  const w = week.data;
  const active = w.goals.filter((g) => g.target > 0);
  const values = editing ?? {};
  const invalid = Object.values(values).some((v) => v === "" || !(Number(v) >= 0 && Number(v) <= 500));
  return (
    <Card title="This week's goals" actions={
      editing ? null : <button className="link text-xs" onClick={() => setEditing(Object.fromEntries(w.goals.map((g) => [g.key, String(g.target)])))}>Change goals</button>}>
      <p className="-mt-1 mb-3 text-xs text-slate-500">
        {formatDate(w.week_start)} – {formatDate(w.week_end)} · {w.days_left === 1 ? "last day" : `${w.days_left} days left`}
        {w.streak > 0 && <> · <span className="font-medium text-emerald-700">{w.streak} week{w.streak === 1 ? "" : "s"} in a row met 🔥</span></>}
      </p>
      {editing ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))); }}>
          {w.goals.map((g) => (
            <label key={g.key} className="flex items-center justify-between gap-3 text-sm">
              <span>{g.label} <span className="text-xs text-slate-400">a week</span></span>
              <input className="input w-20 py-1 text-right" type="number" min={0} max={500} aria-label={`${g.label} target`}
                value={values[g.key] ?? ""} onChange={(e) => setEditing({ ...values, [g.key]: e.target.value })} />
            </label>
          ))}
          <p className="text-xs text-slate-500">0 turns a goal off.</p>
          {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
          <div className="flex gap-2">
            <button className="btn-primary" type="submit" disabled={invalid || save.isPending}>Save goals</button>
            <button className="btn-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      ) : !active.length ? (
        <p className="text-sm text-slate-500">No goals set. <button className="link" onClick={() => setEditing(Object.fromEntries(w.goals.map((g) => [g.key, String(g.target)])))}>Set weekly goals</button></p>
      ) : (
        <>
          {w.all_met && <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">All goals met this week. Nice work!</p>}
          <ul className="space-y-3">{active.map((g) => <GoalRow key={g.key} g={g} daysLeft={w.days_left} />)}</ul>
        </>
      )}
      <div className="mt-4 border-t border-slate-100 pt-3"><ReminderToggle /></div>
    </Card>
  );
}
