/**
 * Pure helpers for AI-drafted professional headline/summary.
 * No `server-only` — safe for unit tests and shared imports.
 */
import { z } from "zod";
import {
  AI_DRAFTED_CONFIDENCE,
  AI_DRAFTED_EVIDENCE,
} from "@/lib/resume/professional-copy-constants";

export const professionalCopySchema = z.object({
  headline: z.string().min(1).max(140),
  summary: z.string().min(1).max(2000),
});

export type ProfessionalCopy = z.infer<typeof professionalCopySchema>;

/** True when extraction found no usable professional summary on the CV. */
export function resumeLacksProfessionalSummary(
  summary: { value: string } | null | undefined,
): boolean {
  return !summary?.value?.trim();
}

type PersonalField = {
  value: string;
  confidence: number;
  evidence_text: string | null;
} | null;

export interface MergeProfessionalCopyInput {
  personal: {
    headline: PersonalField;
    summary: PersonalField;
  };
  /** Existing profile values — AI drafts only fill empty profile fields. */
  profileHeadline: string | null | undefined;
  profileSummary: string | null | undefined;
  drafted: ProfessionalCopy;
}

/**
 * Applies AI-drafted headline/summary onto an extraction result.
 * - Summary is applied when the profile summary is empty.
 * - Headline is applied only when the CV also lacked a headline AND the
 *   profile headline is empty (never overwrite a verbatim CV headline).
 */
export function mergeProfessionalCopyIntoPersonal(input: MergeProfessionalCopyInput): {
  headline: PersonalField;
  summary: PersonalField;
  filled: ("headline" | "summary")[];
} {
  const filled: ("headline" | "summary")[] = [];
  let { headline, summary } = input.personal;

  if (!input.profileSummary?.trim() && input.drafted.summary.trim()) {
    summary = {
      value: input.drafted.summary.trim().slice(0, 2000),
      confidence: AI_DRAFTED_CONFIDENCE,
      evidence_text: AI_DRAFTED_EVIDENCE,
    };
    filled.push("summary");
  }

  const cvLacksHeadline = !input.personal.headline?.value?.trim();
  if (cvLacksHeadline && !input.profileHeadline?.trim() && input.drafted.headline.trim()) {
    headline = {
      value: input.drafted.headline.trim().slice(0, 140),
      confidence: AI_DRAFTED_CONFIDENCE,
      evidence_text: AI_DRAFTED_EVIDENCE,
    };
    filled.push("headline");
  }

  return { headline, summary, filled };
}
