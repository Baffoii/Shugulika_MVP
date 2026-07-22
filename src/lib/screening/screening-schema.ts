/**
 * Structured-output schema for AI CV screening (role-fit review) via the OpenAI
 * API. The shape maps 1:1 onto the `application_ai_reviews` (top-level fields)
 * and `application_ai_review_items` (the `items` array) tables.
 *
 * OpenAI strict JSON schema mode does not support optional keys — every property
 * must be present, and absent values are represented as `null`.
 */
import { z } from "zod";

/** One granular, evidence-cited point about the candidate. */
export const screeningItemSchema = z.object({
  /**
   * For `requirement_match` items, echo the exact `id` of the job requirement
   * this addresses (as supplied in the prompt). `null` for free-form
   * strengths / gaps / concerns / questions not tied to a single requirement.
   */
  requirement_id: z.string().nullable(),
  item_type: z.enum(["requirement_match", "strength", "gap", "concern", "question"]),
  /** Short title: the requirement label, or the heading of the strength/concern. */
  label: z.string().min(1),
  /** Only meaningful for `requirement_match` items; `null` otherwise. */
  assessment: z.enum(["met", "partial", "missing", "unclear"]).nullable(),
  /** Direct, specific reasoning — why this is strong / weak / concerning. */
  explanation: z.string().min(1),
  /** Verbatim CV excerpt supporting the point; `null` when the point is an absence. */
  evidence_text: z.string().max(300).nullable(),
  confidence: z.number().min(0).max(1),
});

export const screeningResultSchema = z.object({
  /** 0–100 overall role fit. */
  overall_score: z.number().int().min(0).max(100),
  fit_verdict: z.enum(["strong_fit", "possible_fit", "weak_fit", "insufficient_evidence"]),
  /** Blunt top-line: whether to advance this candidate and why. */
  summary: z.string().min(1),
  /** Narrative of what genuinely looks strong for THIS role. */
  strengths: z.string(),
  /** Narrative of gaps (incl. employment gaps), vagueness, and red flags — stated directly. */
  concerns: z.string(),
  /** Interview questions that probe the weakest / least-verified areas. */
  recommended_questions: z.array(z.string()),
  /** Fuller reasoning trace behind the score. */
  model_reasoning: z.string(),
  items: z.array(screeningItemSchema),
});

export type ScreeningItem = z.infer<typeof screeningItemSchema>;
export type ScreeningResult = z.infer<typeof screeningResultSchema>;
