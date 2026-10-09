import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { Badge, Card, Empty, ErrorBox, Pagination, ScoreBadge, Spinner, StatusBadge } from "../../components/ui";
import type { Job, Page } from "../../types/api";
import { experienceRange, formatDate, humanize, salaryRange } from "../../utils/format";

const FILTERS = ["q", "min_score", "recommendation", "tier", "technology", "location", "work_model",
  "source", "status", "posted_after", "experience", "sort", "stale", "has_application"] as const;

export const JOB_STATUSES = ["DISCOVERED", "NEW", "REVIEWING", "SHORTLISTED", "READY_TO_APPLY", "APPLIED",
  "RECRUITER_CONTACTED", "SCREENING", "INTERVIEW", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN", "ON_HOLD",
  "CLOSED", "NOT_RELEVANT"];
const RECS = ["HIGHLY_RECOMMENDED", "RECOMMENDED", "CONSIDER", "LOW_PRIORITY", "NOT_RECOMMENDED"];
const SOURCES = ["CAREER_OPS", "LINKEDIN", "NAUKRI", "INDEED", "GLASSDOOR", "GREENHOUSE", "LEVER", "WORKDAY",
  "SMARTRECRUITERS", "SUCCESSFACTORS", "ASHBY", "COMPANY_CAREERS", "REFERRAL", "RECRUITER_EMAIL", "WHATSAPP",
  "TELEGRAM", "DIRECT", "OTHER"];

export function JobsPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const query: Record<string, string | string[]> = {};
  for (const f of FILTERS) {
    const values = params.getAll(f).filter(Boolean);
    if (values.length) query[f] = f === "status" ? values : values[0];
  }
  const { data, isLoading, error } = useQuery({
    queryKey: ["jobs", query, page],
    queryFn: () => api.get<Page<Job>>("/jobs", { ...query, page, size: 50 }),
  });
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    setParams(next);
  };
  const select = (key: string, options: string[], label: string) => (
    <select className="input" aria-label={label} value={params.get(key) ?? ""} onChange={(e) => set(key, e.target.value)}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
    </select>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1>Jobs</h1>
        <Link className="btn-primary" to="/jobs/new">Add Job</Link>
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
          <input className="input col-span-2" placeholder="Search title, company, location" aria-label="Search jobs"
            defaultValue={params.get("q") ?? ""} onKeyDown={(e) => e.key === "Enter" && set("q", e.currentTarget.value)} />
          <input className="input" type="number" min={0} max={100} placeholder="Min score" aria-label="Min score"
            defaultValue={params.get("min_score") ?? ""} onBlur={(e) => set("min_score", e.target.value)} />
          {select("recommendation", RECS, "Recommendation")}
          {select("status", JOB_STATUSES, "Status")}
          {select("tier", ["TIER_A", "TIER_B", "TIER_C"], "Company tier")}
          <input className="input" placeholder="Technology" aria-label="Technology" defaultValue={params.get("technology") ?? ""}
            onBlur={(e) => set("technology", e.target.value)} />
          <input className="input" placeholder="Location" aria-label="Location" defaultValue={params.get("location") ?? ""}
            onBlur={(e) => set("location", e.target.value)} />
          {select("work_model", ["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"], "Work model")}
          {select("source", SOURCES, "Source")}
          <input className="input" type="date" aria-label="Posted after" defaultValue={params.get("posted_after") ?? ""}
            onChange={(e) => set("posted_after", e.target.value)} />
          <input className="input" type="number" step="0.5" placeholder="My years" aria-label="Experience fits"
            defaultValue={params.get("experience") ?? ""} onBlur={(e) => set("experience", e.target.value)} />
          <select className="input" aria-label="Application" value={params.get("has_application") ?? ""} onChange={(e) => set("has_application", e.target.value)}>
            <option value="">Any application</option><option value="false">Not applied</option><option value="true">Applied</option>
          </select>
          <select className="input" aria-label="Sort" value={params.get("sort") ?? "-match_score"} onChange={(e) => set("sort", e.target.value)}>
            <option value="-match_score">Highest score</option>
            <option value="-posting_date">Newest</option>
            <option value="posting_date">Oldest</option>
            <option value="company">Company</option>
            <option value="-salary">Salary</option>
            <option value="experience">Experience</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={params.get("stale") === "true"} onChange={(e) => set("stale", e.target.checked ? "true" : "")} />
            Stale only
          </label>
          <button className="btn-secondary" onClick={() => setParams(new URLSearchParams())}>Clear</button>
        </div>
      </Card>
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} />}
      {data && (
        <Card>
          {!data.items.length ? <Empty>No jobs match these filters.</Empty> : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead><tr>
                  <th className="th">Score</th><th className="th">Job</th><th className="th">Location</th>
                  <th className="th">Exp</th><th className="th">Salary</th><th className="th">Sources</th>
                  <th className="th">Posted</th><th className="th">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {data.items.map((j) => (
                    <tr key={j.id} className="hover:bg-slate-50">
                      <td className="td"><ScoreBadge score={j.match_score} stale={j.score_stale} /></td>
                      <td className="td">
                        <Link to={`/jobs/${j.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{j.title}</Link>
                        <div className="text-xs text-slate-500">
                          {j.company.name} {j.company.tier && <Badge>{j.company.tier.replace("TIER_", "Tier ")}</Badge>}
                          {j.jd_status !== "OK" && <Badge tone="amber">no JD</Badge>}
                        </div>
                      </td>
                      <td className="td text-xs">{j.location ?? "—"}<div className="text-slate-500">{humanize(j.work_model)}</div></td>
                      <td className="td text-xs">{experienceRange(j.experience_min, j.experience_max)}</td>
                      <td className="td text-xs">{salaryRange(j.salary_min, j.salary_max, j.salary_currency)}</td>
                      <td className="td text-xs">{j.sources.map(humanize).join(", ")}</td>
                      <td className="td text-xs">{formatDate(j.posting_date)}</td>
                      <td className="td"><StatusBadge value={j.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} size={50} total={data.total} onPage={(p) => { const n = new URLSearchParams(params); n.set("page", String(p)); setParams(n); }} />
        </Card>
      )}
    </div>
  );
}
