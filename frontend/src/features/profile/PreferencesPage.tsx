import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { ListInput } from "../../components/ListInput";
import { ErrorBox, Field, Spinner, PageIntro, Switch } from "../../components/ui";
import type { Preferences, Profile } from "../../types/api";
import { ImpactPreview, RuleTester, type ImportRules, type ProfileKey, type ProfileLists } from "./ImportFilter";

type RulesData = { rules: ImportRules; sources: Record<string, string> };

/** What you bring (the professional profile, filled from your CV), at the bottom of the page. */
const YEARS = [["total_experience_years", "Total experience (yrs)"], ["relevant_experience_years", "Relevant experience (yrs)"],
  ["leadership_experience_years", "Leadership experience (yrs)"]] as const;
const SKILL_LISTS = [["primary_roles", "Primary roles", "roles you have done"], ["core_skills", "Core skills", "what you're strongest in"],
  ["additional_skills", "Additional skills"], ["domains", "Domains", "industries / platforms you know"], ["leadership", "Leadership"],
  ["certifications", "Certifications"]] as const;
type Skills = Pick<Profile, (typeof YEARS)[number][0] | (typeof SKILL_LISTS)[number][0] | "achievements">;
const pickSkills = (p: Profile): Skills => ({
  total_experience_years: p.total_experience_years, relevant_experience_years: p.relevant_experience_years,
  leadership_experience_years: p.leadership_experience_years, primary_roles: p.primary_roles, core_skills: p.core_skills,
  additional_skills: p.additional_skills, domains: p.domains, leadership: p.leadership, certifications: p.certifications,
  achievements: p.achievements,
});

const NOT_LINKED: ImportRules["from_profile"] = { target_titles: false, required_skills: false, excluded_roles: false, excluded_technologies: false };
/** Older filter-only words → the list they now belong to. */
const OLD_WORDS: [keyof ImportRules & ("required_roles" | "required_skills" | "ignored_roles" | "ignored_skills"), ProfileKey][] = [
  ["required_roles", "target_titles"], ["required_skills", "required_skills"], ["ignored_roles", "excluded_roles"], ["ignored_skills", "excluded_technologies"],
];

/** The rules as the page keeps them: a row filters only while filtering is on, and filtering is
 * on while any row filters. Fills in what an older API (not restarted since the update) leaves out. */
function normalize(r: ImportRules): ImportRules {
  const linked = { ...NOT_LINKED, ...(r.from_profile ?? {}) };
  const from_profile = Object.fromEntries(Object.entries(linked).map(([k, v]) => [k, !!r.enabled && v])) as ImportRules["from_profile"];
  return { ...r, extras_enabled: r.extras_enabled ?? true, from_profile, enabled: Object.values(from_profile).some(Boolean) };
}
const union = (a: string[], b: string[]) => [...a, ...b.filter((x) => !a.some((y) => y.toLowerCase() === x.toLowerCase()))];

/** One page, one list per idea: older filter-only words (Settings → Import rules) that were in use
 * move into the matching list here, and that list filters. Returns the merged form and rules. */
function mergeOldWords(prefs: Preferences, rules: ImportRules): { form: Preferences; rules: ImportRules; moved: number } {
  const active = rules.enabled && rules.extras_enabled;
  let form = prefs;
  let next = normalize(rules);
  let moved = 0;
  for (const [old, key] of OLD_WORDS) {
    const words = rules[old] ?? [];
    if (!words.length) continue;
    if (!active) continue; // switched off before: left as they were (they don't filter)
    moved += words.length;
    form = { ...form, [key]: union(form[key], words) };
    next = { ...next, [old]: [], from_profile: { ...next.from_profile, [key]: true } };
  }
  return { form, rules: { ...next, enabled: Object.values(next.from_profile).some(Boolean) }, moved };
}

const COMMON_IGNORED_TITLES = ["Intern", "Trainee", "Sales", "Recruiter", "QA", "Support"];
const COMMON_IGNORED_SKILLS = ["Java", ".NET", "Salesforce", "SAP", "Python", "Shopify"];

/** Learned from your jobs (GET /preferences/suggestions): what you went for and what you turned down. */
type Learned = { value: string; count: number };
type Suggestions = { based_on: { went_for: number; turned_down: number } } & Record<ProfileKey, Learned[]>;
type Idea = { value: string; why?: string; count?: number };

