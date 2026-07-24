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
  // Next 15+ made `cookies()` async. Resolving it lazily inside the cookie
  // handlers keeps `createClient()` synchronous, so its ~180 call sites don't
  // each need to become `await createClient()`. @supabase/ssr supports async
  // getAll/setAll and invokes them within the same request scope.
  return createServerClient<Database>(env.supabaseUrl(), env.supabaseKey(), {
    cookies: {
      async getAll() {
        return (await cookies()).getAll();
      },
      async setAll(cookiesToSet: CookieToSet[]) {
        try {
          const cookieStore = await cookies();
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — ignore; middleware handles refresh.
        }
      },
    },
  });
}
