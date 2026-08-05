import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  StatCard,
} from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import type { EmployerHealthSummary } from "@/lib/data/franchise-ops";

export function FranchiseEmployerHealthPanel({ summary }: { summary: EmployerHealthSummary }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Active employers" value={summary.activeEmployers} tone="brand" />
        <StatCard label="Open jobs" value={summary.openJobs} tone="info" />
        <StatCard label="Overdue approvals" value={summary.overdueApprovals} tone="warn" />
        <StatCard label="Stalled vacancies" value={summary.stalledVacancies} tone="orange" />
        <StatCard
          label="Repeat placements"
          value={summary.repeatPlacementEmployers}
          tone="success"
        />
      </div>

      {summary.rows.length === 0 ? (
        <EmptyState
          title="No employers in scope"
          description="Employers linked to your franchise appear here under database isolation."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Employer health</CardTitle>
          </CardHeader>
          <DataTable className="border-0 shadow-none">
            <THead>
              <TR>
                <TH>Employer</TH>
                <TH>Status</TH>
                <TH>Open jobs</TH>
                <TH>Active apps</TH>
                <TH>Overdue approvals</TH>
                <TH>Stalled</TH>
                <TH>Repeat placements</TH>
                <TH>Recent activity</TH>
              </TR>
            </THead>
            <tbody>
              {summary.rows.map((r) => (
                <TR key={r.employerOrgId}>
                  <TD className="font-medium">
                    <Link
                      href={`/franchise/employers?q=${encodeURIComponent(r.name)}`}
                      className="text-brand-700 hover:underline"
                    >
                      {r.name}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge status={r.verificationStatus} />
                  </TD>
                  <TD className="tabular-nums">
                    <Link
                      href={`/franchise/jobs?employer=${r.employerOrgId}`}
                      className="text-brand-700 hover:underline"
                    >
                      {r.openJobs}
                    </Link>
                  </TD>
                  <TD className="tabular-nums">{r.activeApplications}</TD>
                  <TD className="tabular-nums">{r.overdueApprovals}</TD>
                  <TD className="tabular-nums">{r.stalledVacancies}</TD>
                  <TD className="tabular-nums">
                    <Link
                      href={`/franchise/placements?employer=${r.employerOrgId}`}
                      className="text-brand-700 hover:underline"
                    >
                      {r.repeatPlacements}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted">
                    {r.recentActivityAt ? formatDateTime(r.recentActivityAt) : "—"}
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

export function FranchiseFinanceAttributionGate({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <Alert tone="info" title="Attribution rules enabled">
        Franchise-attributable finance views will appear here once finance publishes shared-account
        rules. Raw operational invoices remain on Billing.
      </Alert>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Franchise-attributable finance</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <Alert tone="warn" title="Attribution rules not configured">
          Collected revenue, outstanding invoices, packages/add-ons, and placement revenue are not
          labeled as franchise-attributable P&amp;L until finance defines attribution and
          shared-account rules.
        </Alert>
        <p className="text-sm text-ink-muted">
          Operational invoice and placement lists remain available under{" "}
          <Link href="/franchise/billing" className="font-medium text-brand-700 hover:underline">
            Billing
          </Link>{" "}
          and{" "}
          <Link href="/franchise/placements" className="font-medium text-brand-700 hover:underline">
            Placements
          </Link>{" "}
          (RLS-scoped). Those lists are not franchise P&amp;L.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Collected revenue (attributable)" value="—" tone="neutral" />
          <StatCard label="Outstanding invoices (attributable)" value="—" tone="neutral" />
          <StatCard label="Packages / add-ons (attributable)" value="—" tone="neutral" />
          <StatCard label="Placement revenue (attributable)" value="—" tone="neutral" />
        </div>
      </CardBody>
    </Card>
  );
}
