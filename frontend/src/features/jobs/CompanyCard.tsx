import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Card, JobStatusBadge, ScoreBadge, StatusBadge } from "../../components/ui";
import type { CompanyDetail, Job, Page } from "../../types/api";
import { ExtraLinkList } from "../companies/ExtraLinks";

type Naukri = { rating?: number; reviews?: number };

/** Jobs already decided against are not "other jobs" worth a look. */
const DONE = ["NOT_RELEVANT", "REJECTED", "WITHDRAWN", "CLOSED"];

/** The company behind a job: key facts, its links and its other jobs in the app. */
export function CompanyCard({ companyId, jobId }: { companyId: number; jobId: number }) {
  const company = useQuery({ queryKey: ["company", String(companyId)], queryFn: () => api.get<CompanyDetail>(`/companies/${companyId}`) });
  const others = useQuery({
    queryKey: ["jobs", { company_id: companyId, closed: "false", size: 20 }],
    queryFn: () => api.get<Page<Job>>("/jobs", { company_id: companyId, closed: "false", sort: "-match_score", size: 20 }),
  });
  const c = company.data;
  if (!c) return null;
  const naukri = (c.attributes?.naukri ?? {}) as Naukri;
  const facts = [c.industry, c.employee_range && `${c.employee_range} employees`, c.headquarters,
    naukri.rating !== undefined && `★ ${naukri.rating}${naukri.reviews ? ` (${naukri.reviews.toLocaleString()})` : ""}`].filter(Boolean);
  const site = (href: string | null, label: string) => href && <a className="link" href={href} target="_blank" rel="noopener noreferrer">{label} ↗</a>;
  const jobs = others.data?.items.filter((j) => j.id !== jobId && !DONE.includes(j.status)) ?? [];
  return (
    <Card title="Company">
      <div className="space-y-2 text-sm" data-testid="company-card">
        <div className="flex flex-wrap items-center gap-2">
          <Link className="font-medium hover:text-indigo-700" to={`/companies/${c.id}`}>{c.name}</Link>
          {c.tier && <StatusBadge value={c.tier} />}
          {c.hiring_status === "HIRING" && <StatusBadge value="HIRING" />}
        </div>
        {facts.length > 0 && <p className="text-xs text-slate-500">{facts.join(" · ")}</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {site(c.website, "Website")}{site(c.careers_url, "Careers")}{site(c.linkedin_url, "LinkedIn")}
          {!!c.extra_links?.length && <ExtraLinkList links={c.extra_links} />}
        </div>
        {jobs.length > 0 && (
          <div className="border-t border-slate-100 pt-2">
            <div className="label">Other open jobs here</div>
            <ul className="space-y-1">
              {jobs.slice(0, 5).map((j) => (
                <li key={j.id} className="flex items-center gap-2 text-xs">
                  <ScoreBadge score={j.match_score} />
                  <Link className="min-w-0 flex-1 truncate hover:text-indigo-700" to={`/jobs/${j.id}`} title={j.title}>{j.title}</Link>
                  <JobStatusBadge value={j.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
