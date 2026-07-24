"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/cn";

/** Boxed account control used in portal chrome and standalone flows (e.g. onboarding). */
export function UserAccountMenu({ userName, email }: { userName: string; email: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-lg border border-surface-border bg-white px-2 py-1.5 text-sm hover:bg-surface-muted"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-2xs font-semibold text-white">
          {initials(userName || email)}
        </span>
        <span className="hidden max-w-[140px] truncate text-ink sm:block">{userName || email}</span>
        <ChevronDown className="h-4 w-4 text-ink-subtle" />
      </button>
      {open ? (
        <div
          className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-surface-border bg-white p-1 shadow-pop"
          role="menu"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-ink">{userName || "Signed in"}</p>
            <p className="truncate text-xs text-ink-subtle">{email}</p>
          </div>
          <div className="border-t border-surface-border pt-1">
            <Link
              href="/auth/update-password"
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
              role="menuitem"
              onClick={() => setOpen(false)}
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
  );
}
