"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  LogOut,
  KeyRound,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Logo } from "@/components/brand/Logo";
import { NotificationToasts } from "@/components/notifications/NotificationToasts";
import { PORTAL_META } from "@/components/layout/nav-config";
import { initials } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Portal } from "@/lib/constants";

export interface PortalSwitch {
  portal: Portal;
  href: string;
  label: string;
}

const SIDEBAR_STORAGE_KEY = "shugulika-sidebar-collapsed";

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
    setReady(true);
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  return { collapsed, toggle, ready };
}

function BarePortalChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-muted">
      <div className="border-b border-surface-border bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

export function PortalChrome({
  portal,
  userName,
  email,
  switches,
  children,
}: {
  portal: Portal;
  userName: string;
  email: string;
  switches: PortalSwitch[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const hideSidebar = /^\/candidate\/apply(\/|$)/.test(pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { collapsed, toggle, ready } = useSidebarCollapsed();

  if (hideSidebar) {
    return <BarePortalChrome>{children}</BarePortalChrome>;
  }

  const sidebarWidth = collapsed ? "w-16" : "w-64";
  const mainOffset = collapsed ? "lg:pl-16" : "lg:pl-64";

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:block",
          sidebarWidth,
          !ready && "w-64",
        )}
      >
        <Sidebar portal={portal} collapsed={ready ? collapsed : false} />
        <button
          type="button"
          onClick={toggle}
          className="absolute -right-3 top-[4.25rem] z-40 hidden h-6 w-6 items-center justify-center rounded-full border border-surface-border bg-white text-ink-subtle shadow-sm hover:bg-surface-muted hover:text-ink lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/30"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-72 bg-sidebar shadow-drawer">
            <button
              className="absolute right-3 top-4 rounded-md p-1 text-sidebar-muted hover:bg-sidebar-hover hover:text-white"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <Sidebar portal={portal} />
          </div>
        </div>
      ) : null}

      <div className={cn("transition-[padding] duration-200", mainOffset, !ready && "lg:pl-64")}>
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-surface-border bg-white/95 px-4 backdrop-blur sm:px-6">
          <button
            className="rounded-md p-2 text-ink-muted hover:bg-surface-muted lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="hidden rounded-md p-2 text-ink-muted hover:bg-surface-muted lg:inline-flex"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
          <div className="hidden text-sm font-medium text-ink-muted sm:block">
            {PORTAL_META[portal].label} portal
          </div>
          <div className="ml-auto flex items-center gap-2">
            {switches.length > 1 ? (
              <div className="hidden items-center gap-1 md:flex">
                {switches
                  .filter((s) => s.portal !== portal)
                  .map((s) => (
                    <Link
                      key={s.portal}
                      href={s.href}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                    >
                      {s.label}
                    </Link>
                  ))}
              </div>
            ) : null}
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg border border-surface-border bg-white px-2 py-1.5 text-sm hover:bg-surface-muted"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-2xs font-semibold text-white">
                  {initials(userName || email)}
                </span>
                <span className="hidden max-w-[140px] truncate text-ink sm:block">
                  {userName || email}
                </span>
                <ChevronDown className="h-4 w-4 text-ink-subtle" />
              </button>
              {menuOpen ? (
                <div
                  className="absolute right-0 mt-1 w-56 rounded-lg border border-surface-border bg-white p-1 shadow-pop"
                  role="menu"
                >
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-medium text-ink">
                      {userName || "Signed in"}
                    </p>
                    <p className="truncate text-xs text-ink-subtle">{email}</p>
                  </div>
                  {switches.length > 1 ? (
                    <div className="border-t border-surface-border py-1 md:hidden">
                      {switches
                        .filter((s) => s.portal !== portal)
                        .map((s) => (
                          <Link
                            key={s.portal}
                            href={s.href}
                            className="block rounded-md px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-muted"
                          >
                            Switch to {s.label}
                          </Link>
                        ))}
                    </div>
                  ) : null}
                  <div className="border-t border-surface-border pt-1">
                    <Link
                      href="/auth/update-password"
                      className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                    >
                      <KeyRound className="h-4 w-4" /> Change password
                    </Link>
                    <form action="/auth/sign-out" method="post">
                      <button
                        type="submit"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-status-danger hover:bg-red-50",
                        )}
                        role="menuitem"
                      >
                        <LogOut className="h-4 w-4" /> Sign out
                      </button>
                    </form>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
      {(portal === "candidate" || portal === "recruiter") && !hideSidebar ? (
        <NotificationToasts portal={portal} />
      ) : null}
    </div>
  );
}
