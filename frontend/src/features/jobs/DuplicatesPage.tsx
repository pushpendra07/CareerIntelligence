import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Badge, BackButton, Card, Empty, ErrorBox, JobStatusBadge, PageIntro, Spinner } from "../../components/ui";
import type { Job } from "../../types/api";

type Duplicates = { groups: Job[][]; extra_jobs: number };
type MergeResult = { groups: number; jobs_removed: number };

/**
 * Jobs saved more than once (same company and title in any city, a repost, or the same posting
 * ID in the link). Merging keeps the first job of a group — the one you got furthest with — and
 * moves the others' links, notes, cities and applications onto it.
 */
export function DuplicatesPage() {
  const qc = useQueryClient();
  const dups = useQuery({ queryKey: ["jobs", "duplicates"], queryFn: () => api.get<Duplicates>("/jobs/duplicates") });
  const merge = useMutation({
    mutationFn: (keepIds?: number[]) => api.post<MergeResult>("/jobs/duplicates/merge", keepIds ? { keep_ids: keepIds } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
    meta: { success: "Duplicates merged", toastError: true },
  });
  const groups = dups.data?.groups ?? [];
  return (
    <div className="space-y-4">
      <BackButton fallback="/jobs" label="Jobs" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Duplicate jobs</h1>
          <PageIntro>The same job saved more than once: same company and title (in any city), a repost with a new link,
            or the same posting ID. Merging keeps the first job and moves the others' links, cities, notes and applications onto it.</PageIntro>
        </div>
        {groups.length > 0 && (
          <button className="btn-primary" disabled={merge.isPending} onClick={() => merge.mutate(undefined)}>
            Merge all ({dups.data?.extra_jobs} extra)
          </button>
        )}
      </div>
      {dups.isLoading && <Spinner />}
      {dups.error && <ErrorBox error={dups.error} />}
      {dups.data && groups.length === 0 && <Empty>No duplicate jobs. New jobs that are already saved are merged automatically.</Empty>}
      {groups.map((group) => {
        const [keep, ...rest] = group;
        return (
          <Card key={keep.id} title={`${keep.company.name} · ${keep.title}`}
            actions={<button className="btn-secondary" disabled={merge.isPending} onClick={() => merge.mutate([keep.id])}>
              Merge {rest.length + 1} into #{keep.id}</button>}>
            <ul className="divide-y divide-slate-100 text-sm">
              {group.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Link className="font-medium text-indigo-700 hover:underline" to={`/jobs/${job.id}`}>#{job.id}</Link>
                  <span className="min-w-0 flex-1 truncate">{job.title}</span>
                  <span className="text-slate-500">{job.location ?? "—"}</span>
                  <span className="text-slate-500">{job.posting_date ?? ""}</span>
                  <JobStatusBadge value={job.status} />
                  {job.id === keep.id && <Badge tone="green">kept</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
