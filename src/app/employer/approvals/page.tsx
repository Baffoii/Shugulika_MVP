import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR } from "@/components/ui/table";
import { JobOrderListRow } from "@/components/jobs/JobOrderDetails";
import { ApproveJobOrderByEmployerButton } from "@/components/jobs/ApproveJobOrderButton";
import { requireEmployerSubscription } from "@/lib/auth";
import { getJobOrders } from "@/lib/data/staff";
import { JOB_ORDER_ORIGIN_LABELS } from "@/lib/jobs/constants";
import type { JobOrderOrigin } from "@/lib/jobs/types";

export const metadata = { title: "Job approvals" };

export default async function Page() {
  await requireEmployerSubscription();
  const jobs = await getJobOrders();
  const awaiting = jobs.filter((job) => {
    const origin = ((job as { origin?: JobOrderOrigin }).origin ??
      "employer_online") as JobOrderOrigin;
    return origin === "shugulika_offline" && job.status === "awaiting_employer_approval";
  });

  return (
    <div>
      <PageHeader
        title="Job approvals"
        description="Offline job orders drafted by Shugulika that need your approval before publication."
      />
      {awaiting.length === 0 ? (
        <EmptyState
          title="No approvals waiting"
          description="When Shugulika drafts an offline role for your company, it will appear here."
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Role</TH>
              <TH>Location</TH>
              <TH>Route</TH>
              <TH>Status</TH>
              <TH>Vacancies</TH>
              <TH>Created</TH>
              <TH>Action</TH>
            </TR>
          </THead>
          <tbody>
            {awaiting.map((job) => (
              <JobOrderListRow
                key={job.id}
                job={job}
                workflow={
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                      {JOB_ORDER_ORIGIN_LABELS.shugulika_offline}
                    </p>
                    <ApproveJobOrderByEmployerButton jobOrderId={job.id} />
                  </div>
                }
              />
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
