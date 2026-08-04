"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { FranchisePeriodGrain, FranchiseSortMode } from "@/lib/franchise/types";

const GRAINS: { value: FranchisePeriodGrain; label: string }[] = [
  { value: "day", label: "Today (24h)" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
  { value: "year", label: "Year to date" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "ytd", label: "YTD" },
];

const SORTS: { value: FranchiseSortMode; label: string }[] = [
  { value: "sla_first", label: "SLA due first" },
  { value: "alpha_asc", label: "Name A–Z" },
  { value: "alpha_desc", label: "Name Z–A" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

/**
 * Franchise-local period + alphabetical controls. Does not edit shared PeriodSelect.
 * Always used inside pages that are already franchise-scoped via RLS.
 */
export function FranchisePeriodBar({
  grain,
  sort,
  showSort = true,
}: {
  grain: FranchisePeriodGrain;
  sort?: FranchiseSortMode;
  showSort?: boolean;
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
          value={grain}
          onChange={(e) => set("range", e.target.value)}
        >
          {GRAINS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      {showSort ? (
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Sort
          <select
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
            value={sort ?? "sla_first"}
            onChange={(e) => set("sort", e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
