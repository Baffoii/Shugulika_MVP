"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { AssignedRole, KpiCompany, KpiDateRange } from "@/lib/data/recruiter-kpis";
import { cn } from "@/lib/cn";

const RANGES: { id: KpiDateRange; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
];

export function KpiFilters({
  range,
  roleId,
  roles,
  companyId,
  companies,
}: {
  range: KpiDateRange;
  roleId: string | undefined;
  roles: AssignedRole[];
  companyId: string | undefined;
  companies: KpiCompany[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function hrefFor(next: {
    range?: string;
    role?: string | null;
    company?: string | null;
  }) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next.range) params.set("range", next.range);
    if (next.role === null) params.delete("role");
    else if (next.role !== undefined) {
      if (next.role) params.set("role", next.role);
      else params.delete("role");
    }
    if (next.company === null) params.delete("company");
    else if (next.company !== undefined) {
      if (next.company) params.set("company", next.company);
      else params.delete("company");
    }
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const activeRoles = roles.filter((r) => r.status === "active");

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
      <div
        className="inline-flex rounded-lg border border-surface-border bg-white p-0.5"
        role="group"
        aria-label="Date range"
      >
        {RANGES.map((r) => (
          <Link
            key={r.id}
            href={hrefFor({ range: r.id })}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              range === r.id
                ? "bg-brand-600 text-white"
                : "text-ink-muted hover:bg-surface-muted hover:text-ink",
            )}
            aria-current={range === r.id ? "page" : undefined}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="whitespace-nowrap">Company</span>
          <select
            className="max-w-[220px] rounded-lg border border-surface-border bg-white px-3 py-1.5 text-sm text-ink"
            aria-label="Filter KPIs by company"
            value={companyId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              window.location.href = hrefFor({ company: v || null });
            }}
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.applicationCount > 0 ? ` (${c.applicationCount})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="whitespace-nowrap">Role</span>
          <select
            className="max-w-[220px] rounded-lg border border-surface-border bg-white px-3 py-1.5 text-sm text-ink"
            aria-label="Filter KPIs by assigned role"
            value={roleId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              window.location.href = hrefFor({ role: v || null });
            }}
          >
            <option value="">All assigned roles</option>
            {activeRoles.map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {r.roleName}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
