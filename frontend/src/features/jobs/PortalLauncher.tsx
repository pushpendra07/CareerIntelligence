import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/icons";
import { Field } from "../../components/ui";
import type { Preferences } from "./AiSearchPage";
import { collectorOutdated, extensionDownloadUrl } from "./collector";
import { PORTALS, WORK_TYPES, type SearchQuery, type WorkType } from "./portals";

type Provider = "claude" | "gemini" | "collector";
const PROVIDER_KEY = "aiSearch.provider";

// Chrome doesn't let a page (or another extension) open Claude's or Gemini's panel or type into
// it, so those two need one paste; only the Job collector runs by itself.
const PROVIDERS: { id: Provider; label: string; tag: string; hint: string }[] = [
  { id: "collector", label: "Job collector", tag: "Automatic", hint: "Opens the searches, reads every job and brings them here — no clicks" },
  { id: "claude", label: "Claude", tag: "You paste", hint: "Opens the portal and copies the prompt; paste it in Claude's side panel" },
  { id: "gemini", label: "Gemini", tag: "You paste", hint: "Opens the portal and copies the prompt; paste it in Gemini in Chrome" },
];

function savedProvider(): Provider {
  try {
    const v = localStorage.getItem(PROVIDER_KEY);
    return v === "claude" || v === "gemini" ? v : "collector";
  } catch {
    return "collector";
  }
}

/**
 * The popup behind a portal button: pick a title and place, then who searches — Claude or
 * Gemini (the portal opens with the prompt on the clipboard) or the Job collector extension.
 */
