"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type NotificationActionResult = { ok: boolean; error?: string };

/** Mark one of the current user's notifications as read. */
export async function markNotificationReadAction(
  notificationId: string,
): Promise<NotificationActionResult> {
  if (!notificationId) return { ok: false, error: "Missing notification." };
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", auth.user.id)
    .is("read_at", null);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/notifications");
  revalidatePath("/recruiter/notifications");
  return { ok: true };
}

/** Mark all of the current user's unread notifications as read (e.g. opening the inbox). */
export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", auth.user.id)
    .is("read_at", null);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/notifications");
  revalidatePath("/recruiter/notifications");
  return { ok: true };
}
