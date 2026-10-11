import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api/client";
import { Card } from "../../components/ui";
import type { JobComment } from "../../types/api";
import { formatDateTime } from "../../utils/format";

/** Dated comments on a job: add one, see them newest first, delete with an inline confirmation. */
export function JobComments({ jobId, comments }: { jobId: number; comments: JobComment[] }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState<number | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["job"] });
  const add = useMutation({
    mutationFn: (text: string) => api.post(`/jobs/${jobId}/comments`, { body: text }),
    onSuccess: () => { setBody(""); refresh(); },
  });
  const del = useMutation({
    mutationFn: (commentId: number) => api.delete(`/jobs/${jobId}/comments/${commentId}`),
    onSuccess: () => { setConfirming(null); refresh(); },
  });
  const submit = () => { if (body.trim()) add.mutate(body.trim()); };
  return (
    <Card title="Comments">
      <div className="space-y-2">
        <textarea className="input min-h-20" aria-label="New comment" placeholder="Add a comment…" value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">⌘/Ctrl + Enter to add</span>
          <button type="button" className="btn-primary" onClick={submit} disabled={!body.trim() || add.isPending}>
            {add.isPending ? "Adding…" : "Add comment"}
          </button>
        </div>
        {add.error && <p className="text-xs text-rose-700">{errorMessage(add.error)}</p>}
      </div>
      {comments.length > 0 && (
        <ul className="mt-4 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="border-t border-slate-100 pt-3 text-sm">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-400">
                <span>{formatDateTime(c.created_at)}</span>
                {confirming === c.id ? (
                  <span className="flex items-center gap-2">
                    Delete this comment?
                    <button type="button" className="text-rose-700 hover:underline" onClick={() => del.mutate(c.id)} disabled={del.isPending}>Yes</button>
                    <button type="button" className="hover:underline" onClick={() => setConfirming(null)}>No</button>
                  </span>
                ) : (
                  <button type="button" className="hover:text-rose-700" aria-label="Delete comment" onClick={() => setConfirming(c.id)}>Delete</button>
                )}
              </div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
