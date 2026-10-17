import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api/client";
import { ErrorBox, Field } from "../../components/ui";
import type { Application, JobDetail, Page } from "../../types/api";
import { EmploymentTypeSelect, LocationInput, WorkModelPicker } from "./JobFields";

type Form = {
  title: string; location: string; work_model: string; employment_type: string;
  experience_min: string; experience_max: string; salary_min: string; salary_max: string; salary_currency: string;
  posting_date: string; application_deadline: string; original_jd: string; notes: string;
};

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function fromJob(j: JobDetail): Form {
  return {
    title: j.title, location: s(j.location), work_model: j.work_model === "UNKNOWN" ? "" : j.work_model,
    employment_type: s(j.employment_type),
    experience_min: s(j.experience_min && Number(j.experience_min)), experience_max: s(j.experience_max && Number(j.experience_max)),
    salary_min: s(j.salary_min && Number(j.salary_min)), salary_max: s(j.salary_max && Number(j.salary_max)),
    salary_currency: s(j.salary_currency),
    posting_date: s(j.posting_date), application_deadline: s(j.application_deadline),
    original_jd: j.original_jd ?? "", notes: s(j.notes),
  };
}

const NUMBERS = ["experience_min", "experience_max", "salary_min", "salary_max"];

/** Only the fields that changed, in the API's types ("" clears a value). */
export function changedFields(before: Form, after: Form): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof Form)[]) {
    const v = after[k].trim();
    if (v === before[k].trim()) continue;
    if (k === "title" && !v) continue;
    if (NUMBERS.includes(k)) out[k] = v === "" ? null : Number(v);
    else if (k === "salary_currency") out[k] = v ? v.toUpperCase() : null;
    else if (k === "original_jd") out[k] = after[k];
    else out[k] = v === "" ? null : v;
  }
  return out;
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Edit a job's details: title, where and how you'd work, experience, salary, dates, applied date, description, notes. */
export function EditJob({ job, onDone }: { job: JobDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const start = fromJob(job);
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
  const bad = (f.title.trim() === "" && "Job title is required")
    || NUMBERS.some((k) => f[k as keyof Form].trim() !== "" && !(Number(f[k as keyof Form]) >= 0)) && "Numbers only in experience and salary"
    || (f.salary_currency.trim() && f.salary_currency.trim().length !== 3 && "Currency is a 3-letter code, e.g. INR")
    || (appliedChanged && app && !applied && "The applied date can't be empty")
    || (applied > today() && "The applied date can't be in the future")
    || "";
  const dirty = Object.keys(changes).length > 0 || appliedChanged;
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
  return (
    <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); if (!bad && dirty) save.mutate(); }}>
      <Field label="Job title *"><input className="input" value={f.title} onChange={set("title")} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Location" hint="Pick or type, e.g. Pune / Bengaluru"><LocationInput name="edit-location" value={f.location} onChange={set("location")} /></Field>
        <div className="sm:col-span-2">
          <span className="label">Work model</span>
          <WorkModelPicker name="edit-work-model" value={f.work_model} onChange={(v) => setF((o) => ({ ...o, work_model: v }))} />
        </div>
        <Field label="Job type"><EmploymentTypeSelect current={job.employment_type} value={f.employment_type} onChange={set("employment_type")} /></Field>
        <Field label="Experience from (years)"><input className="input" inputMode="decimal" value={f.experience_min} onChange={set("experience_min")} /></Field>
        <Field label="Experience to (years)"><input className="input" inputMode="decimal" value={f.experience_max} onChange={set("experience_max")} /></Field>
        <Field label="Salary from" hint="Yearly, e.g. 3000000"><input className="input" inputMode="decimal" value={f.salary_min} onChange={set("salary_min")} /></Field>
        <Field label="Salary to"><input className="input" inputMode="decimal" value={f.salary_max} onChange={set("salary_max")} /></Field>
        <Field label="Currency"><input className="input" placeholder="INR" maxLength={3} value={f.salary_currency} onChange={set("salary_currency")} /></Field>
        <Field label="Posted on"><input className="input" type="date" value={f.posting_date} onChange={set("posting_date")} /></Field>
        <Field label="Apply by"><input className="input" type="date" value={f.application_deadline} onChange={set("application_deadline")} /></Field>
        <Field label="Applied on" hint={!app
          ? "Pick the date you applied: records an application and marks the job Applied"
          : app.origin === "auto" && !appliedChanged ? "Recorded automatically, so the date is approximate: set the real one" : "When you sent the application"}>
          <input className="input" type="date" value={applied} max={today()} disabled={apps.isLoading} onChange={(e) => setAppliedOn(e.target.value)} />
        </Field>
      </div>
      <Field label="Job description" hint="Changing it re-reads skills and requirements and re-scores the job">
        <textarea className="input min-h-40 font-mono text-xs" value={f.original_jd} onChange={set("original_jd")} />
      </Field>
      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      {bad && <p className="text-sm text-rose-600">{bad}</p>}
      {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
      <div className="flex items-center gap-2">
        <button className="btn-primary" type="submit" disabled={!!bad || !dirty || save.isPending}>
          {save.isPending ? "Saving & re-scoring…" : "Save changes"}
        </button>
        <button className="btn-secondary" type="button" onClick={onDone}>Cancel</button>
        <span className="text-xs text-slate-500">Values you set here are kept when the description is read again.</span>
      </div>
    </form>
  );
}
