import { requirePortal } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";

export default async function HqLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortal("hq");
  return (
    <DashboardShell portal="hq" session={session}>
      {children}
    </DashboardShell>
  );
}
