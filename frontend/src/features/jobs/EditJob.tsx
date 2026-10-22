import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../api/client";
import { ListInput } from "../../components/ListInput";
import { ErrorBox, Field } from "../../components/ui";
import type { Application, JobDetail, Page } from "../../types/api";
import { EmploymentTypeSelect, LocationInput, WorkModelPicker } from "./JobFields";
import { postingUrl } from "./JobParts";

type Form = {
  title: string; url: string; location: string; work_model: string; employment_type: string;
  experience_min: string; experience_max: string; salary_min: string; salary_max: string; salary_currency: string;
  salary_text: string; posting_date: string; application_deadline: string; original_jd: string; notes: string;
  required_skills: string[]; preferred_skills: string[];
};

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function fromJob(j: JobDetail): Form {
  return {
    title: j.title, url: s(postingUrl(j)), location: s(j.location), work_model: j.work_model === "UNKNOWN" ? "" : j.work_model,
    employment_type: s(j.employment_type),
    experience_min: s(j.experience_min && Number(j.experience_min)), experience_max: s(j.experience_max && Number(j.experience_max)),
    salary_min: s(j.salary_min && Number(j.salary_min)), salary_max: s(j.salary_max && Number(j.salary_max)),
    salary_currency: s(j.salary_currency), salary_text: s(j.salary_text),
    posting_date: s(j.posting_date), application_deadline: s(j.application_deadline),
    original_jd: j.original_jd ?? "", notes: s(j.notes),
    required_skills: j.required_skills ?? [], preferred_skills: j.preferred_skills ?? [],
  };
}

const NUMBERS = ["experience_min", "experience_max"];
const AMOUNTS = ["salary_min", "salary_max"];
const LISTS = ["required_skills", "preferred_skills"];

/** Field names as the user sees them, for the "what changed" line. */
const LABELS: Record<string, string> = {
  title: "Title", url: "Job link", location: "Location", work_model: "Work model", employment_type: "Job type",
  experience_min: "Experience", experience_max: "Experience", salary_min: "Salary", salary_max: "Salary",
  salary_currency: "Currency", salary_text: "Salary as posted", posting_date: "Posted on",
  application_deadline: "Apply by", original_jd: "Description", notes: "Notes",
  required_skills: "Required skills", preferred_skills: "Nice-to-have skills",
};

/**
 * A yearly amount from what people type: 3000000, 30,00,000, 30L, 30 LPA, 1.2 Cr, 50k.
 * Returns null for text that isn't an amount, undefined for an empty box.
 */
export function parseAmount(raw: string): number | null | undefined {
  const t = raw.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  if (!t) return undefined;
  const m = t.match(/^(\d+(?:\.\d+)?)(k|l|lakh|lakhs|lac|lacs|lpa|cr|crore|crores)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "";
  const mult = unit === "k" ? 1e3 : unit.startsWith("cr") ? 1e7 : unit ? 1e5 : 1;
  return Math.round(n * mult);
}

/** "₹30 LPA · 3,000,000 a year" — how a typed salary will be saved. */
export function amountReadout(raw: string, currency: string): string {
  const n = parseAmount(raw);
  if (n === undefined) return "";
  if (n === null) return "Not an amount: try 3000000, 30L or 1.2Cr";
  const cur = (currency.trim() || "INR").toUpperCase();
  const plain = n.toLocaleString("en-US");
  if (cur !== "INR") return `${plain} ${cur} a year`;
  const lakhs = n / 1e5;
  return `₹${lakhs >= 100 ? `${+(lakhs / 100).toFixed(2)} Cr` : `${+lakhs.toFixed(2)} LPA`} · ${plain} a year`;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Only the fields that changed, in the API's types ("" clears a value). */
export function changedFields(before: Form, after: Form): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof Form)[]) {
    if (LISTS.includes(k)) {
      if (!sameList(before[k] as string[] ?? [], after[k] as string[])) out[k] = after[k];
      continue;
    }
    const v = (after[k] as string ?? "").trim();
    if (v === (before[k] as string ?? "").trim()) continue;
    if (k === "title" && !v) continue;
    if (NUMBERS.includes(k)) out[k] = v === "" ? null : Number(v);
    else if (AMOUNTS.includes(k)) out[k] = parseAmount(v) ?? null;
    else if (k === "salary_currency") out[k] = v ? v.toUpperCase() : null;
    else if (k === "original_jd") out[k] = after[k];
    else out[k] = v === "" ? null : v;
  }
  return out;
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

