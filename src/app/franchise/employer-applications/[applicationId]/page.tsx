import { EmployerApplicationReviewPage } from "@/components/pages/EmployerApplicationsPages";
import { requirePortal, franchiseOrgId } from "@/lib/auth";
import { listFranchiseAssignableOwners } from "@/lib/data/franchise-ops";

export const metadata = { title: "Review employer application" };

export default async function Page({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  const ctx = await requirePortal("franchise");
  const orgId = franchiseOrgId(ctx.memberships);
  const owners = orgId ? await listFranchiseAssignableOwners(orgId) : [];

  return (
    <EmployerApplicationReviewPage
      applicationId={applicationId}
      basePath="/franchise/employer-applications"
      canReassign={false}
      canAssignOwner={Boolean(orgId)}
      assignableOwners={owners}
    />
  );
}
