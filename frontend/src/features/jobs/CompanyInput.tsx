import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";

export type CompanySuggestion = {
  id: number; name: string; tier: string | null; website: string | null; jobs: number;
  aliases: string[]; match: boolean;
};
type Suggest = { match: CompanySuggestion | null; items: CompanySuggestion[] };

const tierLabel = (t: string | null) => (t ? t.replace("TIER_", "Tier ") : null);
const host = (url: string | null) => (url ? url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") : null);

/**
 * Company name with suggestions from the companies you already have. Picking one links the job
 * to it; otherwise the name is matched on save (legal suffixes and spelling variants included)
 * and a new company is added only when nothing matches. The line under the box says which.
 */
export function CompanyInput({ value, onChange, companyId, onPick, error, inputProps }: {
  value: string; onChange: (name: string) => void;
  companyId: number | null; onPick: (company: CompanySuggestion | null) => void;
  error?: boolean; inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [q, setQ] = useState(value.trim());
  const [linked, setLinked] = useState<CompanySuggestion | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(value.trim()), 250);
    return () => clearTimeout(t);
  }, [value]);
  const s = useQuery({
    queryKey: ["companies", "suggest", q],
    queryFn: () => api.get<Suggest>("/companies/suggest", { q }),
    enabled: q.length >= 2, staleTime: 30_000, placeholderData: (prev) => prev,
  });
  const items = q.length >= 2 ? s.data?.items ?? [] : [];
  const match = q.length >= 2 ? s.data?.match ?? null : null;
  const canAdd = value.trim().length >= 2 && !match && !items.some((i) => i.name.toLowerCase() === value.trim().toLowerCase());
  const options = [...items.map((i) => ({ kind: "company" as const, company: i })), ...(canAdd ? [{ kind: "new" as const }] : [])];
  const current = companyId !== null && linked?.id === companyId ? linked : null;

  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === "company") {
      setLinked(o.company);
      onChange(o.company.name);
      onPick(o.company);
    } else {
      setLinked(null);
      onPick(null);
    }
    setOpen(false);
    setActive(-1);
  };
  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && options.length) { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % options.length); }
    else if (e.key === "ArrowUp" && options.length) { e.preventDefault(); setOpen(true); setActive((a) => (a <= 0 ? options.length - 1 : a - 1)); }
    else if (e.key === "Enter" && open && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === "Escape") setOpen(false);
  };
  const show = open && value.trim().length >= 2 && options.length > 0;
  return (
    <div className="relative">
      <input {...inputProps} className={`input ${error ? "border-rose-400" : ""}`} value={value} autoComplete="off"
        role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list" aria-describedby={`${listId}-status`}
        aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
          if (current && e.target.value.trim() !== current.name) { setLinked(null); onPick(null); } // edited: no longer that company
        }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={keys} />
      {show && (
        <ul id={listId} role="listbox" aria-label="Companies"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-surface py-1 text-sm shadow-lg">
          {!items.length && !s.isFetching && (
            <li role="presentation" className="px-3 py-1.5 text-xs text-slate-500">No saved company matches “{value.trim()}”.</li>
          )}
          {options.map((o, i) => (
            <li key={o.kind === "company" ? o.company.id : "new"} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }} onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-indigo-50" : ""} ${o.kind === "new" ? "border-t border-slate-100 text-indigo-700" : ""}`}>
              {o.kind === "company" ? (
                <>
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{o.company.name}</span>
                    {o.company.match && <span className="rounded bg-emerald-100 px-1.5 text-[11px] font-medium text-emerald-700">Same company</span>}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {[tierLabel(o.company.tier), `${o.company.jobs} job${o.company.jobs === 1 ? "" : "s"}`, host(o.company.website)].filter(Boolean).join(" · ")}
                  </span>
                </>
              ) : (
                <>
                  + Add “{value.trim()}” as a new company
                  <span className="block text-xs text-slate-500">It's added and linked to this job when you save.</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p id={`${listId}-status`} className="mt-1 text-xs" aria-live="polite">
        {current ? (
          <span className="text-emerald-700">✓ Linked to <Link className="link" to={`/companies/${current.id}`} target="_blank">{current.name}</Link></span>
        ) : match ? (
          <span className="text-slate-600">Will be linked to your company <Link className="link" to={`/companies/${match.id}`} target="_blank">{match.name}</Link></span>
        ) : value.trim().length >= 2 && s.data && !s.isFetching ? (
          <span className="text-amber-700">New company: it will be added when you save.</span>
        ) : null}
      </p>
    </div>
  );
}
