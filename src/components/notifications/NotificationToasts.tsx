"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
import { emitNotificationsChanged } from "@/components/notifications/unread";

const POLL_MS = 30_000;
const MAX_VISIBLE = 4;
const TOAST_TTL_MS = 5_000;

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
    if (subjectType === "job_order") return "/recruiter/jobs";
    return "/recruiter/notifications";
  }
  if (portal === "hq") {
    if (subjectType === "job_order") return "/hq/jobs";
    return "/hq/notifications";
  }
  if (portal === "franchise") {
    if (subjectType === "job_order") return "/franchise/jobs";
    return "/franchise/jobs";
  }
  return `/${portal}/dashboard`;
}

function inboxPath(portal: Portal): string {
  if (portal === "candidate") return "/candidate/notifications";
  if (portal === "recruiter") return "/recruiter/notifications";
  if (portal === "hq") return "/hq/notifications";
  return `/${portal}/dashboard`;
}

function ToastCard({
  toast,
  href,
  onDismiss,
  onAutoHide,
}: {
  toast: NotificationRow;
  href: string;
  onDismiss: (id: string) => void;
  onAutoHide: (id: string) => void;
}) {
  const pausedRef = useRef(false);
  const remainingRef = useRef(TOAST_TTL_MS);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearTimer();
    startedAtRef.current = performance.now();
    if (barRef.current) {
      barRef.current.style.transition = "none";
      barRef.current.style.width = `${(remainingRef.current / TOAST_TTL_MS) * 100}%`;
      // Force reflow so the width transition restarts cleanly after pause.
      void barRef.current.offsetWidth;
      barRef.current.style.transition = `width ${remainingRef.current}ms linear`;
      barRef.current.style.width = "0%";
    }
    timerRef.current = window.setTimeout(() => {
      onAutoHide(toast.id);
    }, remainingRef.current);
  }, [clearTimer, onAutoHide, toast.id]);

  useEffect(() => {
    scheduleHide();
    return clearTimer;
  }, [scheduleHide, clearTimer]);

  function pause() {
    if (pausedRef.current) return;
    pausedRef.current = true;
    clearTimer();
    const elapsed = performance.now() - startedAtRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    if (barRef.current) {
      const pct = (remainingRef.current / TOAST_TTL_MS) * 100;
      barRef.current.style.transition = "none";
      barRef.current.style.width = `${pct}%`;
    }
  }

  function resume() {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    if (remainingRef.current <= 0) {
      onAutoHide(toast.id);
      return;
    }
    scheduleHide();
  }

  return (
    <div
      className={cn(
        "pointer-events-auto relative overflow-hidden rounded-xl border border-surface-border bg-white p-3 shadow-lg shadow-slate-900/10",
        "transition duration-200 ease-out",
      )}
      role="status"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
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
              onClick={() => onDismiss(toast.id)}
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              View
            </Link>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-xs font-medium text-ink-subtle hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="rounded-md p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-surface-muted"
        aria-hidden
      >
        <div ref={barRef} className="h-full w-full bg-brand-500" />
      </div>
    </div>
  );
}

/**
 * Phone / LinkedIn-style toast stack for unread in-app notifications.
 * Toasts auto-hide after 5s (progress bar); dismissing or opening marks them read.
 * Visiting the notifications inbox marks everything read.
 */
export function NotificationToasts({ portal }: { portal: Portal }) {
  const pathname = usePathname();
  const [toasts, setToasts] = useState<NotificationRow[]>([]);
  const hiddenIdsRef = useRef<Set<string>>(new Set());
  const [, start] = useTransition();
  const onInbox = pathname === inboxPath(portal) || pathname.startsWith(`${inboxPath(portal)}/`);

  const refreshUnread = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_VISIBLE + hiddenIdsRef.current.size);
    const rows = (data as NotificationRow[] | null) ?? [];
    setToasts(rows.filter((row) => !hiddenIdsRef.current.has(row.id)).slice(0, MAX_VISIBLE));
  }, []);

  useEffect(() => {
    if (onInbox) {
      start(async () => {
        await markAllNotificationsReadAction();
        hiddenIdsRef.current.clear();
        setToasts([]);
        emitNotificationsChanged();
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
    hiddenIdsRef.current.add(id);
    setToasts((current) => current.filter((item) => item.id !== id));
    start(async () => {
      await markNotificationReadAction(id);
      emitNotificationsChanged();
    });
  }

  function autoHide(id: string) {
    // Hide for this session only — leave unread so the sidebar badge stays accurate.
    hiddenIdsRef.current.add(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }

  if (onInbox || toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(100vw-2rem,22rem)] flex-col-reverse gap-2 sm:bottom-6 sm:right-6"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          href={hrefForNotification(portal, toast.subject_type, toast.subject_id)}
          onDismiss={dismiss}
          onAutoHide={autoHide}
        />
      ))}
    </div>
  );
}
