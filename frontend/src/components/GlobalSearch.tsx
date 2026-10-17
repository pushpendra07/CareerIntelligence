import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { MOD } from "./CommandPalette";
import { Icon } from "./icons";

type Hit = { id: number | null; title: string; subtitle?: string | null; score?: number | null };
type Results = Record<string, Hit[]>;

const ROUTES: Record<string, (h: Hit) => string> = {
  jobs: (h) => `/jobs/${h.id}`,
  companies: (h) => `/companies/${h.id}`,
  recruiters: (h) => `/recruiters?q=${encodeURIComponent(h.title)}`,
  applications: (h) => `/applications/${h.id}`,
  interviews: (h) => `/interviews/${h.id}`,
  cvs: (h) => `/cvs/${h.id}`,
  skills: (h) => `/jobs?technology=${encodeURIComponent(h.title)}`,
};
const hrefFor = (group: string, h: Hit) => (ROUTES[group] && (h.id !== null || group === "skills" || group === "recruiters") ? ROUTES[group](h) : null);

/**
 * Search everything from the top bar. Click a result (or ↑/↓ then Enter) to open it;
 * Enter with nothing highlighted shows all matching jobs; Esc closes.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setActive(-1), [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.get<Results>("/search", { q }),
    enabled: q.length >= 2,
  });
  const groups = Object.entries(data ?? {}).filter(([, hits]) => hits.length);
  const flat = groups.flatMap(([group, hits]) => hits.map((h) => ({ group, h, to: hrefFor(group, h) })))
    .filter((x): x is { group: string; h: Hit; to: string } => x.to !== null);
  const allJobs = `/jobs?q=${encodeURIComponent(text.trim())}`;

  const go = (to: string) => {
    setOpen(false);
    setText("");
    setQ("");
    input.current?.blur();
    navigate(to);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (!flat.length) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % flat.length : (i <= 0 ? flat.length - 1 : i - 1)));
      return;
    }
    if (e.key === "Enter" && text.trim().length >= 2) {
      e.preventDefault();
      go(active >= 0 && flat[active] ? flat[active].to : allJobs);
    }
  };

  let index = -1;
  return (
    <div className="relative w-full max-w-md">
      <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      {!text && (
        // The one search box: ⌘K opens the bigger palette (pages, actions, shortcuts) from anywhere.
        <button type="button" tabIndex={-1} title="Commands: pages, actions and shortcuts"
          onMouseDown={(e) => { e.preventDefault(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true })); }}
          className="absolute right-2 top-1/2 hidden -translate-y-1/2 sm:block">
          <kbd className="kbd ml-0 text-slate-500">{MOD} K</kbd>
        </button>
      )}
      <input
        ref={input}
        className="input pl-8 sm:pr-14"
        placeholder="Search jobs, companies, recruiters, skills…"
        aria-label="Global search"
        role="combobox"
        aria-expanded={open && q.length >= 2}
        aria-controls="global-search-results"
        aria-activedescendant={active >= 0 ? `gs-${active}` : undefined}
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
      />
      {open && q.length >= 2 && (
        // mousedown would blur the input and close the list before the click lands: keep focus.
        <div id="global-search-results" role="listbox" onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 mt-1 max-h-[28rem] w-full overflow-auto rounded-md border border-slate-200 bg-surface p-2 shadow-lg">
          {!groups.length && <p className="p-2 text-sm text-slate-500">{isFetching ? "Searching…" : "No matches"}</p>}
          {groups.map(([group, hits]) => (
            <div key={group} className="mb-2">
              <div className="px-2 text-xs font-semibold uppercase text-slate-400">{group}</div>
              {hits.map((h, i) => {
                const to = hrefFor(group, h);
                if (!to) {
                  return <div key={`${group}-${i}`} className="px-2 py-1 text-sm text-slate-500">{h.title}</div>;
                }
                index += 1;
                const me = index;
                return (
                  <Link key={`${group}-${h.id ?? i}`} id={`gs-${me}`} role="option" aria-selected={me === active} to={to}
                    onClick={(e) => { e.preventDefault(); go(to); }} onMouseEnter={() => setActive(me)}
                    className={`block rounded px-2 py-1 text-sm ${me === active ? "bg-indigo-50 dark:bg-indigo-950" : "hover:bg-slate-50"}`}>
                    <span className="font-medium">{h.title}</span>
                    {h.subtitle && <span className="text-slate-500"> · {h.subtitle}</span>}
                    {typeof h.score === "number" && <span className="float-right text-xs text-slate-500">{h.score}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
          <Link to={allJobs} onClick={(e) => { e.preventDefault(); go(allJobs); }}
            className="block border-t border-slate-100 px-2 pt-2 text-sm text-indigo-700 hover:underline">
            See all jobs matching “{text.trim()}” →
          </Link>
          <p className="px-2 pt-1 text-xs text-slate-400">↑ ↓ to choose · Enter to open · Esc to close</p>
        </div>
      )}
    </div>
  );
}
