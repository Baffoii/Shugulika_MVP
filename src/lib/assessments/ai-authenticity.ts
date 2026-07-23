/**
 * Heuristic AI-writing authenticity check for free-response answers.
 *
 * Uses the same OpenAI key/model as FR grading (structured JSON). This is not a
 * dedicated detector API (e.g. GPTZero/Sapling) — treat results as a review signal
 * only. High AI likelihood must never auto-fail or auto-reject a candidate.
 *
 * Pure helpers below the types are unit-tested; the OpenAI call stays server-only.
 */
import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import {
  aiError,
  aiLog,
  aiLogOpenAiCall,
  estimateTokensFromChars,
  estimateUsd,
} from "@/lib/ai-cost-log";

export type AuthenticityClassification = "human_likely" | "mixed" | "ai_likely";

export type AuthenticityEvidenceLabel = "supports_ai" | "supports_human" | "neutral";

export type AuthenticityEvidenceItem = {
  quote: string;
  label: AuthenticityEvidenceLabel;
  note: string;
};

export type AuthenticitySentenceLabel = "human" | "ai" | "mixed";

export type AuthenticitySentenceItem = {
  sentence: string;
  label: AuthenticitySentenceLabel;
};

export type AnswerAuthenticityResult = {
  provider: "openai_heuristic";
  classification: AuthenticityClassification;
  /** 0–1 estimated likelihood the text was primarily AI-generated. */
  aiProbability: number;
  /** Detector self-confidence 0–1. */
  confidence: number;
  rationale: string;
  /** Quoted spans from the answer used as proof. */
  evidence: AuthenticityEvidenceItem[];
  /** Per-sentence labels (GPTZero-style). */
  sentenceLabels: AuthenticitySentenceItem[];
  /** Short cue list derived from evidence notes (UI / legacy). */
  signals: string[];
  flaggedForReview: boolean;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedUsd: number | null;
  checkedAt: string;
};

/** Flag for recruiter review at or above this AI-writing probability. */
export const AI_AUTHENTICITY_REVIEW_THRESHOLD = 0.7;

/** Cap applied when high AI probability lacks supporting quotes. */
export const AI_AUTHENTICITY_EVIDENCE_CAP = 0.35;

const authenticitySchema = z.object({
  classification: z.enum(["human_likely", "mixed", "ai_likely"]),
  ai_probability: z.number(),
  confidence: z.number(),
  rationale: z.string(),
  evidence: z.array(
    z.object({
      quote: z.string(),
      label: z.enum(["supports_ai", "supports_human", "neutral"]),
      note: z.string(),
    }),
  ),
  sentence_labels: z.array(
    z.object({
      sentence: z.string(),
      label: z.enum(["human", "ai", "mixed"]),
    }),
  ),
});

export function shouldFlagAuthenticityForReview(opts: {
  aiProbability: number;
  classification: AuthenticityClassification;
  threshold?: number;
}): boolean {
  const threshold = opts.threshold ?? AI_AUTHENTICITY_REVIEW_THRESHOLD;
  if (opts.classification === "ai_likely") return true;
  return opts.aiProbability >= threshold;
}

/** True when `quote` appears as a substring of `answer` (case-insensitive). */
export function isVerbatimQuoteInAnswer(answer: string, quote: string): boolean {
  const haystack = answer.trim().toLowerCase();
  const needle = quote.trim().toLowerCase();
  if (!needle || needle.length < 3) return false;
  return haystack.includes(needle);
}

export function filterValidEvidenceQuotes(
  answer: string,
  evidence: AuthenticityEvidenceItem[],
): AuthenticityEvidenceItem[] {
  return evidence
    .map((item) => ({
      quote: item.quote.trim(),
      label: item.label,
      note: item.note.trim(),
    }))
    .filter((item) => item.quote.length > 0 && isVerbatimQuoteInAnswer(answer, item.quote))
    .slice(0, 8);
}

export function filterValidSentenceLabels(
  answer: string,
  sentences: AuthenticitySentenceItem[],
): AuthenticitySentenceItem[] {
  return sentences
    .map((item) => ({
      sentence: item.sentence.trim(),
      label: item.label,
    }))
    .filter(
      (item) => item.sentence.length > 0 && isVerbatimQuoteInAnswer(answer, item.sentence),
    )
    .slice(0, 12);
}

/**
 * Dampen inflated AI probability when quote proof is missing or sentences
 * are mostly labeled human.
 */
export function dampenAuthenticityProbability(opts: {
  aiProbability: number;
  confidence: number;
  rationale: string;
  evidence: AuthenticityEvidenceItem[];
  sentenceLabels: AuthenticitySentenceItem[];
}): { aiProbability: number; confidence: number; rationale: string; dampened: boolean } {
  let aiProbability = Math.max(0, Math.min(1, opts.aiProbability));
  let confidence = Math.max(0, Math.min(1, opts.confidence));
  let rationale = opts.rationale;
  let dampened = false;

  const hasAiQuote = opts.evidence.some((item) => item.label === "supports_ai");
  if (aiProbability >= 0.4 && !hasAiQuote) {
    aiProbability = Math.min(aiProbability, AI_AUTHENTICITY_EVIDENCE_CAP);
    confidence = Math.min(confidence, 0.45);
    rationale = `${rationale} Insufficient quote evidence for a high AI-written score — probability capped.`.trim();
    dampened = true;
  }

  const labeled = opts.sentenceLabels;
  if (labeled.length >= 2) {
    const humanCount = labeled.filter((item) => item.label === "human").length;
    if (humanCount / labeled.length >= 0.6 && aiProbability >= 0.4) {
      aiProbability = Math.min(aiProbability, AI_AUTHENTICITY_EVIDENCE_CAP);
      confidence = Math.min(confidence, 0.5);
      if (!dampened) {
        rationale =
          `${rationale} Most sentences labeled human — probability dampened.`.trim();
      }
      dampened = true;
    }
  }

  return { aiProbability, confidence, rationale, dampened };
}

