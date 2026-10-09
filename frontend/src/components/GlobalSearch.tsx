import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

type Hit = { id: number | null; title: string; subtitle?: string | null; score?: number | null };
type Results = Record<string, Hit[]>;

const ROUTES: Record<string, (id: number) => string> = {
  jobs: (id) => `/jobs/${id}`,
  companies: (id) => `/companies/${id}`,
  recruiters: () => `/recruiters`,
  applications: (id) => `/applications/${id}`,
  interviews: (id) => `/interviews/${id}`,
  cvs: (id) => `/cvs/${id}`,
};

export function GlobalSearch() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const { data } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.get<Results>("/search", { q }),
    enabled: q.length >= 2,
  });
  const groups = Object.entries(data ?? {}).filter(([, hits]) => hits.length);
  return (
    <div className="relative w-full max-w-md">
      <input
        className="input"
        placeholder="Search jobs, companies, recruiters, skills…"
        aria-label="Global search"
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && q.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          {!groups.length && <p className="p-2 text-sm text-slate-500">No matches</p>}
          {groups.map(([group, hits]) => (
            <div key={group} className="mb-2">
              <div className="px-2 text-xs font-semibold uppercase text-slate-400">{group}</div>
              {hits.map((h, i) => {
                const to = group === "skills" ? `/jobs?technology=${encodeURIComponent(h.title)}`
                  : h.id !== null && ROUTES[group] ? ROUTES[group](h.id) : "#";
                return (
                  <Link key={`${group}-${h.id ?? i}`} to={to} className="block rounded px-2 py-1 text-sm hover:bg-slate-50">
                    <span className="font-medium">{h.title}</span>
                    {h.subtitle && <span className="text-slate-500"> · {h.subtitle}</span>}
                    {typeof h.score === "number" && <span className="float-right text-xs text-slate-500">{h.score}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
