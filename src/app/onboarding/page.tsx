import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Card, ButtonLink } from "@/components/ui/primitives";
import { getSessionContext, homeForRoles } from "@/lib/auth";

/** Shown when a signed-in user has no role/membership yet (missing-profile state). */
export default async function OnboardingPage() {
  const session = await getSessionContext();
  if (!session) redirect("/auth/sign-in");
  if (session.roles.length > 0) redirect(homeForRoles(session.roles));

  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <div className="border-b border-surface-border bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <Card className="max-w-lg p-8">
          <h1 className="text-lg font-semibold text-ink">Finish setting up your account</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Your account doesn&apos;t have a role assigned yet. This normally happens automatically
            at sign-up. If you registered as a candidate or employer, refresh — otherwise an
            administrator needs to invite you.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <ButtonLink href="/auth/post-login" size="sm">
              Refresh my access
            </ButtonLink>
            <Link
              href="/jobs"
              className="inline-flex items-center rounded-lg border border-surface-border bg-white px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-muted"
            >
              Browse jobs
            </Link>
          </div>
          <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-subtle">
            Signed in as {session.email}.{" "}
            <form action="/auth/sign-out" method="post" className="inline">
              <button className="text-brand-700 hover:underline">Sign out</button>
            </form>
          </p>
        </Card>
      </div>
    </div>
  );
}
