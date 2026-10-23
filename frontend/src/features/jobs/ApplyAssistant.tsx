import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Card, CopyButton, ErrorBox, Field, Spinner } from "../../components/ui";

export type ApplyAnswers = {
  current_ctc: string; expected_ctc: string; notice_period: string; relocate: string; work_authorization: string;
  github: string; portfolio: string; current_company: string; current_title: string;
  answers: { question: string; answer: string }[];
};
export type ApplyKit = {
  job: { id: number; title: string; company: string; status: string; url: string | null } | null;
  applicant: Record<string, string>; labels: Record<string, string>;
  answers: { question: string; answer: string }[];
  cv: { id: number; name: string; version_id: number; filename: string | null; download: string } | null;
  cover_note: string; email: { to: string; subject: string; body: string; name: string | null } | null;
  missing: string[];
};

/** The details shown with copy buttons, in the order forms usually ask for them. */
const DETAIL_KEYS = ["full_name", "email", "phone", "linkedin", "location", "total_experience", "current_company",
  "current_title", "current_ctc", "expected_ctc", "notice_period", "relocate", "work_authorization", "github", "portfolio"];
const SAVED_FIELDS: [keyof Omit<ApplyAnswers, "answers">, string, string][] = [
  ["current_ctc", "Current CTC", "e.g. 28 LPA"], ["expected_ctc", "Expected CTC", "empty: from Skills & targets"],
  ["notice_period", "Notice period", "empty: from Skills & targets"], ["relocate", "Willing to relocate", "Yes / No / Pune, Bengaluru"],
  ["work_authorization", "Work authorisation", "e.g. Indian citizen"], ["current_company", "Current company", "empty: from your profile"],
  ["current_title", "Current title", "empty: from your profile"], ["github", "GitHub", "https://github.com/…"],
  ["portfolio", "Portfolio / website", "https://…"],
];

