import { redirect } from "next/navigation";
import { getSessionContext, homeForRoles } from "@/lib/auth";

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
  redirect(homeForRoles(session.roles));
}
