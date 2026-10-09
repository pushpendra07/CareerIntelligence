import { useState } from "react";

/** Editable list of short strings (skills, titles, locations). Enter or comma adds an item. */
export function ListInput({ value, onChange, placeholder, label }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; label?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setDraft("");
  };
  return (
    <div className="rounded-md border border-slate-300 bg-white p-1.5">
      <div className="flex flex-wrap gap-1">
        {value.map((item) => (
          <span key={item} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
            {item}
            <button type="button" aria-label={`Remove ${item}`} className="text-slate-400 hover:text-rose-600"
              onClick={() => onChange(value.filter((v) => v !== item))}>×</button>
          </span>
        ))}
        <input
          aria-label={label ?? placeholder ?? "Add item"}
          className="min-w-32 flex-1 border-0 px-1 py-0.5 text-sm focus:outline-none"
          value={draft}
          placeholder={placeholder ?? "Type and press Enter"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && draft.trim()) { e.preventDefault(); add(draft); }
            if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft.trim() && add(draft)}
        />
      </div>
    </div>
  );
}
