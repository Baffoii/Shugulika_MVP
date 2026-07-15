import { requirePortal } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";

export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortal("candidate");
  return (
    <DashboardShell portal="candidate" session={session}>
      {children}
    </DashboardShell>
  );
}
