export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
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

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
