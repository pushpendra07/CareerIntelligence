import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api/client";
import { Card, Empty, ErrorBox, Field, Pagination, Spinner, PAGE_SIZE, PageIntro } from "../../components/ui";
import type { Contact, Page } from "../../types/api";
import { formatDate, humanize } from "../../utils/format";

const STATUSES = ["NOT_CONTACTED", "CONTACTED", "REPLIED", "INTERESTED", "NOT_INTERESTED", "SCREENING", "CLOSED"];
const EMPTY = { name: "", company_name: "", job_title: "", linkedin_url: "", email: "", source: "", location: "", notes: "" };

export function RecruitersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = useQuery({ queryKey: ["recruiters", q, status, page], queryFn: () => api.get<Page<Contact>>("/recruiters", { q, status, page, size: PAGE_SIZE }) });
  const [form, setForm] = useState(EMPTY);
  const create = useMutation({
    mutationFn: () => api.post("/recruiters", Object.fromEntries(Object.entries(form).filter(([, v]) => v))),
    onSuccess: () => { setForm(EMPTY); qc.invalidateQueries({ queryKey: ["recruiters"] }); },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => api.patch(`/recruiters/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recruiters"] }),
  });
  return (
    <div className="space-y-4">
      <div><h1>Recruiters & contacts</h1><PageIntro>People you're talking to about jobs — recruiters, hiring managers and referrers — with their company and how to reach them.</PageIntro></div>
      <Card title="Add contact">
        <p className="mb-2 text-xs text-slate-500">Only store publicly available professional information.</p>
        <div className="grid gap-2 sm:grid-cols-4">
          {(Object.keys(EMPTY) as (keyof typeof EMPTY)[]).map((k) => (
            <Field key={k} label={humanize(k) + (k === "name" ? " *" : "")}>
              <input className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        {create.error && <div className="mt-2"><ErrorBox error={new Error(errorMessage(create.error))} /></div>}
        <button className="btn-primary mt-3" disabled={!form.name || create.isPending} onClick={() => create.mutate()}>Save contact</button>
      </Card>
      <Card>
        <div className="mb-3 flex gap-2">
          <input className="input max-w-xs" placeholder="Search name, email, title" aria-label="Search recruiters" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <select className="input max-w-xs" aria-label="Status filter" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </div>
        {list.isLoading && <Spinner />}
        {list.data && (!list.data.items.length ? <Empty>No contacts yet.</Empty> : (
          <table className="min-w-full divide-y divide-slate-100">
            <thead><tr><th className="th">Name</th><th className="th">Company</th><th className="th">Contact</th><th className="th">Status</th><th className="th">Last contacted</th><th className="th">Next follow-up</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {list.data.items.map((c) => (
                <tr key={c.id}>
                  <td className="td"><div className="font-medium">{c.name}</div><div className="text-xs text-slate-500">{c.job_title}</div></td>
                  <td className="td text-sm">{c.company_name ?? "—"}</td>
                  <td className="td text-xs">{c.email}{c.linkedin_url && <a className="link block" href={c.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn</a>}</td>
                  <td className="td">
                    <select className="input text-xs" aria-label={`Status for ${c.name}`} value={c.status}
                      onChange={(e) => update.mutate({ id: c.id, body: { status: e.target.value, ...(e.target.value === "CONTACTED" ? { last_contacted_at: new Date().toISOString() } : {}) } })}>
                      {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                    </select>
                  </td>
                  <td className="td text-xs">{formatDate(c.last_contacted_at)}</td>
                  <td className="td text-xs">
                    <input className="input text-xs" type="date" aria-label={`Next follow-up for ${c.name}`} value={c.next_followup_at?.slice(0, 10) ?? ""}
                      onChange={(e) => update.mutate({ id: c.id, body: { next_followup_at: e.target.value ? `${e.target.value}T09:00:00Z` : null } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {list.data && <Pagination page={page} size={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
