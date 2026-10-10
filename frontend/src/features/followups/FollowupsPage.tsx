import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, Empty, ErrorBox, Field, Pagination, Spinner, PageIntro, PAGE_SIZE } from "../../components/ui";
import type { FollowUp, Page } from "../../types/api";
import { formatDate, humanize } from "../../utils/format";

export function FollowupsPage() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["followups", showDone, page],
    queryFn: () => api.get<Page<FollowUp>>("/followups", { completed: showDone ? undefined : false, page, size: PAGE_SIZE }),
  });
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ title: "", kind: "OTHER", due_date: today, notes: "" });
  const create = useMutation({
    mutationFn: () => api.post("/followups", { ...form, notes: form.notes || null }),
    onSuccess: () => { setForm({ ...form, title: "", notes: "" }); qc.invalidateQueries(); },
  });
  const complete = useMutation({ mutationFn: (id: number) => api.post(`/followups/${id}/complete`), onSuccess: () => qc.invalidateQueries() });
  const snooze = useMutation({
    mutationFn: ({ id, days }: { id: number; days: number }) => {
      const d = new Date(); d.setDate(d.getDate() + days);
      return api.patch(`/followups/${id}`, { due_date: d.toISOString().slice(0, 10) });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <div className="space-y-4">
      <div><h1>Follow-ups</h1><PageIntro>Reminders so nothing slips: follow up with a recruiter, send a thank-you note, check on an application.</PageIntro></div>
      <Card title="New reminder">
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="What"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Kind">
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {["APPLICATION", "RECRUITER", "INTERVIEW", "OFFER", "OTHER"].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
            </select>
          </Field>
          <Field label="Due"><input className="input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
        {create.error && <div className="mt-2"><ErrorBox error={new Error(errorMessage(create.error))} /></div>}
        <button className="btn-primary mt-3" disabled={!form.title || create.isPending} onClick={() => create.mutate()}>Add reminder</button>
      </Card>
      <Card actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showDone} onChange={(e) => { setShowDone(e.target.checked); setPage(1); }} />Show completed</label>}>
        {list.isLoading && <Spinner />}
        {list.data && (!list.data.items.length ? <Empty>No pending follow-ups.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {list.data.items.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className={`font-medium ${f.completed ? "text-slate-400 line-through" : ""}`}>{f.title}</div>
                  <div className="text-xs text-slate-500">
                    {humanize(f.kind)}{f.company_name && ` · ${f.company_name}`}{f.contact_name && ` · ${f.contact_name}`}
                    {f.job_id && <> · <Link className="link" to={`/jobs/${f.job_id}`}>job</Link></>}
                    {f.notes && ` · ${f.notes}`}
                  </div>
                </div>
                <span className="text-xs text-slate-600">{formatDate(f.due_date)}</span>
                {f.overdue && <Badge tone="red">overdue</Badge>}
                {!f.completed && (
                  <>
                    <button className="btn-secondary" onClick={() => snooze.mutate({ id: f.id, days: 3 })}>+3 days</button>
                    <button className="btn-primary" onClick={() => complete.mutate(f.id)}>Done</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ))}
        {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} size={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
