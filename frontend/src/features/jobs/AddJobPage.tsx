import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, Chips, ErrorBox, Field, PageIntro } from "../../components/ui";
import type { JobDetail } from "../../types/api";
import { formatMoney, humanize, splitList } from "../../utils/format";

const optionalUrl = z.string().trim().refine((v) => !v || /^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(v), "Enter a valid URL");
const optionalEmail = z.string().trim().refine((v) => !v || /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(v), "Enter a valid email");

export const jobSchema = z.object({
  title: z.string().trim().min(1, "Job title is required"),
  company: z.string().trim().min(1, "Company is required"),
  url: optionalUrl,
  source: z.string(),
  location: z.string(),
  work_model: z.string(),
  employment_type: z.string(),
  experience: z.string(),
  salary: z.string(),
  salary_currency: z.string(),
  posting_date: z.string(),
  application_deadline: z.string(),
  recruiter_name: z.string(),
  recruiter_linkedin: z.string().trim().refine((v) => !v || /linkedin\.com\/in\//i.test(v), "Use a linkedin.com/in/ profile URL"),
  recruiter_email: optionalEmail,
  jd: z.string().trim().min(1, "Paste the job description"),
  responsibilities: z.string(),
  required_skills: z.string(),
  preferred_skills: z.string(),
  qualifications: z.string(),
  notes: z.string(),
});
export type JobForm = z.infer<typeof jobSchema>;

const EMPTY: JobForm = {
  title: "", company: "", url: "", source: "", location: "", work_model: "", employment_type: "",
  experience: "", salary: "", salary_currency: "", posting_date: "", application_deadline: "",
  recruiter_name: "", recruiter_linkedin: "", recruiter_email: "", jd: "", responsibilities: "",
  required_skills: "", preferred_skills: "", qualifications: "", notes: "",
};

const MANUAL_SOURCES = ["", "LINKEDIN", "NAUKRI", "INDEED", "GLASSDOOR", "COMPANY_CAREERS", "RECRUITER_EMAIL",
  "WHATSAPP", "TELEGRAM", "REFERRAL", "DIRECT", "INSTAHYRE", "CUTSHORT", "WELLFOUND", "OTHER"];

interface Preview {
  source: string | null;
  external_id: string | null;
  is_aggregator: boolean;
  parsed: {
    required_skills: string[]; preferred_skills: string[]; experience_min: number | null; experience_max: number | null;
    salary_min: string | null; salary_max: string | null; salary_currency: string | null; locations: string[];
    work_model: string | null; employment_type: string | null; seniority: string | null;
    constraints: { type: string; text: string; mandatory: boolean }[];
  };
}

/** Convert the form into the API payload (empty strings are omitted; lists split). */
export function toPayload(v: JobForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!val) continue;
    if (["responsibilities", "required_skills", "preferred_skills", "qualifications"].includes(k)) out[k] = splitList(val);
    else out[k] = val;
  }
  return out;
}

