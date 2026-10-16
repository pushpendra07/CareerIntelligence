import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../../api/client";
import { Card, ErrorBox, PageIntro, Pagination, Spinner, usePageSize } from "../../components/ui";
import { formatDate, formatMoney, humanize } from "../../utils/format";

type Kpi = { key: string; label: string; value: number | null; previous: number | null; unit: string; better: "up" | "down" };
type Chart = { id: string; title: string; kind: "line" | "bar" | "stacked" | "donut" | "hbar"; note: string | null;
  /** Row field that a click on a bar/slice filters the tables by (matching the item's `code`). */
  filter?: string | null;
  series: { key: string; label: string }[]; data: Record<string, string | number | null>[] };
/** A clicked chart item: only rows whose `key` field equals `code` (or contains it) are shown. */
export type Pick = { key: string; code: string; label: string; chart: string };
type Table = { title: string; columns: Column[]; rows: Row[]; total: number };
type Column = { key: string; label: string; kind: string };
type Row = Record<string, string | number | null | string[]>;
export type Report = {
  report: string; title: string; description: string; from: string; to: string; group: string;
  previous: { from: string; to: string }; kpis: Kpi[]; charts: Chart[];
  table: Table;
  /** The jobs behind the numbers (reports whose main table isn't already jobs). */
  jobs?: Table | null;
};

export const matches = (row: Row, pick: Pick | null) => {
  if (!pick || !(pick.key in row)) return true;
  const v = row[pick.key];
  return Array.isArray(v) ? v.includes(pick.code) : String(v) === pick.code;
};
type Catalog = { key: string; title: string; description: string }[];

/** Distinct series colours, readable in light and dark themes. */
export const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899", "#64748b"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

/** Quick ranges. Each returns [from, to]. */
export const RANGES: { key: string; label: string; dates: () => [string, string] }[] = [
  { key: "7d", label: "Last 7 days", dates: () => [daysAgo(6), iso(new Date())] },
  { key: "30d", label: "Last 30 days", dates: () => [daysAgo(29), iso(new Date())] },
  { key: "90d", label: "Last 90 days", dates: () => [daysAgo(89), iso(new Date())] },
  { key: "month", label: "This month", dates: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)]; } },
  { key: "last-month", label: "Last month", dates: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))]; } },
  { key: "year", label: "This year", dates: () => [`${new Date().getFullYear()}-01-01`, iso(new Date())] },
  { key: "12m", label: "Last 12 months", dates: () => [daysAgo(364), iso(new Date())] },
];

function fmt(v: Row[string] | undefined, kind: string, row?: Row): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (kind === "date") return formatDate(String(v));
  if (kind === "money") return formatMoney(v, (row?.currency as string | undefined) ?? "INR");
  if (v === "UNKNOWN") return "Not stated";
  if (kind === "code" || kind === "source") return humanize(String(v));
  return String(v);
}

