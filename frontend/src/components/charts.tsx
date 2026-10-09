import type { Bar } from "../types/api";

/** Minimal dependency-free horizontal bar chart. */
export function BarChart({ data = [], color = "bg-indigo-500", empty = "No data yet", format }: {
  data?: Bar[]; color?: string; empty?: string; format?: (b: Bar) => string;
}) {
  if (!data.length || data.every((d) => d.value === 0)) {
    return <p className="py-4 text-center text-sm text-slate-400">{empty}</p>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-1.5" aria-label="bar chart">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-2 text-xs">
          <span className="truncate text-slate-600" title={d.label}>{d.label}</span>
          <span className="h-3 rounded bg-slate-100">
            <span className={`block h-3 rounded ${color}`} style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-slate-700">{format ? format(d) : d.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Funnel: each stage's bar width relative to the first stage, with conversion %. */
export function Funnel({ stages }: { stages: { stage: string; value: number }[] }) {
  const top = stages[0]?.value || 0;
  return (
    <ol className="space-y-1.5">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : s.value;
        const conv = i > 0 && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.stage} className="grid grid-cols-[7rem_1fr_5rem] items-center gap-2 text-xs">
            <span className="text-slate-600">{s.stage}</span>
            <span className="h-4 rounded bg-slate-100">
              <span className="block h-4 rounded bg-emerald-500" style={{ width: top ? `${(s.value / top) * 100}%` : "0%" }} />
            </span>
            <span className="text-right tabular-nums text-slate-700">
              {s.value}{conv !== null && <span className="text-slate-400"> · {conv}%</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Score breakdown bars: points out of weight per component. */
export function ScoreBreakdown({ components }: { components: { key: string; label: string; weight: number; points: number; reasons: string[] }[] }) {
  return (
    <ul className="space-y-2">
      {components.map((c) => (
        <li key={c.key}>
          <div className="flex justify-between text-sm">
            <span className="font-medium text-slate-700">{c.label}</span>
            <span className="tabular-nums text-slate-600">{Math.round(c.points * 10) / 10} / {c.weight}</span>
          </div>
          <div className="mt-1 h-2 rounded bg-slate-100">
            <div className="h-2 rounded bg-indigo-500" style={{ width: `${c.weight ? (c.points / c.weight) * 100 : 0}%` }} />
          </div>
          {c.reasons.length > 0 && <p className="mt-0.5 text-xs text-slate-500">{c.reasons.join(" · ")}</p>}
        </li>
      ))}
    </ul>
  );
}
