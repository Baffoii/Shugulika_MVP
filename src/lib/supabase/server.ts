import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };
import { env } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Server Supabase client (Server Components, Route Handlers, Server Actions).
 * Uses the publishable key + the request cookies for the authenticated session.
 * The cookie write in Server Components can throw; it's safe to ignore because
 * the middleware refreshes the session on every request.
 */
export function createClient() {
  const cookieStore = cookies();
  return createServerClient<Database>(env.supabaseUrl(), env.supabaseKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — ignore; middleware handles refresh.
        }
      },
    },
  });
}
