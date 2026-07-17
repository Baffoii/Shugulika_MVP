/** Small, dependency-free formatting helpers. */

export function formatDate(
  value: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", opts ?? { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeDays(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value).getTime();
  const days = Math.round((d - Date.now()) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined) return "—";
  const cur = currency ?? "TZS";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${cur} ${amount.toLocaleString()}`;
  }
}

export function salaryRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (min == null && max == null) return "Undisclosed";
  if (min != null && max != null)
    return `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
  return formatMoney(min ?? max, currency);
}

export function initials(name: string | null | undefined, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || fallback;
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
