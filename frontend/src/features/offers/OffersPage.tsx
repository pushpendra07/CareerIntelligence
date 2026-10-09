import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Card, Chips, Empty, ErrorBox, Field, KeyValue, Spinner, StatusBadge, PageIntro } from "../../components/ui";
import type { Job, Offer, Page } from "../../types/api";
import { formatDate, formatMoney, humanize } from "../../utils/format";

interface Comparison {
  target_salary: string | null; currency: string;
  offers: { id: number; company: string; job: string; total_ctc: string | null; currency: string; fixed_share_pct: number | null; percent_of_target: number | null; work_model: string | null; location: string | null; expiry_date: string | null }[];
}

function OfferCard({ o }: { o: Offer }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [counter, setCounter] = useState("");
  const [decision, setDecision] = useState("");
  const refresh = () => qc.invalidateQueries();
  const negotiate = useMutation({ mutationFn: () => api.post(`/offers/${o.id}/negotiate`, { note, counter_ctc: counter || null }), onSuccess: () => { setNote(""); setCounter(""); refresh(); } });
  const decide = useMutation({ mutationFn: (status: string) => api.post(`/offers/${o.id}/decision`, { status, decision: decision || null }), onSuccess: refresh });
  const open = o.status === "RECEIVED" || o.status === "NEGOTIATING";
  const err = negotiate.error ?? decide.error;
  return (
    <Card title={<span>{o.company_name} — <Link className="link" to={`/jobs/${o.job_id}`}>{o.job_title}</Link></span>} actions={<StatusBadge value={o.status} />}>
      <KeyValue items={[
        ["Total CTC", <b key="t">{formatMoney(o.total_ctc, o.currency)}</b>], ["Base", formatMoney(o.base_salary, o.currency)],
        ["Variable", formatMoney(o.variable_pay, o.currency)], ["Bonus", formatMoney(o.bonus, o.currency)],
        ["Equity", o.equity], ["Joining", formatDate(o.joining_date)], ["Location", o.location], ["Work model", humanize(o.work_model)],
        ["Offer date", formatDate(o.offer_date)], ["Expires", formatDate(o.expiry_date)],
      ]} />
      <div className="mt-2"><Chips items={o.benefits} /></div>
      {o.negotiation_log.length > 0 && (
        <ol className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-xs">
          {o.negotiation_log.map((n, i) => <li key={i}><span className="text-slate-400">{formatDate(n.at)} · {n.by}</span> {n.note}{n.counter_ctc && ` (counter ${formatMoney(n.counter_ctc, o.currency)})`}</li>)}
        </ol>
      )}
      {o.decision && <p className="mt-2 text-sm">Decision: {o.decision}</p>}
      {err && <div className="mt-2"><ErrorBox error={new Error(errorMessage(err))} /></div>}
      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <div className="flex gap-2">
            <input className="input" placeholder="Negotiation note" aria-label="Negotiation note" value={note} onChange={(e) => setNote(e.target.value)} />
            <input className="input w-40" placeholder="Counter CTC" aria-label="Counter CTC" value={counter} onChange={(e) => setCounter(e.target.value)} />
            <button className="btn-secondary" disabled={!note} onClick={() => negotiate.mutate()}>Log</button>
          </div>
          <div className="flex gap-2">
            <input className="input" placeholder="Decision notes" aria-label="Decision notes" value={decision} onChange={(e) => setDecision(e.target.value)} />
            <button className="btn-primary" onClick={() => decide.mutate("ACCEPTED")}>Accept</button>
            <button className="btn-secondary" onClick={() => decide.mutate("DECLINED")}>Decline</button>
            <button className="btn-secondary" onClick={() => decide.mutate("EXPIRED")}>Expired</button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function OffersPage() {
  const qc = useQueryClient();
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => api.get<Page<Offer>>("/offers", { size: 100 }) });
  const compare = useQuery({ queryKey: ["offers", "compare"], queryFn: () => api.get<Comparison>("/offers/compare") });
  const jobs = useQuery({ queryKey: ["jobs", "offer-candidates"], queryFn: () => api.get<Page<Job>>("/jobs", { status: ["INTERVIEW", "OFFER", "SCREENING"], size: 100 }) });
  const [form, setForm] = useState({ job_id: "", base_salary: "", variable_pay: "", bonus: "", equity: "", currency: "INR", joining_date: "", expiry_date: "", location: "", work_model: "", benefits: "" });
  const create = useMutation({
    mutationFn: () => api.post("/offers", {
      job_id: Number(form.job_id), currency: form.currency,
      base_salary: form.base_salary || null, variable_pay: form.variable_pay || null, bonus: form.bonus || null,
      equity: form.equity || null, joining_date: form.joining_date || null, expiry_date: form.expiry_date || null,
      location: form.location || null, work_model: form.work_model || null,
      benefits: form.benefits.split(",").map((b) => b.trim()).filter(Boolean),
    }),
    onSuccess: () => { setForm({ ...form, job_id: "", base_salary: "", variable_pay: "", bonus: "", equity: "", benefits: "" }); qc.invalidateQueries(); },
  });
  return (
    <div className="space-y-4">
      <div><h1>Offers</h1><PageIntro>Record offers you receive, note your counter-offer, and compare open offers side by side before you decide.</PageIntro></div>
      <Card title="Record an offer">
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="sm:col-span-2"><Field label="Job *">
            <select className="input" value={form.job_id} onChange={(e) => setForm({ ...form, job_id: e.target.value })}>
              <option value="">Select a job in interview/offer stage</option>
              {jobs.data?.items.map((j) => <option key={j.id} value={j.id}>{j.title} — {j.company.name}</option>)}
            </select>
          </Field></div>
          {(["base_salary", "variable_pay", "bonus", "equity", "currency", "location"] as const).map((k) => (
            <Field key={k} label={humanize(k)}><input className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
          ))}
          <Field label="Work model"><select className="input" value={form.work_model} onChange={(e) => setForm({ ...form, work_model: e.target.value })}><option value="">—</option><option>REMOTE</option><option>HYBRID</option><option>ONSITE</option></select></Field>
          <Field label="Joining date"><input className="input" type="date" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} /></Field>
          <Field label="Offer expires"><input className="input" type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Benefits" hint="comma separated"><input className="input" value={form.benefits} onChange={(e) => setForm({ ...form, benefits: e.target.value })} /></Field></div>
        </div>
        {create.error && <div className="mt-2"><ErrorBox error={new Error(errorMessage(create.error))} /></div>}
        <button className="btn-primary mt-3" disabled={!form.job_id || create.isPending} onClick={() => create.mutate()}>Save offer</button>
      </Card>
      {compare.data && compare.data.offers.length > 1 && (
        <Card title="Compare open offers">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead><tr><th className="th">Company</th><th className="th">Total CTC</th><th className="th">Fixed %</th><th className="th">vs target</th><th className="th">Work</th><th className="th">Expires</th></tr></thead>
            <tbody>{compare.data.offers.map((r) => (
              <tr key={r.id}><td className="td">{r.company}<div className="text-xs text-slate-500">{r.job}</div></td><td className="td">{formatMoney(r.total_ctc, r.currency)}</td>
                <td className="td">{r.fixed_share_pct ?? "—"}%</td><td className="td">{r.percent_of_target !== null ? `${r.percent_of_target}%` : "—"}</td>
                <td className="td">{humanize(r.work_model)} {r.location}</td><td className="td">{formatDate(r.expiry_date)}</td></tr>
            ))}</tbody>
          </table>
        </Card>
      )}
      {offers.isLoading && <Spinner />}
      {offers.data && (!offers.data.items.length ? <Empty>No offers yet.</Empty> : <div className="grid gap-4 lg:grid-cols-2">{offers.data.items.map((o) => <OfferCard key={o.id} o={o} />)}</div>)}
    </div>
  );
}
