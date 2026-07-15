import { requirePortal } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";

export default async function EmployerLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortal("employer");
  return (
    <DashboardShell portal="employer" session={session}>
      {children}
    </DashboardShell>
  );
}
