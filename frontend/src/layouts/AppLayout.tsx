import { NavLink, Outlet } from "react-router-dom";
import { GlobalSearch } from "../components/GlobalSearch";

type NavItem = { to: string; label: string; hint: string };

/** Sidebar, grouped by what you're doing. `hint` shows on hover. */
const NAV: { section: string | null; items: NavItem[] }[] = [
  { section: null, items: [
    { to: "/", label: "Dashboard", hint: "Today's priorities and your numbers at a glance" },
  ] },
  { section: "Find jobs", items: [
    { to: "/jobs", label: "Jobs", hint: "Every job, scored 0–100, in status tabs" },
    { to: "/jobs/new", label: "Add Job", hint: "Paste a job link and description (LinkedIn, Naukri…)" },
    { to: "/jobs/closed", label: "Closed Jobs", hint: "Postings that were taken down" },
    { to: "/companies", label: "Companies", hint: "Companies you track; tick Job search to scan them" },
  ] },
  { section: "Track progress", items: [
    { to: "/applications", label: "Applications", hint: "Where you applied and what happened" },
    { to: "/interviews", label: "Interviews", hint: "Upcoming and past interview rounds" },
    { to: "/offers", label: "Offers", hint: "Offers, negotiation and comparison" },
    { to: "/followups", label: "Follow-ups", hint: "Reminders: who to chase and when" },
    { to: "/recruiters", label: "Recruiters", hint: "People you're in touch with" },
  ] },
  { section: "Your profile", items: [
    { to: "/cvs", label: "CVs", hint: "Upload CVs; the best one is suggested for each job" },
    { to: "/profile", label: "Profile", hint: "Your experience and skills (from your CV)" },
    { to: "/preferences", label: "Target Profile", hint: "What you want: roles, places, salary" },
    { to: "/questions", label: "Question Bank", hint: "Interview questions and your answers" },
  ] },
  { section: "Insights", items: [
    { to: "/analytics", label: "Analytics", hint: "Skill gaps and what's working" },
    { to: "/settings", label: "Settings", hint: "Job scanner, Google Sheets, scoring, imports" },
  ] },
];

export function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="px-4 pb-2 pt-4">
          <div className="text-sm font-bold tracking-tight text-indigo-700">Career Intelligence</div>
          <div className="text-[11px] text-slate-400">Your job search, in one place</div>
        </div>
        <nav className="px-2 pb-4" aria-label="Main">
          {NAV.map((group) => (
            <div key={group.section ?? "top"} className="mt-3 first:mt-1">
              {group.section && <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.section}</div>}
              <div className="space-y-0.5">
                {group.items.map(({ to, label, hint }) => (
                  <NavLink
                    key={to}
                    to={to}
                    title={hint}
                    end={to === "/" || to === "/jobs"}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-slate-200 bg-white/90 px-6 py-2 backdrop-blur">
          <GlobalSearch />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
