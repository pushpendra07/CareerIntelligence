import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import { ListInput } from "../../components/ListInput";
import { ReminderToggle } from "../../components/Reminders";
import { Card, ErrorBox, Field, PageIntro, Spinner } from "../../components/ui";
import { formatDateTime } from "../../utils/format";

export type Rule = {
  id: string; kind: "check_portals" | "apply" | "follow_up" | "custom"; enabled: boolean; label: string;
  cron: string; portals: string[]; message: string; only_when_needed: boolean;
  schedule?: string; next_run?: string | null;
};
type Overview = { desktop: boolean; desktop_available: boolean; rules: Rule[] };

/** Ready-made schedules (cron, local time). "Custom" shows the cron field. */
export const PRESETS: { cron: string; label: string }[] = [
  { cron: "*/5 * * * *", label: "Every 5 minutes" },
  { cron: "*/15 * * * *", label: "Every 15 minutes" },
  { cron: "*/30 * * * *", label: "Every 30 minutes" },
  { cron: "0 * * * *", label: "Every hour" },
  { cron: "0 */2 * * *", label: "Every 2 hours" },
  { cron: "0 */4 * * *", label: "Every 4 hours" },
  { cron: "0 9-18 * * 1-5", label: "Every hour, 9:00–18:00, Mon–Fri" },
  { cron: "0 10-20/2 * * 1-6", label: "Every 2 hours, 10:00–20:00, Mon–Sat" },
  { cron: "0 9 * * *", label: "Every day at 9:00" },
  { cron: "0 9 * * 1-5", label: "Weekdays at 9:00" },
  { cron: "0 11,17 * * 1-5", label: "Weekdays at 11:00 and 17:00" },
  { cron: "30 10 * * 1-5", label: "Weekdays at 10:30" },
  { cron: "0 10 * * 1", label: "Mondays at 10:00" },
];

const KIND: Record<Rule["kind"], { label: string; hint: string }> = {
  check_portals: { label: "Check job portals", hint: "Reminds you to look for jobs on the portals below, and says how many new jobs are waiting." },
  apply: { label: "Apply", hint: "How many shortlisted jobs are waiting for your application." },
  follow_up: { label: "Follow up", hint: "How many follow-ups are due or late." },
  custom: { label: "Your message", hint: "Any reminder you like, e.g. update LinkedIn, practise interviews." },
};

