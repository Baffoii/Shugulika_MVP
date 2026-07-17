import type { Metadata } from "next";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Badge,
} from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { getStaffMetrics, getJobOrders, getOrganizations } from "@/lib/data/staff";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Franchise dashboard" };

export default async function FranchiseDashboard() {
  const [metrics, jobs, employers] = await Promise.all([
    getStaffMetrics(),
    getJobOrders(),
    getOrganizations("employer"),
  ]);
  return (
    <div>
      <PageHeader
        title="Franchise overview"
        description="Operational view for your country and franchise. You see only records within your authorized scope."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active jobs" value={metrics.activeJobs} tone="brand" />
        <StatCard label="Applications" value={metrics.applications} tone="info" />
        <StatCard label="Submissions" value={metrics.submissions} tone="neutral" />
        <StatCard label="Placements" value={metrics.placements} tone="success" />
        <StatCard label="Interviews" value={metrics.interviews} tone="neutral" />
        <StatCard label="Offers" value={metrics.offers} tone="brand" />
        <StatCard label="Employers" value={employers.length} tone="neutral" />
        <StatCard label="Open invoices" value={metrics.openInvoices} tone="warn" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent job orders</CardTitle>
          </CardHeader>
          {jobs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No job orders"
                description="Job orders from your employers will appear here."
              />
            </div>
          ) : (
            <DataTable className="border-0 shadow-none">
              <THead>
                <TR>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <tbody>
                {jobs.slice(0, 6).map((j) => (
                  <TR key={j.id}>
                    <TD className="font-medium text-ink">{j.title}</TD>
                    <TD>
                      <StatusBadge status={j.status} />
                    </TD>
                    <TD className="text-ink-muted">{formatDate(j.created_at)}</TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Employers</CardTitle>
          </CardHeader>
          {employers.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No employers yet"
                description="Client organizations you manage will appear here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-surface-border">
              {employers.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm font-medium text-ink">{e.name}</span>
                  <Badge tone={e.verification_status === "verified" ? "success" : "warn"}>
                    {e.verification_status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
