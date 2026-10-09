import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, errorMessage } from "../../api/client";

/**
 * Delete with an inline confirmation (no browser pop-up). If the job has applications,
 * interviews or offers, the server says so and a second confirmation deletes them too.
 */
export function DeleteJobButton({ jobId, title, onDeleted, compact = false }: {
  jobId: number;
  title: string;
  onDeleted?: () => void;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"idle" | "confirm" | "linked">("idle");
  const [linkedMessage, setLinkedMessage] = useState("");
  const del = useMutation({
    mutationFn: (force: boolean) => api.delete(`/jobs/${jobId}`, force ? { force: "true" } : undefined),
    onSuccess: () => {
      setStep("idle");
      qc.invalidateQueries();
      onDeleted?.();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setLinkedMessage(err.message);
        setStep("linked");
      }
    },
  });
  const size = compact ? "px-2 py-0.5 text-xs" : "";
  if (step === "idle") {
    return (
      <button type="button" className={`btn-secondary text-rose-700 hover:bg-rose-50 ${size}`} aria-label={`Delete ${title}`}
        onClick={() => setStep("confirm")}>Delete</button>
    );
  }
  const linked = step === "linked";
  return (
    <span role="alertdialog" aria-label="Confirm delete" className={`inline-flex flex-wrap items-center gap-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800 ${compact ? "max-w-xs" : ""}`}>
      <span>{linked ? `${linkedMessage} Delete anyway?` : "Delete this job? Imports and scans won't add it back."}</span>
      <button type="button" className="rounded bg-rose-600 px-2 py-0.5 font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        disabled={del.isPending} onClick={() => del.mutate(linked)}>{del.isPending ? "Deleting…" : linked ? "Delete all" : "Delete"}</button>
      <button type="button" className="rounded px-2 py-0.5 hover:bg-rose-100" onClick={() => setStep("idle")}>Cancel</button>
      {del.error && !(del.error instanceof ApiError && del.error.status === 409) && <span className="w-full text-rose-700">{errorMessage(del.error)}</span>}
    </span>
  );
}