/** Suggested words for one row: from your jobs first (with how many), then your CV or common ones. */
function Ideas({ name, ideas, have, onAdd }: { name: string; ideas: Idea[]; have: string[]; onAdd: (x: string) => void }) {
  const seen = new Set(have.map((v) => v.toLowerCase()));
  const shown = ideas.filter((x) => !seen.has(x.value.toLowerCase()) && (seen.add(x.value.toLowerCase()), true)).slice(0, 8);
  if (!shown.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label={`Suggestions for ${name}`}>
      <span className="text-[11px] text-slate-400">Suggested:</span>
      {shown.map((x) => (
        <button key={x.value} type="button" onClick={() => onAdd(x.value)} title={x.why}
          className={`rounded-full border px-2 py-px text-[11px] hover:border-indigo-400 hover:text-indigo-700 ${x.count ? "border-indigo-200 bg-indigo-50/60 text-indigo-800" : "border-dashed border-slate-300 text-slate-600"}`}>
          + {x.value}{x.count ? <> <span className="text-slate-400">{x.count}</span></> : null}
        </button>
      ))}
    </div>
  );
}

const fromJobs = (items: Learned[] | undefined, went: boolean): Idea[] => (items ?? []).map((x) => ({
  value: x.value, count: x.count,
  why: went ? `In ${x.count} jobs you shortlisted, applied to or interviewed for` : `In ${x.count} jobs you marked Not relevant or Ignored, and rarely in ones you applied to`,
}));
const plain = (items: string[], why: string): Idea[] => items.map((value) => ({ value, why }));

/** One row of the search form: what it is, the words, and (for lists that can filter) the switch. */
function Row({ label, help, children, filter }: {
  label: string; help: string; children: ReactNode;
  filter?: { on: boolean; onChange: (on: boolean) => void; on_text: string; skip?: boolean };
}) {
  return (
    <div className="grid gap-x-6 gap-y-2 py-4 first:pt-0 md:grid-cols-[13rem_minmax(0,1fr)_11rem]" role="group" aria-label={label} data-row>
      <div>
        <div className="text-sm font-semibold text-slate-800">{label}</div>
        <div className="text-xs text-slate-500">{help}</div>
      </div>
      <div className="min-w-0">{children}</div>
      <div className="flex items-start gap-2 md:justify-end">
        {filter ? (
          <>
            <span className={`text-right text-xs ${filter.on ? (filter.skip ? "text-rose-700" : "text-emerald-700") : "text-slate-400"}`}>
              {filter.on ? filter.on_text : "Score only"}
            </span>
            <Switch checked={filter.on} onChange={filter.onChange} label={`Filter by ${label}`} />
          </>
        ) : <span className="text-xs text-slate-400">Score only</span>}
      </div>
    </div>
  );
}

const MORE: [keyof Preferences, string, string?][] = [
  ["preferred_domains", "Preferred domains", "e.g. eCommerce, Retail"],
  ["preferred_companies", "Preferred companies"],
  ["employment_types", "Employment types", "e.g. Full-time, Contract"],
  ["excluded_industries", "Excluded industries"],
];

