"use client";

import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/** Browser Supabase client using the publishable (anon) key. */
export function createClient() {
  return createBrowserClient<Database>(env.supabaseUrl(), env.supabaseKey());
}
