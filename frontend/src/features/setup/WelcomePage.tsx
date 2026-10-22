import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { ListInput } from "../../components/ListInput";
import { ErrorBox, Field } from "../../components/ui";

export type SetupStatus = {
  needs_setup: boolean; completed_at: string | null;
  steps: { cv: boolean; targets: boolean; companies: boolean; jobs: boolean };
  counts: { cvs: number; jobs: number; scannable_companies: number };
};
type CV = { id: number; current_version_id: number | null };
type Profile = { full_name?: string | null; total_experience_years?: number | string | null; core_skills?: string[] | null; primary_roles?: string[] | null };
type Prefs = {
  target_titles: string[]; preferred_locations: string[]; required_skills: string[];
  remote_ok: boolean; hybrid_ok: boolean; onsite_ok: boolean;
  min_salary: number | string | null; salary_currency: string | null;
};
type Added = { url: string; name?: string; company_id?: number; created?: boolean; board?: { provider: string; url: string } | null; error?: string };
type Scanner = { running: { id: number } | null; last_run: { status: string; stats: { new?: number; found?: number } } | null; supported_boards?: string[] };

export const STEPS = ["Welcome", "Your CV", "What you want", "Companies", "First jobs"] as const;

const nice = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

/** Full-screen first-run setup: CV → target roles → companies to watch → first scan. */
export function WelcomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const status = useQuery({ queryKey: ["setup"], queryFn: () => api.get<SetupStatus>("/setup") });
  const finish = useMutation({
    mutationFn: () => api.post("/setup/complete"),
    onSuccess: () => { qc.setQueryData(["setup"], (s: SetupStatus | undefined) => s && { ...s, needs_setup: false }); navigate("/"); },
    meta: { success: "You're all set. Welcome to Career Intelligence!" },
  });
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const done = status.data?.steps;
  const doneFlags = [true, !!done?.cv, !!done?.targets, !!done?.companies, !!done?.jobs];

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto flex max-w-3xl flex-col px-4 py-8 sm:py-12">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-bold text-white shadow-sm">CI</span>
            <span className="font-semibold tracking-tight text-slate-900">Career Intelligence</span>
          </div>
          <button className="text-sm text-slate-500 hover:text-slate-800" onClick={() => finish.mutate()} disabled={finish.isPending}>
            Skip setup
          </button>
        </div>
        <ol className="mb-6 flex gap-1.5" aria-label="Setup steps">
          {STEPS.map((label, i) => (
            <li key={label} className="flex-1">
              <button type="button" onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined} className="w-full text-left">
                <span className={`block h-1.5 rounded-full ${i <= step ? "bg-indigo-500" : doneFlags[i] ? "bg-emerald-400" : "bg-slate-200"}`} />
                <span className={`mt-1.5 hidden text-xs sm:block ${i === step ? "font-medium text-indigo-700" : "text-slate-500"}`}>
                  {doneFlags[i] && i > 0 ? "✓ " : ""}{label}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="card p-5 sm:p-8">
          {step === 0 && <Intro onStart={next} />}
          {step === 1 && <CVStep onNext={next} onBack={back} done={!!done?.cv} />}
          {step === 2 && <TargetsStep onNext={next} onBack={back} />}
          {step === 3 && <CompaniesStep onNext={next} onBack={back} />}
          {step === 4 && <JobsStep onBack={back} onFinish={() => finish.mutate()} finishing={finish.isPending} scannable={status.data?.counts.scannable_companies ?? 0} />}
          {finish.error && <div className="mt-3"><ErrorBox error={new Error(errorMessage(finish.error))} /></div>}
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">Everything stays on your computer. You can change any of this later in My profile and Settings.</p>
      </div>
    </div>
  );
}

