import "server-only";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { screeningResultSchema, type ScreeningResult } from "@/lib/screening/screening-schema";
import {
  aiError,
  aiLog,
  aiLogOpenAiCall,
  aiWarn,
  estimateTokensFromChars,
  formatUsd,
  estimateUsd,
} from "@/lib/ai-cost-log";

/** Thrown on any OpenAI/provider failure — never propagate the raw provider error to the client. */
export class ScreeningError extends Error {}

/** A single structured requirement to score the CV against. */
export interface ScreeningRequirement {
  id: string;
  category: string;
  label: string;
  detail: string | null;
  importance: "must_have" | "nice_to_have";
  min_years: number | null;
}

/** A screening-question answer the candidate submitted with the application. */
export interface ScreeningAnswer {
  prompt: string;
  answer: string;
}

export interface ScreeningInput {
  jobTitle: string;
  /** Structured criteria (from `job_requirements`). May be empty. */
  requirements: ScreeningRequirement[];
  /** Original free-text requirements from the job order, for context. */
  freeTextRequirements: string | null;
  /** Raw extracted CV text (already run through extract-text). */
  cvText: string;
  /** Screening Q&A, if any. */
  answers: ScreeningAnswer[];
}

const SYSTEM_PROMPT = `You are a senior technical recruiter reviewing a candidate's CV against a specific job's requirements. Produce a rigorous, EVIDENCE-BASED role-fit assessment. Be direct and honest — do not soften weak matches, and do not inflate scores to be encouraging. Your reader is a recruiter deciding whether to advance this candidate.

Rules:
- Judge ONLY the fit between this CV and THIS job's requirements. Ignore anything not relevant to the role.
- For EVERY structured requirement you are given (each has an "id"), output exactly one item with item_type "requirement_match", set requirement_id to that exact id, and set assessment to one of: met, partial, missing, unclear. Explain concretely WHY, and quote a verbatim CV excerpt in evidence_text when the CV supports it (null when the requirement is simply absent).
- Weight must_have requirements far more heavily than nice_to_have ones when scoring. A missing must_have should cap the score low.
- Beyond requirements, surface: item_type "strength" for genuinely strong, role-relevant signals; item_type "gap" for missing experience AND for unexplained employment gaps in the timeline (state the approximate dates); item_type "concern" for vague/unquantified claims (e.g. "led a team" with no size or outcome), title-vs-substance mismatches, job-hopping, or anything a recruiter should probe; item_type "question" for pointed interview questions that would resolve the biggest uncertainties.
- NEVER invent facts. If the CV is silent on something, say so rather than assuming. Set confidence to reflect how well the CV actually supports each point.
- Do NOT consider or infer age, gender, ethnicity, nationality, religion, marital/family status, or any protected characteristic. Assess capability and relevant experience only.
- evidence_text must be a short verbatim quote from the CV (max ~300 chars), never a paraphrase.
- overall_score is 0-100 role fit. fit_verdict: strong_fit, possible_fit, weak_fit, or insufficient_evidence (use the last when the CV is too sparse/unreadable to judge).`;

function buildUserPrompt(input: ScreeningInput): string {
  const reqLines =
    input.requirements.length > 0
      ? input.requirements
          .map(
            (r) =>
              `- id: ${r.id} | [${r.importance}] (${r.category}${
                r.min_years != null ? `, min ${r.min_years}y` : ""
              }) ${r.label}${r.detail ? ` — ${r.detail}` : ""}`,
          )
          .join("\n")
      : "(No structured requirements provided.)";

  const answerLines =
    input.answers.length > 0
      ? input.answers.map((a) => `Q: ${a.prompt}\nA: ${a.answer}`).join("\n\n")
      : "(No screening answers submitted.)";

  return [
    `JOB TITLE: ${input.jobTitle}`,
    "",
    "STRUCTURED REQUIREMENTS (score each by its id):",
    reqLines,
    "",
    "ORIGINAL FREE-TEXT REQUIREMENTS (context):",
    input.freeTextRequirements?.trim() || "(none)",
    "",
    "SCREENING ANSWERS:",
    answerLines,
    "",
    "CANDIDATE CV TEXT:",
    input.cvText.slice(0, 60_000),
  ].join("\n");
}

