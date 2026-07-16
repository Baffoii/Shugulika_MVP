import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

type LogoVariant = "default" | "sidebar";

/** Shugulika wordmark with tie icon. Light backgrounds use the full-color SVG; portal sidebars use the light variant. */
export function Logo({
  href = "/",
  className,
  subtitle,
  variant = "default",
}: {
  href?: string;
  className?: string;
  subtitle?: string;
  variant?: LogoVariant;
}) {
  const isSidebar = variant === "sidebar";

  return (
    <Link
      href={href}
      className={cn(
        "flex",
        isSidebar && subtitle ? "flex-col items-start gap-1" : "items-center gap-2.5",
        className,
      )}
      aria-label="Shugulika home"
    >
      <Image
        src={isSidebar ? "/logo-light.svg" : "/logo.svg"}
        alt=""
        width={isSidebar ? 148 : 168}
        height={isSidebar ? 34 : 38}
        priority
        className="h-auto w-auto max-h-9 shrink-0"
      />
      {subtitle ? (
        <span
          className={cn(
            "text-2xs font-medium uppercase tracking-wide",
            isSidebar ? "text-sidebar-muted" : "text-ink-subtle",
          )}
        >
          {subtitle}
        </span>
      ) : null}
    </Link>
  );
}
