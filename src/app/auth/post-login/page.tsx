import { redirect } from "next/navigation";
import { getApprovedEmployerOrg, getSessionContext, homeForRoles } from "@/lib/auth";
import { getEmployerPlanSnapshot } from "@/lib/employer-entitlements";

/** Routes a freshly-signed-in user to the right portal (or onboarding / plan picker). */
export default async function PostLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;
  const session = await getSessionContext();
  if (!session) redirect("/auth/sign-in");
  if (redirectTo && redirectTo.startsWith("/")) redirect(redirectTo);
  if (session.roles.length === 0) redirect("/onboarding");

  if (session.roles.includes("employer_user")) {
    const employerOrg = await getApprovedEmployerOrg(session);
    if (!employerOrg) redirect("/onboarding/employer");
    const plan = await getEmployerPlanSnapshot(employerOrg.id);
    if (!plan.isActive) redirect("/employer/plan");
  }

  redirect(homeForRoles(session.roles));
}
