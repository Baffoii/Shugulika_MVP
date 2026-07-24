import { requireApprovedEmployer } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";

/**
 * Employer portal gate. Beyond the employer_user role, usable access requires
 * an active membership scoped to an active + verified employer organization —
 * unapproved employers are redirected to the onboarding journey. Server
 * actions independently re-check organization scope.
 */
export default async function EmployerLayout({ children }: { children: React.ReactNode }) {
  const { ctx } = await requireApprovedEmployer();
  return (
    <DashboardShell portal="employer" session={ctx}>
      {children}
    </DashboardShell>
  );
}
