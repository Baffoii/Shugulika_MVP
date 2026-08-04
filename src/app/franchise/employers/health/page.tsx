import { Suspense } from "react";
import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import { PageHeader, Skeleton } from "@/components/ui/primitives";
import { FranchisePeriodBar } from "@/components/franchise/FranchisePeriodBar";
import { FranchiseEmployerHealthPanel } from "@/components/franchise/FranchiseEmployerHealthPanel";
import { getFranchiseEmployerHealth } from "@/lib/data/franchise-ops";
import {
  franchisePeriodWindow,
  parseFranchisePeriodGrain,
  parseFranchiseSort,
} from "@/lib/franchise/period";

export const metadata: Metadata = { title: "Employer health" };

export default async function FranchiseEmployerHealthPage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  await requirePortal("franchise");
  const params = await Promise.resolve(searchParams ?? {});
  const grain = parseFranchisePeriodGrain(params.range);
  const sort = parseFranchiseSort(params.sort);
  const window = franchisePeriodWindow(grain);
  const summary = await getFranchiseEmployerHealth(window, sort);

  return (
    <div>
      <PageHeader
        title="Employer health"
        description="Active employers, open jobs, recent activity, overdue approvals, stalled vacancies, and repeat placements — scoped to your franchise by database policies."
      />
      <Suspense fallback={<Skeleton className="mb-6 h-10 w-64" />}>
        <FranchisePeriodBar grain={grain} sort={sort} />
      </Suspense>
      <FranchiseEmployerHealthPanel summary={summary} />
    </div>
  );
}
