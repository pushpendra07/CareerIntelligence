import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { GlobalSearch } from "../components/GlobalSearch";

type Tab = { to: string; label: string };
type Section = { to: string; label: string; hint: string; tabs: Tab[]; badge?: (s: Record<string, number>) => number | undefined };

/**
 * The menu has one entry per thing you do; related pages are tabs inside a section
 * (shown above the page), so the sidebar stays short.
 */
export const SECTIONS: Section[] = [
  { to: "/", label: "Today", hint: "What to do today, and how your search is going",
    tabs: [{ to: "/", label: "Today" }, { to: "/analytics", label: "Insights" }] },
  { to: "/jobs", label: "Jobs", hint: "Review new jobs, browse every job, companies you track",
    tabs: [{ to: "/jobs/review", label: "Review new" }, { to: "/jobs", label: "All jobs" }, { to: "/companies", label: "Companies" }],
    badge: (s) => s.new_jobs },
  { to: "/applications", label: "Pipeline", hint: "Applications, interviews, offers and recruiters",
    tabs: [{ to: "/applications", label: "Applications" }, { to: "/interviews", label: "Interviews" },
      { to: "/offers", label: "Offers" }, { to: "/recruiters", label: "Recruiters" }] },
  { to: "/followups", label: "Follow-ups", hint: "Who to chase and when", tabs: [{ to: "/followups", label: "Follow-ups" }],
    badge: (s) => s.due_followups },
  { to: "/profile", label: "My profile", hint: "Your experience, what you want, CVs and interview answers",
    tabs: [{ to: "/profile", label: "Profile" }, { to: "/preferences", label: "Target roles" },
      { to: "/cvs", label: "CVs" }, { to: "/questions", label: "Question bank" }] },
  { to: "/settings", label: "Settings", hint: "Job scanner, Google Sheets, Career-Ops, scoring, imports",
    tabs: [{ to: "/settings", label: "Settings" }] },
];

const matches = (path: string, to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`));

/** The section and tab for a path: the longest matching tab wins (/jobs/review over /jobs). */
export function locate(path: string): { section: Section | undefined; tab: Tab | undefined } {
  let best: { section: Section; tab: Tab } | undefined;
  for (const section of SECTIONS) {
    for (const tab of section.tabs) {
      if (matches(path, tab.to) && (!best || tab.to.length > best.tab.to.length)) best = { section, tab };
    }
  }
  return { section: best?.section, tab: best?.tab };
}

function SectionTabs({ section, active }: { section: Section; active: Tab | undefined }) {
  if (section.tabs.length < 2) return null;
  return (
    <nav aria-label={`${section.label} pages`} className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {section.tabs.map((t) => {
        const on = t === active;
        return (
          <Link key={t.to} to={t.to} aria-current={on ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${on ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  const { section, tab } = locate(pathname);
  // Counts next to menu entries (new jobs to review, follow-ups due).
  const summary = useQuery({
    queryKey: ["dashboard"], queryFn: () => api.get<{ summary: Record<string, number> }>("/dashboard"),
    refetchInterval: 60_000,
  }).data?.summary;
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-48 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="px-4 pb-2 pt-4">
          <div className="text-sm font-bold tracking-tight text-indigo-700">Career Intelligence</div>
          <div className="text-[11px] text-slate-400">Your job search, in one place</div>
        </div>
        <nav className="space-y-0.5 px-2 pb-4 pt-2" aria-label="Main">
          {SECTIONS.map((s) => {
            const n = summary && s.badge ? s.badge(summary) : undefined;
            const on = s === section;
            return (
              <Link key={s.to} to={s.to} title={s.hint} aria-current={on ? "page" : undefined}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${on ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
                {s.label}
                {!!n && <span className={`rounded-full px-1.5 text-xs ${s.to === "/followups" ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-700"}`}
                  title={s.to === "/followups" ? "Due today or overdue" : "New jobs to review"}>{n}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-slate-200 bg-white/90 px-6 py-2 backdrop-blur">
          {/* Small screens: the sidebar is hidden, so the sections are a row of links. */}
          <nav className="flex gap-3 overflow-x-auto text-sm md:hidden" aria-label="Sections">
            {SECTIONS.map((s) => <Link key={s.to} to={s.to} className={s === section ? "font-medium text-indigo-700" : "text-slate-600"}>{s.label}</Link>)}
          </nav>
          <GlobalSearch />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
          {section && <SectionTabs section={section} active={tab} />}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
