import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Badge,
  Skeleton,
  ButtonLink,
} from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { getStaffMetrics, getJobOrders, getOrganizations } from "@/lib/data/staff";
import { formatDate } from "@/lib/format";
import { FranchisePeriodBar } from "@/components/franchise/FranchisePeriodBar";
import {
  parseFranchisePeriodGrain,
  parseFranchiseSort,
} from "@/lib/franchise/period";
import { listEmployerApplicationsForReview } from "@/lib/data/employer-applications";

export const metadata: Metadata = { title: "Franchise dashboard" };

export default async function FranchiseDashboard({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const params = await Promise.resolve(searchParams ?? {});
  const grain = parseFranchisePeriodGrain(params.range);
  const sort = parseFranchiseSort(params.sort);

  const [metrics, jobs, employers, eapps] = await Promise.all([
    getStaffMetrics(),
    getJobOrders(),
    getOrganizations("employer"),
    listEmployerApplicationsForReview({ sort: "sla_first" }),
  ]);

  const sortedEmployers =
    sort === "alpha_desc"
      ? [...employers].sort((a, b) => b.name.localeCompare(a.name))
      : [...employers].sort((a, b) => a.name.localeCompare(b.name));

  const overdueApps = eapps.filter((a) => a.sla_overdue).length;
  const awaitingApps = eapps.filter(
    (a) => a.status === "submitted" || a.status === "under_review",
  ).length;

  return (
    <div>
      <PageHeader
        title="Franchise overview"
        description="Operational view for your country and franchise. You see only records within your authorized scope."
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/franchise/employers/health" variant="secondary" size="sm">
              Employer health
            </ButtonLink>
            <ButtonLink href="/franchise/capacity" variant="secondary" size="sm">
              Capacity
            </ButtonLink>
            <ButtonLink href="/franchise/finance" variant="secondary" size="sm">
              Finance
            </ButtonLink>
          </div>
        }
      />

      <Suspense fallback={<Skeleton className="mb-6 h-10 w-64" />}>
        <FranchisePeriodBar grain={grain} sort={sort} />
      </Suspense>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active jobs" value={metrics.activeJobs} tone="brand" />
        <StatCard label="Applications" value={metrics.applications} tone="info" />
        <StatCard label="Submissions" value={metrics.submissions} tone="neutral" />
        <StatCard label="Placements" value={metrics.placements} tone="success" />
        <StatCard label="Interviews" value={metrics.interviews} tone="neutral" />
        <StatCard label="Offers" value={metrics.offers} tone="brand" />
        <StatCard label="Employers" value={employers.length} tone="neutral" />
        <StatCard label="Open invoices" value={metrics.openInvoices} tone="warn" />
        <StatCard label="Employer apps awaiting" value={awaitingApps} tone="warn" />
        <StatCard label="Employer app SLA overdue" value={overdueApps} tone="orange" />
      </div>

      <p className="mt-4 text-sm text-ink-muted">
        Compare recruiter KPIs on{" "}
        <Link href="/franchise/reports" className="font-medium text-brand-700 hover:underline">
          Reports
        </Link>
        . Review onboarding on{" "}
        <Link
          href="/franchise/employer-applications"
          className="font-medium text-brand-700 hover:underline"
        >
          Employer applications
        </Link>
        .
      </p>

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
                    <TD className="font-medium text-ink">
                      <Link
                        href={`/franchise/jobs?job=${j.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {j.title}
                      </Link>
                    </TD>
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
          {sortedEmployers.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No employers yet"
                description="Client organizations you manage will appear here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-surface-border">
              {sortedEmployers.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-center justify-between px-5 py-3">
                  <Link
                    href={`/franchise/employers/health`}
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    {e.name}
                  </Link>
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
