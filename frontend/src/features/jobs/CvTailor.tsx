import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api/client";
import { Badge, ErrorBox, scoreTone } from "../../components/ui";

type Status = "found" | "implied" | "related" | "missing";
type Keyword = { skill: string; importance: "required" | "preferred"; status: Status; via: string | null };
export type AtsReport = {
  score: number;
  parts: Record<string, { earned: number; max: number }>;
  keywords: Keyword[];
  title: string | null;
  title_words_missing: string[];
  experience_required: number | null;
  experience_found: number | null;
  notes: string[];
};
type CheckOut = { format: string; can_edit: boolean; builds_copy?: boolean; report: AtsReport; suggested: string[] };
type TailorOut = {
  before: AtsReport; after: AtsReport; added: string[]; not_added: string[]; reordered_lines: number;
  headline: string | null; notes: string[]; filename: string; content_base64: string;
};

const PART_LABEL: Record<string, string> = {
  required: "Required skills", preferred: "Nice-to-have skills", title: "Job title", experience: "Experience",
};

function hint(k: Keyword): string {
  if (k.status === "found") return "In your CV";
  if (k.status === "implied") return `You have ${k.via}: adds the job's own word`;
  if (k.status === "related") return `You have ${k.via}, a related skill. Tick only if you've also used ${k.skill}`;
  return "Not in your CV. Tick only if you really have it";
}

function download(out: TailorOut) {
  const bytes = Uint8Array.from(atob(out.content_base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }));
  const a = document.createElement("a");
  a.href = url;
  a.download = out.filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Upload a CV, see its ATS score for this job, and get a DOCX copy in the same format with the
 * skills you confirm added. The CV stays in this page's memory: nothing is saved. */
export function CvTailor({ jobId }: { jobId: number }) {
  const [file, setFile] = useState<File | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [useTitle, setUseTitle] = useState(false);

  const build = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("file", file as File);
      ticked.forEach((s) => form.append("add", s));
      form.append("use_title", String(useTitle));
      return api.post<TailorOut>(`/jobs/${jobId}/cv-tailor`, form);
    },
    onSuccess: download,
  });
  const check = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append("file", f);
      return api.post<CheckOut>(`/jobs/${jobId}/cv-check`, form);
    },
    onSuccess: (out) => { setTicked(new Set(out.suggested)); build.reset(); },
  });

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    check.mutate(f);
  };
  const toggle = (skill: string) => setTicked((old) => {
    const next = new Set(old);
    if (next.has(skill)) next.delete(skill); else next.add(skill);
    return next;
  });

  const report = check.data?.report;
  const open = report?.keywords.filter((k) => k.status !== "found") ?? [];
  const found = report?.keywords.filter((k) => k.status === "found") ?? [];
  const done = build.data;
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label">Your CV (DOCX, PDF or TXT)</span>
        <input type="file" className="input" accept=".docx,.pdf,.txt,.md"
          onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {check.isPending && <p className="text-sm text-slate-500">Checking your CV against this job…</p>}
      {check.error && <ErrorBox error={new Error(errorMessage(check.error))} />}

      {report && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3" aria-label="ATS check">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">ATS score for this job</span>
            <Badge tone={scoreTone(report.score)}>{report.score} / 100</Badge>
            <span className="text-xs text-slate-500">
              {Object.entries(report.parts).map(([k, p]) => `${PART_LABEL[k] ?? k} ${p.earned}/${p.max}`).join(" · ")}
            </span>
          </div>
          {report.title_words_missing.length > 0 && (
            <p className="text-xs text-slate-600">Job title words not in your CV: {report.title_words_missing.join(", ")}</p>
          )}
          {report.experience_required !== null && (
            <p className="text-xs text-slate-600">
              Experience: the job asks for {report.experience_required}+ years; your CV says{" "}
              {report.experience_found ?? "nothing an ATS can read"}{report.experience_found !== null && " years"}.
            </p>
          )}
          {report.notes.map((n) => <p key={n} className="text-xs text-amber-700">{n}</p>)}

          {found.length > 0 && (
            <p className="text-xs text-slate-600">
              <span className="font-medium text-emerald-700">In your CV:</span> {found.map((k) => k.skill).join(", ")}
            </p>
          )}
          {open.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Add to your CV? Only tick skills you really have</legend>
              {open.map((k) => (
                <label key={k.skill} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={ticked.has(k.skill)}
                    disabled={!check.data?.can_edit} onChange={() => toggle(k.skill)} />
                  <span>
                    <span className="font-medium">{k.skill}</span>
                    {k.importance === "required" && <span className="ml-1 text-xs text-rose-600">required</span>}
                    <span className="block text-xs text-slate-500">{hint(k)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {check.data?.can_edit ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useTitle} onChange={(e) => setUseTitle(e.target.checked)} />
                Put the job title “{report.title}” in front of my headline (only if it describes you)
              </label>
              {check.data.builds_copy && (
                <p className="text-xs text-slate-600">
                  From a {check.data.format.toUpperCase()}, you get a Word copy: the same text in a plain layout (your PDF's
                  design isn't copied). Check it before sending.
                </p>
              )}
              <button type="button" className="btn-primary" disabled={build.isPending} onClick={() => build.mutate()}>
                {build.isPending ? "Updating your CV…" : check.data.builds_copy ? "Create tailored Word copy (DOCX)" : "Create tailored CV (DOCX)"}
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-600">
              A {check.data?.format.toUpperCase()} can't be edited without changing its layout. Upload the Word (DOCX)
              version of this CV to get an updated copy in the same format.
            </p>
          )}
          {build.error && <ErrorBox error={new Error(errorMessage(build.error))} />}
          {done && (
            <div className="space-y-1 rounded-md bg-emerald-50 p-2 text-sm text-emerald-900" aria-live="polite">
              <p>
                Score {done.before.score} → <strong>{done.after.score}</strong>. Downloaded {done.filename}.{" "}
                <button type="button" className="underline" onClick={() => download(done)}>Download again</button>
              </p>
              {done.added.length > 0 && <p>Added: {done.added.join(", ")}</p>}
              {done.reordered_lines > 0 && <p>The job's skills now come first in {done.reordered_lines} skill line(s).</p>}
              {done.headline && <p>Headline: {done.headline}</p>}
              {done.notes.map((n) => <p key={n} className="text-amber-800">{n}</p>)}
              {done.after.keywords.some((k) => k.status !== "found") && (
                <p className="text-xs">
                  Still not in your CV: {done.after.keywords.filter((k) => k.status !== "found").map((k) => k.skill).join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
