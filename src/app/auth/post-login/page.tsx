import { redirect } from "next/navigation";
import { getApprovedEmployerOrg, getSessionContext, homeForRoles } from "@/lib/auth";

/** Routes a freshly-signed-in user to the right portal (or onboarding). */
export default async function PostLoginPage({
  searchParams,
}: {
  searchParams: { redirectTo?: string };
}) {
  const session = await getSessionContext();
  if (!session) redirect("/auth/sign-in");
  if (searchParams.redirectTo && searchParams.redirectTo.startsWith("/"))
    redirect(searchParams.redirectTo);
  if (session.roles.length === 0) redirect("/onboarding");
  // Unapproved employers must finish company registration before the portal.
  if (session.roles.includes("employer_user") && !(await getApprovedEmployerOrg(session))) {
    redirect("/onboarding/employer");
  }
  redirect(homeForRoles(session.roles));
}
