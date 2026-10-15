import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api/client";
import { Card, ErrorBox } from "../../components/ui";
import { WebSearch, hrEmailTopic, polishTopic } from "../../components/WebSearch";
import type { JobDetail } from "../../types/api";

export interface EmailDraftResult {
  to: string | null;
  to_options: { name: string; email: string; job_title: string | null }[];
  subjects: string[];
  body: string;
  company: string;
  company_domain: string | null;
}

/** A copy button that says "Copied" for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard?.writeText(text).then(() => {
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }, () => {});
  return (
    <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => void copy()} disabled={!text}>
      {done ? "Copied ✓" : label}
    </button>
  );
}

/** Draft an email to HR from the job description and your profile; edit, copy or open it. */
export function EmailDraft({ job }: { job: JobDetail }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const draft = useMutation({
    mutationFn: () => api.get<EmailDraftResult>(`/jobs/${job.id}/email-draft`),
    meta: { invalidates: false },
    onSuccess: (d) => { setTo(d.to ?? ""); setSubject(d.subjects[0] ?? ""); setBody(d.body); },
  });
  const d = draft.data;
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const hr = hrEmailTopic(job.company.name, d?.company_domain, job.location);

  return (
    <Card title="Email to HR" actions={
      <button className="btn-secondary" onClick={() => draft.mutate()} disabled={draft.isPending}
        title="Write an email from this job's description and your profile">
        {draft.isPending ? "Drafting…" : d ? "Draft again" : "Draft email"}
      </button>}>
      {draft.error && <ErrorBox error={new Error(errorMessage(draft.error))} />}
      {!d && !draft.error && (
        <p className="text-sm text-slate-500">
          Writes a short email from this job and your profile — the skills you match, your experience and the job link.
          Edit it, then copy it or open it in your email app.
        </p>
      )}
      {d && (
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="label">To</span>
            <input className="input" type="email" aria-label="To" list={`hr-emails-${job.id}`} value={to} onChange={(e) => setTo(e.target.value)}
              placeholder="HR or recruiter email — find one below" />
            <datalist id={`hr-emails-${job.id}`}>
              {d.to_options.map((o) => <option key={o.email} value={o.email}>{o.name}{o.job_title ? ` · ${o.job_title}` : ""}</option>)}
            </datalist>
          </label>
          <div>
            <div className="flex items-end justify-between gap-2">
              <span className="label">Subject</span>
              <CopyButton text={subject} label="Copy subject" />
            </div>
            <input className="input mt-1" aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Subject options">
              {d.subjects.map((s) => (
                <button key={s} type="button" aria-pressed={s === subject} onClick={() => setSubject(s)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${s === subject ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-end justify-between gap-2">
              <span className="label">Message</span>
              <CopyButton text={body} label="Copy message" />
            </div>
            <textarea className="input mt-1 min-h-64 text-sm" aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={`Subject: ${subject}\n\n${body}`} label="Copy subject + message" />
            <a className="btn-primary px-3 py-1.5 text-xs" href={mailto}>Open in email app</a>
          </div>
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <WebSearch label="Find HR email with" topic={hr} />
            <WebSearch label="Polish with" topic={polishTopic(subject, body)} />
            <p className="text-xs text-slate-400">Only use addresses you can see published. Remember to attach your CV.</p>
          </div>
        </div>
      )}
      {!d && <div className="mt-3"><WebSearch label="Find HR email with" topic={hr} /></div>}
    </Card>
  );
}
