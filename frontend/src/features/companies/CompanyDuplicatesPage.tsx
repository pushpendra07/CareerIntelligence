import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { BackButton, Card, Empty, ErrorBox, PageIntro, Spinner, StatusBadge } from "../../components/ui";
import type { Company } from "../../types/api";
import { formatDateTime } from "../../utils/format";
import { Rating } from "./CompaniesPage";
import { ExtraLinkList } from "./ExtraLinks";

type Group = { reason: string; companies: Company[] };

/** The company to keep by default: the one with the most jobs, then the oldest. */
const defaultKeep = (cs: Company[]) =>
  [...cs].sort((a, b) => (b.job_count ?? 0) - (a.job_count ?? 0) || a.id - b.id)[0].id;

function DuplicateGroup({ group }: { group: Group }) {
  const qc = useQueryClient();
  const [keep, setKeep] = useState(() => defaultKeep(group.companies));
  const others = group.companies.filter((c) => c.id !== keep);
  const done = () => qc.invalidateQueries({ queryKey: ["companies"] });
  const merge = useMutation({
    mutationFn: async () => { for (const c of others) await api.post(`/companies/${keep}/merge`, { merge_id: c.id }); },
    onSuccess: done,
    meta: { success: "Merged — jobs, recruiters and links moved to the kept company" },
  });
  const dismiss = useMutation({
    mutationFn: () => api.post("/companies/duplicates/dismiss", { company_ids: group.companies.map((c) => c.id) }),
    onSuccess: done,
    meta: { success: "Marked as different companies" },
  });
  const kept = group.companies.find((c) => c.id === keep)!;
  return (
    <Card>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{group.reason === "same website" ? "Same website" : "Similar name"}</p>
      <ul className="divide-y divide-slate-100">
        {group.companies.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start gap-3 py-2">
            <label className="flex items-center gap-2 pt-0.5 text-xs text-slate-500">
              <input type="radio" name={`keep-${group.companies[0].id}`} checked={keep === c.id} onChange={() => setKeep(c.id)}
                aria-label={`Keep ${c.name}`} />Keep
            </label>
            <div className="min-w-0 flex-1">
              <Link className="font-medium hover:text-indigo-700" to={`/companies/${c.id}`}>{c.name}</Link>
              <span className="ml-1 text-xs text-slate-400">#{c.id}</span>
              <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                {c.website && <a className="link" href={c.website} target="_blank" rel="noopener noreferrer">{c.domain ?? c.website}</a>}
                {c.industry && <span>{c.industry}</span>}
                {c.employee_range && <span>{c.employee_range} employees</span>}
                <Rating value={c.rating} reviews={c.rating_reviews} />
                {!!c.extra_links?.length && <ExtraLinkList links={c.extra_links} />}
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>{c.job_count ?? 0} job{c.job_count === 1 ? "" : "s"}</div>
              <div title="Added to this app">{formatDateTime(c.created_at, true)}</div>
            </div>
            <StatusBadge value={c.verification_status} />
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
        <button className="btn-primary px-3 py-1 text-sm" disabled={merge.isPending || dismiss.isPending} onClick={() => merge.mutate()}>
          {merge.isPending ? "Merging…" : `Merge into ${kept.name}`}
        </button>
        <button className="btn-secondary px-3 py-1 text-sm" disabled={merge.isPending || dismiss.isPending} onClick={() => dismiss.mutate()}
          title="They are different companies — don't suggest them again">Not duplicates</button>
        <span className="text-xs text-slate-500">Merging keeps every job, recruiter, link and alias on the kept company.</span>
      </div>
      {(merge.error || dismiss.error) && <ErrorBox error={new Error(errorMessage(merge.error ?? dismiss.error))} />}
    </Card>
  );
}

export function CompanyDuplicatesPage() {
  const dups = useQuery({ queryKey: ["companies", "duplicates"], queryFn: () => api.get<{ groups: Group[]; total: number }>("/companies/duplicates") });
  return (
    <div className="space-y-4">
      <BackButton fallback="/companies" label="Back to companies" />
      <div>
        <h1>Possible duplicate companies</h1>
        <PageIntro>Companies whose names match once words like “Technologies” or “Global” are left out, or that share a website.
          Some are renamed or acquired companies (one company); others only look alike. Pick the one to keep and merge, or mark them as different.</PageIntro>
      </div>
      {dups.isLoading && <Spinner />}
      {dups.error && <ErrorBox error={dups.error} />}
      {dups.data && (dups.data.groups.length
        ? dups.data.groups.map((g) => <DuplicateGroup key={g.companies.map((c) => c.id).join("-")} group={g} />)
        : <Card><Empty>No possible duplicates. 🎉</Empty></Card>)}
    </div>
  );
}
