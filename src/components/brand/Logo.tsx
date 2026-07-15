import Link from "next/link";
import { cn } from "@/lib/cn";

/** Shugulika wordmark: green brand mark + name. Kept simple and on-brand. */
export function Logo({ href = "/", className, subtitle }: { href?: string; className?: string; subtitle?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5", className)} aria-label="Shugulika home">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white shadow-sm">
        S
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-ink">Shugulika</span>
        {subtitle ? <span className="block text-2xs font-medium uppercase tracking-wide text-brand-600">{subtitle}</span> : null}
      </span>
    </Link>
  );
}
