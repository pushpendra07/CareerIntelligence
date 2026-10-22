import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { GlobalSearch } from "../components/GlobalSearch";
import { Icon } from "../components/icons";
import { NotificationBell, useBrowserReminders, useScheduledReminders, type ReminderEvent } from "../components/Reminders";
import { toast } from "../components/Toaster";
import { LogoutButton } from "../components/AuthGate";
import { CommandPalette } from "../components/CommandPalette";
import { ChatLauncher } from "../features/chat/Chat";
import { Toaster } from "../components/Toaster";
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
  { to: "/jobs", label: "Jobs", icon: "jobs", hint: "Review new jobs, browse every job, search job portals",
    tabs: [{ to: "/jobs", label: "All jobs" }, { to: "/jobs/ai-search", label: "AI search" }, { to: "/jobs/review", label: "Review new" }],
    badge: (s) => s.new_jobs },
  { to: "/companies", label: "Companies", icon: "companies", hint: "Companies you track, their job boards and verification",
    tabs: [{ to: "/companies", label: "Companies" }] },
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
      { to: "/settings/reminders", label: "Reminders" }, { to: "/settings/data", label: "Backup & import" },
      { to: "/settings/about", label: "About & AI" }] },
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
    <nav aria-label={`${section.label} pages`} className="pill-tabs tabs-scroll mb-5">
      {section.tabs.map((t) => {
        const on = t === active;
        return (
          <Link key={t.to} to={t.to} aria-current={on ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${on ? "bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_var(--color-indigo-200)]" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}>
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
    <div role="group" aria-label="Theme" className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5">
      {THEMES.map((t) => (
        <button key={t.value} type="button" title={t.label} aria-label={t.label} aria-pressed={theme === t.value}
          onClick={() => setTheme(t.value)}
          className={`rounded-lg p-1.5 transition ${theme === t.value
            ? "bg-surface text-indigo-600 shadow-sm"
            : "text-slate-500 hover:text-slate-800"}`}>
          <Icon name={t.icon} />
        </button>
      ))}
    </div>
  );
}

const SIDEBAR_KEY = "layout.sidebar";

const showReminder = (e: ReminderEvent) => toast(`🔔 ${e.title} — ${e.body}`, "info");

/** Every page in the menu, for the command palette ("Jobs › Companies"). */
const PAGES = SECTIONS.flatMap((s) => s.tabs.map((t) => ({ to: t.to, label: t.label === s.label || s.tabs.length === 1 ? s.label : t.label, group: s.label })));

export function AppLayout() {
  const { pathname } = useLocation();
  const { section, tab } = locate(pathname);
  // A fresh install (no CVs, no jobs, setup not finished) opens the Welcome wizard once.
  const setup = useQuery({ queryKey: ["setup"], queryFn: () => api.get<{ needs_setup: boolean }>("/setup"),
    staleTime: Infinity, retry: false });
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
  useBrowserReminders(summary); // notifications (when turned on), tab-title count, app badge
  useScheduledReminders(showReminder); // Settings → Reminders: a toast (and notification) when one fires
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<{ full_name?: string | null; headline?: string | null }>("/profile"),
    staleTime: 300_000, retry: false }).data;
  // Sidebar colours are theme tokens (--color-sidebar-*, index.css): light and dark values.
  const item = (s: Section) => {
    const n = summary && s.badge ? s.badge(summary) : undefined;
    const on = s === section;
    return (
      <Link key={s.to} to={s.to} title={s.hint} aria-current={on ? "page" : undefined}
        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${on
          ? "bg-sidebar-active font-semibold text-sidebar-active-text"
          : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-strong"}`}>
        {on && <span aria-hidden className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-[#6366f1] to-[#8b5cf6]" />}
        <Icon name={s.icon} className={`h-[18px] w-[18px] ${on ? "text-sidebar-active-text" : "text-sidebar-muted group-hover:text-sidebar-strong"}`} />
        <span className="flex-1">{s.label}</span>
        {!!n && <span className={`min-w-6 rounded-full px-2 py-px text-center text-[11px] font-bold tabular-nums ${s.to === "/followups" ? "bg-[#f59e0b] text-[#3b2400]" : "bg-[#6366f1] text-white"}`}
          title={s.to === "/followups" ? "Due today or overdue" : "New jobs to review"}>{n}</span>}
      </Link>
    );
  };
  const group = (label: string, items: Section[]) => (
    <div className="space-y-0.5">
      <div className="px-3 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-muted">{label}</div>
      {items.map((s) => (
        <div key={s.to}>{item(s)}</div>
      ))}
    </div>
  );
  const menu = (
    <nav className="px-3 pb-4" aria-label="Main">
      {group("Workspace", SECTIONS.filter((s) => !["/profile", "/settings"].includes(s.to)))}
      {group("You", SECTIONS.filter((s) => ["/profile", "/settings"].includes(s.to)))}
    </nav>
  );
  const brand = (
    <div className="flex items-center gap-3 px-5 pb-2 pt-5">
      <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1] via-[#8b5cf6] to-[#d946ef] font-display text-sm font-extrabold text-white shadow-[0_6px_16px_-4px_rgb(139_92_246/0.6)]">CI</span>
      <div>
        <div className="font-display text-[15px] font-bold tracking-tight text-sidebar-strong">Career Intelligence</div>
        <div className="text-[11px] text-sidebar-muted">Your job search, in one place</div>
      </div>
    </div>
  );
  const initials = (profile?.full_name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "Me";
  const footer = (
    <div className="mt-auto space-y-3 border-t border-sidebar-line p-4">
      <Link to="/profile" className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-sidebar-hover">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#a855f7] text-xs font-bold text-white ring-2 ring-indigo-100">{initials}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-sidebar-strong">{profile?.full_name || "My profile"}</span>
          <span className="block truncate text-[11px] text-sidebar-muted">{profile?.headline || "CV, target roles, answers"}</span>
        </span>
      </Link>
      <div className="flex items-center justify-between px-1.5 text-[11px] text-sidebar-muted">Theme <ThemeSwitch /></div>
    </div>
  );
  const sidebar = "flex flex-col overflow-y-auto bg-sidebar border-r border-sidebar-line";
  if (setup.data?.needs_setup) return <Navigate to="/welcome" replace />;
  return (
    <div className="group/app flex min-h-screen" data-menu={hidden ? "hidden" : "shown"}>
      {!hidden && <aside className={`sticky top-0 hidden h-screen w-64 shrink-0 print:!hidden md:flex ${sidebar}`}>{brand}{menu}{footer}</aside>}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={() => setDrawer(false)} />
          <aside className={`relative h-full w-72 shadow-2xl ${sidebar}`}>{brand}{menu}{footer}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex print:hidden items-center gap-3 border-b border-slate-200/70 bg-page/75 px-4 py-2.5 backdrop-blur-xl md:px-8">
          <button type="button" onClick={toggle} aria-label={hidden ? "Show menu" : "Hide menu"} title={hidden ? "Show menu" : "Hide menu (full-width pages)"}
            aria-expanded={drawer || !hidden} className="rounded-xl p-2 text-slate-500 hover:bg-slate-200/60 hover:text-slate-900">
            <Icon name="menu" className="h-5 w-5" />
          </button>
          {hidden && <span className="hidden text-sm font-semibold text-slate-900 md:inline">{section?.label}</span>}
          <div className="min-w-0 flex-1"><GlobalSearch /></div>
          <NotificationBell summary={summary} />
          <Link to="/jobs/new" className="btn-primary hidden sm:inline-flex"><span aria-hidden className="text-base leading-none">+</span>Add job</Link>
          <LogoutButton />
          {hidden && <div className="hidden sm:block"><ThemeSwitch /></div>}
        </header>
        <main className={`mx-auto w-full flex-1 px-4 py-6 md:px-8 md:py-8 ${hidden ? "" : "max-w-[1440px]"}`}>
          {section && <SectionTabs section={section} active={tab} />}
          <Outlet />
        </main>
        <CommandPalette pages={PAGES} />
        <ChatLauncher />
        <Toaster />
      </div>
    </div>
  );
}
