import { requirePortal } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";

export default async function FranchiseLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortal("franchise");
  return (
    <DashboardShell portal="franchise" session={session}>
      {children}
    </DashboardShell>
  );
}
