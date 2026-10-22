import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { api, errorMessage } from "../../api/client";
import { BackButton, Card, ErrorBox, Field, PageIntro, StatusBadge } from "../../components/ui";
import { ListInput } from "../../components/ListInput";
import type { Company, CompanyDetail, Page } from "../../types/api";

const url = (msg = "Enter a valid URL") =>
  z.string().trim().refine((v) => !v || /^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(v), msg);

export const companySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  legal_name: z.string(),
  aliases: z.array(z.string()),
  website: url(),
  careers_url: url(),
  linkedin_url: url().refine((v) => !v || /linkedin\.com\/company\//i.test(v), "Use a linkedin.com/company/ page URL"),
  extra_links: z.array(z.string()).refine((v) => v.every((x) => /^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(x)), "Every link must be a URL"),
  industry: z.string(),
  company_type: z.string(),
  employee_range: z.string(),
  headquarters: z.string(),
  india_presence: z.enum(["", "true", "false"]),
  india_locations: z.array(z.string()),
  tier: z.string(),
  priority: z.string().max(10),
  hiring_status: z.string(),
  job_search_enabled: z.boolean(),
  source_url: url(),
  notes: z.string(),
});
export type CompanyForm = z.infer<typeof companySchema>;

const EMPTY: CompanyForm = {
  name: "", legal_name: "", aliases: [], website: "", careers_url: "", linkedin_url: "", extra_links: [],
  industry: "", company_type: "", employee_range: "", headquarters: "", india_presence: "", india_locations: [],
  tier: "", priority: "", hiring_status: "", job_search_enabled: false, source_url: "", notes: "",
};

const SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"];
const TYPES = ["Product", "Services", "Agency", "Consulting", "Startup", "Enterprise", "Recruitment / Staffing"];

/** The form's values as the API body: empty fields left out, so nothing unknown is saved. */
export function companyBody(v: CompanyForm): Record<string, unknown> {
  const body: Record<string, unknown> = { name: v.name.trim() };
  for (const k of ["legal_name", "website", "careers_url", "linkedin_url", "industry", "company_type", "employee_range",
    "headquarters", "tier", "priority", "hiring_status", "source_url", "notes"] as const) {
    if (v[k].trim()) body[k] = v[k].trim();
  }
  for (const k of ["aliases", "extra_links", "india_locations"] as const) if (v[k].length) body[k] = v[k];
  if (v.india_presence) body.india_presence = v.india_presence === "true";
  if (v.job_search_enabled) body.job_search_enabled = true;
  return body;
}

/** Waits until typing stops before the value is used (so a lookup doesn't run on every key). */
function useSettled(value: string, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** Companies already in the list whose name looks like the one being typed. */
function SimilarCompanies({ name }: { name: string }) {
  const q = useSettled(name.trim());
  const { data } = useQuery({
    queryKey: ["companies", "similar", q],
    queryFn: () => api.get<Page<Company>>("/companies", { q, size: 5 }),
    enabled: q.length >= 2,
  });
  if (q.length < 2 || !data?.items.length) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800" role="status">
      <b>Already in your list?</b>
      <ul className="mt-1 space-y-0.5">
        {data.items.map((c) => (
          <li key={c.id}><Link className="link" to={`/companies/${c.id}`}>{c.name}</Link>
            {c.website && <span className="text-slate-500"> · {c.website.replace(/^https?:\/\/(www\.)?/, "")}</span>} <StatusBadge value={c.verification_status} /></li>
        ))}
      </ul>
    </div>
  );
}

