import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/primitives";
import { getSessionContext, homeForRoles } from "@/lib/auth";

/** Public site header. Shows sign-in/up for anonymous, or a dashboard link. */
export async function PublicHeader() {
  const session = await getSessionContext();
  return (
    <header className="border-b border-surface-border bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2" aria-label="Primary">
          <ButtonLink href="/jobs" variant="ghost" size="sm">
            Browse jobs
          </ButtonLink>
          {session ? (
            <ButtonLink href={homeForRoles(session.roles)} variant="primary" size="sm">
              Go to dashboard
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/auth/sign-in" variant="outline" size="sm">
                Sign in
              </ButtonLink>
              <ButtonLink href="/auth/sign-up" variant="primary" size="sm">
                Create account
              </ButtonLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
