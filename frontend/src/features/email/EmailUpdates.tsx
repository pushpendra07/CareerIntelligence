import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, Empty, ErrorBox, Field, JobStatusBadge, PageIntro, Spinner } from "../../components/ui";
import { formatDateTime, humanize } from "../../utils/format";
import { JOB_STATUSES } from "../jobs/jobTabs";
import type { Job, Page } from "../../types/api";

type JobRef = { id: number; title: string; status: string; company: string | null };
export type EmailUpdate = {
  id: number; kind: "OFFER" | "REJECTION" | "INTERVIEW" | "ASSESSMENT" | "RECEIVED" | "RECRUITER";
  state: "PENDING" | "DONE" | "DISMISSED"; subject: string; sender_name: string; sender_email: string;
  received_at: string | null; evidence: string; match_reason: string; company: string | null;
  job: JobRef | null; candidates: JobRef[]; suggested_status: string | null; applied_status: string | null;
  open_url: string | null;
};
type LastCheck = { at: string; messages?: number; read?: number; found?: number; to_review?: number; more?: boolean; error: string | null };
type Settings = { auto_check: boolean; every_minutes: number; first_days: number; notify: boolean };
export type EmailAccount = {
  connected: boolean; user: string | null; host: string | null; port: number | null; folder: string | null;
  is_gmail: boolean | null; provider: Provider | null; settings: Settings; last_check: LastCheck | null; checking: boolean; pending: number;
};

type Provider = "gmail" | "yahoo" | "other";

/** Ready-made settings and the steps to get an app password (IMAP refuses the normal one). */
const PROVIDERS: Record<Provider, { label: string; host: string; folder: string; steps: ReactNode[] }> = {
  gmail: {
    label: "Gmail", host: "imap.gmail.com", folder: "INBOX",
    steps: [
      <>In your Google account, turn on <b>2-Step Verification</b>.</>,
      <>Create an <a className="text-indigo-600 hover:underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">app password</a> (any name, e.g. "Career Intelligence").</>,
      <>Paste the 16-letter password below. Your normal Gmail password won't work.</>,
    ],
  },
  yahoo: {
    label: "Yahoo Mail", host: "imap.mail.yahoo.com", folder: "INBOX",
    steps: [
      <>Open Yahoo <a className="text-indigo-600 hover:underline" href="https://login.yahoo.com/account/security" target="_blank" rel="noreferrer">Account security</a>.</>,
      <>Click <b>Generate app password</b> (or <i>Manage app passwords</i>), name it "Career Intelligence" and click <b>Generate</b>.</>,
      <>Paste the 16-letter password below. Your normal Yahoo password won't work.</>,
    ],
  },
  other: {
    label: "Other (IMAP)", host: "", folder: "INBOX",
    steps: [<>Use your provider's IMAP server (SSL, usually port 993) and, if it offers one, an app password.</>],
  },
};

/** The provider an address most likely uses: me@yahoo.co.in → yahoo. */
export function providerFor(address: string): Provider | null {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  if (/^(gmail|googlemail)\.com$/.test(domain)) return "gmail";
  if (/^(yahoo|ymail|rocketmail)\./.test(domain)) return "yahoo";
  return null;
}

const KIND: Record<EmailUpdate["kind"], { label: string; tone: "red" | "green" | "blue" | "amber" | "indigo" | "gray" }> = {
  REJECTION: { label: "Rejection", tone: "red" },
  OFFER: { label: "Offer", tone: "green" },
  INTERVIEW: { label: "Interview invite", tone: "green" },
  ASSESSMENT: { label: "Assessment", tone: "amber" },
  RECEIVED: { label: "Application received", tone: "blue" },
  RECRUITER: { label: "Recruiter wrote", tone: "indigo" },
};

function useCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<LastCheck & { pending: number }>("/email/check"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email"] }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
    meta: { toastError: true },
  });
}

