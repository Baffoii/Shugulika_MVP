import type { CandidateProfileRow } from "@/lib/database.types";

export interface CompletionInput {
  profile: Pick<CandidateProfileRow, "given_name" | "headline" | "summary" | "city"> | null;
  experiences: number;
  education: number;
  skills: number;
  documents: number;
}

/**
 * Profile-completion percentage from the loaded sections. Pure and unit-tested;
 * re-exported from lib/data/candidate.ts for the app. Clamped to 0..100.
 */
export function computeCompletion(input: CompletionInput): number {
  let pct = 0;
  if (input.profile?.given_name) pct += 15;
  if (input.profile?.headline) pct += 10;
  if (input.profile?.summary) pct += 15;
  if (input.profile?.city) pct += 10;
  if (input.experiences > 0) pct += 20;
  if (input.education > 0) pct += 15;
  if (input.skills > 0) pct += 5;
  if (input.documents > 0) pct += 10;
  return Math.max(0, Math.min(100, pct));
}
