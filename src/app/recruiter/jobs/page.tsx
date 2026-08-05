import { JobOrdersPage } from "@/components/pages/StaffLists";
import { OfflineJobOrderDraftForm } from "@/components/jobs/OfflineJobOrderDraftForm";
import { getOrganizations } from "@/lib/data/staff";

export const metadata = { title: "Jobs & orders" };

export default async function Page() {
  const orgs = await getOrganizations();
  const employers = orgs
    .filter((org) => org.org_type === "employer")
    .map((org) => ({ id: org.id, name: org.name }));

  return (
    <JobOrdersPage
      title="Jobs & orders"
      description="Approve and publish are separate. Offline drafts need employer approval before you can publish."
      canPublish
      canApprove
      canRequestChanges
      canSubmitOffline
      beforeList={<OfflineJobOrderDraftForm employers={employers} />}
    />
  );
}
