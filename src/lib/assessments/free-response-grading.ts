/**
 * Free-response grading types and helpers.
 *
 * MCQs stay deterministic (see mcq-grade.ts). Free-response uses a stored rubric
 * + OpenAI structured JSON (see grade-shugulika.ts). Low confidence / borderline
 * scores / high AI-writing likelihood set humanReviewRequired. AI alone must never
 * reject a candidate. Token usage and estimated cost are logged via ai_usage_events.
 */

import type { AnswerAuthenticityResult } from "@/lib/assessments/ai-authenticity";

export type FreeResponseRubricCriterion = {
  id: string;
  label: string;
  maxPoints: number;
  guidance: string;
};

export type FreeResponseRubric = {
  id: string;
  questionId: string;
  criteria: FreeResponseRubricCriterion[];
  passThresholdPercent: number;
  /** Scores at or below this confidence require human review. */
  minConfidenceForAutoAccept: number;
  /** Percent margin around the pass threshold that requires human review. */
  borderlineMarginPercent: number;
};

export type FreeResponseGradeEvidence = {
  criterionId: string;
  /** Points awarded for this criterion (0–criterion max). */
  pointsAwarded: number;
  quote: string | null;
  note: string;
};

/** Structured model output contract for the OpenAI free-response grader. */
export type FreeResponseGradeOutput = {
  score: number;
  maxScore: number;
  percent: number;
  explanation: string;
  evidence: FreeResponseGradeEvidence[];
  confidence: number;
  humanReviewRequired: boolean;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedUsd: number | null;
  /** Optional AI-writing authenticity signal (review-only). */
  authenticity?: AnswerAuthenticityResult | null;
};

export type FreeResponseGradeResult = FreeResponseGradeOutput & {
  questionId: string;
  rubricId: string;
};

export function requiresHumanReview(opts: {
  percent: number;
  passThresholdPercent: number;
  confidence: number;
  minConfidenceForAutoAccept: number;
  borderlineMarginPercent: number;
  authenticityFlagged?: boolean;
}): boolean {
  if (opts.authenticityFlagged) return true;
  if (opts.confidence < opts.minConfidenceForAutoAccept) return true;
  const distance = Math.abs(opts.percent - opts.passThresholdPercent);
  return distance <= opts.borderlineMarginPercent;
}

/**
 * Assembles a grading_payload fragment for storage on assessment_assignments.
 * Callers must still persist token/cost rows separately when AI is wired.
 */
export function buildFreeResponseGradingPayload(
  results: FreeResponseGradeResult[],
): Record<string, unknown> {
  return {
    version: 1,
    kind: "free_response",
    gradedAt: new Date().toISOString(),
    results,
    humanReviewRequired: results.some((result) => result.humanReviewRequired),
  };
}
