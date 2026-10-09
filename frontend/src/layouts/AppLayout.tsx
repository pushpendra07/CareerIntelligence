import { NavLink, Outlet } from "react-router-dom";
import { GlobalSearch } from "../components/GlobalSearch";

const NAV: [string, string][] = [
  ["/", "Dashboard"],
  ["/jobs", "Jobs"],
  ["/jobs/closed", "Closed Jobs"],
  ["/jobs/new", "Add Job"],
  ["/companies", "Companies"],
  ["/applications", "Applications"],
  ["/interviews", "Interviews"],
  ["/questions", "Question Bank"],
  ["/offers", "Offers"],
  ["/followups", "Follow-ups"],
  ["/recruiters", "Recruiters"],
  ["/cvs", "CVs"],
  ["/profile", "Profile"],
  ["/preferences", "Target Profile"],
  ["/analytics", "Analytics"],
  ["/settings", "Settings"],
];

export function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="px-4 py-4 text-sm font-bold tracking-tight text-indigo-700">Career Intelligence</div>
        <nav className="space-y-0.5 px-2 pb-4">
          {NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/" || to === "/jobs"}
              className={({ isActive }) =>
                `block rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {label}
            </NavLink>
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
