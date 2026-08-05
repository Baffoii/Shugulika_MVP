import { JobOrdersPage } from "@/components/pages/StaffLists";
import { OfflineJobOrderDraftForm } from "@/components/jobs/OfflineJobOrderDraftForm";
import { getOrganizations } from "@/lib/data/staff";

export const metadata = { title: "Jobs" };

export default async function Page() {
  const orgs = await getOrganizations();
  const employers = orgs
    .filter((org) => org.org_type === "employer")
    .map((org) => ({ id: org.id, name: org.name }));

  return (
    <JobOrdersPage
      title="Jobs"
      description="Approve employer submissions, send offline drafts for employer approval, then publish when ready."
      canPublish
      canApprove
      canDeny
      canRequestChanges
      canSubmitOffline
      canAssignRecruiter
      beforeList={<OfflineJobOrderDraftForm employers={employers} />}
    />
  );
}
