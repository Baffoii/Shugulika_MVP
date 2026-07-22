/**
 * Centralized, validated access to public environment variables.
 * Only NEXT_PUBLIC_* values are safe for the browser. A missing value throws a
 * clear error at first use rather than failing deep inside the Supabase client.
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
  /** Server-only. Never expose to the client. */
  openaiApiKey: () => required("OPENAI_API_KEY", process.env.OPENAI_API_KEY),
  /** Server-only. Never expose to the client. */
  openaiResumeModel: () => process.env.OPENAI_RESUME_MODEL ?? "gpt-4.1-mini",
  /** Server-only. Model used for AI CV screening (role-fit reviews). */
  openaiScreeningModel: () =>
    process.env.OPENAI_SCREENING_MODEL ?? process.env.OPENAI_RESUME_MODEL ?? "gpt-4.1-mini",
};

/** True when the OpenAI key is configured (used to gracefully disable CV parsing). */
export function isResumeParsingConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** True when both required Supabase values are present (used for graceful degradation). */
export function isSupabaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
