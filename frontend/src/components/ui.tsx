import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { humanize } from "../utils/format";

export function Card({ title, actions, children, className = "" }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h2>{title}</h2> : <span />}
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** One plain-language line under a page title: what this page is for. */
export function PageIntro({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{children}</p>;
}

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  gray: "bg-slate-100 text-slate-600 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

export function Badge({ children, tone = "gray", title }: { children: ReactNode; tone?: keyof typeof TONES; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  VERIFIED: "green", PARTIALLY_VERIFIED: "blue", RESEARCHED: "indigo", DISCOVERED: "gray",
  NEEDS_REVIEW: "amber", STALE: "amber", INVALID: "red", REJECTED: "red",
  APPLIED: "indigo", SHORTLISTED: "blue", READY_TO_APPLY: "blue", INTERVIEW: "green",
  SCREENING: "blue", OFFER: "green", ACCEPTED: "green", NOT_RELEVANT: "gray", CLOSED: "gray",
  WITHDRAWN: "gray", RECEIVED: "blue", NEGOTIATING: "amber", DECLINED: "gray", EXPIRED: "gray",
  SCHEDULED: "blue", RESCHEDULED: "amber", COMPLETED: "green", CANCELLED: "gray",
  PASSED: "green", FAILED: "red", PENDING: "gray", HIRING: "green",
  TIER_A: "green", TIER_B: "blue", TIER_C: "gray",
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return <Badge tone={STATUS_TONE[value] ?? "gray"}>{humanize(value)}</Badge>;
}

/** One distinct color per job status, so the pipeline stage is readable at a glance. */
export const JOB_STATUS_STYLE: Record<string, { badge: string; dot: string }> = {
  DISCOVERED: { badge: "bg-slate-100 text-slate-700 ring-slate-300", dot: "bg-slate-400" },
  NEW: { badge: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500" },
  REVIEWING: { badge: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500" },
  SHORTLISTED: { badge: "bg-indigo-50 text-indigo-700 ring-indigo-200", dot: "bg-indigo-500" },
  READY_TO_APPLY: { badge: "bg-cyan-50 text-cyan-800 ring-cyan-200", dot: "bg-cyan-500" },
  APPLIED: { badge: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-600" },
  RECRUITER_CONTACTED: { badge: "bg-teal-50 text-teal-700 ring-teal-200", dot: "bg-teal-500" },
  SCREENING: { badge: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  INTERVIEW: { badge: "bg-orange-50 text-orange-700 ring-orange-200", dot: "bg-orange-500" },
  OFFER: { badge: "bg-lime-50 text-lime-800 ring-lime-300", dot: "bg-lime-500" },
  ACCEPTED: { badge: "bg-emerald-100 text-emerald-800 ring-emerald-300", dot: "bg-emerald-600" },
  REJECTED: { badge: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
  WITHDRAWN: { badge: "bg-stone-100 text-stone-600 ring-stone-300", dot: "bg-stone-400" },
  ON_HOLD: { badge: "bg-yellow-50 text-yellow-800 ring-yellow-300", dot: "bg-yellow-500" },
  CLOSED: { badge: "bg-zinc-200 text-zinc-700 ring-zinc-300", dot: "bg-zinc-600" },
  NOT_RELEVANT: { badge: "bg-neutral-100 text-neutral-500 ring-neutral-200", dot: "bg-neutral-300" },
};

export function JobStatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const style = JOB_STATUS_STYLE[value] ?? JOB_STATUS_STYLE.DISCOVERED;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.badge}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {humanize(value)}
    </span>
  );
}

export function scoreTone(score: number | null | undefined): keyof typeof TONES {
  if (score === null || score === undefined) return "gray";
  if (score >= 90) return "green";
  if (score >= 80) return "blue";
  if (score >= 70) return "indigo";
  if (score >= 60) return "amber";
  return "red";
}

export function ScoreBadge({ score, stale }: { score: number | null; stale?: boolean }) {
  if (score === null) return <Badge>Not scored</Badge>;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={scoreTone(score)}>{score}</Badge>
      {stale && <Badge tone="amber" title="Profile or preferences changed since this score">stale</Badge>}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <div className="py-6 text-center text-sm text-slate-500" role="status">{label}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
      {error && <span className="mt-0.5 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

/** Rows per page on every paginated list. */
export const PAGE_SIZE = 20;

export function Pagination({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>{total.toLocaleString()} results</span>
      <div className="flex items-center gap-2">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className="btn-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Chips({ items, tone = "gray", empty = "—" }: { items: string[]; tone?: keyof typeof TONES; empty?: string }) {
  if (!items.length) return <span className="text-sm text-slate-400">{empty}</span>;
  return <div className="flex flex-wrap gap-1">{items.map((i) => <Badge key={i} tone={tone}>{i}</Badge>)}</div>;
}

export function Stat({ label, value, tone = "text-slate-900", to }: { label: string; value: ReactNode; tone?: string; to?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
    </>
  );
  if (!to) return <div className="card p-3">{body}</div>;
  return (
    <Link to={to} aria-label={`${label}: view results`}
      className="card block p-3 transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500">
      {body}
    </Link>
  );
}

/** Goes back in history, or to a fallback page when opened directly (no history). */
export function BackButton({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const navigate = useNavigate();
  // The first page of a visit has key "default": there is nothing in-app to go back to.
  const hasHistory = useLocation().key !== "default";
  return (
    <button type="button" className="btn-secondary mb-2"
      onClick={() => (hasHistory ? navigate(-1) : navigate(fallback))}>
      ← {label}
    </button>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-x-6 gap-y-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-sm">
          <dt className="w-32 shrink-0 text-slate-500">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
