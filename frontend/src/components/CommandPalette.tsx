import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Icon } from "./icons";

export type Command = { id: string; label: string; group: string; hint?: string; keys?: string; run: () => void };
type Hit = { id: number | null; title: string; subtitle?: string | null };

/** Commands whose label, group or hint contain every typed word (any order, any case). */
export function filterCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  return commands.filter((c) => {
    const text = `${c.label} ${c.group} ${c.hint ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** "g" then one of these keys opens the page (avoid s/n/k/o/u: Review new uses them). */
export const GO_KEYS: Record<string, { to: string; label: string }> = {
  t: { to: "/", label: "Today" },
  j: { to: "/jobs", label: "All jobs" },
  r: { to: "/jobs/review", label: "Review new jobs" },
  c: { to: "/companies", label: "Companies" },
  p: { to: "/applications/board", label: "Pipeline" },
  f: { to: "/followups", label: "Follow-ups" },
  i: { to: "/reports", label: "Reports" },
  m: { to: "/profile", label: "My profile" },
  ",": { to: "/settings", label: "Settings" },
};

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

/**
 * ⌘K / Ctrl+K: jump to any page, run an action, or open a job/company by name.
 * Also the app-wide keyboard shortcuts: "/" search, "c" add a job, "g" + key go to a page,
 * "?" lists them all.
 */
export function CommandPalette({ pages }: { pages: { to: string; label: string; group: string }[] }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"closed" | "palette" | "help">("closed");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const close = () => { setMode("closed"); setQ(""); setActive(0); };

  const scan = useMutation({ mutationFn: () => api.post("/scanner/run", {}), meta: { success: "Job scan started — new jobs appear in a few minutes", toastError: true } });
  const backup = useMutation({ mutationFn: () => api.post("/backups"), meta: { success: "Backup saved", toastError: true } });

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const keyFor = (to: string) => Object.entries(GO_KEYS).find(([, v]) => v.to === to)?.[0];
    return [
      { id: "add-job", group: "Actions", label: "Add a job", hint: "paste a URL and description", keys: "C", run: go("/jobs/new") },
      { id: "review", group: "Actions", label: "Review new jobs", hint: "one at a time, best first", run: go("/jobs/review") },
      { id: "scan", group: "Actions", label: "Search company job boards now", hint: "find new jobs", run: () => scan.mutate() },
      { id: "followup", group: "Actions", label: "See follow-ups due", hint: "who to chase", run: go("/followups") },
      { id: "upload-cv", group: "Actions", label: "Upload a CV", hint: "resume", run: go("/cvs") },
      { id: "backup", group: "Actions", label: "Back up my data now", hint: "database, CVs", run: () => backup.mutate() },
      { id: "import", group: "Actions", label: "Import jobs from a file", hint: "CSV JSON export", run: go("/settings/data") },
      ...pages.map((p) => {
        const k = keyFor(p.to);
        return { id: `page:${p.to}`, group: "Go to", label: p.label, hint: p.group, keys: k ? `G ${k.toUpperCase()}` : undefined, run: go(p.to) };
      }),
      { id: "shortcuts", group: "Help", label: "Keyboard shortcuts", keys: "?", run: () => setMode("help") },
      { id: "setup", group: "Help", label: "Setup guide", hint: "CV, target roles, companies, first jobs", run: go("/welcome") },
    ];
  }, [pages, navigate, scan, backup]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<Record<string, Hit[]>>("/search", { q: debounced }),
    enabled: mode === "palette" && debounced.length >= 2,
  });
  const found: Command[] = [
    ...(search.data?.jobs ?? []).slice(0, 5).filter((h) => h.id !== null).map((h) => ({
      id: `job:${h.id}`, group: "Jobs", label: h.title, hint: h.subtitle ?? undefined, run: () => navigate(`/jobs/${h.id}`) })),
    ...(search.data?.companies ?? []).slice(0, 3).filter((h) => h.id !== null).map((h) => ({
      id: `company:${h.id}`, group: "Companies", label: h.title, hint: h.subtitle?.replace(/^TIER_/, "Tier ") ?? undefined, run: () => navigate(`/companies/${h.id}`) })),
  ];
  const list = [...filterCommands(commands, q), ...(debounced === q.trim() ? found : [])];
  useEffect(() => setActive(0), [q]);

  // App-wide shortcuts.
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMode((m) => (m === "palette" ? "closed" : "palette"));
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "Escape") { close(); return; }
      if (pendingG && Date.now() - pendingG < 1500) {
        pendingG = 0;
        const target = GO_KEYS[e.key.toLowerCase()];
        if (target) { e.preventDefault(); e.stopImmediatePropagation(); navigate(target.to); }
        return;
      }
      if (e.key === "g") { pendingG = Date.now(); return; }
      if (e.key === "?") { e.preventDefault(); setMode("help"); return; }
      if (e.key === "/") {
        const box = document.querySelector<HTMLInputElement>('input[aria-label="Global search"]');
        if (box) { e.preventDefault(); box.focus(); }
        return;
      }
      if (e.key === "c" && !window.location.pathname.startsWith("/jobs/review")) { e.preventDefault(); navigate("/jobs/new"); }
    };
    // Capture phase: "g" then "r" must not also count as a key on the Review page.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [navigate]);

  useEffect(() => { if (mode === "palette") input.current?.focus(); }, [mode]);

  if (mode === "closed") return null;
  const run = (c: Command | undefined) => {
    if (!c) return;
    if (c.id !== "shortcuts") close();
    c.run();
  };
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true"
      aria-label={mode === "help" ? "Keyboard shortcuts" : "Command palette"}>
      <button aria-label="Close" className="absolute inset-0 cursor-default bg-slate-900/40 backdrop-blur-[2px] dark:bg-black/60" onClick={close} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-2xl">
        {mode === "help" ? (
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2>Keyboard shortcuts</h2>
              <button className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close" onClick={close}><Icon name="close" /></button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {([[`${MOD} K`, "Command palette: pages, actions, jobs, companies"], ["/", "Search everything"], ["C", "Add a job"], ["?", "This list"], ["Esc", "Close"]] as const)
                .map(([k, v]) => <Row key={k} k={k} v={v} />)}
              {Object.entries(GO_KEYS).map(([k, v]) => <Row key={k} k={`G ${k.toUpperCase()}`} v={`Go to ${v.label}`} />)}
              <Row k="S N K O U" v="On Review new: shortlist, not relevant, skip, open posting, undo" />
            </dl>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-200 px-4">
              <Icon name="search" className="h-4 w-4 text-slate-400" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command, page, job or company…"
                aria-label="Command" role="combobox" aria-expanded aria-controls="command-list"
                aria-activedescendant={list[active] ? `cmd-${active}` : undefined}
                className="w-full bg-transparent py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400"
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); close(); }
                  else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(list.length - 1, i + 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
                  else if (e.key === "Enter") { e.preventDefault(); run(list[active]); }
                }} />
              {search.isFetching && <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" aria-label="Searching" />}
            </div>
            <ul id="command-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
              {!list.length && <li className="px-3 py-6 text-center text-sm text-slate-500">Nothing matches “{q}”.</li>}
              {list.map((c, i) => {
                const header = c.group !== lastGroup ? (lastGroup = c.group) : null;
                return (
                  <li key={c.id} role="presentation">
                    {header && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{header}</div>}
                    <div id={`cmd-${i}`} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => run(c)}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-indigo-50 text-indigo-800" : "text-slate-700"}`}>
                      <span className="min-w-0 flex-1 truncate">{c.label}{c.hint && <span className="ml-2 text-xs text-slate-400">{c.hint}</span>}</span>
                      {c.keys && <kbd className="kbd">{c.keys}</kbd>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-4 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400">
              <span>↑↓ choose</span><span>Enter open</span><span>Esc close</span><span className="ml-auto">? shortcuts</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt><kbd className="kbd ml-0 text-xs">{k}</kbd></dt>
      <dd className="text-slate-600">{v}</dd>
    </>
  );
}