function RuleEditor({ rule, onChange, onRemove }: { rule: Rule; onChange: (r: Rule) => void; onRemove?: () => void }) {
  const preset = PRESETS.some((p) => p.cron === rule.cron) ? rule.cron : "custom";
  const [custom, setCustom] = useState(preset === "custom");
  const test = useMutation({
    mutationFn: () => api.post<{ title: string; body: string }>(`/reminder-rules/${rule.id}/test`),
    meta: { success: "Test reminder sent — see the bell (and your notifications)", toastError: true },
  });
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => onChange({ ...rule, [k]: v });
  return (
    <li className={`rounded-2xl border p-4 transition ${rule.enabled ? "border-indigo-200 bg-indigo-50/30" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex items-center gap-3">
          <input type="checkbox" className="h-4 w-4" checked={rule.enabled} aria-label={`${rule.label} on`}
            onChange={(e) => set("enabled", e.target.checked)} />
          <span>
            <span className="block font-semibold text-slate-900">{rule.label}</span>
            <span className="block text-xs text-slate-500">{KIND[rule.kind].hint}</span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={test.isPending} onClick={() => test.mutate()}>Test now</button>
          {onRemove && <button type="button" className="rounded-lg px-2 py-1 text-xs text-rose-700 hover:bg-rose-50" onClick={onRemove}>Remove</button>}
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label="Name">
          <input className="input" value={rule.label} maxLength={80} onChange={(e) => set("label", e.target.value)} />
        </Field>
        <Field label="How often" hint={rule.enabled && rule.next_run ? `Next: ${formatDateTime(rule.next_run)}` : rule.enabled ? "Saved schedules show the next time here" : "Off"}>
          <select className="input" aria-label={`${rule.label} schedule`} value={custom ? "custom" : preset}
            onChange={(e) => { if (e.target.value === "custom") setCustom(true); else { setCustom(false); set("cron", e.target.value); } }}>
            {PRESETS.map((p) => <option key={p.cron} value={p.cron}>{p.label}</option>)}
            <option value="custom">Custom (cron)…</option>
          </select>
        </Field>
        {custom && (
          <Field label="Cron schedule" hint="minute hour day month weekday, your local time. E.g. */10 9-18 * * 1-5 = every 10 minutes, 9:00–18:59, Mon–Fri">
            <input className="input font-mono" aria-label={`${rule.label} cron`} value={rule.cron} onChange={(e) => set("cron", e.target.value)} />
          </Field>
        )}
        {rule.kind === "check_portals" && (
          <div className="md:col-span-2">
            <Field label="Portals to check"><ListInput label="Portals to check" value={rule.portals} onChange={(v) => set("portals", v)} placeholder="e.g. LinkedIn, Naukri" /></Field>
          </div>
        )}
        {rule.kind === "custom" && (
          <div className="md:col-span-2">
            <Field label="Message"><input className="input" value={rule.message} maxLength={300} onChange={(e) => set("message", e.target.value)} /></Field>
          </div>
        )}
        {(rule.kind === "apply" || rule.kind === "follow_up") && (
          <label className="flex items-center gap-2 text-sm text-slate-600 md:col-span-2">
            <input type="checkbox" checked={rule.only_when_needed} onChange={(e) => set("only_when_needed", e.target.checked)} />
            Only when there's something to do
          </label>
        )}
      </div>
    </li>
  );
}

/** Settings → Reminders: scheduled nudges to check portals, apply and follow up. */
export function ReminderSettings() {
  const q = useQuery({ queryKey: ["reminder-rules"], queryFn: () => api.get<Overview>("/reminder-rules") });
  const [form, setForm] = useState<Overview | null>(null);
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: (f: Overview) => api.put<Overview>("/reminder-rules", { desktop: f.desktop, rules: f.rules }),
    onSuccess: (saved) => setForm(saved),
    meta: { success: "Reminders saved" },
  });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!form) return <Spinner />;
  const dirty = JSON.stringify({ d: form.desktop, r: form.rules.map(({ schedule: _s, next_run: _n, ...r }) => r) })
    !== JSON.stringify({ d: q.data?.desktop, r: q.data?.rules.map(({ schedule: _s, next_run: _n, ...r }) => r) });
  const update = (i: number, r: Rule) => setForm({ ...form, rules: form.rules.map((x, j) => (j === i ? r : x)) });
  const addCustom = () => {
    const n = form.rules.filter((r) => r.kind === "custom").length + 1;
    setForm({ ...form, rules: [...form.rules, { id: `custom-${Date.now().toString(36)}`, kind: "custom", enabled: true,
      label: `Reminder ${n}`, cron: "0 9 * * 1-5", portals: [], message: "", only_when_needed: false }] });
  };
  return (
    <div className="space-y-5">
      <div><h1>Reminders</h1><PageIntro>Nudges on a schedule — check the job portals, apply to shortlisted jobs, follow up — like a cron job. The app checks every minute while it runs; each reminder shows in the 🔔 bell, as a message in the app and as a notification.</PageIntro></div>
      <Card title="Where reminders reach you">
        <ul className="space-y-3 text-sm">
          <li className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-700">In the app:</span> the 🔔 bell and a message at the bottom of the screen — always on.</li>
          <li><span className="font-medium text-slate-700">Browser notifications</span> (while the app is open in a tab):<div className="mt-1"><ReminderToggle /></div></li>
          <li>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={form.desktop} disabled={!form.desktop_available}
                onChange={(e) => setForm({ ...form, desktop: e.target.checked })} />
              <span>
                <span className="font-medium text-slate-700">macOS notifications</span> — work even when the browser is closed (the app must be running).
                {!form.desktop_available && <span className="block text-xs text-slate-500">Only when the app runs directly on a Mac (not in Docker).</span>}
                {form.desktop_available && <span className="block text-xs text-slate-500">The first one may ask to allow notifications from “Script Editor” in System Settings → Notifications.</span>}
              </span>
            </label>
          </li>
        </ul>
      </Card>
      <Card title="Your reminders" actions={<button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={addCustom}>+ Add a reminder</button>}>
        <ul className="space-y-3">
          {form.rules.map((r, i) => (
            <RuleEditor key={r.id} rule={r} onChange={(x) => update(i, x)}
              onRemove={r.kind === "custom" ? () => setForm({ ...form, rules: form.rules.filter((_, j) => j !== i) }) : undefined} />
          ))}
        </ul>
        {save.error && <div className="mt-3"><ErrorBox error={new Error(errorMessage(save.error))} /></div>}
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(form)}>{save.isPending ? "Saving…" : "Save reminders"}</button>
          {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
        </div>
      </Card>
    </div>
  );
}
