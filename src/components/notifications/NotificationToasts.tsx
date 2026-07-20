"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/notifications/actions";
import { createClient } from "@/lib/supabase/client";
import type { NotificationRow } from "@/lib/database.types";
import type { Portal } from "@/lib/constants";
import { cn } from "@/lib/cn";

const POLL_MS = 30_000;
const MAX_VISIBLE = 4;

function hrefForNotification(
  portal: Portal,
  subjectType: string | null,
  subjectId: string | null,
): string {
  if (portal === "candidate") {
    if (subjectType === "interview_assignment" && subjectId) {
      return `/candidate/interviews/${subjectId}`;
    }
    if (subjectType === "application") return "/candidate/applications";
    return "/candidate/notifications";
  }
  if (portal === "recruiter") {
    if (subjectType === "interview_assignment" && subjectId) {
      return `/recruiter/interviews/${subjectId}`;
    }
    if (subjectType === "application" && subjectId) {
      return `/recruiter/applications/${subjectId}`;
    }
    return "/recruiter/notifications";
  }
  return `/${portal}/dashboard`;
}

function inboxPath(portal: Portal): string {
  if (portal === "candidate") return "/candidate/notifications";
  if (portal === "recruiter") return "/recruiter/notifications";
  return `/${portal}/dashboard`;
}

/**
 * Phone / LinkedIn-style toast stack for unread in-app notifications.
 * Dismissing or opening a toast marks it read so it does not return.
 * Visiting the notifications inbox marks everything read.
 */
export function NotificationToasts({ portal }: { portal: Portal }) {
  const pathname = usePathname();
  const [toasts, setToasts] = useState<NotificationRow[]>([]);
  const [, start] = useTransition();
  const onInbox = pathname === inboxPath(portal) || pathname.startsWith(`${inboxPath(portal)}/`);

  const refreshUnread = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_VISIBLE);
    setToasts((data as NotificationRow[] | null) ?? []);
  }, []);

  useEffect(() => {
    if (onInbox) {
      start(async () => {
        await markAllNotificationsReadAction();
        setToasts([]);
      });
      return;
    }
    void refreshUnread();
    const intervalId = window.setInterval(() => void refreshUnread(), POLL_MS);
    const onFocus = () => void refreshUnread();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [onInbox, refreshUnread]);

  function dismiss(id: string) {
    setToasts((current) => current.filter((item) => item.id !== id));
    start(async () => {
      await markNotificationReadAction(id);
    });
  }

  if (onInbox || toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(100vw-2rem,22rem)] flex-col-reverse gap-2 sm:bottom-6 sm:right-6"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => {
        const href = hrefForNotification(portal, toast.subject_type, toast.subject_id);
        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto rounded-xl border border-surface-border bg-white p-3 shadow-lg shadow-slate-900/10",
              "transition duration-200 ease-out",
            )}
            role="status"
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Bell className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{toast.title}</p>
                {toast.body ? (
                  <p className="mt-0.5 line-clamp-3 text-sm text-ink-muted">{toast.body}</p>
                ) : null}
                <div className="mt-2 flex items-center gap-3">
                  <Link
                    href={href}
                    onClick={() => dismiss(toast.id)}
                    className="text-xs font-semibold text-brand-700 hover:underline"
                  >
                    View
                  </Link>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    className="text-xs font-medium text-ink-subtle hover:text-ink"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded-md p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
