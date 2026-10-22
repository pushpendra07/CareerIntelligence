import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { ContactLinks } from "../../components/ContactLinks";
import { Card, Field } from "../../components/ui";
import type { JobDetail } from "../../types/api";

type Form = { name: string; job_title: string; email: string; phone: string; linkedin_url: string };

/** What's wrong with a field, if anything (all fields are optional; one is needed). */
export function contactProblems(f: Form): Partial<Record<keyof Form | "form", string>> {
  const out: Partial<Record<keyof Form | "form", string>> = {};
  if (f.email.trim() && !/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(f.email.trim())) out.email = "Enter a valid email";
  if (f.phone.trim() && f.phone.replace(/\D/g, "").length < 8) out.phone = "Enter a phone number";
  if (f.linkedin_url.trim() && !/linkedin\.com\/in\//i.test(f.linkedin_url)) out.linkedin_url = "Use a linkedin.com/in/ profile URL";
  if (![f.name, f.email, f.phone, f.linkedin_url].some((v) => v.trim())) out.form = "Add at least a name, email, phone or LinkedIn";
  return out;
}

/** The job's contact person (recruiter / HR): shown on the job page, added or edited in place. */
export function JobContact({ job }: { job: JobDetail }) {
  const qc = useQueryClient();
  const c = job.recruiter;
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const blank = { name: c?.name ?? "", job_title: c?.job_title ?? "", email: c?.email ?? "", phone: c?.phone ?? "", linkedin_url: c?.linkedin_url ?? "" };
  const [f, setF] = useState<Form>(blank);
  const [tried, setTried] = useState(false);
  const done = (j: JobDetail) => { qc.setQueryData(["job", String(job.id)], j); qc.invalidateQueries({ queryKey: ["job", String(job.id)] }); setEditing(false); setConfirm(false); };
  const save = useMutation({ mutationFn: (body: Form) => api.put<JobDetail>(`/jobs/${job.id}/contact`, body), onSuccess: done,
    meta: { success: "Contact saved" } });
  const remove = useMutation({ mutationFn: () => api.delete<JobDetail>(`/jobs/${job.id}/contact`), onSuccess: done,
    meta: { success: "Contact removed from this job" } });
  const problems = contactProblems(f);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF((o) => ({ ...o, [k]: e.target.value }));
  const start = () => { setF(blank); setTried(false); setEditing(true); };

  if (editing) {
    return (
      <Card title={c ? "Edit contact person" : "Add contact person"}>
        <form className="space-y-2" noValidate onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!Object.keys(problems).length) save.mutate(f);
        }}>
          <p className="text-xs text-slate-500">All optional — fill what you know.</p>
          <Field label="Name"><input className="input" autoFocus value={f.name} onChange={set("name")} placeholder="e.g. Priya Sharma" /></Field>
          <Field label="Role"><input className="input" value={f.job_title} onChange={set("job_title")} placeholder="Recruiter, HR, hiring manager…" /></Field>
          <Field label="Email" error={tried ? problems.email : undefined}><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Phone / WhatsApp" error={tried ? problems.phone : undefined}><input className="input" inputMode="tel" value={f.phone} onChange={set("phone")} placeholder="98765 43210" /></Field>
          <Field label="LinkedIn" error={tried ? problems.linkedin_url : undefined}><input className="input" value={f.linkedin_url} onChange={set("linkedin_url")} placeholder="https://www.linkedin.com/in/…" /></Field>
          {tried && problems.form && <p className="text-xs text-rose-600">{problems.form}</p>}
          {save.error && <p className="text-xs text-rose-600">{errorMessage(save.error)}</p>}
          <div className="flex gap-2 pt-1">
            <button className="btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save contact"}</button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      </Card>
    );
  }
  if (!c) {
    return (
      <Card title="Contact person">
        <p className="text-sm text-slate-500">No contact yet. Add the recruiter or HR person's name, email or phone to follow up directly.</p>
        <button type="button" className="btn-secondary mt-2" onClick={start}>+ Add contact person</button>
      </Card>
    );
  }
  return (
    <Card title="Contact person" actions={<button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={start}>Edit</button>}>
      <div className="space-y-1 text-sm" data-testid="job-contact">
        <div className="font-medium text-slate-800">{c.name}</div>
        {c.job_title && <div className="text-xs text-slate-500">{c.job_title}</div>}
        <ContactLinks email={c.email} phone={c.phone} linkedin={c.linkedin_url} className="text-sm" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs">
          <Link className="link" to={`/recruiters?q=${encodeURIComponent(c.email ?? c.name)}`}>Open in Recruiters</Link>
          {confirm ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-slate-600">Remove from this job?</span>
              <button type="button" className="font-medium text-rose-600 hover:underline" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</button>
              <button type="button" className="text-slate-500 hover:underline" onClick={() => setConfirm(false)}>Keep</button>
            </span>
          ) : <button type="button" className="text-slate-500 hover:text-rose-600 hover:underline" onClick={() => setConfirm(true)}>Remove</button>}
        </div>
      </div>
    </Card>
  );
}
