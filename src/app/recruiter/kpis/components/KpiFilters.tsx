"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type {
  AssignedRole,
  KpiCompany,
  KpiJobOption,
  KpiStageOption,
} from "@/lib/data/recruiter-kpis";
import {
  KPI_GRAINS,
  KPI_GRAIN_LABELS,
  type KpiFilterState,
  type KpiGrain,
} from "@/lib/kpi/filters";

/**
 * Recruiter KPI filters: date grain, assigned role, employer, job, and stage.
 *
 * There is deliberately no recruiter/owner picker and no nationality filter.
 * Scope comes from the session on the server; the options offered here are
 * already restricted to the recruiter's own work, and the loader re-checks
 * every submitted value against that list.
 */
export function KpiFilters({
  filters,
  roles,
  companies,
  jobs,
  stages,
}: {
  filters: KpiFilterState;
  roles: AssignedRole[];
  companies: KpiCompany[];
  jobs: KpiJobOption[];
  stages: KpiStageOption[];
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
      // Legacy param from the pre-grain dashboard; `grain` supersedes it.
      next.delete("range");
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const activeRoles = roles.filter((r) => r.status === "active");
  const visibleJobs = filters.employerOrgId
    ? jobs.filter((j) => j.employerOrgId === filters.employerOrgId)
    : jobs;

  const selectClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Period
        <select
          className={selectClass}
          value={filters.grain}
          onChange={(e) => update({ grain: e.target.value as KpiGrain })}
        >
          {KPI_GRAINS.map((g) => (
            <option key={g} value={g}>
              {KPI_GRAIN_LABELS[g]}
            </option>
          ))}
        </select>
      </label>

      {filters.grain === "custom" ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            From
            <input
              type="date"
              className={selectClass}
              defaultValue={filters.from ?? ""}
              onChange={(e) => update({ from: e.target.value || undefined, grain: "custom" })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            To
            <input
              type="date"
              className={selectClass}
              defaultValue={filters.to ?? ""}
              onChange={(e) => update({ to: e.target.value || undefined, grain: "custom" })}
            />
          </label>
        </>
      ) : null}

      {activeRoles.length > 0 ? (
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Assigned role
          <select
            className={selectClass}
            value={filters.roleId ?? ""}
            onChange={(e) => update({ role: e.target.value || undefined })}
          >
            <option value="">All my roles</option>
            {activeRoles.map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {r.roleName}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {companies.length > 0 ? (
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Employer
          <select
            className={selectClass}
            value={filters.employerOrgId ?? ""}
            onChange={(e) => update({ employer: e.target.value || undefined, job: undefined })}
          >
            <option value="">All employers</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.applicationCount})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {visibleJobs.length > 0 ? (
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Job
          <select
            className={selectClass}
            value={filters.jobOrderId ?? ""}
            onChange={(e) => update({ job: e.target.value || undefined })}
          >
            <option value="">All jobs</option>
            {visibleJobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} ({j.applicationCount})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {stages.length > 0 ? (
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Stage
          <select
            className={selectClass}
            value={filters.stage ?? ""}
            onChange={(e) => update({ stage: e.target.value || undefined })}
          >
            <option value="">All stages</option>
            {stages.map((s) => (
              <option key={s.key} value={s.key}>
                {s.key.replace(/_/g, " ")} ({s.count})
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
