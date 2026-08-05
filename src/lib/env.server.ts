/**
 * Server-only environment access.
 *
 * `import "server-only"` makes it a build error for any client component to
 * reach this module, which is what keeps OPENAI_API_KEY out of browser
 * bundles. Never re-export these values from `env.ts`, and never pass a value
 * read here into a client component's props or a page payload.
 *
 * The browser is only ever given a short-lived Realtime client secret minted
 * per authorized assignment — never the permanent key.
 */
import "server-only";

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const serverEnv = {
  /** Permanent provider credential. Must never reach a browser, log or DB row. */
  openaiApiKey: () => required("OPENAI_API_KEY", process.env.OPENAI_API_KEY),
  openaiResumeModel: () => process.env.OPENAI_RESUME_MODEL ?? "gpt-4.1-mini",
  openaiScreeningModel: () =>
    process.env.OPENAI_SCREENING_MODEL ?? process.env.OPENAI_RESUME_MODEL ?? "gpt-4.1-mini",
  /** Realtime voice model for live AI interviews. Configurable per environment. */
  openaiRealtimeModel: () => process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1",
  /** Transcription model for post-interview candidate audio. */
  openaiTranscribeModel: () => process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-transcribe",
};

/** True when the OpenAI key is configured (used to gracefully disable CV parsing). */
export function isResumeParsingConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** Alias for assessment/screening callers — same gate as resume parsing. */
export function isOpenAiConfigured(): boolean {
  return isResumeParsingConfigured();
}
