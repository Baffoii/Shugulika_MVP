"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { PORTAL_NAV, PORTAL_META } from "@/components/layout/nav-config";
import { Logo } from "@/components/brand/Logo";
import type { Portal } from "@/lib/constants";

function isNavActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ portal, collapsed = false }: { portal: Portal; collapsed?: boolean }) {
  const pathname = usePathname();
  const items = PORTAL_NAV[portal];

  return (
    <nav
      aria-label={`${PORTAL_META[portal].label} navigation`}
      className={cn("flex h-full flex-col bg-sidebar text-white", collapsed ? "w-16" : "w-64")}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b border-sidebar-border",
          collapsed ? "justify-center px-2" : "px-5",
        )}
      >
        <Logo subtitle={collapsed ? undefined : PORTAL_META[portal].subtitle} variant="sidebar" compact={collapsed} />
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
        {items.map((item) => {
          const active = isNavActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "relative flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
                  collapsed ? "justify-center px-2" : "gap-3 px-3",
                  active
                    ? "bg-sidebar-active text-white"
                    : "text-sidebar-muted hover:bg-sidebar-hover hover:text-white",
                )}
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-brand-500" aria-hidden />
                ) : null}
                <Icon
                  className={cn("h-4.5 w-4.5 shrink-0", active ? "text-brand-400" : "text-sidebar-muted")}
                  style={{ width: 18, height: 18 }}
                  aria-hidden
                />
                {collapsed ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {item.placeholder ? (
                      <span className="rounded-badge bg-amber-900/40 px-1.5 py-0.5 text-2xs font-semibold text-amber-300">
                        Soon
                      </span>
                    ) : null}
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
