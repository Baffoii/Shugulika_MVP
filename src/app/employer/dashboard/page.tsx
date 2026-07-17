import Link from "next/link";
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
import { getStaffMetrics, getJobOrders } from "@/lib/data/staff";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Employer dashboard" };

export default async function EmployerDashboard() {
  const [metrics, jobs] = await Promise.all([getStaffMetrics(), getJobOrders()]);
  return (
    <div>
      <PageHeader
        title="Employer dashboard"
        description="Your jobs and the candidates submitted to you. You only ever see candidates authorized for your organization."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active jobs" value={metrics.activeJobs} tone="brand" />
        <StatCard label="Candidates submitted" value={metrics.submissions} tone="info" />
        <StatCard label="Interviews" value={metrics.interviews} tone="neutral" />
        <StatCard label="Offers" value={metrics.offers} tone="success" />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Your job orders</CardTitle>
            <Link href="/employer/job-orders" className="text-sm text-brand-700 hover:underline">
              Manage
            </Link>
          </CardHeader>
          {jobs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No job orders yet"
                description="Submit a job order to start receiving candidates."
              />
            </div>
          ) : (
            <DataTable className="border-0 shadow-none">
              <THead>
                <TR>
                  <TH>Role</TH>
                  <TH>Route</TH>
                  <TH>Status</TH>
                  <TH>Vacancies</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <tbody>
                {jobs.slice(0, 8).map((j) => (
                  <TR key={j.id}>
                    <TD>
                      <span className="font-medium text-ink">{j.title}</span>
                    </TD>
                    <TD>
                      <Badge tone={j.recruitment_path === "A" ? "info" : "success"}>
                        {j.recruitment_path === "A" ? "Direct" : "Managed"}
                      </Badge>
                    </TD>
                    <TD>
                      <StatusBadge status={j.status} />
                    </TD>
                    <TD className="text-ink-muted">{j.vacancy_count}</TD>
                    <TD className="text-ink-muted">{formatDate(j.created_at)}</TD>
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
