import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

/** The jobs on the list page the user last looked at, in its order (this browser tab only). */
const LIST_KEY = "jobs.list.v1";
/** That list page's address (tab, filters, page), to return to after closing a job. */
const LIST_URL_KEY = "jobs.listUrl.v1";

export function rememberJobList(ids: number[], url?: string) {
  try {
    sessionStorage.setItem(LIST_KEY, JSON.stringify(ids));
    if (url) sessionStorage.setItem(LIST_URL_KEY, url);
  } catch { /* storage off: no prev/next */ }
}

/** The list page the user last looked at, or the Jobs page. */
export function lastJobListUrl(): string {
  try {
    const url = sessionStorage.getItem(LIST_URL_KEY);
    if (url?.startsWith("/jobs")) return url;
  } catch { /* storage off */ }
  return "/jobs";
}

function lastList(): number[] {
  try {
    const ids = JSON.parse(sessionStorage.getItem(LIST_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((x): x is number => typeof x === "number") : [];
  } catch { return []; }
}

/** Where this job sits in the last list, and its neighbours. */
export function jobNeighbours(id: number) {
  const ids = lastList();
  const at = ids.indexOf(id);
  if (at < 0) return null;
  return { prev: at > 0 ? ids[at - 1] : null, next: at < ids.length - 1 ? ids[at + 1] : null, position: at + 1, total: ids.length };
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** ← → through the list you came from; J / K keys do the same. */
export function JobPager({ id }: { id: number }) {
  const navigate = useNavigate();
  const n = jobNeighbours(id);
  const prev = n?.prev, next = n?.next;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const to = e.key === "j" ? next : e.key === "k" ? prev : null;
      if (to) { e.preventDefault(); navigate(`/jobs/${to}`); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, navigate]);
  if (!n) return null;
  const btn = "btn-secondary px-2 py-1 text-xs";
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500" aria-label="Move through the list">
      {n.prev ? <Link className={btn} to={`/jobs/${n.prev}`} aria-label="Previous job" title="Previous job (K)">←</Link>
        : <span className={`${btn} opacity-40`} aria-hidden>←</span>}
      <span className="tabular-nums" title="Position in the list you came from">{n.position}/{n.total}</span>
      {n.next ? <Link className={btn} to={`/jobs/${n.next}`} aria-label="Next job" title="Next job (J)">→</Link>
        : <span className={`${btn} opacity-40`} aria-hidden>→</span>}
    </span>
  );
}
