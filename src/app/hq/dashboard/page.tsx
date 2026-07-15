import type { Metadata } from "next";
import { PageHeader, StatCard, Card, CardHeader, CardTitle, EmptyState, Alert } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { getStaffMetrics, getOrganizations } from "@/lib/data/staff";
import { titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "HQ dashboard" };

export default async function HqDashboard() {
  const [metrics, franchises, employers] = await Promise.all([
    getStaffMetrics(),
    getOrganizations("franchise"),
    getOrganizations("employer"),
  ]);
  return (
    <div>
      <PageHeader title="HQ overview" description="Continent-wide summary. Aggregates are shown by default; opening an individual private record is permission-checked and audited." />
      <Alert tone="info">HQ visibility does not mean edit rights on every record — administrative actions are scoped by your HQ permissions.</Alert>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Franchises" value={franchises.length} tone="brand" />
        <StatCard label="Employers" value={employers.length} tone="neutral" />
        <StatCard label="Active jobs" value={metrics.activeJobs} tone="info" />
        <StatCard label="Applications" value={metrics.applications} tone="neutral" />
        <StatCard label="Submissions" value={metrics.submissions} tone="neutral" />
        <StatCard label="Placements" value={metrics.placements} tone="success" />
        <StatCard label="Offers" value={metrics.offers} tone="brand" />
        <StatCard label="Open invoices" value={metrics.openInvoices} tone="warn" />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader><CardTitle>Franchises</CardTitle></CardHeader>
          {franchises.length === 0 ? (
            <div className="p-5"><EmptyState title="No franchises yet" description="Country franchises will appear here." /></div>
          ) : (
            <DataTable className="border-0 shadow-none">
              <THead><TR><TH>Franchise</TH><TH>Country</TH><TH>Status</TH></TR></THead>
              <tbody>
                {franchises.map((f) => (
                  <TR key={f.id}>
                    <TD className="font-medium text-ink">{f.name}</TD>
                    <TD className="text-ink-muted">{f.country_code ?? "—"}</TD>
                    <TD><StatusBadge status={f.status} label={titleCase(f.status)} /></TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
      </div>
    </div>
  );
}
