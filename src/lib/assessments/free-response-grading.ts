/**
 * Future-compatible free-response grading boundary.
 *
 * Do not call OpenAI from here yet. When AI grading is enabled:
 * - MCQs stay deterministic (see mcq-grade.ts)
 * - Free-response uses a stored rubric + structured JSON output
 * - Low confidence / borderline scores must set humanReviewRequired
 * - AI alone must never reject a candidate
 * - Token usage and estimated cost must be logged via ai_usage_events
 */

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
  quote: string | null;
  note: string;
};

/** Structured model output contract for a future OpenAI (or other) grader. */
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
}): boolean {
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