/**
 * Stable fingerprint of the requirement set used for a screen. Stored on the
 * review row so a cached result is reused only while the requirements are
 * unchanged. Order-independent (sorted by id) so mere reordering does not
 * invalidate the cache.
 */
export function requirementsFingerprint(requirements: ScreeningRequirement[]): string {
  const canonical = [...requirements]
    .map(
      (r) =>
        `${r.id}:${r.category}:${r.importance}:${r.min_years ?? ""}:${r.label}:${r.detail ?? ""}`,
    )
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Calls OpenAI with a strict structured-output schema to score a CV against a
 * job's requirements. Never logs the raw API key or CV bytes; wraps all
 * provider errors so nothing internal leaks to the client.
 */
export async function scoreApplication(input: ScreeningInput): Promise<ScreeningResult> {
  if (!input.cvText.trim()) {
    throw new ScreeningError("The CV has no extractable text to screen.");
  }

  const model = env.openaiScreeningModel();
  const cvChars = input.cvText.length;
  const cvCharsSent = Math.min(cvChars, 60_000);
  const userPrompt = buildUserPrompt(input);
  const promptChars = SYSTEM_PROMPT.length + userPrompt.length;
  const estInTokens = estimateTokensFromChars(promptChars);
  const roughPreUsd = estimateUsd({
    prompt_tokens: estInTokens,
    completion_tokens: 1_500, // typical structured-output size ballpark
  });

  aiLog("screening", "OPENAI_REQUEST_PREPARE", {
    purpose: "cv_role_fit_screen",
    model,
    jobTitle: input.jobTitle,
    requirementCount: input.requirements.length,
    mustHaveCount: input.requirements.filter((r) => r.importance === "must_have").length,
    niceToHaveCount: input.requirements.filter((r) => r.importance === "nice_to_have").length,
    answerCount: input.answers.length,
    cvChars,
    cvCharsSent,
    cvTruncated: cvChars > 60_000,
    promptChars,
    estPromptTokens: estInTokens,
    roughEstimatedUsdIfTypicalOutput: formatUsd(roughPreUsd),
    billed: true,
    tip: "This is a PAID call — cache hits skip this path",
  });

  const client = new OpenAI({ apiKey: env.openaiApiKey() });
  const started = Date.now();
  try {
    aiLog("openai", "CALL_START", {
      feature: "screening",
      purpose: "cv_role_fit_screen",
      model,
    });
    const completion = await client.chat.completions.parse({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: zodResponseFormat(screeningResultSchema, "cv_screening"),
    });
    const durationMs = Date.now() - started;
    const usage = completion.usage
      ? {
          prompt_tokens: completion.usage.prompt_tokens,
          completion_tokens: completion.usage.completion_tokens,
          total_tokens: completion.usage.total_tokens,
        }
      : null;
    await aiLogOpenAiCall({
      feature: "screening",
      purpose: "cv_role_fit_screen",
      model,
      durationMs,
      usage,
      extra: {
        finishReason: completion.choices[0]?.finish_reason ?? null,
        refusal: completion.choices[0]?.message.refusal ? true : false,
      },
    });

    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      aiWarn("screening", "OPENAI_NO_PARSED_RESULT", { durationMs, model });
      throw new ScreeningError("The AI provider returned no structured result.");
    }

    aiLog("screening", "OPENAI_RESULT_SUMMARY", {
      overallScore: parsed.overall_score,
      fitVerdict: parsed.fit_verdict,
      itemCount: parsed.items?.length ?? 0,
      requirementMatchCount:
        parsed.items?.filter((i) => i.item_type === "requirement_match").length ?? 0,
      strengthCount: parsed.items?.filter((i) => i.item_type === "strength").length ?? 0,
      gapOrConcernCount:
        parsed.items?.filter((i) => i.item_type === "gap" || i.item_type === "concern").length ?? 0,
      questionCount: Array.isArray(parsed.recommended_questions)
        ? parsed.recommended_questions.length
        : 0,
      estimatedUsd: formatUsd(estimateUsd(usage)),
    });
    return parsed;
  } catch (error) {
    aiError("screening", "OPENAI_CALL_FAILED", error, {
      model,
      durationMs: Date.now() - started,
      billedMaybe: true,
    });
    if (error instanceof ScreeningError) throw error;
    throw new ScreeningError("The AI provider could not screen this CV. Please try again.");
  }
}
