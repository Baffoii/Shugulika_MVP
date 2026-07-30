"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type { AssignedRole, KpiCompany, KpiPeriod } from "@/lib/data/recruiter-kpis";

const PERIODS: { value: KpiPeriod; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
];

export function KpiFilters({
  range,
  roleId,
  roles,
  companyId,
  companies,
  showCustom = true,
}: {
  range: KpiPeriod;
  roleId?: string;
  roles: AssignedRole[];
  companyId?: string;
  companies: KpiCompany[];
  showCustom?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const update = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const activeRoles = roles.filter((r) => r.status === "active");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Period
        <select
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
          value={range}
          onChange={(e) => update({ range: e.target.value })}
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          {showCustom ? <option value="custom">Custom</option> : null}
        </select>
      </label>
      {range === "custom" ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            From
            <input
              type="date"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
              defaultValue={searchParams.get("from") ?? ""}
              onChange={(e) => update({ from: e.target.value || undefined, range: "custom" })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            To
            <input
              type="date"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
              defaultValue={searchParams.get("to") ?? ""}
              onChange={(e) => update({ to: e.target.value || undefined, range: "custom" })}
            />
          </label>
        </>
      ) : null}
      {companies.length > 0 ? (
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Company
          <select
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
            value={companyId ?? ""}
            onChange={(e) => update({ company: e.target.value || undefined })}
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.applicationCount})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {activeRoles.length > 0 ? (
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Role
          <select
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
            value={roleId ?? ""}
            onChange={(e) => update({ role: e.target.value || undefined })}
          >
            <option value="">All roles</option>
            {activeRoles.map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {r.roleName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