function Nav({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
      {onBack ? <button type="button" className="btn-secondary" onClick={onBack}>← Back</button> : <span />}
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  const points = [
    ["Every job in one place", "Company job boards, Google Sheets, files and jobs you paste in, without duplicates."],
    ["A clear 0–100 match score", "Each job is scored against your CV and what you want, with the reasons."],
    ["Never miss a step", "Pipeline board, follow-up reminders, interview prep, offers and weekly goals."],
    ["Your data stays yours", "Runs on your computer, with automatic backups. No account, no tracking."],
  ];
  return (
    <div>
      <h1 className="text-2xl">Welcome! Let's set up your job search.</h1>
      <p className="mt-2 text-slate-600">Four quick steps, about five minutes. You can skip any of them.</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {points.map(([t, d]) => (
          <li key={t} className="rounded-lg border border-slate-200 p-4">
            <div className="font-medium text-slate-900">{t}</div>
            <div className="mt-1 text-sm text-slate-500">{d}</div>
          </li>
        ))}
      </ul>
      <Nav><button className="btn-primary" onClick={onStart}>Let's start →</button></Nav>
    </div>
  );
}

function CVStep({ onNext, onBack, done }: { onNext: () => void; onBack: () => void; done: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile>("/profile"), enabled: done });
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("name", file!.name.replace(/\.[^.]+$/, ""));
      const cv = await api.post<CV>("/cvs", fd);
      // Fill the profile from it (the same as "Merge into profile" on the CVs page).
      if (cv.current_version_id) await api.post("/profile/import-cv", { cv_version_id: cv.current_version_id, mode: "merge" });
    },
    onSuccess: () => setFile(null),
  });
  const p = profile.data;
  return (
    <div>
      <h1>Upload your CV</h1>
      <p className="mt-1 text-sm text-slate-600">PDF or Word. We read your experience and skills from it, so every job can be scored for you.</p>
      <label className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-indigo-400 hover:bg-indigo-50/30">
        <span className="text-sm font-medium text-slate-800">{file ? file.name : "Choose your CV file"}</span>
        <span className="text-xs text-slate-500">PDF, DOCX or TXT · up to 10 MB</span>
        <input type="file" className="sr-only" aria-label="CV file" accept=".pdf,.doc,.docx,.txt,.md,.rtf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {upload.error && <div className="mt-3"><ErrorBox error={new Error(errorMessage(upload.error))} /></div>}
      {done && p && (
        <div className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
          <div className="font-medium">✓ CV read{p.full_name ? ` for ${p.full_name}` : ""}</div>
          <div className="mt-1">
            {p.total_experience_years ? `${p.total_experience_years} years of experience` : "Experience not found — add it in My profile"}
            {p.core_skills?.length ? ` · skills: ${p.core_skills.slice(0, 8).join(", ")}${p.core_skills.length > 8 ? "…" : ""}` : ""}
          </div>
        </div>
      )}
      <Nav onBack={onBack}>
        {file ? <button className="btn-primary" disabled={upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? "Reading your CV…" : "Upload and read"}</button>
          : <button className={done ? "btn-primary" : "btn-secondary"} onClick={onNext}>{done ? "Next →" : "Skip for now"}</button>}
      </Nav>
    </div>
  );
}

function TargetsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: () => api.get<Prefs>("/preferences") });
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile>("/profile") });
  const [f, setF] = useState<Prefs | null>(null);
  useEffect(() => {
    if (prefs.data && profile.data && !f) {
      const d = prefs.data;
      setF({ ...d,
        // Suggest the roles and skills read from the CV when nothing is set yet.
        target_titles: d.target_titles.length ? d.target_titles : (profile.data.primary_roles ?? []).slice(0, 5),
        required_skills: d.required_skills.length ? d.required_skills : (profile.data.core_skills ?? []).slice(0, 6) });
    }
  }, [prefs.data, profile.data, f]);
  const save = useMutation({
    mutationFn: (v: Prefs) => api.patch("/preferences", {
      target_titles: v.target_titles, preferred_locations: v.preferred_locations, required_skills: v.required_skills,
      remote_ok: v.remote_ok, hybrid_ok: v.hybrid_ok, onsite_ok: v.onsite_ok,
      min_salary: v.min_salary === "" || v.min_salary === null ? null : Number(v.min_salary),
      salary_currency: v.salary_currency || null,
    }),
    onSuccess: onNext,
  });
  if (prefs.error) return <ErrorBox error={prefs.error} />;
  if (!f) return <p className="text-sm text-slate-500">Loading…</p>;
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setF({ ...f, [k]: v });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(f); }}>
      <h1>What are you looking for?</h1>
      <p className="mt-1 text-sm text-slate-600">Jobs are scored against this. Press Enter after each item.</p>
      <div className="mt-5 space-y-4">
        <Field label="Job titles you want" hint="e.g. Backend Engineer, Engineering Manager">
          <ListInput label="Job titles" value={f.target_titles} onChange={(v) => set("target_titles", v)} placeholder="Type a title and press Enter" />
        </Field>
        <Field label="Must-have skills" hint="The skills a job should ask for">
          <ListInput label="Skills" value={f.required_skills} onChange={(v) => set("required_skills", v)} placeholder="e.g. Python, React" />
        </Field>
        <Field label="Locations" hint="Cities or countries you'd work in">
          <ListInput label="Locations" value={f.preferred_locations} onChange={(v) => set("preferred_locations", v)} placeholder="e.g. Bengaluru, London" />
        </Field>
        <fieldset>
          <legend className="label">Ways of working</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {(["remote_ok", "hybrid_ok", "onsite_ok"] as const).map((k) => (
              <label key={k} className="inline-flex items-center gap-2">
                <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />{({ remote_ok: "Remote", hybrid_ok: "Hybrid", onsite_ok: "On-site" })[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label="Lowest yearly salary you'd accept (optional)">
            <input className="input" inputMode="numeric" value={f.min_salary ?? ""} onChange={(e) => set("min_salary", e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          <Field label="Currency">
            <input className="input uppercase" maxLength={3} value={f.salary_currency ?? ""} placeholder="INR" onChange={(e) => set("salary_currency", e.target.value.toUpperCase())} />
          </Field>
        </div>
      </div>
      {save.error && <div className="mt-3"><ErrorBox error={new Error(errorMessage(save.error))} /></div>}
      <Nav onBack={onBack}>
        <button type="button" className="btn-secondary" onClick={onNext}>Skip</button>
        <button type="submit" className="btn-primary" disabled={save.isPending}>Save and continue →</button>
      </Nav>
    </form>
  );
}

/** "Acme | https://…" or just the URL, one per line. */
export function parseCompanyLines(text: string): { url: string; name?: string }[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [a, b] = line.split("|").map((s) => s.trim());
    return b ? { name: a, url: b } : { url: a };
  });
}

function CompaniesStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<Added[]>([]);
  const scanner = useQuery({ queryKey: ["scanner"], queryFn: () => api.get<Scanner>("/scanner/status") });
  const add = useMutation({
    mutationFn: () => api.post<Added[]>("/setup/companies", { companies: parseCompanyLines(text) }),
    onSuccess: (r) => { setResults((old) => [...r, ...old]); setText(""); },
  });
  const boards = scanner.data?.supported_boards?.map(nice).join(", ");
  return (
    <div>
      <h1>Which companies should we watch?</h1>
      <p className="mt-1 text-sm text-slate-600">
        Paste the careers page or job board link of companies you'd like to work for, one per line.
        We check their openings for you{boards ? ` on ${boards}` : ""}.
      </p>
      <Field label="Careers pages or job boards" hint="Optional name first: Acme | https://boards.greenhouse.io/acme">
        <textarea className="input mt-1 min-h-32 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"https://boards.greenhouse.io/yourcompany\nhttps://jobs.lever.co/anothercompany\nAcme | https://careers.acme.com"} />
      </Field>
      <div className="mt-2"><button className="btn-secondary" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}>{add.isPending ? "Checking…" : "Add companies"}</button></div>
      {add.error && <div className="mt-3"><ErrorBox error={new Error(errorMessage(add.error))} /></div>}
      {!!results.length && (
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm" aria-label="Companies added">
          {results.map((r, i) => (
            <li key={`${r.url}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
              {r.error ? <><span className="text-rose-600">✕</span><span className="min-w-0 flex-1 truncate">{r.url}</span><span className="text-xs text-rose-700">{r.error}</span></>
                : <><span className={r.board ? "text-emerald-600" : "text-amber-600"}>{r.board ? "✓" : "!"}</span>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-slate-500">{r.board ? `${nice(r.board.provider)} — jobs will be checked` : "saved; we can't read this site's jobs yet (Settings → Job board search → Find job boards can look for one)"}</span></>}
            </li>
          ))}
        </ul>
      )}
      <Nav onBack={onBack}>
        <button className={results.some((r) => r.board) ? "btn-primary" : "btn-secondary"} onClick={onNext}>
          {results.some((r) => r.board) ? "Next →" : "Skip for now"}
        </button>
      </Nav>
    </div>
  );
}

function JobsStep({ onBack, onFinish, finishing, scannable }: { onBack: () => void; onFinish: () => void; finishing: boolean; scannable: number }) {
  const [started, setStarted] = useState(false);
  const scanner = useQuery({
    queryKey: ["scanner"], queryFn: () => api.get<Scanner>("/scanner/status"),
    refetchInterval: (q) => (started && q.state.data?.running ? 3000 : false),
  });
  const scan = useMutation({ mutationFn: () => api.post("/scanner/run", {}), onSuccess: () => setStarted(true) });
  const running = started && !!scanner.data?.running;
  const result = started && !running ? scanner.data?.last_run : null;
  return (
    <div>
      <h1>Get your first jobs</h1>
      <p className="mt-1 text-sm text-slate-600">Pick any way to start. New jobs are scored and waiting for you on Today.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="font-medium text-slate-900">Search job boards</div>
          <div className="mt-1 text-xs text-slate-500">{scannable ? `${scannable} compan${scannable === 1 ? "y" : "ies"} ready · 1–3 minutes` : "Add companies in the previous step first"}</div>
          <button className="btn-primary mt-3 w-full" disabled={!scannable || running || scan.isPending} onClick={() => scan.mutate()}>
            {running ? "Searching…" : started ? "Search again" : "Search now"}
          </button>
          {running && <div className="mt-2 flex items-center gap-2 text-xs text-slate-500" role="status"><span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />Looking for jobs…</div>}
          {result && <div className="mt-2 text-xs text-emerald-700" role="status">Done: {result.stats.new ?? 0} new jobs added.</div>}
        </div>
        <Link to="/jobs/new" className="rounded-lg border border-slate-200 p-4 hover:border-indigo-300 hover:bg-indigo-50/30">
          <div className="font-medium text-slate-900">Add a job by hand</div>
          <div className="mt-1 text-xs text-slate-500">Paste a job link and description (LinkedIn, Naukri, any site).</div>
        </Link>
        <Link to="/settings/data" className="rounded-lg border border-slate-200 p-4 hover:border-indigo-300 hover:bg-indigo-50/30">
          <div className="font-medium text-slate-900">Import a file or sheet</div>
          <div className="mt-1 text-xs text-slate-500">A CSV/JSON list of jobs, or a Google Sheet you already keep.</div>
        </Link>
      </div>
      {scan.error && <div className="mt-3"><ErrorBox error={new Error(errorMessage(scan.error))} /></div>}
      <Nav onBack={onBack}>
        <button className="btn-primary" disabled={finishing} onClick={onFinish}>Finish and open my dashboard →</button>
      </Nav>
    </div>
  );
}
