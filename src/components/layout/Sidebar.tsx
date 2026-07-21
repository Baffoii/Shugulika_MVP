"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { PORTAL_NAV, PORTAL_META } from "@/components/layout/nav-config";
import { Logo } from "@/components/brand/Logo";
import { NOTIFICATIONS_CHANGED_EVENT, formatUnreadBadge } from "@/components/notifications/unread";
import { createClient } from "@/lib/supabase/client";
import type { Portal } from "@/lib/constants";

const UNREAD_POLL_MS = 30_000;

function isNavActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isNotificationsHref(href: string) {
  return href.endsWith("/notifications");
}

function UnreadBadge({ count, collapsed }: { count: number; collapsed: boolean }) {
  const label = formatUnreadBadge(count);
  if (!label) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-red-500 font-bold text-white shadow-[0_0_0_1.5px_#1c1c1c]",
        collapsed
          ? "absolute -right-1.5 -top-1.5 min-h-[1.125rem] min-w-[1.125rem] px-1 text-[10px] leading-none"
          : "min-h-5 min-w-5 px-1.5 text-2xs leading-none",
      )}
      aria-label={`${count} unread notification${count === 1 ? "" : "s"}`}
    >
      {label}
    </span>
  );
}

export function Sidebar({ portal, collapsed = false }: { portal: Portal; collapsed?: boolean }) {
  const pathname = usePathname();
  const items = PORTAL_NAV[portal];
  const [unreadCount, setUnreadCount] = useState(0);
  const hasNotificationsNav = items.some((item) => isNotificationsHref(item.href));

  const refreshUnread = useCallback(async () => {
    if (!hasNotificationsNav) return;
    const supabase = createClient();
    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .is("read_at", null);
    if (error) return;
    setUnreadCount(count ?? 0);
  }, [hasNotificationsNav]);

  useEffect(() => {
    if (!hasNotificationsNav) return;
    void refreshUnread();
    const intervalId = window.setInterval(() => void refreshUnread(), UNREAD_POLL_MS);
    const onChange = () => void refreshUnread();
    window.addEventListener("focus", onChange);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onChange);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
    };
  }, [hasNotificationsNav, refreshUnread, pathname]);

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
        <Logo
          subtitle={collapsed ? undefined : PORTAL_META[portal].subtitle}
          variant="sidebar"
          compact={collapsed}
        />
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
        {items.map((item) => {
          const active = isNavActive(pathname, item.href);
          const Icon = item.icon;
          const showUnread = isNotificationsHref(item.href);
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
                  <span
                    className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-brand-500"
                    aria-hidden
                  />
                ) : null}
                <span className={cn("relative shrink-0", collapsed && "inline-flex")}>
                  <Icon
                    className={cn(
                      "h-4.5 w-4.5 shrink-0",
                      active ? "text-brand-400" : "text-sidebar-muted",
                    )}
                    style={{ width: 18, height: 18 }}
                    aria-hidden
                  />
                  {collapsed && showUnread ? <UnreadBadge count={unreadCount} collapsed /> : null}
                </span>
                {collapsed ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {showUnread ? <UnreadBadge count={unreadCount} collapsed={false} /> : null}
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
