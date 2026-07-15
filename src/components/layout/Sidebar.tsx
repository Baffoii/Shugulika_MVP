"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { PORTAL_NAV, PORTAL_META } from "@/components/layout/nav-config";
import { Logo } from "@/components/brand/Logo";
import type { Portal } from "@/lib/constants";

export function Sidebar({ portal }: { portal: Portal }) {
  const pathname = usePathname();
  const items = PORTAL_NAV[portal];

  return (
    <nav aria-label={`${PORTAL_META[portal].label} navigation`} className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-surface-border px-5">
        <Logo subtitle={PORTAL_META[portal].subtitle} />
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const active = pathname === item.href || (item.href !== "/jobs" && pathname.startsWith(`${item.href}/`));
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                )}
              >
                <Icon className={cn("h-4.5 w-4.5 shrink-0", active ? "text-brand-600" : "text-ink-subtle")} style={{ width: 18, height: 18 }} aria-hidden />
                <span className="flex-1">{item.label}</span>
                {item.placeholder ? (
                  <span className="rounded-badge bg-amber-50 px-1.5 py-0.5 text-2xs font-semibold text-amber-700">Soon</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
