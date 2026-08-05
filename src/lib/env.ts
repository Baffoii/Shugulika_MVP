/**
 * Browser-safe environment access.
 *
 * This module is imported by client components, so it must only ever read
 * NEXT_PUBLIC_* values. Server-only configuration (OpenAI keys and models)
 * lives in `env.server.ts`, which is marked `server-only` so that importing it
 * from client code is a build error rather than a silent leak.
 *
 * A missing value throws a clear error at first use rather than failing deep
 * inside the Supabase client.
 */
function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseKey: () =>
    required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};

/** True when both required Supabase values are present (used for graceful degradation). */
export function isSupabaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