export function PortalLauncher({ portal, prefs, days, count, collectorReady, collectorVersion = null, busy, promptFor, onCollect, onClose }: {
  portal: string; prefs: Preferences; days: number; count: number; collectorReady: boolean; collectorVersion?: string | null; busy: boolean;
  promptFor: (portal: string, start: string) => string; onCollect: (portal: string, urls: string[], max: number) => void; onClose: () => void;
}) {
  const p = PORTALS.find((x) => x.name === portal) ?? PORTALS[0];
  const titles = prefs.effective_titles?.length ? prefs.effective_titles : ["Senior PHP Developer"];
  const cityOptions = (prefs.preferred_locations ?? []).filter((l) => !/remote/i.test(l));
  const [title, setTitle] = useState(titles[0]);
  const [cities, setCities] = useState<string[]>(cityOptions.slice(0, 1));
  const [work, setWork] = useState<WorkType[]>(() => {
    const ok = WORK_TYPES.filter((w) => (w === "Remote" ? prefs.remote_ok : w === "Hybrid" ? prefs.hybrid_ok : prefs.onsite_ok) !== false);
    return ok.length ? ok : [...WORK_TYPES];
  });
  const [provider, setProvider] = useState<Provider>(savedProvider);
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const searches = searchesFor(title, days, work, cities);
  const urls = [...new Set(searches.map((q) => p.search(q)))];
  const described = searches.map(describe);
  const start = p.filled
    ? `I have opened the ${p.name} search results for "${title}" — ${described[0]} (last ${days} days) — in a tab. Start there.`
      + (urls.length > 1 ? ` Then do these searches on ${p.name} too:\n${urls.slice(1).map((u, i) => `- ${described[i + 1]}: ${u}`).join("\n")}` : "")
      + "\nIf they have few good results, also search the other titles from my list."
    : `I have opened ${p.name} in a tab. Search it for "${title}": ${described.join("; ")} (and the other titles from my list).`;
  const prompt = promptFor(p.name, start);

  const choose = (v: Provider) => {
    setProvider(v);
    setOpened(false);
    try { localStorage.setItem(PROVIDER_KEY, v); } catch { /* private window */ }
  };
  const open = () => {
    if (provider === "collector") {
      onCollect(p.name, urls, count);
      onClose();
      return;
    }
    // Copy first (the page still has focus), then open the portal in the same click.
    const write = navigator.clipboard?.writeText(prompt);
    if (write) write.then(() => setCopied(true), () => setCopied(false));
    else setCopied(false);
    window.open(urls[0], "_blank", "noopener");
    setOpened(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label={`Search ${p.name}`}>
      <button aria-label="Close" className="absolute inset-0 cursor-default bg-slate-900/40 backdrop-blur-[2px] dark:bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-surface p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2>Search {p.name}</h2>
          <button className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Field label="Job title">
            <select className="input" value={title} onChange={(e) => { setTitle(e.target.value); setOpened(false); }}>
              {titles.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <LocationPicker work={work} cities={cities} cityOptions={cityOptions}
            onChange={(w, c) => { setWork(w); setCities(c); setOpened(false); }} />
        </div>
        <p className="-mt-2 mb-4 text-xs text-slate-500">
          {urls.length === 1 ? "1 search" : `${urls.length} searches`}: {described.join(" · ")}.
          {!p.filled && ` ${p.name}'s search can't be pre-filled; this goes in the prompt.`}
          {p.filled && !["LinkedIn", "Naukri"].includes(p.name) && work.length > 0 && work.length < 3 && ` ${p.name} gets the title and place; set its work-type filter on the page.`}
        </p>

        <fieldset>
          <legend className="label mb-1">Who searches?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {PROVIDERS.map((v) => (
              <label key={v.id} className={`cursor-pointer rounded-lg border p-2 text-sm ${provider === v.id ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15" : "border-slate-200"}`}>
                <input type="radio" name="provider" className="sr-only" checked={provider === v.id} onChange={() => choose(v.id)} />
                <span className="flex items-center justify-between gap-1 font-semibold">{v.label}
                  <span className={`rounded-full px-1.5 text-[10px] font-medium ${v.id === "collector" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{v.tag}</span>
                </span>
                <span className="block text-xs text-slate-500">{v.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {provider === "collector" && collectorOutdated(collectorVersion) && (
          <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
            Your Job collector extension is an older version ({collectorVersion}) and will only run the first search. Update it: open
            {" "}<code>chrome://extensions</code> and click the reload icon on <b>Career Intelligence – Job collector</b> (or <a className="link font-medium" href={extensionDownloadUrl()} download>download it again</a>
            {" "}and replace the folder), then reload this page.
          </p>
        )}
        {provider === "collector" && !collectorReady && (
          <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
            The Job collector extension isn't installed in this browser. <a className="link font-medium" href={extensionDownloadUrl()} download>Download it</a>,
            unzip it, then in Chrome open <code>chrome://extensions</code> → turn on Developer mode → <b>Load unpacked</b> → choose the unzipped folder.
            Then reload this page.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={provider === "collector" && (!collectorReady || busy)} onClick={open}>
            {provider === "collector" ? `Collect up to ${count} jobs` : `Open ${p.name} and copy the prompt`}
          </button>
          {provider !== "collector" && <span className="text-xs text-slate-500">Chrome doesn't let the app start {provider === "claude" ? "Claude" : "Gemini"} for you — you paste once.</span>}
          {provider !== "collector" && opened && <button className="btn-secondary" onClick={open}>Again</button>}
        </div>

        {provider !== "collector" && opened && (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
            <li>Go to the {p.name} tab that just opened{p.name === "LinkedIn" || p.name === "Naukri" ? " (log in if it asks)" : ""}.</li>
            {provider === "claude"
              ? <li>Open Claude: click the <b>Claude</b> icon in Chrome's toolbar (the side panel opens).</li>
              : <li>Open <b>Gemini in Chrome</b> (the Gemini button at the top right of Chrome).</li>}
            <li>Paste the prompt (<kbd>⌘V</kbd> / <kbd>Ctrl V</kbd>) and press Enter.{copied === false && <span className="text-rose-600"> Copy didn't work — use “Copy prompt” below.</span>}</li>
            <li>The assistant adds the jobs on this page (<b>Jobs from the assistant</b> → Check → Add){provider === "gemini" ? "; if Gemini only shows you the list, paste it there yourself" : ""}.</li>
          </ol>
        )}
        {provider === "collector" && collectorReady && (
          <p className="mt-3 text-sm text-slate-600">The extension opens {p.name} in a tab, reads up to {count} jobs one by one (a few seconds each), then
            brings them here and checks them for duplicates. Log in to {p.name} first if it needs it.</p>
        )}
        {provider !== "collector" && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-slate-500">Copy prompt</summary>
            <textarea aria-label={`Prompt for ${p.name}`} className="input mt-2 h-40 w-full font-mono text-xs" readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} />
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * The searches for a title: remote jobs anywhere in India (one search), and hybrid / onsite jobs
 * in each chosen city (all of India when no city is chosen).
 */
export function searchesFor(title: string, days: number, work: WorkType[], cities: string[]): SearchQuery[] {
  const out: SearchQuery[] = [];
  const local = work.filter((w) => w !== "Remote");
  if (work.includes("Remote")) out.push({ title, days, location: "Remote India", work: ["Remote"] });
  if (local.length || !work.length) {
    for (const city of cities.length ? cities : ["India"]) out.push({ title, days, location: city, work: local });
  }
  return out;
}

function describe(q: SearchQuery): string {
  if (q.location === "Remote India") return "remote, anywhere in India";
  const kinds = q.work?.length ? q.work.join(" / ").toLowerCase() : "any work type";
  return `${kinds} in ${q.location}`;
}

/** Location: one drop-down to tick work types (Remote, Hybrid, Onsite) and cities. */
function LocationPicker({ work, cities, cityOptions, onChange }: {
  work: WorkType[]; cities: string[]; cityOptions: string[]; onChange: (work: WorkType[], cities: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const toggle = <T,>(list: T[], value: T, all: readonly T[]) =>
    list.includes(value) ? list.filter((x) => x !== value) : all.filter((x) => x === value || list.includes(x));
  const onlyRemote = work.length === 1 && work[0] === "Remote";
  const summary = [
    work.length ? work.join(", ") : "Any work type",
    onlyRemote ? null : cities.length ? (cities.length > 2 ? `${cities.slice(0, 2).join(", ")} +${cities.length - 2}` : cities.join(", ")) : "All of India",
  ].filter(Boolean).join(" · ");
  return (
    <div className="relative" ref={box}>
      <span className="label" id="location-label">Location</span>
      <button type="button" className="input flex w-full items-center justify-between gap-2 text-left" aria-haspopup="true" aria-expanded={open}
        aria-labelledby="location-label location-value" onClick={() => setOpen(!open)}>
        <span id="location-value" className="truncate">{summary}</span><span aria-hidden className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 left-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-surface p-2 text-sm shadow-lg">
          <div className="px-1 pb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Work type</div>
          {WORK_TYPES.map((w) => (
            <label key={w} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-slate-50">
              <input type="checkbox" checked={work.includes(w)} onChange={() => onChange(toggle(work, w, WORK_TYPES), cities)} />
              {w}{w === "Remote" && <span className="text-xs text-slate-500">— anywhere in India</span>}
            </label>
          ))}
          <div className="mt-2 flex items-center justify-between px-1 pb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Cities{onlyRemote && <span className="font-normal normal-case">(for hybrid / onsite)</span>}
          </div>
          {cityOptions.map((c) => (
            <label key={c} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-slate-50">
              <input type="checkbox" checked={cities.includes(c)} onChange={() => onChange(work, toggle(cities, c, cityOptions))} />{c}
            </label>
          ))}
          {!cityOptions.length && <p className="px-1 text-xs text-slate-500">No cities in your target roles — all of India is searched.</p>}
        </div>
      )}
    </div>
  );
}
