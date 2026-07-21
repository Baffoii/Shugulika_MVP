/** Fired on `window` whenever unread notifications may have changed. */
export const NOTIFICATIONS_CHANGED_EVENT = "shugulika:notifications-changed";

export function emitNotificationsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/** Format an unread count for a badge: blank when 0, "99+" above 99. */
export function formatUnreadBadge(count: number): string | null {
  if (count <= 0) return null;
  if (count > 99) return "99+";
  return String(count);
}
