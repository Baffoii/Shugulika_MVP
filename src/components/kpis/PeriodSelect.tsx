"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { KpiPeriod } from "@/lib/data/recruiter-kpis";

const PERIODS: { value: KpiPeriod; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
];

export function PeriodSelect({
  range,
  countryCode,
  countries,
  franchiseId,
  franchises,
}: {
  range: KpiPeriod;
  countryCode?: string;
  countries?: { code: string; name: string }[];
  franchiseId?: string;
  franchises?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function set(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap gap-3">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Period
        <select
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
          value={range}
          onChange={(e) => set("range", e.target.value)}
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {countries ? (
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Country
          <select
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
            value={countryCode ?? ""}
            onChange={(e) => set("country", e.target.value || undefined)}
          >
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {franchises ? (
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Franchise
          <select
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
            value={franchiseId ?? ""}
            onChange={(e) => set("franchise", e.target.value || undefined)}
          >
            <option value="">All franchises</option>
            {franchises.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