function KpiCard({ k }: { k: Kpi }) {
  const value = k.value === null ? "—" : k.unit === "money" ? formatMoney(k.value) : `${k.value}${k.unit}`;
  const diff = k.value !== null && k.previous !== null ? k.value - k.previous : null;
  const good = diff !== null && diff !== 0 && (diff > 0) === (k.better === "up");
  return (
    <div className="card p-3">
      <div className="text-xs font-medium text-slate-500">{k.label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {diff !== null && (
        <div className={`text-xs ${diff === 0 ? "text-slate-400" : good ? "text-emerald-600" : "text-rose-600"}`}
          title={`Previous period: ${k.unit === "money" ? formatMoney(k.previous) : `${k.previous}${k.unit}`}`}>
          {diff === 0 ? "same as before" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)}${k.unit === "money" ? "" : k.unit} vs previous period`}
        </div>
      )}
    </div>
  );
}

const axis = { fontSize: 11, fill: "currentColor" };

/** One chart, drawn by kind. Empty data shows a message instead of a blank frame. */
export function ReportChart({ c, pick, onPick }: { c: Chart; pick?: Pick | null; onPick?: (p: Pick | null) => void }) {
  const clickable = !!(c.filter && onPick);
  const mine = pick?.chart === c.id ? pick : null;
  const click = (_: unknown, i: number) => {
    const item = c.data[i];
    if (!clickable || !item || item.code === null || item.code === undefined) return;
    const code = String(item.code);
    onPick!(mine?.code === code ? null : { key: c.filter!, code, label: `${c.title}: ${item.label}`, chart: c.id });
  };
  const dim = (i: number) => (mine && String(c.data[i]?.code) !== mine.code ? 0.3 : 1);
  const cursor = clickable ? "pointer" : undefined;
  const empty = !c.data.length || c.data.every((d) => c.series.every((s) => !Number(d[s.key] ?? d.value ?? 0)));
  const many = c.series.length > 1;
  let body;
  if (empty) body = <p className="flex h-full items-center justify-center text-sm text-slate-400">Nothing in this period</p>;
  else if (c.kind === "line") {
    body = (
      <LineChart data={c.data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
        <XAxis dataKey="label" tick={axis} /><YAxis allowDecimals={false} tick={axis} />
        <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
        {c.series.map((s, i) => <Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />)}
      </LineChart>
    );
  } else if (c.kind === "donut") {
    const total = c.data.reduce((n, d) => n + Number(d.value || 0), 0);
    const share = (label: string) => {
      const v = Number(c.data.find((d) => d.label === label)?.value ?? 0);
      return `${label} · ${v} (${total ? Math.round((v * 100) / total) : 0}%)`;
    };
    body = (
      <PieChart>
        <Pie data={c.data} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="85%" paddingAngle={1} onClick={click} style={{ cursor }}>
          {c.data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={dim(i)} />)}
        </Pie>
        <Tooltip /><Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 12 }} formatter={(v) => share(String(v))} />
      </PieChart>
    );
  } else if (c.kind === "hbar") {
    body = (
      <BarChart data={c.data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={axis} />
        <YAxis type="category" dataKey="label" width={130} tick={axis} interval={0} />
        <Tooltip />{many && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {c.series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} radius={[0, 3, 3, 0]} onClick={click} style={{ cursor }}>
            {c.data.map((_, j) => <Cell key={j} fill={COLORS[i % COLORS.length]} fillOpacity={dim(j)} />)}
          </Bar>
        ))}
      </BarChart>
    );
  } else {
    body = (
      <BarChart data={c.data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} vertical={false} />
        <XAxis dataKey="label" tick={axis} /><YAxis allowDecimals={false} tick={axis} />
        <Tooltip />{many && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {c.series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} onClick={click} style={{ cursor }}
            stackId={c.kind === "stacked" ? "a" : undefined} radius={c.kind === "stacked" ? undefined : [3, 3, 0, 0]}>
            {c.data.map((_, j) => <Cell key={j} fill={COLORS[i % COLORS.length]} fillOpacity={dim(j)} />)}
          </Bar>
        ))}
      </BarChart>
    );
  }
  const height = c.kind === "hbar" ? Math.max(200, Math.min(c.data.length, 15) * 26 + 40) : 260;
  return (
    <Card title={c.title} className="break-inside-avoid">
      {(c.note || clickable) && <p className="-mt-1 mb-2 text-xs text-slate-500">{[c.note, clickable && !empty ? "Click a bar or slice to list its rows below." : null].filter(Boolean).join(" ")}</p>}
      <div className="text-slate-500" style={{ height }} role="img" aria-label={`${c.title} chart`}>
        {empty ? body : <ResponsiveContainer width="100%" height="100%">{body}</ResponsiveContainer>}
      </div>
    </Card>
  );
}

function cell(col: Column, row: Row) {
  const v = row[col.key];
  const text = fmt(v, col.kind, row);
  if (v === null || v === undefined) return text;
  if (col.kind === "job" && row.id) return <Link className="link" to={`/jobs/${row.id}`}>{text}</Link>;
  if (col.kind === "company" && row.company_id) return <Link className="link" to={`/companies/${row.company_id}`}>{text}</Link>;
  if (col.kind === "source") return <Link className="link" to={`/jobs?source=${v}`}>{text}</Link>;
  if (col.kind === "skill") return <Link className="link" to={`/jobs?technology=${encodeURIComponent(String(v))}`}>{text}</Link>;
  return text;
}

/** CSV with the table's columns as shown (dates as YYYY-MM-DD so spreadsheets sort them). */
export function toCsv(columns: Column[], rows: Row[]): string {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(c.kind === "code" ? humanize(String(r[c.key] ?? "")) || "" : r[c.key])).join(","))].join("\n");
}

function DetailTable({ t, name, from, to, pick }: { t: Table; name: string; from: string; to: string; pick: Pick | null }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize("reports.pageSize.v1", 25);
  // A new chart pick starts again at page 1.
  const [seenPick, setSeenPick] = useState(pick);
  if (seenPick !== pick) { setSeenPick(pick); setPage(1); }
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const picked = t.rows.filter((r) => matches(r, pick));
    let out = needle ? picked.filter((r) => t.columns.some((c) => fmt(r[c.key], c.kind, r).toLowerCase().includes(needle))) : picked;
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      });
    }
    return out;
  }, [t, q, sort, pick]);
  const download = () => {
    const blob = new Blob([toCsv(t.columns, rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report-${name}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * size, current * size);
  const id = `report-table-${name}`;
  return (
    <Card id={id} className="scroll-mt-16" title={`${t.title} (${rows.length}${t.total > t.rows.length ? ` of ${t.total}, first ${t.rows.length} loaded` : ""})`}
      actions={<span className="flex gap-2 print:hidden">
        <input className="input w-48 py-1 text-xs" placeholder="Filter rows" aria-label={`Filter rows: ${t.title}`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <button className="btn-secondary" onClick={download} disabled={!rows.length}>Download CSV</button>
      </span>}>
      {!rows.length ? <p className="text-sm text-slate-500">No rows.</p> : (
        <>
        {rows.length > size && <Pagination position="top" page={current} size={size} total={rows.length} onPage={setPage} noun="rows" />}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-surface"><tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              {t.columns.map((c) => (
                <th key={c.key} className={`whitespace-nowrap py-1.5 pr-4 ${c.kind === "number" || c.kind === "money" ? "text-right" : ""}`}
                  aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button className="uppercase hover:text-slate-800" onClick={() => { setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === -1 ? 1 : -1 })); setPage(1); }}>
                    {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r, i) => (
                <tr key={i}>
                  {t.columns.map((c) => <td key={c.key} className={`py-1.5 pr-4 ${c.kind === "number" || c.kind === "money" ? "text-right tabular-nums" : ""} ${c.kind === "date" ? "whitespace-nowrap" : ""}`}>{cell(c, r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={current} size={size} total={rows.length} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} scrollTo={id} noun="rows" />
        </>
      )}
    </Card>
  );
}

/** Reports: pick a report and a date range; KPIs vs the previous period, charts and a detail table. */
export function ReportsPage() {
  const { name = "overview" } = useParams();
  const [params, setParams] = useSearchParams();
  const preset = params.get("range") ?? (params.get("from") ? "custom" : "90d");
  const [from, to] = preset === "custom"
    ? [params.get("from") ?? daysAgo(89), params.get("to") ?? iso(new Date())]
    : (RANGES.find((r) => r.key === preset) ?? RANGES[2]).dates();
  const group = params.get("group") ?? "";
  const catalog = useQuery({ queryKey: ["reports"], queryFn: () => api.get<Catalog>("/reports"), staleTime: Infinity });
  const report = useQuery({
    queryKey: ["reports", name, from, to, group],
    queryFn: () => api.get<Report>(`/reports/${name}`, { from, to, ...(group ? { group } : {}) }),
    placeholderData: (prev) => (prev?.report === name ? prev : undefined),
  });
  const update = (changes: Record<string, string | null>) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) n.set(k, v); else n.delete(k); }
    setParams(n, { replace: true });
  };
  const keep = params.toString() ? `?${params.toString()}` : "";
  const r = report.data;
  // A chart click narrows the tables; it belongs to one report and range.
  const [picked, setPicked] = useState<(Pick & { at: string }) | null>(null);
  const at = `${name}|${from}|${to}|${group}`;
  const pick = picked?.at === at ? picked : null;
  const onPick = (p: Pick | null) => {
    setPicked(p && { ...p, at });
    if (p) setTimeout(() => document.getElementById("report-tables")?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 50);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1>Reports</h1><PageIntro>Every part of your search over any period, with charts, a comparison with the period before, and the details behind each number.</PageIntro></div>
        <button className="btn-secondary print:hidden" onClick={() => window.print()}>Print / save as PDF</button>
      </div>
      <nav aria-label="Reports" className="flex flex-wrap gap-1.5 print:hidden">
        {(catalog.data ?? []).map((c) => (
          <Link key={c.key} to={`/reports/${c.key}${keep}`} title={c.description} aria-current={c.key === name ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${c.key === name ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
            {c.title}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-end gap-3 text-sm print:hidden">
        <label><span className="label">Period</span>
          <select className="input w-44" value={preset} onChange={(e) => update(e.target.value === "custom" ? { range: null, from, to } : { range: e.target.value, from: null, to: null })}>
            {RANGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            <option value="custom">Custom dates…</option>
          </select>
        </label>
        {preset === "custom" && (<>
          <label><span className="label">From</span><input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && update({ range: null, from: e.target.value, to })} /></label>
          <label><span className="label">To</span><input className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && update({ range: null, from, to: e.target.value })} /></label>
        </>)}
        <label><span className="label">Group by</span>
          <select className="input w-32" value={group} onChange={(e) => update({ group: e.target.value || null })}>
            <option value="">Automatic</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
          </select>
        </label>
        {report.isFetching && <span className="pb-2 text-xs text-slate-400">Updating…</span>}
      </div>
      {report.error && <ErrorBox error={report.error} />}
      {!r ? (report.isLoading ? <Spinner /> : null) : (
        <>
          <div>
            <h2 className="text-lg font-semibold">{r.title}</h2>
            <p className="text-sm text-slate-500">{r.description} {formatDate(r.from)} – {formatDate(r.to)}, by {r.group}. Compared with {formatDate(r.previous.from)} – {formatDate(r.previous.to)}.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{r.kpis.map((k) => <KpiCard key={k.key} k={k} />)}</div>
          <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
            {r.charts.map((c) => <ReportChart key={c.id} c={c} pick={pick} onPick={onPick} />)}
          </div>
          <div id="report-tables" className="scroll-mt-16 space-y-4">
            {pick && (
              <div className="flex items-center gap-2 text-sm">
                <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">Showing: {pick.label}</span>
                <button className="link text-xs" onClick={() => onPick(null)}>Show all</button>
              </div>
            )}
            <DetailTable key={`${r.report}-${r.from}-${r.to}`} t={r.table} name={r.report} from={r.from} to={r.to} pick={pick} />
            {r.jobs && <DetailTable key={`jobs-${r.report}-${r.from}-${r.to}`} t={r.jobs} name={`${r.report}-jobs`} from={r.from} to={r.to} pick={pick} />}
          </div>
        </>
      )}
    </div>
  );
}
