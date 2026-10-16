import { useQuery } from "@tanstack/react-query";
import { forwardRef, type InputHTMLAttributes } from "react";
import { api } from "../../api/client";

/** Where the work happens. "" = not stated (the description decides). */
export const WORK_MODELS: { value: string; label: string; hint: string }[] = [
  { value: "ONSITE", label: "Onsite", hint: "Work from the office every day" },
  { value: "HYBRID", label: "Hybrid", hint: "Some days in the office, some from home" },
  { value: "REMOTE", label: "Remote", hint: "Work from home / anywhere" },
  { value: "", label: "Not stated", hint: "Use what the job description says" },
];

/** Same names the JD parser uses, so edited and detected values match. */
export const EMPLOYMENT_TYPES = ["Full-time", "Contract", "Contract-to-hire", "Part-time", "Internship", "Freelance"];

/** Common places for the location suggestions (your preferred locations come first). */
const COMMON_LOCATIONS = [
  "Bengaluru", "Hyderabad", "Pune", "Chennai", "Mumbai", "Navi Mumbai", "Gurugram", "Noida", "Delhi NCR",
  "Kolkata", "Ahmedabad", "Kochi", "Thiruvananthapuram", "Coimbatore", "Jaipur", "Indore", "Chandigarh",
  "Remote (India)", "Anywhere in India", "Multiple locations",
];

/** Onsite / Hybrid / Remote / Not stated as one row of buttons (a radio group). */
export function WorkModelPicker({ value, onChange, name = "work_model" }: { value: string; onChange: (v: string) => void; name?: string }) {
  const current = value === "UNKNOWN" ? "" : value;
  return (
    <div role="radiogroup" aria-label="Work model" className="inline-flex flex-wrap overflow-hidden rounded-md border border-slate-300 text-sm">
      {WORK_MODELS.map((m) => {
        const on = current === m.value;
        return (
          <label key={m.label} title={m.hint}
            className={`cursor-pointer border-r border-slate-300 px-3 py-1.5 last:border-r-0 ${on ? "bg-indigo-600 text-white" : "bg-surface text-slate-700 hover:bg-slate-50"}`}>
            <input type="radio" className="sr-only" name={name} value={m.value} checked={on} onChange={() => onChange(m.value)} />
            {m.label}
          </label>
        );
      })}
    </div>
  );
}

/** Free-text location with suggestions: your preferred locations, then common cities. */
export const LocationInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function LocationInput(props, ref) {
  const prefs = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.get<{ preferred_locations?: string[] }>("/preferences"),
    staleTime: 60_000,
  });
  const options = [...new Set([...(prefs.data?.preferred_locations ?? []), ...COMMON_LOCATIONS])];
  const listId = `${props.name ?? "location"}-options`;
  return (
    <>
      <input ref={ref} className="input" placeholder="City, or several: Pune / Bengaluru" list={listId} autoComplete="off" {...props} />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </>
  );
});

/** Job type select; keeps an unusual existing value selectable. */
export const EmploymentTypeSelect = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { current?: string | null }>(
  function EmploymentTypeSelect({ current, ...props }, ref) {
    const extra = current && !EMPLOYMENT_TYPES.includes(current) ? [current] : [];
    return (
      <select ref={ref} className="input" {...props}>
        <option value="">Not stated</option>
        {[...EMPLOYMENT_TYPES, ...extra].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    );
  },
);
