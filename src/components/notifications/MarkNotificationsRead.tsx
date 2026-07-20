"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markAllNotificationsReadAction } from "@/app/notifications/actions";

/** Marks every unread notification as read when the inbox page is opened. */
export function MarkNotificationsRead() {
  const router = useRouter();
  useEffect(() => {
    void (async () => {
      await markAllNotificationsReadAction();
      router.refresh();
    })();
  }, [router]);
  return null;
}