export function PreferencesPage() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: () => api.get<Preferences>("/preferences") });
  const saved = useQuery({ queryKey: ["import-rules"], queryFn: () => api.get<RulesData>("/import-rules") });
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile>("/profile") });
  const learned = useQuery({ queryKey: ["preferences", "suggestions"], queryFn: () => api.get<Suggestions>("/preferences/suggestions"), retry: false }).data;
  const [form, setForm] = useState<Preferences | null>(null);
  const [rules, setRules] = useState<ImportRules | null>(null);
  const [skills, setSkills] = useState<Skills | null>(null);
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    if (!prefs.data || !saved.data) return;
    const m = mergeOldWords(prefs.data, saved.data.rules);
    setForm(m.form); setRules(m.rules); setMoved(m.moved);
  }, [prefs.data, saved.data]);
  useEffect(() => { if (profile.data) setSkills(pickSkills(profile.data)); }, [profile.data]);
  // One Save for everything on the page: the search (scoring + filters) and what you bring.
  const save = useMutation({
    mutationFn: async ({ have, body, filter }: { have: Record<string, unknown> | null; body: Record<string, unknown> | null; filter: ImportRules | null }) => {
      if (have) qc.setQueryData(["profile"], await api.patch<Profile>("/profile", have));
      if (body) qc.setQueryData(["preferences"], await api.patch<Preferences>("/preferences", body));
      if (filter) await api.patch("/settings/app", { import_rules: filter });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["import-rules"] }); },
  });
  const searchNow = useMutation({
    mutationFn: () => api.post("/scanner/run", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner"] }),
    meta: { success: "Job board search started — new jobs appear in Jobs in 1–3 minutes", toastError: true },
  });
  const { hash } = useLocation();
  const ready = !!form && !!rules && !!skills;
  useEffect(() => {
    if (!ready || !hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el instanceof HTMLDetailsElement) el.open = true;
    el?.scrollIntoView({ block: "start" });
  }, [ready, hash]);
  if (prefs.error) return <ErrorBox error={prefs.error} />;
  if (profile.error) return <ErrorBox error={profile.error} />;
  if (!form || !rules || !saved.data || !skills || !profile.data || !prefs.data) return <Spinner />;

  const skillsChanged = JSON.stringify(skills) !== JSON.stringify(pickSkills(profile.data));
  const prefsChanged = JSON.stringify(form) !== JSON.stringify(prefs.data);
  const rulesChanged = JSON.stringify(rules) !== JSON.stringify(normalize(saved.data.rules));
  const changed = skillsChanged || prefsChanged || rulesChanged;
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setForm({ ...form, [k]: v });
  const setSkill = <K extends keyof Skills>(k: K, v: Skills[K]) => setSkills({ ...skills, [k]: v });
  const filterBy = (key: ProfileKey, on: boolean) => {
    const from_profile = { ...rules.from_profile, [key]: on };
    setRules({ ...rules, from_profile, enabled: Object.values(from_profile).some(Boolean) });
  };
  const lists: ProfileLists = { target_titles: form.target_titles, required_skills: form.required_skills,
    excluded_roles: form.excluded_roles, excluded_technologies: form.excluded_technologies };
  const num = (v: string | null) => (v === null || v === "" ? null : v);
  const submit = () => {
    const { version: _v, effective_titles: _e, ...rest } = form; // eslint-disable-line @typescript-eslint/no-unused-vars
    void _v; void _e;
    save.mutate({
      have: skillsChanged ? { ...skills, total_experience_years: num(skills.total_experience_years),
        relevant_experience_years: num(skills.relevant_experience_years), leadership_experience_years: num(skills.leadership_experience_years) } : null,
      body: prefsChanged ? {
        ...rest,
        min_experience_years: num(form.min_experience_years), max_experience_years: num(form.max_experience_years),
        min_salary: num(form.min_salary), target_salary: num(form.target_salary),
        notice_period_days: form.notice_period_days === null || String(form.notice_period_days) === "" ? null : Number(form.notice_period_days),
      } : null,
      filter: rulesChanged ? rules : null,
    });
    setMoved(0);
  };
  const toggleSource = (key: string, on: boolean) =>
    setRules({ ...rules, sources: Object.keys(saved.data!.sources).filter((k) => (k === key ? on : rules.sources.includes(k))) });
  const filtering = (Object.keys(rules.from_profile) as ProfileKey[]).filter((k) => rules.from_profile[k]).length;
  const work = (["remote_ok", "hybrid_ok", "onsite_ok"] as const).filter((k) => form[k]).map((k) => k.replace("_ok", ""));
  const list = (key: keyof Preferences, label: string, placeholder?: string) => (
    <ListInput label={label} value={form[key] as string[]} onChange={(v) => set(key, v as never)} placeholder={placeholder} />
  );

  return (
    <div className="space-y-4">
      <div>
        <h1>Skills & targets</h1>
        <PageIntro>Your job search in one form. Every job is scored against it; switch <b>Filter</b> on for a row and it also decides which jobs are searched and saved.
          {learned && learned.based_on.went_for + learned.based_on.turned_down > 0 && <> Suggestions with a number come from your own jobs: {learned.based_on.went_for} you went for, {learned.based_on.turned_down} you marked Not relevant or Ignored.</>}</PageIntro>
      </div>
      {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
      {moved > 0 && (
        <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900" role="status">
          Your {moved} words from the old <i>Import rules</i> are now in the lists below, with Filter on. Press <b>Save</b> to keep this.
        </p>
      )}

      <section className="card p-0!" aria-label="Job search">
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-slate-200 bg-surface/95 px-5 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold">Job search</h2>
            <p className="text-xs text-slate-500">
              {form.target_titles.length || "Any"} title{form.target_titles.length === 1 ? "" : "s"} · {form.required_skills.length || "any"} must-have skill{form.required_skills.length === 1 ? "" : "s"}
              {form.preferred_locations.length > 0 && ` · ${form.preferred_locations.slice(0, 2).join(", ")}${form.preferred_locations.length > 2 ? "…" : ""}`}
              {work.length > 0 && work.length < 3 && ` (${work.join("/")})`}
              {" · "}{filtering ? `${filtering} filter${filtering === 1 ? "" : "s"} on` : "no filters: every job is saved"}
            </p>
          </div>
          {changed && <span className="text-xs text-amber-700">Unsaved changes</span>}
          <button className="btn-primary" onClick={submit} disabled={save.isPending || !changed}>{save.isPending ? "Saving…" : "Save"}</button>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden />
          <button type="button" className="btn-secondary" disabled={searchNow.isPending || changed} onClick={() => searchNow.mutate()}
            title={changed ? "Save first, so the search uses your changes" : "Search your companies' job boards now (1–3 minutes)"}>
            {searchNow.isPending ? "Starting…" : "Search job boards"}
          </button>
          <Link className="btn-secondary" to="/jobs/ai-search" title="LinkedIn, Naukri, Indeed… with Claude, Gemini or the Job collector">Search portals</Link>
        </div>
        {save.isSuccess && !changed && <p className="mx-5 mt-3 rounded bg-emerald-50 p-2 text-sm text-emerald-800" role="status">Saved. Scores refresh by themselves within a minute.</p>}

        <div className="divide-y divide-slate-100 px-5 pt-4">
          <Row label="Job titles" help="Titles you're looking for. Senior, Lead… don't have to match."
            filter={{ on: rules.from_profile.target_titles, onChange: (on) => filterBy("target_titles", on), on_text: "Only fitting titles" }}>
            {list("target_titles", "Job titles", "e.g. Magento Developer, Tech Lead")}
            <Ideas name="Job titles" have={form.target_titles} onAdd={(x) => set("target_titles", [...form.target_titles, x])}
              ideas={[...fromJobs(learned?.target_titles, true), ...plain(skills.primary_roles, "A role on your CV")]} />
            <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={form.include_architect_roles} onChange={(e) => set("include_architect_roles", e.target.checked)} />
              Also Architect roles
            </label>
          </Row>
          <Row label="Must-have skills" help="A job should mention at least one."
            filter={{ on: rules.from_profile.required_skills, onChange: (on) => filterBy("required_skills", on), on_text: "Must mention one" }}>
            {list("required_skills", "Must-have skills", "e.g. Magento 2, PHP")}
            <Ideas name="Must-have skills" have={form.required_skills} onAdd={(x) => set("required_skills", [...form.required_skills, x])}
              ideas={[...fromJobs(learned?.required_skills, true), ...plain(skills.core_skills, "A core skill on your CV")]} />
          </Row>
          <Row label="Nice-to-have skills" help="Raise the score when a job mentions them.">
            {list("preferred_skills", "Nice-to-have skills", "e.g. GraphQL, AWS")}
            <Ideas name="Nice-to-have skills" have={[...form.preferred_skills, ...form.required_skills]} onAdd={(x) => set("preferred_skills", [...form.preferred_skills, x])}
              ideas={plain(skills.additional_skills, "An additional skill on your CV")} />
          </Row>
          <Row label="Ignore titles" help="Roles you don't want."
            filter={{ on: rules.from_profile.excluded_roles, onChange: (on) => filterBy("excluded_roles", on), on_text: "Never saved", skip: true }}>
            {list("excluded_roles", "Ignore titles", "e.g. Intern, Sales")}
            <Ideas name="Ignore titles" have={form.excluded_roles} onAdd={(x) => set("excluded_roles", [...form.excluded_roles, x])}
              ideas={[...fromJobs(learned?.excluded_roles, false), ...plain(COMMON_IGNORED_TITLES, "Often ignored")]} />
          </Row>
          <Row label="Ignore skills" help="Technologies you don't work with."
            filter={{ on: rules.from_profile.excluded_technologies, onChange: (on) => filterBy("excluded_technologies", on), on_text: "Never saved", skip: true }}>
            {list("excluded_technologies", "Ignore skills", "e.g. Java, Salesforce")}
            <Ideas name="Ignore skills" have={[...form.excluded_technologies, ...skills.core_skills, ...form.required_skills]}
              onAdd={(x) => set("excluded_technologies", [...form.excluded_technologies, x])}
              ideas={[...fromJobs(learned?.excluded_technologies, false), ...plain(COMMON_IGNORED_SKILLS, "Often ignored")]} />
          </Row>
          <Row label="Where" help="Cities (or 'Remote India') and how you want to work.">
            {list("preferred_locations", "Locations", "e.g. Pune, Remote India")}
            <div className="mt-2 flex flex-wrap gap-4">
              {(["remote_ok", "hybrid_ok", "onsite_ok"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} />{k.replace("_ok", "").replace(/^./, (c) => c.toUpperCase())}</label>
              ))}
            </div>
          </Row>
          <Row label="Experience & pay" help="Years the job may ask for, and your salary (annual).">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Min years"><input className="input" type="number" step="0.5" value={form.min_experience_years ?? ""} onChange={(e) => set("min_experience_years", e.target.value)} /></Field>
              <Field label="Max years"><input className="input" type="number" step="0.5" value={form.max_experience_years ?? ""} onChange={(e) => set("max_experience_years", e.target.value)} /></Field>
              <Field label="Minimum salary"><input className="input" type="number" value={form.min_salary ?? ""} onChange={(e) => set("min_salary", e.target.value)} /></Field>
              <Field label="Target salary"><input className="input" type="number" value={form.target_salary ?? ""} onChange={(e) => set("target_salary", e.target.value)} /></Field>
              <Field label="Currency"><input className="input" maxLength={3} value={form.salary_currency} onChange={(e) => set("salary_currency", e.target.value.toUpperCase())} /></Field>
              <Field label="Notice (days)"><input className="input" type="number" value={form.notice_period_days ?? ""} onChange={(e) => set("notice_period_days", e.target.value as unknown as number)} /></Field>
            </div>
          </Row>
        </div>

        <details className="border-t border-slate-100 px-5 py-3" id="advanced">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Advanced: domains, companies, industries, where filters apply</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {MORE.map(([k, label, hint]) => <Field key={k} label={label} hint={hint}>{list(k, label)}</Field>)}
          </div>
          <fieldset className="mt-4">
            <legend className="label">Filters apply to jobs from</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {Object.entries(saved.data.sources).map(([key, name]) => (
                <label key={key} className="flex items-center gap-1">
                  <input type="checkbox" checked={rules.sources.includes(key)} onChange={(e) => toggleSource(key, e.target.checked)} />{name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={rules.keep_without_description} onChange={(e) => setRules({ ...rules, keep_without_description: e.target.checked })} />
            <span>Keep jobs that have no description yet <span className="block text-xs text-slate-500">Sheet and Career-Ops rows often have only a title: kept unless the title breaks a filter.</span></span>
          </label>
        </details>

        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 lg:flex-row" id="import-filter">
          <ImpactPreview rules={rules} profile={lists} />
          <RuleTester rules={rules} profile={lists} />
        </div>
      </section>

      <details className="card" id="skills">
        <summary className="cursor-pointer">
          <span className="font-display text-base font-semibold">From your CV</span>
          <span className="ml-2 text-xs text-slate-500">experience {skills.total_experience_years ?? "?"} yrs · {skills.core_skills.length} core skills · {skills.domains.length} domains — what jobs are compared with</span>
        </summary>
        <p className="mb-3 mt-3 text-xs text-slate-500">Filled from your CV (CVs → Merge into profile). Fix anything that's wrong; it's saved with the Save button above.</p>
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          {YEARS.map(([k, label]) => (
            <Field key={k} label={label}><input className="input" type="number" step="0.1" min={0} value={skills[k] ?? ""} onChange={(e) => setSkill(k, e.target.value)} /></Field>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {SKILL_LISTS.map(([k, label, hint]) => (
            <Field key={k} label={label} hint={hint}><ListInput label={label} value={skills[k]} onChange={(v) => setSkill(k, v)} /></Field>
          ))}
          <div className="md:col-span-2"><Field label="Achievements"><ListInput label="Achievements" value={skills.achievements} onChange={(v) => setSkill("achievements", v)} /></Field></div>
        </div>
      </details>
    </div>
  );
}
