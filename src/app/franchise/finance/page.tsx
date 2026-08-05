import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import { PageHeader } from "@/components/ui/primitives";
import { FranchiseFinanceAttributionGate } from "@/components/franchise/FranchiseEmployerHealthPanel";
import { isFranchiseFinanceAttributionEnabled } from "@/lib/data/franchise-ops";

export const metadata: Metadata = { title: "Finance" };

export default async function FranchiseFinancePage() {
  await requirePortal("franchise");
  const enabled = await isFranchiseFinanceAttributionEnabled();

  return (
    <div>
      <PageHeader
        title="Finance"
        description="Franchise-attributable finance appears only after finance defines attribution and shared-account rules."
      />
      <FranchiseFinanceAttributionGate enabled={enabled} />
    </div>
  );
}
