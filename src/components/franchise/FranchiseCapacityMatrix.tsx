import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Badge,
  StatCard,
} from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import type { FranchiseCapacityMatrix } from "@/lib/data/franchise-ops";

export function FranchiseCapacityMatrix({ matrix }: { matrix: FranchiseCapacityMatrix }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total workload" value={matrix.totalWorkload} tone="info" />
        <StatCard label="Total capacity" value={matrix.totalCapacity} tone="brand" />
        <StatCard
          label="Headroom"
          value={matrix.totalCapacity - matrix.totalWorkload}
          tone={matrix.totalCapacity - matrix.totalWorkload < 0 ? "warn" : "success"}
        />
      </div>

      {matrix.rows.length === 0 ? (
        <EmptyState
          title="No recruiters"
          description="Active recruiter memberships in your franchise will appear here."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Workload by recruiter</CardTitle>
          </CardHeader>
          <DataTable className="border-0 shadow-none">
            <THead>
              <TR>
                <TH>Recruiter</TH>
                <TH>Workload</TH>
                <TH>Capacity</TH>
                <TH>Remaining</TH>
                <TH>By stage</TH>
                <TH>SLA</TH>
                <TH />
              </TR>
            </THead>
            <tbody>
              {matrix.rows.map((r) => (
                <TR key={r.recruiterId}>
                  <TD>
                    <p className="font-medium text-ink">{r.name}</p>
                    <p className="text-xs text-ink-subtle capitalize">
                      {r.level.replace(/_/g, " ")}
                    </p>
                  </TD>
                  <TD className="tabular-nums">{r.activeWorkload}</TD>
                  <TD className="tabular-nums">{r.maxActiveWorkload}</TD>
                  <TD>
                    <Badge tone={r.overCapacity ? "danger" : "success"}>
                      {r.capacityRemaining}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(r.byStage).length === 0 ? (
                        <span className="text-xs text-ink-muted">—</span>
                      ) : (
                        Object.entries(r.byStage).map(([stage, n]) => (
                          <Badge key={stage} tone="neutral" className="text-xs">
                            {stage.replace(/_/g, " ")}: {n}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TD>
                  <TD className="tabular-nums">{r.slaOverdue}</TD>
                  <TD>
                    <Link
                      href={`/franchise/recruiters/${r.recruiterId}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      Reassign jobs
                    </Link>
                  </TD>
                </TR>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}
    </div>
  );
}
