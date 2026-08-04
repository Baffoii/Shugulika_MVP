import { Suspense } from "react";
import type { Metadata } from "next";
import { requirePortal, franchiseOrgId } from "@/lib/auth";
import { PageHeader, Skeleton, Alert } from "@/components/ui/primitives";
import { FranchisePeriodBar } from "@/components/franchise/FranchisePeriodBar";
import { FranchiseCapacityMatrix } from "@/components/franchise/FranchiseCapacityMatrix";
import { getFranchiseCapacityMatrix } from "@/lib/data/franchise-ops";
import {
  franchiseGrainToKpiPeriod,
  parseFranchisePeriodGrain,
} from "@/lib/franchise/period";

export const metadata: Metadata = { title: "Capacity" };

export default async function FranchiseCapacityPage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const ctx = await requirePortal("franchise");
  const orgId = franchiseOrgId(ctx.memberships);
  const params = await Promise.resolve(searchParams ?? {});
  const grain = parseFranchisePeriodGrain(params.range);

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Capacity" description="Your account is not linked to a franchise." />
      </div>
    );
  }

  const matrix = await getFranchiseCapacityMatrix(orgId, franchiseGrainToKpiPeriod(grain));

  return (
    <div>
      <PageHeader
        title="Workload & capacity"
        description="Compare active workload to the target capacity for each recruiter. Reassign jobs from the recruiter detail page."
      />
      <Suspense fallback={<Skeleton className="mb-6 h-10 w-64" />}>
        <FranchisePeriodBar grain={grain} showSort={false} />
      </Suspense>
      {matrix.rows.some((r) => r.overCapacity) ? (
        <div className="mb-4">
          <Alert tone="warn" title="Some recruiters are over capacity">
            Reassign open jobs to recruiters with remaining headroom.
          </Alert>
        </div>
      ) : null}
      <FranchiseCapacityMatrix matrix={matrix} />
    </div>
  );
}
