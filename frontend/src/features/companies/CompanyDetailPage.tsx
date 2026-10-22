import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, Chips, ErrorBox, KeyValue, Spinner, StatusBadge } from "../../components/ui";
import { StickyBar, useScrolledPast } from "../../components/StickyBar";
import { WebSearch, companyTopic } from "../../components/WebSearch";
import type { CompanyDetail, Contact, Page, Preferences } from "../../types/api";
import { formatDate, formatDateTime, humanize } from "../../utils/format";
import { type ScanRun, num, runSummary } from "../scanner/ScannerSettings";
import { CompanyJobs } from "./CompanyJobs";
import { ExtraLinks, portalLabel } from "./ExtraLinks";
import { Rating, VERIFICATION } from "./CompaniesPage";

const FIELDS = ["website", "careers_url", "linkedin_url", "headquarters", "industry", "company_type", "employee_range", "india_locations", "india_presence", "legal_name"];
const KINDS = ["OFFICIAL_WEBSITE", "OFFICIAL_CAREERS", "OFFICIAL_LINKEDIN", "OFFICIAL_ATS", "SECONDARY", "AGGREGATOR", "MANUAL"];

function EvidenceForm({ companyId, onDone }: { companyId: number; onDone: () => void }) {
  const [f, setF] = useState({ field: "website", value: "", source_kind: "OFFICIAL_WEBSITE", verification_status: "VERIFIED", source_url: "", note: "" });
  const add = useMutation({
    mutationFn: () => api.post(`/companies/${companyId}/evidence`, { ...f, source_url: f.source_url || null, note: f.note || null }),
    onSuccess: () => { setF({ ...f, value: "", source_url: "", note: "" }); onDone(); },
  });
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <select className="input" aria-label="Field" value={f.field} onChange={(e) => setF({ ...f, field: e.target.value })}>{FIELDS.map((x) => <option key={x}>{x}</option>)}</select>
      <input className="input sm:col-span-2" placeholder="Value" aria-label="Value" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
      <select className="input" aria-label="Source kind" value={f.source_kind} onChange={(e) => setF({ ...f, source_kind: e.target.value })}>{KINDS.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>
      <select className="input" aria-label="Status" value={f.verification_status} onChange={(e) => setF({ ...f, verification_status: e.target.value })}>{VERIFICATION.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>
      <input className="input" placeholder="Source URL (required to verify)" aria-label="Source URL" value={f.source_url} onChange={(e) => setF({ ...f, source_url: e.target.value })} />
      {add.error && <div className="sm:col-span-3"><ErrorBox error={new Error(errorMessage(add.error))} /></div>}
      <button className="btn-primary sm:col-span-3 sm:w-fit" disabled={!f.value || add.isPending} onClick={() => add.mutate()}>Add evidence</button>
    </div>
  );
}

type Naukri = { rating?: number; reviews?: number; founded?: string; jobs_page?: string };

const enc = encodeURIComponent;
const google = (q: string) => `https://www.google.com/search?q=${enc(q)}`;
/** Searches that find the company's page on each portal, to paste into Extra links. */
const FINDERS: [string, (name: string) => string][] = [
  ["naukri", (n) => google(`site:naukri.com "${n}" overview`)],
  ["linkedin", (n) => `https://www.linkedin.com/search/results/companies/?keywords=${enc(n)}`],
  ["foundit", (n) => google(`site:foundit.in "${n}"`)],
  ["monster", (n) => google(`site:monster.com "${n}"`)],
];

/** "Find on Naukri / LinkedIn / Foundit / Monster" for the portals the company has no link for yet. */
function FindLinks({ company }: { company: CompanyDetail }) {
  const have = new Set((company.extra_links ?? []).map((l) => l.portal));
  if (company.linkedin_url) have.add("linkedin");
  const missing = FINDERS.filter(([portal]) => !have.has(portal));
  if (!missing.length) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500" aria-label="Find more links">
      <span>Find its page on</span>
      {missing.map(([portal, url]) => (
        <a key={portal} className="link" href={url(company.name)} target="_blank" rel="noopener noreferrer"
          title={`Search for ${company.name} on ${portalLabel(portal)}, then paste the link under Overview → Extra links`}>{portalLabel(portal)} ↗</a>
      ))}
    </p>
  );
}

