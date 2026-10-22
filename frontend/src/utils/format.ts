/** Codes whose plain words would be unclear. */
const LABELS: Record<string, string> = {
  AWAITING_FEEDBACK: "Interview done – no reply",
};

export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  if (LABELS[value]) return LABELS[value];
  return value
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "Oct 20" this year, "Oct 20, 2025" otherwise: for narrow table columns. */
export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(!sameYear && { year: "numeric" }) });
}

/** How long ago, in words for a narrow column: "today", "1 day", "5 days", "3 weeks", "2 months". */
export function timeSince(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  return `${Math.floor(days / 30)} months`;
}

export function formatDateTime(value: string | null | undefined, withYear = false): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString(undefined, { day: "numeric", month: "short", ...(withYear && { year: "numeric" }), hour: "2-digit", minute: "2-digit" });
}

/** INR amounts read better in lakhs ("35 L"); other currencies use compact notation. */
export function formatMoney(value: string | number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (!currency || currency === "INR") {
    if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)} L`;
    return `₹${n.toLocaleString("en-IN")}`;
  }
  return new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact" }).format(n);
}

export function salaryRange(min: string | null, max: string | null, currency: string | null): string {
  if (!min && !max) return "Not disclosed";
  if (min && max && min !== max) return `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
  return formatMoney(max ?? min, currency);
}

export function experienceRange(min: string | null, max: string | null): string {
  if (!min && !max) return "—";
  const a = min ? Number(min) : null;
  const b = max ? Number(max) : null;
  if (a !== null && b !== null) return `${a}–${b} yrs`;
  return a !== null ? `${a}+ yrs` : `≤ ${b} yrs`;
}

export function splitList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Job source codes in their usual spelling (LINKEDIN → LinkedIn). */
const SOURCE_NAMES: Record<string, string> = {
  LINKEDIN: "LinkedIn", SMARTRECRUITERS: "SmartRecruiters", SUCCESSFACTORS: "SuccessFactors",
  OTHER_ATS: "Other job boards", CAREER_OPS: "Career-Ops", COMPANY_CAREERS: "Company career sites",
  INSTAHYRE: "Instahyre", RECRUITER_EMAIL: "Recruiter email", WHATSAPP: "WhatsApp",
};
export function sourceName(code: string): string {
  return SOURCE_NAMES[code] ?? humanize(code);
}
