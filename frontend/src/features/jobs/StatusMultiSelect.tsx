import { useEffect, useRef, useState } from "react";
import { JobStatusBadge } from "../../components/ui";
import { humanize } from "../../utils/format";

/** Pick any number of job statuses; none selected = all statuses. */
export function StatusMultiSelect({ options, value, onChange }: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((v) => v !== s) : options.filter((o) => o === s || value.includes(o)));
  const label = value.length === 0 ? "All statuses"
    : value.length === 1 ? humanize(value[0])
    : `${value.length} statuses`;
  return (
    <div ref={ref} className="relative">
      <button type="button" className="input flex w-full items-center justify-between text-left" aria-haspopup="listbox"
        aria-expanded={open} aria-label="Status" onClick={() => setOpen((o) => !o)}>
        <span className={value.length ? "text-slate-900" : "text-slate-500"}>{label}</span>
        <span aria-hidden className="ml-2 text-slate-400">▾</span>
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" aria-label="Job statuses"
          className="absolute z-20 mt-1 w-64 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <div className="flex justify-between border-b border-slate-100 px-2 py-1 text-xs">
            <button type="button" className="link" onClick={() => onChange(options)}>Select all</button>
            <button type="button" className="link" onClick={() => onChange([])}>Clear</button>
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {options.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                <input type="checkbox" checked={value.includes(s)} onChange={() => toggle(s)} aria-label={humanize(s)} />
                <JobStatusBadge value={s} />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
