"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/primitives";
import type { RecruiterComparisonRow } from "@/lib/data/recruiter-kpis";
import { RECRUITER_LEVEL_LABELS } from "@/lib/rbac";
import { formatDurationHours } from "@/lib/kpi/definitions";

type SortKey = "slaOverdue" | "activeWorkload" | "applicationsReviewed" | "placementRate" | "name";

const statusTone = {
  on_target: "success" as const,
  at_risk: "warn" as const,
  off_target: "orange" as const,
  insufficient_data: "neutral" as const,
};

export function RecruiterComparisonTable({
  rows,
  manageBasePath,
}: {
  rows: RecruiterComparisonRow[];
  manageBasePath: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("slaOverdue");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return asc ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
    return copy;
  }, [rows, sortKey, asc]);

  function toggle(key: SortKey) {
    if (sortKey === key) setAsc(!asc);
    else {
      setSortKey(key);
      setAsc(key === "name");
    }
  }

  if (rows.length === 0) {
    return <p className="p-4 text-sm text-ink-muted">No recruiters in this scope.</p>;
  }

  return (
    <DataTable className="border-0 shadow-none">
      <THead>
        <TR>
          <TH>
            <button type="button" className="font-semibold" onClick={() => toggle("name")}>
              Recruiter
            </button>
          </TH>
          <TH>Level</TH>
          <TH>Jobs</TH>
          <TH>
            <button
              type="button"
              className="font-semibold"
              onClick={() => toggle("activeWorkload")}
            >
              Workload
            </button>
          </TH>
          <TH>
            <button
              type="button"
              className="font-semibold"
              onClick={() => toggle("applicationsReviewed")}
            >
              Reviewed
            </button>
          </TH>
          <TH>Awaiting</TH>
          <TH>First review</TH>
          <TH>CS</TH>
          <TH>Placements</TH>
          <TH>
            <button type="button" className="font-semibold" onClick={() => toggle("placementRate")}>
              Place %
            </button>
          </TH>
          <TH>
            <button type="button" className="font-semibold" onClick={() => toggle("slaOverdue")}>
              SLA
            </button>
          </TH>
          <TH>Target</TH>
        </TR>
      </THead>
      <tbody>
        {sorted.map((r) => (
          <TR key={r.recruiterId}>
            <TD>
              <Link
                href={`${manageBasePath}/${r.recruiterId}`}
                className="font-medium text-brand-700 hover:underline"
              >
                {r.name}
              </Link>
              <p className="text-xs text-ink-muted">{r.email}</p>
            </TD>
            <TD className="text-xs">{RECRUITER_LEVEL_LABELS[r.level]}</TD>
            <TD className="tabular-nums">{r.assignedJobs}</TD>
            <TD className="tabular-nums">{r.activeWorkload}</TD>
            <TD className="tabular-nums">{r.applicationsReviewed}</TD>
            <TD className="tabular-nums">{r.awaitingFirstReview}</TD>
            <TD className="tabular-nums">{formatDurationHours(r.medianFirstReviewHours)}</TD>
            <TD className="tabular-nums">{r.clientSubmissions}</TD>
            <TD className="tabular-nums">{r.placements}</TD>
            <TD className="tabular-nums">
              {r.placementRate == null ? "—" : `${r.placementRate}%`}
            </TD>
            <TD className="tabular-nums font-medium">{r.slaOverdue}</TD>
            <TD>
              <Badge tone={statusTone[r.targetStatus]}>{r.targetStatus.replace(/_/g, " ")}</Badge>
            </TD>
          </TR>
        ))}
      </tbody>
    </DataTable>
  );
}