export function AddCompanyPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<CompanyForm>({
    resolver: zodResolver(companySchema), defaultValues: EMPTY,
  });
  const industries = useQuery({
    queryKey: ["companies", "facets"], retry: false,
    queryFn: () => api.get<{ industries: { value: string }[] }>("/companies/facets"),
  }).data?.industries ?? [];
  const save = useMutation({
    mutationFn: (v: CompanyForm) => api.post<CompanyDetail>("/companies", companyBody(v)),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["companies"] }); navigate(`/companies/${c.id}`); },
    meta: { success: "Company added" },
  });
  const name = watch("name");
  const list = (field: "aliases" | "india_locations" | "extra_links", placeholder: string, label: string) => (
    <Controller control={control} name={field} render={({ field: f }) => (
      <ListInput value={f.value} onChange={f.onChange} placeholder={placeholder} label={label} />
    )} />
  );
  return (
    <div className="space-y-4">
      <BackButton fallback="/companies" label="Back to companies" />
      <div><h1>Add company</h1><PageIntro>Fill in what you know; leave the rest empty. Details you enter are saved as your own
        (manual) evidence. Verify them later from the company page, and turn on Job search once it has a supported job board.</PageIntro></div>
      <form className="grid gap-4 lg:grid-cols-3" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <div className="space-y-4 lg:col-span-2">
          <Card title="Company" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company name *" error={errors.name?.message}><input className="input" autoFocus {...register("name")} /></Field>
              <Field label="Legal name" hint="e.g. Acme Technologies Pvt Ltd"><input className="input" {...register("legal_name")} /></Field>
            </div>
            <SimilarCompanies name={name} />
            <Field label="Other names" hint="Short names or old names, so jobs under them match this company">
              {list("aliases", "Type a name and press Enter", "Other names")}
            </Field>
          </Card>
          <Card title="Links" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Website" error={errors.website?.message}><input className="input" placeholder="https://www.example.com" {...register("website")} /></Field>
              <Field label="LinkedIn page" error={errors.linkedin_url?.message}><input className="input" placeholder="https://www.linkedin.com/company/…" {...register("linkedin_url")} /></Field>
            </div>
            <Field label="Careers page / job board" error={errors.careers_url?.message}
              hint="Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee, Pinpoint, Teamtailor, SuccessFactors or Oracle Cloud boards can be searched for jobs">
              <input className="input" placeholder="https://boards.greenhouse.io/…" {...register("careers_url")} />
            </Field>
            <Field label="Job portal pages" error={errors.extra_links?.message} hint="The company's page on Naukri, LinkedIn, Foundit or Monster">
              {list("extra_links", "Paste a link and press Enter", "Job portal pages")}
            </Field>
          </Card>
          <Card title="About" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Industry">
                <input className="input" list="company-industries" placeholder="IT Services & Consulting" {...register("industry")} />
                <datalist id="company-industries">{industries.map((i) => <option key={i.value} value={i.value} />)}</datalist>
              </Field>
              <Field label="Company type">
                <input className="input" list="company-types" placeholder="Product, Services, Agency…" {...register("company_type")} />
                <datalist id="company-types">{TYPES.map((t) => <option key={t} value={t} />)}</datalist>
              </Field>
              <Field label="Employees">
                <select className="input" {...register("employee_range")}>
                  <option value="">Unknown</option>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Headquarters" hint="City, Country"><input className="input" placeholder="Pune, India" {...register("headquarters")} /></Field>
              <Field label="Office in India">
                <select className="input" {...register("india_presence")}>
                  <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
                </select>
              </Field>
              <Field label="India office cities">{list("india_locations", "Bengaluru, Pune…", "India office cities")}</Field>
            </div>
            <Field label="Where you found these details" error={errors.source_url?.message}
              hint="A page that shows them, e.g. the company's About or Contact page. Saved as the source of each detail.">
              <input className="input" placeholder="https://www.example.com/about" {...register("source_url")} />
            </Field>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Your view" className="space-y-3">
            <Field label="Tier" hint="How much you want to work there; it adds to job scores">
              <select className="input" {...register("tier")}>
                <option value="">No tier</option><option value="TIER_A">Tier A</option><option value="TIER_B">Tier B</option><option value="TIER_C">Tier C</option>
              </select>
            </Field>
            <Field label="Priority" hint="Your own label, e.g. P1"><input className="input" maxLength={10} {...register("priority")} /></Field>
            <Field label="Hiring">
              <select className="input" {...register("hiring_status")}>
                <option value="">Unknown</option><option value="HIRING">Hiring now</option><option value="NOT_HIRING">Not hiring</option>
              </select>
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" {...register("job_search_enabled")} />
              <span>Job search<span className="block text-xs text-slate-500">Search its job board for new jobs (needs a supported careers URL)</span></span>
            </label>
            <Field label="Notes"><textarea className="input" rows={4} {...register("notes")} /></Field>
          </Card>
          {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Add company"}</button>
            <Link className="btn-secondary" to="/companies">Cancel</Link>
          </div>
        </div>
      </form>
    </div>
  );
}