/** Internal bookkeeping in attributes, not research to show. */
const HIDDEN_ATTRIBUTES = new Set(["scan_excluded", "not_duplicates", "logo"]);

function researchValue(v: unknown): ReactNode {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  const text = String(v);
  if (/^https?:\/\//.test(text)) {
    return <a className="link break-all" href={text} target="_blank" rel="noopener noreferrer">{text.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a>;
  }
  return text;
}

/** What imports said about the company (Naukri details, research sheets…), as labelled fields. */
function ImportedResearch({ attributes }: { attributes: Record<string, unknown> }) {
  const sections = Object.entries(attributes ?? {}).filter(([k]) => !HIDDEN_ATTRIBUTES.has(k));
  const groups = sections.filter(([, v]) => v && typeof v === "object" && !Array.isArray(v)) as [string, Record<string, unknown>][];
  const loose = sections.filter(([, v]) => !(v && typeof v === "object" && !Array.isArray(v)));
  if (!groups.length && !loose.length) return null;
  const label = (k: string) => (k === "naukri_id" ? "Naukri ID" : humanize(k.toUpperCase()));
  return (
    <Card title="Imported research">
      <div className="space-y-3 text-sm" data-testid="imported-research">
        {groups.map(([source, values]) => (
          <section key={source}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{source === "naukri" ? "Naukri" : humanize(source.toUpperCase())}</h3>
            <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1">
              {Object.entries(values).filter(([k]) => !HIDDEN_ATTRIBUTES.has(k)).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-xs text-slate-500">{label(k)}</dt><dd className="min-w-0 text-xs [overflow-wrap:anywhere]">{researchValue(v)}</dd></div>
              ))}
            </dl>
          </section>
        ))}
        {loose.length > 0 && (
          <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1">
            {loose.map(([k, v]) => <div key={k} className="contents"><dt className="text-xs text-slate-500">{label(k)}</dt><dd className="text-xs">{researchValue(v)}</dd></div>)}
          </dl>
        )}
      </div>
    </Card>
  );
}

