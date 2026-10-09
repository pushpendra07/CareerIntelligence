import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { CVAdvice } from "./CVAdvice";
import { Badge, Card, Chips, Empty, ErrorBox, Field, Spinner, PageIntro } from "../../components/ui";
import type { CV, Page } from "../../types/api";
import { formatDate } from "../../utils/format";

export const ACCEPT = ".pdf,.docx,.txt,.md";

export function CVsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["cvs", "all"], queryFn: () => api.get<Page<CV>>("/cvs", { include_archived: true }) });
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("name", name || file!.name);
      if (role) fd.append("target_role", role);
      return api.post<CV>("/cvs", fd);
    },
    onSuccess: () => { setFile(null); setName(""); setRole(""); qc.invalidateQueries(); },
  });
  return (
    <div className="space-y-4">
      <div><h1>CVs</h1><PageIntro>Upload your CV (PDF or Word). It fills your profile, and for every job the best-matching CV is suggested. Below, <b>Improve your CV</b> shows which skills to add, based on your jobs.</PageIntro></div>
      <Card title="Upload a CV">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="File (PDF, DOCX, TXT, Markdown)"><input className="input" type="file" accept={ACCEPT} aria-label="CV file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <Field label="Name"><input className="input" placeholder="e.g. Tech Lead – Magento" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Target role"><input className="input" value={role} onChange={(e) => setRole(e.target.value)} /></Field>
          <div className="flex items-end"><button className="btn-primary" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? "Parsing…" : "Upload & parse"}</button></div>
        </div>
        {upload.error && <div className="mt-2"><ErrorBox error={new Error(errorMessage(upload.error))} /></div>}
        <p className="mt-2 text-xs text-slate-500">Originals are stored unchanged and never deleted. Uploading a new version of an existing CV is done from its page.</p>
      </Card>
      {list.isLoading && <Spinner />}
      {list.data && (!list.data.items.length ? <Empty>No CVs yet.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data.items.map((cv) => (
            <Card key={cv.id} title={<Link className="hover:text-indigo-700" to={`/cvs/${cv.id}`}>{cv.name}</Link>}
              actions={<>{cv.is_active && <Badge tone="green">active</Badge>}{cv.is_archived && <Badge>archived</Badge>}</>}>
              <p className="text-sm text-slate-600">{cv.target_role ?? "No target role"} · {cv.versions.length} version(s) · {cv.total_experience_years ?? "?"} yrs · updated {formatDate(cv.versions.at(-1)?.created_at)}</p>
              <div className="mt-2"><Chips items={cv.top_skills} tone="indigo" /></div>
            </Card>
          ))}
        </div>
      ))}
      <CVAdvice />
    </div>
  );
}