function deriveClassification(aiProbability: number): AuthenticityClassification {
  if (aiProbability >= 0.7) return "ai_likely";
  if (aiProbability >= 0.4) return "mixed";
  return "human_likely";
}

export async function detectAnswerAuthenticity(
  answerText: string,
): Promise<AnswerAuthenticityResult> {
  const model = env.openaiScreeningModel();
  const text = answerText.trim() || "(empty)";
  const system = `You assess whether a short candidate free-response answer appears AI-generated.
Return structured JSON only. This is an authenticity review signal — not a hire/reject decision and not a rubric grade.

Be evidence-first (GPTZero-style): every non-trivial claim must be backed by a verbatim quote from the answer.
Never invent quotes. Prefer quoting over vague vibes.

Calibration:
- Short informal answers (hedging, "not applicable", typos, personal asides, uneven structure) are usually human_likely with low ai_probability unless there is clear LLM polish.
- Polished multi-sentence template answers with generic corporate empathy, perfect parallel lists, empty specificity, and stock closings ("I would ensure…", "moving forward…", "please don't hesitate…") should score higher and must include supports_ai quotes.

classification:
- human_likely: mostly natural human writing
- mixed: possible AI assistance or heavy editing
- ai_likely: strong signs of LLM-generated prose

ai_probability is 0–1 (likelihood the text was primarily AI-generated).
confidence is 0–1 for your classification certainty.
rationale: 1–3 sentences summarizing the judgment.

evidence: 2–6 items. Each quote MUST be copied verbatim from the answer.
- supports_ai: cue that the span looks LLM-generated
- supports_human: cue that the span looks human
- neutral: context only
note: one short sentence explaining why.

sentence_labels: split the answer into sentences (as written) and label each human | ai | mixed.
Every sentence string MUST appear verbatim in the answer.

Do not grade quality, correctness, or recommend hire/reject.`;
  const user = `CANDIDATE ANSWER:\n${text}`;

  const started = Date.now();
  const client = new OpenAI({ apiKey: env.openaiApiKey() });
  aiLog("openai", "CALL_START", {
    purpose: "assessment_ai_authenticity",
    model,
    est_input_tokens: estimateTokensFromChars(system.length + user.length),
  });

  try {
    const completion = await client.chat.completions.parse({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: zodResponseFormat(authenticitySchema, "answer_authenticity"),
    });
    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) throw new Error("Empty authenticity response from model.");

    const usage = completion.usage;
    void aiLogOpenAiCall({
      feature: "assessment",
      purpose: "assessment_ai_authenticity",
      model,
      durationMs: Date.now() - started,
      usage,
    });

    const evidence = filterValidEvidenceQuotes(
      text,
      parsed.evidence.map((item) => ({
        quote: item.quote,
        label: item.label,
        note: item.note,
      })),
    );
    const sentenceLabels = filterValidSentenceLabels(
      text,
      parsed.sentence_labels.map((item) => ({
        sentence: item.sentence,
        label: item.label,
      })),
    );

    const dampened = dampenAuthenticityProbability({
      aiProbability: parsed.ai_probability,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      evidence,
      sentenceLabels,
    });

    const aiProbability = dampened.aiProbability;
    const confidence = dampened.confidence;
    // After dampening, keep classification consistent with probability unless model
    // already said ai_likely and we still have AI quotes + high score.
    let classification = parsed.classification;
    if (dampened.dampened) {
      classification = deriveClassification(aiProbability);
    }
    const flaggedForReview = shouldFlagAuthenticityForReview({
      aiProbability,
      classification,
    });

    const signals = evidence
      .map((item) => `${item.label}: ${item.note}`)
      .filter(Boolean)
      .slice(0, 5);

    return {
      provider: "openai_heuristic",
      classification,
      aiProbability,
      confidence,
      rationale: dampened.rationale,
      evidence,
      sentenceLabels,
      signals,
      flaggedForReview,
      model,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      estimatedUsd: estimateUsd(usage),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    aiError("openai", "CALL_FAILED", error, { purpose: "assessment_ai_authenticity" });
    // Soft-fail: do not block grading if authenticity check fails.
    return {
      provider: "openai_heuristic",
      classification: "mixed",
      aiProbability: 0.5,
      confidence: 0,
      rationale:
        error instanceof Error
          ? `Authenticity check failed (${error.message}). Flagged for recruiter review.`
          : "Authenticity check failed. Flagged for recruiter review.",
      evidence: [],
      sentenceLabels: [],
      signals: ["authenticity_check_failed"],
      flaggedForReview: true,
      model,
      promptTokens: null,
      completionTokens: null,
      estimatedUsd: null,
      checkedAt: new Date().toISOString(),
    };
  }
}
