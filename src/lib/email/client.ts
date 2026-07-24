import "server-only";

import { Resend } from "resend";

/** True when Resend is configured (emails send; otherwise they are skipped). */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export function emailFrom(): string | null {
  const from = process.env.EMAIL_FROM?.trim();
  return from || null;
}

/** Lazily create a Resend client. Returns null when the API key is missing. */
export function getResendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return new Resend(key);
}