export function AddJobPage() {
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<JobForm>({
    resolver: zodResolver(jobSchema), defaultValues: EMPTY,
  });
  const [url, jd, title] = watch(["url", "jd", "title"]);
  const [debounced, setDebounced] = useState({ url: "", jd: "", title: "" });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ url, jd, title }), 500);
    return () => clearTimeout(t);
  }, [url, jd, title]);
  const preview = useQuery({
    queryKey: ["job-preview", debounced],
    queryFn: () => api.post<Preview>("/jobs/preview", { url: debounced.url || null, jd: debounced.jd, title: debounced.title || null }),
    enabled: Boolean(debounced.jd.trim() || debounced.url.trim()),
  });
  const save = useMutation({
    mutationFn: (v: JobForm) => api.post<{ job: JobDetail; created: boolean; duplicate_matched_by: string | null }>("/jobs", toPayload(v)),
    onSuccess: (res) => navigate(`/jobs/${res.job.id}`, { state: { duplicate: !res.created, matchedBy: res.duplicate_matched_by } }),
  });
  const p = preview.data?.parsed;
  return (
    <div className="space-y-4">
      <div><h1>Add Job</h1><PageIntro>Found a job on LinkedIn, Naukri or elsewhere? Paste its link and description — it's checked for duplicates and scored against your profile.</PageIntro></div>
      <form className="grid gap-4 lg:grid-cols-3" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <Card className="space-y-3 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job Title *" error={errors.title?.message}><input className="input" {...register("title")} /></Field>
            <Field label="Company *" error={errors.company?.message}><input className="input" {...register("company")} /></Field>
          </div>
          <Field label="Job URL" error={errors.url?.message} hint="LinkedIn, Naukri, Indeed, ATS or careers page">
            <input className="input" placeholder="https://…" {...register("url")} />
          </Field>
          <Field label="Job Description *" error={errors.jd?.message}>
            <textarea className="input min-h-72 font-mono text-xs" placeholder="Paste the full job description" {...register("jd")} />
          </Field>
          <button type="button" className="link text-sm" onClick={() => setShowDetails((s) => !s)}>
            {showDetails ? "Hide" : "Show"} optional details (location, salary, recruiter, skills…)
          </button>
          {showDetails && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Source (override)">
                <select className="input" {...register("source")}>
                  {MANUAL_SOURCES.map((s) => <option key={s} value={s}>{s ? humanize(s) : "Detect from URL"}</option>)}
                </select>
              </Field>
              <Field label="Location"><input className="input" {...register("location")} /></Field>
              <Field label="Work model">
                <select className="input" {...register("work_model")}>
                  <option value="">From JD</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ONSITE">Onsite</option>
                </select>
              </Field>
              <Field label="Employment type"><input className="input" placeholder="Full-time" {...register("employment_type")} /></Field>
              <Field label="Experience" hint='e.g. "8-12 years"'><input className="input" {...register("experience")} /></Field>
              <Field label="Salary / CTC" hint='e.g. "30-40 LPA"'><input className="input" {...register("salary")} /></Field>
              <Field label="Currency"><input className="input" placeholder="INR" maxLength={3} {...register("salary_currency")} /></Field>
              <Field label="Posting date"><input className="input" type="date" {...register("posting_date")} /></Field>
              <Field label="Application deadline"><input className="input" type="date" {...register("application_deadline")} /></Field>
              <Field label="Recruiter"><input className="input" {...register("recruiter_name")} /></Field>
              <Field label="Recruiter LinkedIn" error={errors.recruiter_linkedin?.message}><input className="input" {...register("recruiter_linkedin")} /></Field>
              <Field label="Recruiter email" error={errors.recruiter_email?.message}><input className="input" {...register("recruiter_email")} /></Field>
              <Field label="Required skills" hint="comma separated (overrides JD parsing)"><input className="input" {...register("required_skills")} /></Field>
              <Field label="Preferred skills"><input className="input" {...register("preferred_skills")} /></Field>
              <Field label="Qualifications"><input className="input" {...register("qualifications")} /></Field>
              <div className="sm:col-span-3"><Field label="Responsibilities" hint="one per line"><textarea className="input" rows={3} {...register("responsibilities")} /></Field></div>
              <div className="sm:col-span-3"><Field label="Notes"><textarea className="input" rows={2} {...register("notes")} /></Field></div>
            </div>
          )}
          {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
          <div className="flex gap-2">
            <button className="btn-primary" type="submit" disabled={save.isPending}>{save.isPending ? "Saving & analyzing…" : "Save & analyze"}</button>
            <button className="btn-secondary" type="button" onClick={() => navigate(-1)}>Cancel</button>
          </div>
        </Card>
        <Card title="Live preview" className="h-fit space-y-3 text-sm">
          {!preview.data && <p className="text-slate-500">Paste a URL and JD to see what will be detected.</p>}
          {preview.data && p && (
            <>
              <div>Source: <Badge tone="indigo">{humanize(preview.data.source ?? "OTHER")}</Badge>
                {preview.data.is_aggregator && <Badge tone="amber">aggregator — confirm at employer</Badge>}
                {preview.data.external_id && <span className="ml-1 text-xs text-slate-500">id {preview.data.external_id}</span>}
              </div>
              <div><div className="label">Required skills</div><Chips items={p.required_skills} tone="indigo" /></div>
              <div><div className="label">Preferred skills</div><Chips items={p.preferred_skills} /></div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span>Experience: {p.experience_min ?? "—"}{p.experience_max ? `–${p.experience_max}` : p.experience_min ? "+" : ""} yrs</span>
                <span>Seniority: {humanize(p.seniority)}</span>
                <span>Work model: {humanize(p.work_model)}</span>
                <span>Type: {p.employment_type ?? "—"}</span>
                <span className="col-span-2">Salary: {p.salary_min ? `${formatMoney(p.salary_min, p.salary_currency)} – ${formatMoney(p.salary_max, p.salary_currency)}` : "Not stated"}</span>
                <span className="col-span-2">Locations: {p.locations.join(", ") || "—"}</span>
              </div>
              {p.constraints.length > 0 && (
                <div><div className="label">Possible blockers</div>
                  <ul className="list-disc pl-4 text-xs text-amber-700">{p.constraints.map((c) => <li key={c.text}>{humanize(c.type)}: {c.text}</li>)}</ul>
                </div>
              )}
            </>
          )}
        </Card>
      </form>
    </div>
  );
}
