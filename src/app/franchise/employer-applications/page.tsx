import {
  EmployerApplicationsQueuePage,
  type QueueSearchParams,
} from "@/components/pages/EmployerApplicationsPages";
import { requirePortal, franchiseOrgId } from "@/lib/auth";
import { listFranchiseAssignableOwners } from "@/lib/data/franchise-ops";

export const metadata = { title: "Employer applications" };

export default async function Page({ searchParams }: { searchParams: Promise<QueueSearchParams> }) {
  const ctx = await requirePortal("franchise");
  const orgId = franchiseOrgId(ctx.memberships);
  const owners = orgId
    ? (await listFranchiseAssignableOwners(orgId)).map((o) => ({ id: o.id, name: o.name }))
    : [];

  return (
    <EmployerApplicationsQueuePage
      basePath="/franchise/employer-applications"
      description="Employer onboarding applications assigned to your franchise within your geographic region. Access is enforced by database policies, not just this list."
      searchParams={await searchParams}
      owners={owners}
    />
  );
}
