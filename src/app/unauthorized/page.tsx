import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { ButtonLink } from "@/components/ui/primitives";
import { getSessionContext, homeForRoles } from "@/lib/auth";

export default async function UnauthorizedPage() {
  const session = await getSessionContext();
  const home = session ? homeForRoles(session.roles) : "/";
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <div className="card max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <ShieldAlert className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold text-ink">You don&apos;t have access to that area</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Your account roles don&apos;t include this portal. If you believe this is a mistake, contact your Shugulika administrator.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <ButtonLink href={home} size="sm">Go to my dashboard</ButtonLink>
          <Link href="/jobs" className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-white">Browse jobs</Link>
        </div>
      </div>
    </div>
  );
}