function lastCheckText(c: LastCheck | null | undefined): string {
  if (!c) return "Not checked yet";
  if (c.error) return `Last check ${formatDateTime(c.at)} failed: ${c.error}`;
  const found = c.found ? `${c.found} job email${c.found === 1 ? "" : "s"} found` : "nothing new about your jobs";
  return `Last checked ${formatDateTime(c.at)}: ${c.messages ?? 0} new messages, ${found}${c.more ? " (more next time)" : ""}`;
}

/** Which job an email is about: the suggested ones, or any job found by title, company or #ID. */
function JobPicker({ name, candidates, value, onChange }: { name: string; candidates: JobRef[]; value: number | ""; onChange: (id: number | "") => void }) {
  const [q, setQ] = useState("");
  const term = q.trim();
  const found = useQuery({
    queryKey: ["jobs", "pick", term], enabled: term.length >= 2,
    queryFn: () => api.get<Page<Job>>("/jobs", { q: term, size: 8, sort: "-created_at" }),
  }).data?.items ?? [];
  const options: JobRef[] = [...candidates, ...found
    .filter((j) => !candidates.some((c) => c.id === j.id))
    .map((j) => ({ id: j.id, title: j.title, status: j.status, company: j.company.name }))];
  return (
    <fieldset className="min-w-0 flex-1 rounded-lg border border-slate-200 p-2">
      <legend className="px-1 text-xs text-slate-500">Which job is this email about?</legend>
      {options.length > 0 && (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto" aria-label="Jobs to pick from">
          {options.map((o) => (
            <li key={o.id}>
              <label className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50 ${value === o.id ? "bg-indigo-50" : ""}`}>
                <input type="radio" name={name} checked={value === o.id} onChange={() => onChange(o.id)} />
                <span className="min-w-0 flex-1 truncate"><b className="font-medium">{o.title}</b>
                  <span className="text-slate-500">{o.company ? ` · ${o.company}` : ""} · #{o.id}</span></span>
                <JobStatusBadge value={o.status} />
              </label>
            </li>
          ))}
        </ul>
      )}
      <input className="input mt-1 text-sm" placeholder={candidates.length ? "Not here? Search title, company or #ID" : "Search title, company or #ID"}
        aria-label="Search for the job" value={q} onChange={(e) => setQ(e.target.value)} />
    </fieldset>
  );
}

/** One email and what it means: Confirm (with the suggested or another status), or Dismiss. */
function UpdateRow({ u }: { u: EmailUpdate }) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<number | "">(u.job?.id ?? (u.candidates.length === 1 ? u.candidates[0].id : ""));
  const [status, setStatus] = useState<string>(u.suggested_status ?? "");
  const [changing, setChanging] = useState(false);
  const picking = !u.job || changing;
  const done = () => { qc.invalidateQueries({ queryKey: ["email"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["jobs"] }); };
  const confirm = useMutation({
    mutationFn: () => api.post(`/email/updates/${u.id}/confirm`, { job_id: jobId || undefined, status: status || undefined, change_status: status !== "" }),
    onSuccess: done,
    meta: { success: status ? `Marked ${humanize(status)}` : "Email added to the job", toastError: true },
  });
  const dismiss = useMutation({ mutationFn: () => api.post(`/email/updates/${u.id}/dismiss`), onSuccess: done, meta: { toastError: true } });
  const kind = KIND[u.kind];
  const busy = confirm.isPending || dismiss.isPending;
  const pending = u.state === "PENDING";
  return (
    <li className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={kind.tone}>{kind.label}</Badge>
            <span className="font-semibold text-slate-900">{u.subject || "(no subject)"}</span>
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {u.sender_name ? `${u.sender_name} · ` : ""}{u.sender_email}{u.received_at ? ` · ${formatDateTime(u.received_at)}` : ""}
            {u.open_url && <> · <a className="text-indigo-600 hover:underline" href={u.open_url} target="_blank" rel="noreferrer">Open in Gmail</a></>}
          </div>
        </div>
        {!pending && <Badge tone={u.state === "DONE" ? "green" : "gray"}>{u.state === "DONE" ? (u.applied_status ? `Set to ${humanize(u.applied_status)}` : "No change needed") : "Dismissed"}</Badge>}
      </div>
      {u.evidence && <blockquote className="mt-2 border-l-2 border-slate-200 pl-3 text-sm italic text-slate-600">“{u.evidence}”</blockquote>}
      <div className="mt-2 text-sm">
        {u.job ? (
          <span>Job: <Link className="font-medium text-indigo-700 hover:underline" to={`/jobs/${u.job.id}`}>{u.job.title}</Link>
            {u.job.company ? ` at ${u.job.company}` : ""} <JobStatusBadge value={u.job.status} />
            {pending && !changing && <button type="button" className="ml-2 text-xs text-indigo-600 hover:underline" onClick={() => { setChanging(true); setJobId(""); }}>Wrong job? Change</button>}</span>
        ) : u.company ? <span>Company: <b>{u.company}</b>{u.candidates.length > 1 ? " — pick the job below" : ""}</span>
          : <span className="text-slate-600">No job linked yet</span>}
        <span className="block text-xs text-slate-400">Why: {u.match_reason}</span>
      </div>
      {pending && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {picking && <div className="flex w-full"><JobPicker name={`job-for-${u.id}`} candidates={u.candidates} value={jobId} onChange={setJobId} /></div>}
          <label className="text-xs text-slate-500">Set status to
            <select className="input mt-0.5 block" aria-label="Set status to" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Don't change, just add the email to the job</option>
              {JOB_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}{s === u.suggested_status ? " (suggested)" : ""}</option>)}
            </select>
          </label>
          <button type="button" className="btn-primary" disabled={busy || (picking && !jobId)} onClick={() => confirm.mutate()}>Confirm</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => dismiss.mutate()}>Dismiss</button>
          {!u.job && u.candidates.length === 0 && u.company === null && (
            <Link className="text-xs text-indigo-600 hover:underline" to="/jobs/new">Add this job</Link>
          )}
        </div>
      )}
    </li>
  );
}

/** Follow-ups → Email updates: what your inbox says about your applications. */
export function EmailUpdatesPage() {
  const qc = useQueryClient();
  const [history, setHistory] = useState(false);
  const account = useQuery({ queryKey: ["email", "account"], queryFn: () => api.get<EmailAccount>("/email/account") });
  const pending = useQuery({ queryKey: ["email", "updates", "PENDING"], queryFn: () => api.get<EmailUpdate[]>("/email/updates", { state: "PENDING" }) });
  const done = useQuery({ queryKey: ["email", "updates", "history"], enabled: history,
    queryFn: () => api.get<EmailUpdate[]>("/email/updates", { limit: 50 }) });
  const check = useCheck();
  const confirmAll = useMutation({
    mutationFn: () => api.post<{ confirmed: number }>("/email/updates/confirm-all"),
    onSuccess: (r) => { qc.invalidateQueries(); return r; },
    meta: { success: "Confirmed", toastError: true },
  });
  const a = account.data;
  const items = pending.data ?? [];
  const sure = items.filter((u) => u.job).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Email updates</h1>
          <PageIntro>Rejections, interview invites, assessments and offers found in your inbox. Nothing changes until you Confirm.</PageIntro>
          {a?.connected && <p className="mt-1 text-xs text-slate-500">{a.user} · {a.checking || check.isPending ? "Checking…" : lastCheckText(a.last_check)}</p>}
        </div>
        {a?.connected && (
          <div className="flex flex-wrap gap-2">
            {sure > 1 && <button type="button" className="btn-secondary" disabled={confirmAll.isPending} onClick={() => confirmAll.mutate()}>Confirm all {sure} with a job</button>}
            <button type="button" className="btn-primary" disabled={check.isPending || a.checking} onClick={() => check.mutate()}>{check.isPending ? "Checking…" : "Check now"}</button>
          </div>
        )}
      </div>
      {account.isLoading ? <Spinner /> : a && !a.connected ? (
        <Card title="Connect your email">
          <p className="text-sm text-slate-600">Connect your inbox once and the app finds replies about your applications by itself.</p>
          <Link className="btn-primary mt-3 inline-flex" to="/settings/email">Connect email</Link>
        </Card>
      ) : null}
      {pending.error ? <ErrorBox error={pending.error} /> : pending.isLoading ? <Spinner /> : items.length ? (
        <ul className="space-y-3" aria-label="Email updates to review">{items.map((u) => <UpdateRow key={u.id} u={u} />)}</ul>
      ) : a?.connected ? <Empty>No email updates to review. New ones appear here after each check.</Empty> : null}
      {a?.connected && (
        <div>
          <button type="button" className="text-sm text-indigo-600 hover:underline" onClick={() => setHistory((v) => !v)}>
            {history ? "Hide handled emails" : "Show handled emails"}
          </button>
          {history && (done.isLoading ? <Spinner /> : (
            <ul className="mt-3 space-y-3" aria-label="Handled emails">
              {(done.data ?? []).filter((u) => u.state !== "PENDING").map((u) => <UpdateRow key={u.id} u={u} />)}
            </ul>
          ))}
        </div>
      )}
    </div>
  );
}

/** Settings → Email: connect the inbox (read-only), how often to check. */
export function EmailSettings() {
  const qc = useQueryClient();
  const account = useQuery({ queryKey: ["email", "account"], queryFn: () => api.get<EmailAccount>("/email/account") });
  const [form, setForm] = useState({ user: "", password: "", host: "imap.gmail.com", port: "993", folder: "INBOX" });
  const [provider, setProvider] = useState<Provider>("gmail");
  const [advanced, setAdvanced] = useState(false);
  const pick = (p: Provider) => {
    setProvider(p);
    setForm((f) => ({ ...f, host: PROVIDERS[p].host, folder: PROVIDERS[p].folder }));
    setAdvanced(p === "other");
  };
  const [draft, setDraft] = useState<Settings | null>(null);
  const a = account.data;
  useEffect(() => { if (a) setDraft(a.settings); }, [a]);
  const connect = useMutation({
    mutationFn: () => api.put<EmailAccount>("/email/account", { user: form.user, password: form.password, host: form.host, port: Number(form.port) || 993, folder: form.folder }),
    onSuccess: () => { setForm((f) => ({ ...f, password: "" })); qc.invalidateQueries({ queryKey: ["email"] }); },
    meta: { success: "Email connected" },
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete("/email/account"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email"] }),
    meta: { success: "Email disconnected", toastError: true },
  });
  const save = useMutation({
    mutationFn: (s: Settings) => api.patch("/settings/app", { email: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email"] }),
    meta: { success: "Email settings saved", toastError: true },
  });
  const check = useCheck();
  const [confirming, setConfirming] = useState(false);
  if (account.isLoading || !a) return <Spinner />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const setUser = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, user: e.target.value });
    const guess = providerFor(e.target.value);
    if (guess && guess !== provider) pick(guess);
  };
  return (
    <div className="space-y-4">
      <div><h1>Settings</h1><PageIntro>Read job-search emails from your inbox and turn them into status updates you confirm.</PageIntro></div>
      <Card title="Your email">
        {a.connected ? (
          <div className="space-y-3 text-sm">
            <p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />Connected as <b>{a.user}</b>
              <span className="text-slate-500"> · {a.host}:{a.port} · {a.folder}</span></p>
            <p className="text-xs text-slate-500">{a.checking || check.isPending ? "Checking…" : lastCheckText(a.last_check)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={check.isPending || a.checking} onClick={() => check.mutate()}>Check now</button>
              <Link className="btn-secondary" to="/followups/email">Review {a.pending} update{a.pending === 1 ? "" : "s"}</Link>
              {confirming ? (
                <span className="inline-flex items-center gap-2 text-xs">Forget this account? Updates found so far are kept.
                  <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={() => { setConfirming(false); disconnect.mutate(); }}>Disconnect</button>
                  <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setConfirming(false)}>Cancel</button>
                </span>
              ) : <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>Disconnect</button>}
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); connect.mutate(); }}>
            <div role="radiogroup" aria-label="Email provider" className="flex flex-wrap gap-2">
              {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={provider === p} onClick={() => pick(p)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${provider === p ? "border-indigo-400 bg-indigo-50 font-medium text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  {PROVIDERS[p].label}
                </button>
              ))}
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600" aria-label="How to connect">
              {PROVIDERS[provider].steps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email address"><input className="input" type="email" autoComplete="username" value={form.user} onChange={setUser} required /></Field>
              <Field label="App password"><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required /></Field>
            </div>
            <div><button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => setAdvanced((v) => !v)}>{advanced ? "Hide mail server settings" : "Mail server settings"}</button></div>
            {advanced && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="IMAP server"><input className="input" value={form.host} onChange={set("host")} /></Field>
                <Field label="Port (SSL)"><input className="input" inputMode="numeric" value={form.port} onChange={set("port")} /></Field>
                <Field label="Folder" hint='Usually INBOX. Gmail: "[Gmail]/All Mail" also reads archived mail'><input className="input" value={form.folder} onChange={set("folder")} /></Field>
              </div>
            )}
            {connect.error && <p className="text-sm text-rose-700" role="alert">{errorMessage(connect.error)}</p>}
            <button type="submit" className="btn-primary" disabled={connect.isPending}>{connect.isPending ? "Connecting…" : "Connect"}</button>
          </form>
        )}
        <p className="mt-4 text-xs text-slate-500">Read-only: nothing is marked as read, moved or sent. Only the headers of new messages are read; the text is read only for
          job-search emails, and only the sentence that matters is kept. The password stays on this computer in <code>backend/secrets/</code>, never in the database or backups.</p>
      </Card>
      {draft && (
        <Card title="Checking">
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={draft.auto_check} onChange={(e) => setDraft({ ...draft, auto_check: e.target.checked })} />
              <span><b>Check by itself</b><span className="block text-xs text-slate-500">While the app is running.</span></span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Every (minutes)"><input className="input" type="number" min={5} max={1440} value={draft.every_minutes}
                onChange={(e) => setDraft({ ...draft, every_minutes: Number(e.target.value) })} /></Field>
              <Field label="First check reads the last (days)" hint="Only for the first check; later checks read new mail."><input className="input" type="number" min={1} max={365} value={draft.first_days}
                onChange={(e) => setDraft({ ...draft, first_days: Number(e.target.value) })} /></Field>
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={draft.notify} onChange={(e) => setDraft({ ...draft, notify: e.target.checked })} />
              <span><b>Tell me when something new is found</b><span className="block text-xs text-slate-500">In the bell, and as a desktop notification when that's on in Reminders.</span></span>
            </label>
            <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(draft)}>Save</button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Today: a card when emails are waiting for you. */
export function EmailUpdatesCard({ pending }: { pending: number }) {
  if (!pending) return null;
  return (
    <Link to="/followups/email" className="card block border-indigo-200 p-4 hover:border-indigo-400">
      <div className="text-sm font-semibold text-slate-900">{pending} email update{pending === 1 ? "" : "s"} to review</div>
      <p className="mt-0.5 text-xs text-slate-500">Replies about your applications: confirm the new statuses in one click.</p>
    </Link>
  );
}

/** Job page: emails about this job. */
export function JobEmails({ jobId }: { jobId: number }) {
  const updates = useQuery({ queryKey: ["email", "updates", "job", jobId], queryFn: () => api.get<EmailUpdate[]>("/email/updates", { job_id: jobId, limit: 20 }) });
  if (!updates.data?.length) return null;
  return (
    <Card title="Emails">
      <ul className="space-y-2 text-sm">
        {updates.data.map((u) => (
          <li key={u.id}>
            <div className="flex flex-wrap items-center gap-2"><Badge tone={KIND[u.kind].tone}>{KIND[u.kind].label}</Badge>
              <span className="font-medium">{u.subject}</span>
              {u.state === "PENDING" && <Link className="text-xs text-indigo-600 hover:underline" to="/followups/email">Review</Link>}</div>
            <div className="text-xs text-slate-500">{u.sender_name || u.sender_email}{u.received_at ? ` · ${formatDateTime(u.received_at)}` : ""}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
