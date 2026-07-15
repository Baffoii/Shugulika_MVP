import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted px-4 text-center">
      <Logo className="mb-6" />
      <p className="text-5xl font-semibold text-brand-600">404</p>
      <h1 className="mt-2 text-lg font-semibold text-ink">Page not found</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <div className="mt-5 flex gap-2">
        <ButtonLink href="/" size="sm">Home</ButtonLink>
        <Link href="/jobs" className="inline-flex items-center rounded-lg border border-surface-border bg-white px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-muted">Browse jobs</Link>
      </div>
    </div>
  );
}
