/**
 * Shared labels for AI-drafted headline/summary suggestions.
 * Kept free of `server-only` so client review UI can detect drafted copy.
 */

/** Shown as evidence_text on AI-drafted headline/summary suggestions. */
export const AI_DRAFTED_EVIDENCE =
  "AI-drafted from your CV — no professional summary was found on the document";

/** Confidence for drafted copy (lower than verbatim extraction). */
export const AI_DRAFTED_CONFIDENCE = 0.65;