/** Problems per field (shown under that field) — saving waits until there are none. */
function problems(f: Form, appliedProblem: string): Partial<Record<keyof Form | "applied", string>> {
  const out: Partial<Record<keyof Form | "applied", string>> = {};
  if (!f.title.trim()) out.title = "Job title is required";
  if (f.url.trim() && !/^(https?:\/\/)?[^\s/.]+\.[^\s]+$/i.test(f.url.trim())) out.url = "Paste the posting's web address, e.g. https://…";
  for (const k of NUMBERS as (keyof Form)[]) {
    const n = num(f[k] as string);
    if (n !== undefined && !(n >= 0 && n <= 50)) out[k] = "Years from 0 to 50";
  }
  const [emin, emax] = [num(f.experience_min), num(f.experience_max)];
  if (!out.experience_max && emin !== undefined && emax !== undefined && emin > emax) out.experience_max = "Must be at least the “from” value";
  for (const k of AMOUNTS as (keyof Form)[]) if (parseAmount(f[k] as string) === null) out[k] = "Not an amount: try 3000000, 30L or 1.2Cr";
  const [smin, smax] = [parseAmount(f.salary_min), parseAmount(f.salary_max)];
  if (!out.salary_max && smin != null && smax != null && smin > smax) out.salary_max = "Must be at least the “from” value";
  if (f.salary_currency.trim() && !/^[a-z]{3}$/i.test(f.salary_currency.trim())) out.salary_currency = "A 3-letter code, e.g. INR";
  if (f.posting_date && f.application_deadline && f.application_deadline < f.posting_date) out.application_deadline = "Can't be before the posted date";
  if (appliedProblem) out.applied = appliedProblem;
  return out;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section role="group" aria-label={title} className="space-y-3 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-slate-700">
        {title}{hint && <span className="ml-2 text-xs font-normal text-slate-400">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Edit a job's details: title, where and how you'd work, experience, salary, skills, dates, applied date, description, notes. */
export function EditJob({ job, onDone }: { job: JobDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const [start] = useState(() => fromJob(job));
  const [f, setF] = useState<Form>(start);
  // The applied date lives on the job's application (the most recent one).
  const apps = useQuery({
    queryKey: ["applications", { job_id: String(job.id) }],
    queryFn: () => api.get<Page<Application>>("/applications", { job_id: job.id }),
  });
  const app = apps.data?.items[0];
  const [appliedOn, setAppliedOn] = useState<string | null>(null); // null = untouched
  const applied = appliedOn ?? app?.applied_on ?? "";
  const appliedChanged = appliedOn !== null && appliedOn !== (app?.applied_on ?? "");
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((o) => ({ ...o, [k]: e.target.value }));
  const changes = changedFields(start, f);
  const errors = problems(f, (appliedChanged && app && !applied && "The applied date can't be empty")
    || (applied > today() && "The applied date can't be in the future") || "");
  const bad = Object.values(errors)[0] ?? "";
  const changedNames = [...new Set(Object.keys(changes).map((k) => LABELS[k] ?? k))];
  if (appliedChanged) changedNames.push("Applied on");
  const dirty = changedNames.length > 0;
  const save = useMutation({
    mutationFn: async () => {
      if (Object.keys(changes).length) await api.patch<JobDetail>(`/jobs/${job.id}`, changes);
      if (appliedChanged && applied) {
        if (app) await api.patch(`/applications/${app.id}`, { applied_on: applied });
        else await api.post("/applications", { job_id: job.id, applied_on: applied });
      }
    },
    onSuccess: () => { qc.invalidateQueries(); onDone(); },
    meta: { success: "Job saved" },
  });
  const submit = () => { if (!bad && dirty && !save.isPending) save.mutate(); };
  const undo = () => { setF(start); setAppliedOn(null); };

  // Leaving the page (reload, close tab) with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const jdWords = f.original_jd.trim() ? f.original_jd.trim().split(/\s+/).length : 0;
  return (
    <form className="space-y-4" noValidate
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
        if (e.key === "Escape" && !dirty) { e.preventDefault(); onDone(); }
      }}>
      <Section title="Role">
        <Field label="Job title *" error={errors.title}><input className="input" value={f.title} onChange={set("title")} /></Field>
        <Field label="Job link" error={errors.url} hint="The posting's page — Open posting and Check if still open use it; the old link is kept under Sources">
          <input className="input" type="url" inputMode="url" placeholder="https://…" value={f.url} onChange={set("url")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Job type"><EmploymentTypeSelect current={job.employment_type} value={f.employment_type} onChange={set("employment_type")} /></Field>
        </div>
      </Section>

      <Section title="Where">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Location" hint="Pick or type, e.g. Pune / Bengaluru"><LocationInput name="edit-location" value={f.location} onChange={set("location")} /></Field>
          <div className="sm:col-span-2">
            <span className="label">Work model</span>
            <WorkModelPicker name="edit-work-model" value={f.work_model} onChange={(v) => setF((o) => ({ ...o, work_model: v }))} />
          </div>
        </div>
      </Section>

      <Section title="Experience & salary">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Experience from (years)" error={errors.experience_min}><input className="input" inputMode="decimal" value={f.experience_min} onChange={set("experience_min")} /></Field>
          <Field label="Experience to (years)" error={errors.experience_max}><input className="input" inputMode="decimal" value={f.experience_max} onChange={set("experience_max")} /></Field>
          <div className="hidden sm:block" />
          <Field label="Salary from" error={errors.salary_min} hint={amountReadout(f.salary_min, f.salary_currency) || "Yearly: 3000000, 30L, 30 LPA or 1.2Cr"}>
            <input className="input" value={f.salary_min} onChange={set("salary_min")} />
          </Field>
          <Field label="Salary to" error={errors.salary_max} hint={amountReadout(f.salary_max, f.salary_currency)}>
            <input className="input" value={f.salary_max} onChange={set("salary_max")} />
          </Field>
          <Field label="Currency" error={errors.salary_currency}>
            <input className="input" placeholder="INR" maxLength={3} list="edit-currencies" value={f.salary_currency} onChange={set("salary_currency")} />
            <datalist id="edit-currencies">{["INR", "USD", "EUR", "GBP", "AED", "SGD", "CAD", "AUD"].map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
        </div>
        <Field label="Salary as posted" hint="The posting's own words, e.g. “Best in industry” or “₹25–35 LPA + ESOPs”">
          <input className="input" value={f.salary_text} onChange={set("salary_text")} />
        </Field>
      </Section>

      <Section title="Skills" hint="Used for the match score; your lists are kept when the description is read again">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Required skills"><ListInput label="Required skills" value={f.required_skills} onChange={(v) => setF((o) => ({ ...o, required_skills: v }))} /></Field>
          <Field label="Nice-to-have skills"><ListInput label="Nice-to-have skills" value={f.preferred_skills} onChange={(v) => setF((o) => ({ ...o, preferred_skills: v }))} /></Field>
        </div>
      </Section>

      <Section title="Dates">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Posted on"><input className="input" type="date" value={f.posting_date} max={today()} onChange={set("posting_date")} /></Field>
          <Field label="Apply by" error={errors.application_deadline}><input className="input" type="date" value={f.application_deadline} onChange={set("application_deadline")} /></Field>
          <Field label="Applied on" error={errors.applied} hint={!app
            ? "Pick the date you applied: records an application and marks the job Applied"
            : app.origin === "auto" && !appliedChanged ? "Recorded automatically, so the date is approximate: set the real one" : "When you sent the application"}>
            <input className="input" type="date" value={applied} max={today()} disabled={apps.isLoading} onChange={(e) => setAppliedOn(e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Description & notes">
        <Field label="Job description" hint={f.original_jd !== start.original_jd
          ? "Changed: skills and requirements are read again and the job is re-scored when you save"
          : `${jdWords.toLocaleString()} words · changing it re-reads skills and requirements and re-scores the job`}>
          <textarea className="input min-h-40 font-mono text-xs" value={f.original_jd} onChange={set("original_jd")} />
        </Field>
        <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      </Section>

      {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-slate-100 bg-surface px-1 py-2">
        <button className="btn-primary" type="submit" disabled={!!bad || !dirty || save.isPending}>
          {save.isPending ? "Saving & re-scoring…" : "Save changes"}
        </button>
        <button className="btn-secondary" type="button" onClick={onDone}>Cancel</button>
        {dirty && <button className="btn-secondary" type="button" onClick={undo}>Undo changes</button>}
        <span className="text-xs text-slate-500" aria-live="polite">
          {bad ? <span className="text-rose-600">Fix the field marked in red to save.</span>
            : dirty ? <>Changed: {changedNames.join(", ")} · <kbd className="kbd">⌘/Ctrl</kbd><kbd className="kbd">Enter</kbd> saves</>
            : "Nothing changed yet. Values you set here are kept when the description is read again."}
        </span>
      </div>
    </form>
  );
}