export function CompanyDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  const c = useQuery({ queryKey: ["company", id], queryFn: () => api.get<CompanyDetail>(`/companies/${id}`) });
  const contacts = useQuery({ queryKey: ["recruiters", { company_id: id }], queryFn: () => api.get<Page<Contact>>("/recruiters", { company_id: id }) });
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/companies/${id}`, body), onSuccess: refresh });
  const check = useMutation({ mutationFn: () => api.post<{ results: Record<string, string> }>(`/companies/${id}/check`), onSuccess: refresh });
  const profile = useQuery({ queryKey: ["preferences"], queryFn: () => api.get<Preferences>("/preferences") });
  const appSettings = useQuery({ queryKey: ["app-settings"], queryFn: () => api.get<{ scanner?: { search_all_companies?: boolean } }>("/settings/app") });
  const searchAll = !!appSettings.data?.scanner?.search_all_companies;
  const board = useQuery({ queryKey: ["company-board", id], queryFn: () => api.get<{ provider: string; url: string } | null>(`/scanner/companies/${id}/board`) });
  const scan = useMutation({
    mutationFn: () => api.post<{ board: { provider: string; url: string } | null; run: ScanRun }>(`/scanner/companies/${id}/scan`),
    onSuccess: () => qc.invalidateQueries(),
  });
  const [heading, setHeading] = useState<HTMLElement | null>(null);
  const scrolled = useScrolledPast(heading);
  if (c.isLoading) return <Spinner />;
  if (c.error) return <ErrorBox error={c.error} />;
  const co = c.data!;
  const naukri = (co.attributes?.naukri ?? {}) as Naukri;
  const facts = [co.industry, co.company_type, co.employee_range && `${co.employee_range} employees`, co.headquarters,
    naukri.founded && `founded ${naukri.founded}`].filter(Boolean) as string[];
  const linkChip = (href: string | null | undefined, text: string) => href && (
    <a key={text} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-700 hover:border-indigo-400 hover:text-indigo-700"
      href={href} target="_blank" rel="noopener noreferrer">{text} ↗</a>
  );
  return (
    <div className="space-y-4">
      <StickyBar fallback="/companies" label="Back to companies">
        <span className={`min-w-0 flex-1 truncate text-sm transition-opacity ${scrolled ? "" : "invisible opacity-0"}`}
          data-testid="sticky-company" aria-hidden={!scrolled}>
          <span className="font-semibold text-slate-900">{co.name}</span>
          {facts.length > 0 && <span className="text-slate-500"> · {facts.slice(0, 2).join(" · ")}</span>}
        </span>
        {scrolled && <button className="btn-secondary hidden shrink-0 px-2 py-1 text-xs lg:inline-flex" disabled={scan.isPending} onClick={() => scan.mutate()}>{scan.isPending ? "Searching…" : "Search its board"}</button>}
      </StickyBar>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 ref={setHeading}>{co.name} <span className="text-base font-normal text-slate-400" title="Company ID">#{co.id}</span></h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge value={co.verification_status} /><Badge>score {co.verification_score}</Badge>
              {co.tier && <StatusBadge value={co.tier} />}
              {co.hiring_status === "HIRING" && <Badge tone="green">Hiring now</Badge>}
              {co.job_search_enabled && <Badge tone="indigo" title="Its job board is searched by Job board search">Job search on</Badge>}
              {co.rating != null && <span className="text-sm"><Rating value={co.rating} reviews={co.rating_reviews} /></span>}
            </div>
            {facts.length > 0 && <p className="mt-2 text-sm text-slate-600" data-testid="company-facts">{facts.join(" · ")}</p>}
            {co.aliases.length > 0 && <p className="mt-1 text-xs text-slate-500">Also known as: {co.aliases.join(", ")}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Company links">
              {linkChip(co.website, "Website")}
              {linkChip(co.careers_url, "Careers")}
              {linkChip(co.linkedin_url, "LinkedIn")}
              {board.data && linkChip(board.data.url, `${humanize(board.data.provider)} board`)}
              {co.extra_links?.map((l) => linkChip(l.url, portalLabel(l.portal)))}
              {naukri.jobs_page && linkChip(naukri.jobs_page, "Jobs on Naukri")}
            </div>
            <FindLinks company={co} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-32" aria-label="Tier" value={co.tier ?? ""} onChange={(e) => patch.mutate({ tier: e.target.value || null })}>
              <option value="">No tier</option><option value="TIER_A">Tier A</option><option value="TIER_B">Tier B</option><option value="TIER_C">Tier C</option>
            </select>
            {searchAll ? (
              <label className="flex items-center gap-2 text-sm"
                title="Settings → Job board search → Search every company is on. Untick to leave this company out of searches.">
                <input type="checkbox" aria-label="Job search" checked={!co.scan_excluded}
                  onChange={(e) => patch.mutate({ scan_excluded: !e.target.checked })} />
                Job search <span className="text-xs text-slate-500">{co.scan_excluded ? "(left out of all-company searches)" : "(all companies)"}</span>
              </label>
            ) : (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={co.job_search_enabled} onChange={(e) => patch.mutate({ job_search_enabled: e.target.checked })} />Job search</label>
            )}
            <button className="btn-secondary" disabled={scan.isPending} onClick={() => scan.mutate()} title="Search this company's job board now">{scan.isPending ? "Searching…" : "Search its board"}</button>
            <button className="btn-secondary" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? "Checking…" : "Run verification check"}</button>
          </div>
        </div>
        <div className="mt-3 border-t border-slate-100 pt-3"><WebSearch label="Find jobs for me with" topic={companyTopic(co.name, profile.data)} /></div>
      </Card>
      {scan.data && (
        <div className="rounded bg-slate-50 p-2 text-sm">
          {scan.data.board
            ? <>{humanize(scan.data.board.provider)} board: {runSummary(scan.data.run)}.{" "}{num(scan.data.run.stats.new) > 0 && <Link className="link" to={`/jobs?q=${encodeURIComponent(co.name)}`}>View jobs</Link>}</>
            : <>No supported job board found on the careers page. Set the careers URL to the company's Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee, Pinpoint or Teamtailor page.</>}
        </div>
      )}
      {scan.error && <ErrorBox error={new Error(errorMessage(scan.error))} />}
      {check.data && <div className="rounded bg-slate-50 p-2 text-xs">{Object.entries(check.data.results).map(([k, v]) => <div key={k}>{k}: {v}</div>)}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <CompanyJobs companyId={co.id} companyName={co.name} total={co.job_count ?? 0} open={co.open_job_count ?? 0}
            onScan={() => scan.mutate()} scanning={scan.isPending} />
          <Card title="Overview">
            <KeyValue items={[
              ["Website", co.website ? <a className="link" href={co.website} target="_blank" rel="noopener noreferrer">{co.website}</a> : "—"],
              ["Careers", co.careers_url ? <a className="link" href={co.careers_url} target="_blank" rel="noopener noreferrer">{co.careers_url}</a> : "—"],
              ["LinkedIn", co.linkedin_url ? <a className="link" href={co.linkedin_url} target="_blank" rel="noopener noreferrer">{co.linkedin_url}</a> : "—"],
              ["Extra links", <ExtraLinks key={co.id} companyId={co.id} links={co.extra_links} />],
              ["ATS", co.ats_provider ?? "—"],
              ["Job board", board.data ? <a className="link" href={board.data.url} target="_blank" rel="noopener noreferrer">{humanize(board.data.provider)}</a> : "not detected"], ["Headquarters", co.headquarters], ["Industry", co.industry],
              ["Type", co.company_type], ["Employees", co.employee_range],
              ["India presence", co.india_presence === null ? "Unknown" : co.india_presence ? "Yes" : "No"],
              ["Hiring", humanize(co.hiring_status)], ["Priority", co.priority], ["Last verified", formatDate(co.last_verified_at)],
              ["Added", formatDateTime(co.created_at, true)],
            ]} />
            <div className="mt-3"><div className="label">India locations</div><Chips items={co.india_locations} /></div>
            {co.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{co.notes}</p>}
          </Card>
          <Card>
            <details>
              <summary className="cursor-pointer font-semibold text-slate-800">
                Verification evidence <span className="text-sm font-normal text-slate-500">({co.sources.length} source{co.sources.length === 1 ? "" : "s"} · add evidence)</span>
              </summary>
              <div className="mt-3 overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
                <thead><tr><th className="th">Field</th><th className="th">Value</th><th className="th">Source</th><th className="th">Status</th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {co.sources.map((s) => (
                    <tr key={s.id}>
                      <td className="td text-xs">{s.field}</td>
                      <td className="td max-w-xs truncate text-xs" title={s.value ?? ""}>{s.value}</td>
                      <td className="td text-xs">{humanize(s.source_kind)}{s.source_name && ` · ${s.source_name}`}{s.source_url && <a className="link ml-1" href={s.source_url} target="_blank" rel="noopener noreferrer">↗</a>}{s.note && <div className="text-slate-400">{s.note}</div>}</td>
                      <td className="td"><StatusBadge value={s.verification_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <div className="mt-4 border-t border-slate-100 pt-3"><EvidenceForm companyId={co.id} onDone={refresh} /></div>
            </details>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card title="Recruiters">
            {contacts.data?.items.length ? contacts.data.items.map((r) => <div key={r.id} className="text-sm">{r.name} <span className="text-xs text-slate-500">{r.job_title}</span> <StatusBadge value={r.status} /></div>)
              : <p className="text-sm text-slate-500">None</p>}
          </Card>
          <ImportedResearch attributes={co.attributes} />
          <Card title="Verification status override">
            <select className="input" aria-label="Override" value={co.verification_override ?? ""} onChange={(e) => patch.mutate({ verification_override: e.target.value || null })}>
              <option value="">Derived from evidence</option><option value="NEEDS_REVIEW">Needs review</option><option value="REJECTED">Rejected</option><option value="INVALID">Invalid</option>
            </select>
          </Card>
        </div>
      </div>
    </div>
  );
}
