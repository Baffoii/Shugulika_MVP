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
  Alert,
} from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { requireApprovedEmployer } from "@/lib/auth";
import { getEmployerPlanSnapshot } from "@/lib/employer-entitlements";
import { getStaffMetrics, getJobOrders } from "@/lib/data/staff";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Employer dashboard" };

export default async function EmployerDashboard() {
  const { employerOrg } = await requireApprovedEmployer();
  const [metrics, jobs, plan] = await Promise.all([
    getStaffMetrics(),
    getJobOrders(),
    getEmployerPlanSnapshot(employerOrg.id),
  ]);
  return (
    <div>
      <PageHeader
        title="Employer dashboard"
        description="Shugulika runs the recruiting pipeline for you. Review the roles you engaged us on and the candidate CVs we send once they clear screening and consent."
      />
      {!plan.isActive ? (
        <div className="mb-4">
          <Alert tone="warn" title="Choose a plan to unlock hiring">
            Start a free trial or pick a package to post roles and unlock candidate CVs.{" "}
            <Link href="/employer/plan" className="font-medium underline">
              Choose a plan
            </Link>
          </Alert>
        </div>
      ) : (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="CV unlocks left" value={plan.cvUnlockBalance} tone="brand" />
          <StatCard
            label="Job slots"
            value={`${plan.jobSlotsUsed} / ${plan.jobSlotLimit || "—"}`}
            tone="info"
          />
          <StatCard label="Plan" value={plan.package?.name ?? "—"} tone="neutral" />
          <StatCard
            label={plan.subscription?.is_trial ? "Trial ends" : "Period ends"}
            value={
              plan.subscription?.is_trial
                ? formatDate(plan.subscription.trial_ends_on)
                : formatDate(plan.subscription?.expires_on ?? null)
            }
            tone="success"
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active roles" value={metrics.activeJobs} tone="brand" />
        <StatCard label="CVs submitted" value={metrics.submissions} tone="info" />
        <StatCard label="Interviews" value={metrics.interviews} tone="neutral" />
        <StatCard label="Offers" value={metrics.offers} tone="success" />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Your roles with Shugulika</CardTitle>
            <Link href="/employer/job-orders" className="text-sm text-brand-700 hover:underline">
              View all
            </Link>
          </CardHeader>
          {jobs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No roles yet"
                description="When your franchise opens a headhunting search for you, the role appears here."
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