/** Answers you give on every form: saved once, used by the assistant and the extension. */
function SavedAnswers({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["apply", "answers"], queryFn: () => api.get<ApplyAnswers>("/apply/answers") });
  const [form, setForm] = useState<ApplyAnswers | null>(null);
  const f = form ?? saved.data ?? null;
  const save = useMutation({
    mutationFn: (body: ApplyAnswers) => api.put<ApplyAnswers>("/apply/answers", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["apply"] }); onDone(); },
    meta: { success: "Answers saved", toastError: true },
  });
  if (!f) return <Spinner />;
  const set = (patch: Partial<ApplyAnswers>) => setForm({ ...f, ...patch });
  const qa = (i: number, patch: Partial<ApplyAnswers["answers"][number]>) =>
    set({ answers: f.answers.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(f); }}>
      <div className="grid gap-2 sm:grid-cols-3">
        {SAVED_FIELDS.map(([k, label, placeholder]) => (
          <Field key={k} label={label}><input className="input" value={f[k]} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value })} /></Field>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium text-slate-700">Your questions and answers</div>
        <p className="text-xs text-slate-500">Questions forms often ask (“Why do you want to join us?”, “Years with Magento 2?”). The extension fills a field whose question matches.</p>
        {f.answers.map((a, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input className="input" aria-label={`Question ${i + 1}`} value={a.question} onChange={(e) => qa(i, { question: e.target.value })} placeholder="Question" />
            <textarea className="input" rows={2} aria-label={`Answer ${i + 1}`} value={a.answer} onChange={(e) => qa(i, { answer: e.target.value })} placeholder="Answer" />
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => set({ answers: f.answers.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <button type="button" className="link text-sm" onClick={() => set({ answers: [...f.answers, { question: "", answer: "" }] })}>+ Add a question</button>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save answers"}</button>
        <button type="button" className="btn-secondary" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

/** Everything the application asks for, ready to copy; the extension fills the form with it. */
export function ApplyAssistant({ jobId, onTailor }: { jobId: number; onTailor?: () => void }) {
  const qc = useQueryClient();
  const kit = useQuery({ queryKey: ["apply", "kit", jobId], queryFn: () => api.get<ApplyKit>(`/jobs/${jobId}/apply-kit`) });
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const record = useMutation({
    mutationFn: (method: string) => api.post<{ created: boolean; follow_up_date: string | null }>(`/jobs/${jobId}/applied`,
      { method, cv_version_id: kit.data?.cv?.version_id ?? null }),
    onSuccess: () => qc.invalidateQueries(),
    meta: { success: "Recorded: marked Applied, follow-up planned", toastError: true },
  });
  if (kit.isLoading) return <Card title="Apply assistant"><Spinner /></Card>;
  if (kit.error) return <Card title="Apply assistant"><ErrorBox error={kit.error} /></Card>;
  const k = kit.data!;
  const cover = note ?? k.cover_note;
  const mail = k.email && `mailto:${encodeURIComponent(k.email.to)}?subject=${encodeURIComponent(k.email.subject)}&body=${encodeURIComponent(k.email.body)}`;
  const done = record.data;
  return (
    <Card title="Apply assistant">
      <ol className="space-y-4 text-sm">
        <li>
          <div className="font-medium text-slate-800">1. Your CV</div>
          {k.cv ? (
            <p className="text-slate-600">
              <span className="font-medium">{k.cv.name}</span>{k.cv.filename ? ` · ${k.cv.filename}` : ""} —{" "}
              <a className="link" href={k.cv.download}>Download</a>
              {onTailor && <> · <button type="button" className="link" onClick={onTailor}>Tailor it for this job</button></>}
            </p>
          ) : <p className="text-amber-700">No CV uploaded yet. <Link className="link" to="/cvs">Upload one</Link>.</p>}
        </li>
        <li>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-800">2. Cover note</span>
            {cover && <CopyButton text={cover} label="Copy note" />}
          </div>
          <textarea className="input mt-1 text-sm" rows={5} aria-label="Cover note" value={cover} onChange={(e) => setNote(e.target.value)} />
        </li>
        <li>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-800">3. Your details and answers</span>
            <button type="button" className="link text-xs" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit saved answers"}</button>
          </div>
          {editing ? <div className="mt-2"><SavedAnswers onDone={() => setEditing(false)} /></div> : (
            <>
              {k.missing.length > 0 && <p className="mt-1 text-xs text-amber-700">Missing: {k.missing.join(", ")} — add them in <Link className="link" to="/profile">My profile</Link> or Edit saved answers.</p>}
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2" aria-label="Your details">
                {DETAIL_KEYS.filter((key) => k.applicant[key]).map((key) => (
                  <div key={key} className="flex min-w-0 items-center justify-between gap-2 border-b border-slate-100 py-1">
                    <dt className="shrink-0 text-xs text-slate-500">{k.labels[key]}</dt>
                    <dd className="flex min-w-0 items-center gap-1.5"><span className="truncate" title={k.applicant[key]}>{k.applicant[key]}</span>
                      <CopyButton text={k.applicant[key]} label={`Copy ${k.labels[key]}`} compact /></dd>
                  </div>
                ))}
              </dl>
              {k.answers.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label="Saved answers">
                  {k.answers.map((a) => (
                    <li key={a.question} className="flex items-start justify-between gap-2 border-b border-slate-100 py-1">
                      <span className="min-w-0"><span className="block text-xs text-slate-500">{a.question}</span><span className="line-clamp-2">{a.answer}</span></span>
                      <CopyButton text={a.answer} label={`Copy answer: ${a.question}`} compact />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </li>
        <li>
          <div className="font-medium text-slate-800">4. Apply</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {k.job?.url && <a className="btn-sky" href={k.job.url} target="_blank" rel="noopener noreferrer">Open application page ↗</a>}
            {mail && <a className="btn-secondary" href={mail}>Email {k.email!.name ?? k.email!.to}</a>}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            On the application page, click the <b>Career Intelligence</b> extension → <b>Fill this application</b>: it fills the form and attaches your CV.
            Check everything, then press the page's Submit yourself.{mail && " By email: attach the CV you downloaded above."}
          </p>
        </li>
        <li>
          <div className="font-medium text-slate-800">5. Record it</div>
          {done ? (
            <p className="text-emerald-700">✓ {done.created ? "Recorded" : "Already recorded"} — marked Applied{done.follow_up_date ? `, follow up on ${done.follow_up_date}` : ""}.</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" className="btn-emerald" disabled={record.isPending} onClick={() => record.mutate("COMPANY_SITE")}>✓ I applied on the site</button>
              {mail && <button type="button" className="btn-secondary" disabled={record.isPending} onClick={() => record.mutate("EMAIL")}>✓ I applied by email</button>}
            </div>
          )}
        </li>
      </ol>
    </Card>
  );
}
