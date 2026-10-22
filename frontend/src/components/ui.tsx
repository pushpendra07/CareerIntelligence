import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { formatDate, humanize, timeSince } from "../utils/format";
import { prefs } from "../utils/storage";
import { Icon } from "./icons";

export function Card({ title, actions, children, className = "", id }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={`card ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="min-w-0">{title}</h2> : <span />}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  VERIFIED: "green", PARTIALLY_VERIFIED: "blue", RESEARCHED: "indigo", DISCOVERED: "gray",
  NEEDS_REVIEW: "amber", STALE: "amber", INVALID: "red", REJECTED: "red",
  APPLIED: "indigo", SHORTLISTED: "blue", READY_TO_APPLY: "blue", INTERVIEW: "green",
  AWAITING_FEEDBACK: "amber", SCREENING: "blue", OFFER: "green", ACCEPTED: "green", NOT_RELEVANT: "gray", CLOSED: "gray",
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
  AWAITING_FEEDBACK: { badge: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200", dot: "bg-fuchsia-500" },
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

/** What each job status means for you: the next thing to do, in a few words. */
export const JOB_STATUS_NEXT: Record<string, string> = {
  DISCOVERED: "not reviewed yet", NEW: "not reviewed yet", REVIEWING: "decide: shortlist or drop",
  SHORTLISTED: "apply next", READY_TO_APPLY: "apply next", ON_HOLD: "paused",
  APPLIED: "waiting for a reply", RECRUITER_CONTACTED: "reply to the recruiter", SCREENING: "screening in progress",
  INTERVIEW: "prepare for the interview", AWAITING_FEEDBACK: "waiting for feedback", OFFER: "decide on the offer",
  ACCEPTED: "offer accepted", REJECTED: "ended", WITHDRAWN: "you withdrew",
  NOT_RELEVANT: "hidden from open lists", CLOSED: "posting no longer open",
};

/** The current status, unmistakably: the status pill, then what it means and how long it's been so. */
export function JobStatusSummary({ status, since }: { status: string; since?: string | null }) {
  const ago = timeSince(since);
  return (
    <div className="min-w-0">
      <JobStatusBadge value={status} />
      <div className="mt-0.5 text-xs text-slate-500" title={since ? `Status set ${formatDate(since)}` : undefined}>
        {JOB_STATUS_NEXT[status] ?? ""}{ago && <> · <span className="tabular-nums">{ago === "today" ? "since today" : ago}</span></>}
      </div>
    </div>
  );
}

/** How a job came into the app (the "Added via" tag). */
export const ADDED_VIA: Record<string, { label: string; cls: string }> = {
  manual: { label: "Manual", cls: "bg-slate-100 text-slate-700 ring-slate-300" },
  sheet: { label: "Google Sheet", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  scanner: { label: "Job board search", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  career_ops: { label: "Career-Ops", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  file: { label: "File import", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  ai_search: { label: "AI search", cls: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
};

export function AddedViaTags({ values }: { values?: string[] | null }) {
  if (!values?.length) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {values.map((v) => {
        const t = ADDED_VIA[v] ?? { label: humanize(v), cls: "bg-slate-100 text-slate-600 ring-slate-200" };
        return <span key={v} title={`Added via ${t.label}`} className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${t.cls}`}>{t.label}</span>;
      })}
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
      {stale && <Badge tone="amber" title="Profile or preferences changed since this score; it updates by itself shortly">updating</Badge>}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500" role="status">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />{label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
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
export const PAGE_SIZE = 10;

