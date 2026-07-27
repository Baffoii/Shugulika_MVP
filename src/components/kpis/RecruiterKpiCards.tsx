import { Badge, Card } from "@/components/ui/primitives";
import type { RecruiterComparisonRow } from "@/lib/data/recruiter-kpis";
import { RECRUITER_LEVEL_LABELS } from "@/lib/rbac";
import { formatDurationHours } from "@/lib/kpi/definitions";
import Link from "next/link";

const statusTone = {
  on_target: "success" as const,
  at_risk: "warn" as const,
  off_target: "orange" as const,
  insufficient_data: "neutral" as const,
};

/** Compact per-recruiter KPI cards for franchise/HQ comparison. */
export function RecruiterKpiCards({
  rows,
  manageBasePath,
}: {
  rows: RecruiterComparisonRow[];
  manageBasePath: string;
}) {
  if (rows.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm font-medium text-ink">No recruiters in this franchise yet</p>
        <p className="mt-1 text-sm text-ink-muted">
          Recruiters with an active membership on this franchise organization will appear here with
          workload, review, placement, and SLA metrics.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => (
        <Card key={r.recruiterId} className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Link
                href={`${manageBasePath}/${r.recruiterId}`}
                className="font-semibold text-ink hover:text-brand-700 hover:underline"
              >
                {r.name}
              </Link>
              <p className="text-xs text-ink-muted">{RECRUITER_LEVEL_LABELS[r.level]}</p>
              <p className="text-xs text-ink-subtle">{r.email}</p>
            </div>
            <Badge tone={statusTone[r.targetStatus]}>{r.targetStatus.replace(/_/g, " ")}</Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-ink-subtle">Active workload</dt>
              <dd className="font-medium tabular-nums text-ink">{r.activeWorkload}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Apps reviewed</dt>
              <dd className="font-medium tabular-nums text-ink">{r.applicationsReviewed}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Awaiting review</dt>
              <dd className="font-medium tabular-nums text-ink">{r.awaitingFirstReview}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">First review (median)</dt>
              <dd className="font-medium tabular-nums text-ink">
                {formatDurationHours(r.medianFirstReviewHours)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Client submissions</dt>
              <dd className="font-medium tabular-nums text-ink">{r.clientSubmissions}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Placements</dt>
              <dd className="font-medium tabular-nums text-ink">{r.placements}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Placement rate</dt>
              <dd className="font-medium tabular-nums text-ink">
                {r.placementRate == null ? "—" : `${r.placementRate}%`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">SLA overdue items</dt>
              <dd className="font-medium tabular-nums text-ink">{r.slaOverdue}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Assigned jobs</dt>
              <dd className="font-medium tabular-nums text-ink">{r.assignedJobs}</dd>
            </div>
          </dl>
        </Card>
      ))}
    </div>
  );
}
