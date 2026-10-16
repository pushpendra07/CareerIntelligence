import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { GlobalSearch } from "../components/GlobalSearch";
import { Icon } from "../components/icons";
import { prefs } from "../utils/storage";
import { useTheme, type Theme } from "../utils/theme";

type Tab = { to: string; label: string };
type Section = { to: string; label: string; icon: string; hint: string; tabs: Tab[]; badge?: (s: Record<string, number>) => number | undefined };

/**
 * The menu has one entry per thing you do; related pages are tabs inside a section
 * (shown above the page), so the sidebar stays short.
 */
export const SECTIONS: Section[] = [
  { to: "/", label: "Today", icon: "today", hint: "What to do today, and how your search is going",
    tabs: [{ to: "/", label: "Today" }, { to: "/analytics", label: "Insights" }] },
  { to: "/jobs", label: "Jobs", icon: "jobs", hint: "Review new jobs, browse every job, companies you track",
    tabs: [{ to: "/jobs/review", label: "Review new" }, { to: "/jobs", label: "All jobs" }, { to: "/companies", label: "Companies" }],
    badge: (s) => s.new_jobs },
  { to: "/applications/board", label: "Pipeline", icon: "pipeline", hint: "Board of applications by stage, interviews, offers and recruiters",
    tabs: [{ to: "/applications/board", label: "Board" }, { to: "/applications", label: "Applications" }, { to: "/interviews", label: "Interviews" },
      { to: "/offers", label: "Offers" }, { to: "/recruiters", label: "Recruiters" }] },
  { to: "/followups", label: "Follow-ups", icon: "followups", hint: "Who to chase and when", tabs: [{ to: "/followups", label: "Follow-ups" }],
    badge: (s) => s.due_followups },
  { to: "/reports", label: "Reports", icon: "reports", hint: "Charts and details for any period: jobs, applications, interviews, offers, sources…",
    tabs: [{ to: "/reports", label: "Reports" }] },
  { to: "/profile", label: "My profile", icon: "profile", hint: "Your experience, what you want, CVs and interview answers",
    tabs: [{ to: "/profile", label: "Profile" }, { to: "/preferences", label: "Target roles" },
      { to: "/cvs", label: "CVs" }, { to: "/questions", label: "Question bank" }] },
  { to: "/settings", label: "Settings", icon: "settings", hint: "Where jobs come from, how they're scored, backups",
    tabs: [{ to: "/settings", label: "Job sources" }, { to: "/settings/scoring", label: "Scoring" },
      { to: "/settings/data", label: "Backup & import" }, { to: "/settings/about", label: "About & AI" }] },
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

const THEMES: { value: Theme; icon: string; label: string }[] = [
  { value: "light", icon: "sun", label: "Light theme" },
  { value: "dark", icon: "moon", label: "Dark theme" },
  { value: "system", icon: "monitor", label: "Same as my computer" },
];

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div role="group" aria-label="Theme" className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {THEMES.map((t) => (
        <button key={t.value} type="button" title={t.label} aria-label={t.label} aria-pressed={theme === t.value}
          onClick={() => setTheme(t.value)}
          className={`rounded-md p-1.5 transition ${theme === t.value ? "bg-surface text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
          <Icon name={t.icon} />
        </button>
      ))}
    </div>
  );
}

const SIDEBAR_KEY = "layout.sidebar";

export function AppLayout() {
  const { pathname } = useLocation();
  const { section, tab } = locate(pathname);
  // Desktop: the sidebar can be hidden (remembered) to give lists the full width.
  // Phones: it opens as a drawer over the page and closes after picking a page.
  const [hidden, setHidden] = useState(() => prefs.get(SIDEBAR_KEY) === "hidden");
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);
  const toggle = () => {
    if (window.matchMedia?.("(min-width: 768px)").matches === false) return setDrawer((v) => !v);
    setHidden((h) => { prefs.set(SIDEBAR_KEY, h ? null : "hidden"); return !h; });
  };
  // Counts next to menu entries (new jobs to review, follow-ups due).
  const summary = useQuery({
    queryKey: ["dashboard"], queryFn: () => api.get<{ summary: Record<string, number> }>("/dashboard"),
    refetchInterval: 60_000,
  }).data?.summary;
  const menu = (
    <nav className="space-y-0.5 px-3 pb-4 pt-2" aria-label="Main">
      {SECTIONS.map((s) => {
        const n = summary && s.badge ? s.badge(summary) : undefined;
        const on = s === section;
        return (
          <Link key={s.to} to={s.to} title={s.hint} aria-current={on ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${on ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
            <Icon name={s.icon} className={`h-[18px] w-[18px] ${on ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"}`} />
            <span className="flex-1">{s.label}</span>
            {!!n && <span className={`rounded-full px-1.5 text-xs font-medium ${s.to === "/followups" ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-700"}`}
              title={s.to === "/followups" ? "Due today or overdue" : "New jobs to review"}>{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
  const brand = (
    <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
      <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-bold text-white shadow-sm">CI</span>
      <div>
        <div className="text-sm font-semibold tracking-tight text-slate-900">Career Intelligence</div>
        <div className="text-[11px] text-slate-400">Your job search, in one place</div>
      </div>
    </div>
  );
  return (
    <div className="flex min-h-screen">
      {!hidden && <aside className="sticky top-0 hidden h-screen print:!hidden w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-surface md:block">{brand}{menu}</aside>}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={() => setDrawer(false)} />
          <aside className="relative h-full w-64 overflow-y-auto bg-surface shadow-xl">{brand}{menu}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex print:hidden items-center gap-3 border-b border-slate-200 bg-surface/85 px-4 py-2 backdrop-blur md:px-6">
          <button type="button" onClick={toggle} aria-label={hidden ? "Show menu" : "Hide menu"} title={hidden ? "Show menu" : "Hide menu (full-width pages)"}
            aria-expanded={drawer || !hidden} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <Icon name="menu" className="h-5 w-5" />
          </button>
          {hidden && <span className="hidden text-sm font-semibold text-slate-900 md:inline">{section?.label}</span>}
          <div className="min-w-0 flex-1"><GlobalSearch /></div>
          <ThemeSwitch />
        </header>
        <main className={`mx-auto w-full flex-1 px-4 py-6 md:px-6 ${hidden ? "" : "max-w-[1440px]"}`}>
          {section && <SectionTabs section={section} active={tab} />}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
