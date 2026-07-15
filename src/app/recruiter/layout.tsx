import { requirePortal } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";

export default async function RecruiterLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortal("recruiter");
  return (
    <DashboardShell portal="recruiter" session={session}>
      {children}
    </DashboardShell>
  );
}
