import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Card, ErrorBox, Spinner } from "../../components/ui";
import type { FollowUp, Page } from "../../types/api";
import { FollowUpRow, QuickFollowUp, inDays } from "./FollowUpParts";

/** Open reminders, most urgent first, in groups you can act on top to bottom. */
const GROUPS: { key: string; title: string; tone: string; test: (due: string, today: string, week: string) => boolean }[] = [
  { key: "late", title: "Late", tone: "text-rose-700", test: (d, t) => d < t },
  { key: "today", title: "Today", tone: "text-indigo-700", test: (d, t) => d === t },
  { key: "week", title: "This week", tone: "text-slate-700", test: (d, t, w) => d > t && d <= w },
  { key: "later", title: "Later", tone: "text-slate-500", test: (d, _t, w) => d > w },
];

export function FollowupsPage() {
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const open = useQuery({
    queryKey: ["followups", "open"],
    queryFn: () => api.get<Page<FollowUp>>("/followups", { completed: false, size: 200 }),
  });
  const done = useQuery({
    queryKey: ["followups", "done"], enabled: showDone,
    queryFn: () => api.get<Page<FollowUp>>("/followups", { completed: true, size: 20 }),
  });
  const today = inDays(0);
  const week = inDays(7);
  const items = open.data?.items ?? [];
  const urgent = items.filter((f) => f.due_date <= today).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Follow-ups</h1>
          <p className="text-sm text-slate-500">
            {open.data ? (urgent ? <><strong className="text-slate-800">{urgent}</strong> to do today{items.length > urgent ? ` · ${items.length - urgent} coming up` : ""}</>
              : items.length ? `Nothing due today · ${items.length} coming up` : "Nothing planned") : " "}
          </p>
        </div>
        <button className="btn-primary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "+ New reminder"}</button>
      </div>
      {adding && <Card title="New reminder"><QuickFollowUp /></Card>}
      {open.error && <ErrorBox error={open.error} />}
      {open.isLoading ? <Spinner /> : !items.length ? (
        <Card>
          <div className="py-6 text-center text-sm text-slate-500">
            All clear. When you apply, a follow-up is planned for you; you can also add one from any job.
            <div className="mt-2"><Link className="link" to="/jobs?tab=applied">See jobs you applied to</Link></div>
          </div>
        </Card>
      ) : GROUPS.map((g) => {
        const list = items.filter((f) => g.test(f.due_date, today, week));
        if (!list.length) return null;
        return (
          <section key={g.key} aria-label={g.title}>
            <h2 className={`mb-1 text-sm font-semibold ${g.tone}`}>{g.title} <span className="font-normal text-slate-400">({list.length})</span></h2>
            <Card><ul className="divide-y divide-slate-100">{list.map((f) => <FollowUpRow key={f.id} f={f} />)}</ul></Card>
          </section>
        );
      })}
      <div>
        <button className="link text-sm" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>{showDone ? "Hide recently done" : "Show recently done"}</button>
        {showDone && (done.data ? (
          done.data.items.length ? <Card className="mt-2"><ul className="divide-y divide-slate-100">{done.data.items.map((f) => <FollowUpRow key={f.id} f={f} />)}</ul></Card>
            : <p className="mt-2 text-sm text-slate-500">Nothing done yet.</p>
        ) : <Spinner />)}
      </div>
    </div>
  );
}
