import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client for privileged Storage reads after an application-layer
 * entitlement check (watermarked previews / HQ export). Never import from
 * client components. Returns null when the key is not configured.
 */
export function createServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createSupabaseClient<Database>(env.supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isServiceRoleConfigured(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}