/** Page numbers to show around the current one: 1 … 4 5 [6] 7 8 … 45 */
export function pageRange(page: number, pages: number, around = 2): (number | "…")[] {
  const shown = (p: number) => p === 1 || p === pages || Math.abs(p - page) <= around;
  const out: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    // A "…" that would hide a single page shows that page instead.
    if (shown(p) || (shown(p - 1) && shown(p + 1))) out.push(p);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

export const PAGE_SIZES = [10, 25, 50, 100];

/** Rows per page for one list, remembered in this browser. */
export function usePageSize(key: string, fallback = 25): [number, (n: number) => void] {
  const [size, setSize] = useState(() => {
    const saved = Number(prefs.get(key));
    return PAGE_SIZES.includes(saved) ? saved : fallback;
  });
  return [size, (n: number) => { setSize(n); prefs.set(key, String(n)); }];
}

type PaginationProps = {
  page: number; size: number; total: number; onPage: (p: number) => void;
  /** Show a rows-per-page menu. */
  onSize?: (n: number) => void;
  /** "top": a compact bar above the list; "bottom" (default): the full control. */
  position?: "top" | "bottom";
  /** Id of the element to scroll back to after changing page. */
  scrollTo?: string;
  noun?: string;
};

export function Pagination({ page, size, total, onPage, onSize, position = "bottom", scrollTo, noun = "results" }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / size));
  const [jump, setJump] = useState("");
  const go = (p: number) => {
    const next = Math.min(Math.max(1, p), pages);
    if (next !== page) onPage(next);
    if (scrollTo) document.getElementById(scrollTo)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(page * size, total);
  const showing = <span className="tabular-nums">Showing <b>{from.toLocaleString()}–{to.toLocaleString()}</b> of <b>{total.toLocaleString()}</b> {noun}</span>;
  const btn = "btn-secondary min-w-8 px-2 py-1 text-xs disabled:opacity-40";
  const arrows = (
    <>
      <button className={btn} disabled={page <= 1} onClick={() => go(1)} aria-label="First page" title="First page">«</button>
      <button className={btn} disabled={page <= 1} onClick={() => go(page - 1)} aria-label="Previous page" title="Previous page">‹</button>
    </>
  );
  const arrowsEnd = (
    <>
      <button className={btn} disabled={page >= pages} onClick={() => go(page + 1)} aria-label="Next page" title="Next page">›</button>
      <button className={btn} disabled={page >= pages} onClick={() => go(pages)} aria-label="Last page" title="Last page">»</button>
    </>
  );
  if (position === "top") {
    return (
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        {showing}
        {pages > 1 && (
          <nav className="flex items-center gap-1" aria-label="Pages (top)">
            <button className={btn} disabled={page <= 1} onClick={() => go(page - 1)} aria-label="Previous page (top)">‹</button>
            <span className="tabular-nums text-slate-500">Page {page} of {pages}</span>
            <button className={btn} disabled={page >= pages} onClick={() => go(page + 1)} aria-label="Next page (top)">›</button>
          </nav>
        )}
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
      <div className="flex flex-wrap items-center gap-3">
        {showing}
        {onSize && (
          <label className="flex items-center gap-1 text-xs">
            Rows per page
            <select className="input w-auto py-1 text-xs" aria-label="Rows per page" value={size} onChange={(e) => onSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <nav className="flex items-center gap-1" aria-label="Pages">
            {arrows}
            {pageRange(page, pages).map((p, i) => p === "…"
              ? <span key={`gap${i}`} className="px-1 text-slate-400">…</span>
              : <button key={p} className={p === page ? "btn-primary min-w-8 px-2 py-1 text-xs" : btn} aria-current={p === page ? "page" : undefined}
                  aria-label={`Page ${p}`} onClick={() => go(p)}>{p}</button>)}
            {arrowsEnd}
          </nav>
          {pages > 7 && (
            <form className="ml-2 flex items-center gap-1 text-xs" onSubmit={(e) => { e.preventDefault(); if (Number(jump)) go(Number(jump)); setJump(""); }}>
              Go to
              <input className="input w-16 py-1 text-xs" type="number" min={1} aria-label="Go to page" title={`1–${pages}`} value={jump} onChange={(e) => setJump(e.target.value)} />
              <button type="submit" className="btn-secondary px-2 py-1 text-xs" disabled={!jump}>Go</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export function Chips({ items, tone = "gray", empty = "—" }: { items: string[]; tone?: keyof typeof TONES; empty?: string }) {
  if (!items.length) return <span className="text-sm text-slate-400">{empty}</span>;
  return <div className="flex flex-wrap gap-1">{items.map((i) => <Badge key={i} tone={tone}>{i}</Badge>)}</div>;
}

/** Icon chip colours: a soft tint and a strong icon colour per accent. */
export const ACCENTS = {
  indigo: "bg-indigo-50 text-indigo-600 ring-indigo-100",
  violet: "bg-violet-50 text-violet-600 ring-violet-100",
  sky: "bg-sky-50 text-sky-600 ring-sky-100",
  emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  amber: "bg-amber-50 text-amber-600 ring-amber-100",
  rose: "bg-rose-50 text-rose-600 ring-rose-100",
  slate: "bg-slate-100 text-slate-500 ring-slate-200",
} as const;
export type Accent = keyof typeof ACCENTS;

export function IconChip({ icon, accent = "indigo", size = "md" }: { icon: string; accent?: Accent; size?: "sm" | "md" }) {
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${ACCENTS[accent]} ${size === "sm" ? "h-8 w-8" : "h-10 w-10"}`}>
      <Icon name={icon} className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </span>
  );
}

export function Stat({ label, value, tone = "text-slate-900", to, icon, accent = "indigo" }: {
  label: string; value: ReactNode; tone?: string; to?: string; icon?: string; accent?: Accent;
}) {
  const body = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className={`mt-1.5 font-display text-2xl font-bold tabular-nums tracking-tight ${tone}`}>{value}</div>
      </div>
      {icon && <IconChip icon={icon} accent={accent} size="sm" />}
    </div>
  );
  if (!to) return <div className="card p-4">{body}</div>;
  return (
    <Link to={to} aria-label={`${label}: view results`}
      className="card lift block p-4 focus:outline-none focus:ring-2 focus:ring-indigo-500">
      {body}
    </Link>
  );
}

/** "▲ 26 vs last week" — the change from the week before, green when up, red when down. */
export function WeekChange({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined) return null;
  const diff = now - before;
  return (
    <span className={`mt-0.5 block font-sans text-xs font-medium tracking-normal ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-400"}`}>
      {diff === 0 ? "same as last week" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)} vs last week`}
    </span>
  );
}

/** Goes back in history, or to a fallback page when opened directly (no history). */
export function BackButton({ fallback, label = "Back", className = "mb-2" }: { fallback: string; label?: string; className?: string }) {
  const navigate = useNavigate();
  // The first page of a visit has key "default": there is nothing in-app to go back to.
  const hasHistory = useLocation().key !== "default";
  return (
    <button type="button" className={`btn-secondary ${className}`}
      onClick={() => (hasHistory ? navigate(-1) : navigate(fallback))}>
      ← {label}
    </button>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(17rem,100%),1fr))] gap-x-6 gap-y-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-sm">
          <dt className="w-32 shrink-0 text-slate-500">{k}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Copies a job's portal link to share it anywhere; says "Copied" for a moment. */
export function CopyLinkButton({ url, compact = false, className }: { url: string; compact?: boolean; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () => {
    const done = (s: "copied" | "failed") => { setState(s); window.setTimeout(() => setState("idle"), 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => done("copied"), () => done("failed"));
    else done("failed");
  };
  const label = state === "copied" ? "Copied ✓" : state === "failed" ? "Copy failed" : compact ? "" : "Copy link";
  return (
    <button type="button" className={className ?? (compact ? "btn-secondary px-2 py-1 text-xs" : "btn-secondary")} onClick={copy}
      aria-label="Copy job link" title={state === "failed" ? url : "Copy the job posting link to share it"}>
      {state === "idle" && <Icon name="link" className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />}{label}
    </button>
  );
}
