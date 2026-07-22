import "server-only";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import {
  professionalCopySchema,
  type ProfessionalCopy,
} from "@/lib/resume/professional-copy-logic";
import {
  aiError,
  aiLog,
  aiLogOpenAiCall,
  aiWarn,
  estimateTokensFromChars,
  estimateUsd,
  formatUsd,
} from "@/lib/ai-cost-log";

export {
  professionalCopySchema,
  resumeLacksProfessionalSummary,
  mergeProfessionalCopyIntoPersonal,
  type ProfessionalCopy,
  type MergeProfessionalCopyInput,
} from "@/lib/resume/professional-copy-logic";
export {
  AI_DRAFTED_CONFIDENCE,
  AI_DRAFTED_EVIDENCE,
} from "@/lib/resume/professional-copy-constants";

/** Thrown on any OpenAI/provider failure — never propagate the raw provider error to the client. */
export class ProfessionalCopyError extends Error {}

const SYSTEM_PROMPT = `You are a professional CV writer for a recruitment platform serving East African and global candidates. You are given the raw text of a candidate's CV/resume that did NOT include a professional summary (or objective) section.

Write a concise, professional headline and summary grounded ONLY in facts present in the CV. Never invent employers, titles, degrees, years of experience, skills, certifications, or achievements. Prefer concrete role and domain language over vague marketing fluff.

Rules:
- headline: one short line (max ~120 characters) suitable as a profile title (e.g. "Financial Analyst · IFRS & Month-End Close"). Do not use the candidate's full name as the headline.
- summary: 2–4 sentences (max ~600 characters) in first person or third person is fine; prefer a neutral professional tone. Mention seniority, core domain, and 1–2 strongest evidence-backed strengths from the CV. Do not claim soft skills or results that are not supported by the text.
- If the CV is too sparse to write a meaningful summary, still produce the best honest short draft you can from what is present — do not pad with speculation.`;

/**
 * Drafts a professional headline + summary from CV text using the same
 * low-cost resume model as field extraction. Only call when
 * `resumeLacksProfessionalSummary` is true.
 */
export async function generateProfessionalCopy(resumeText: string): Promise<ProfessionalCopy> {
  const model = env.openaiResumeModel();
  const cvChars = resumeText.length;
  const cvCharsSent = Math.min(cvChars, 60_000);
  const userContent = `This CV has no professional summary section. Draft a headline and summary from the content below.\n\nCV text:\n\n${resumeText.slice(0, 60_000)}`;
  const promptChars = SYSTEM_PROMPT.length + userContent.length;
  const estInTokens = estimateTokensFromChars(promptChars);
  const roughPreUsd = estimateUsd({
    prompt_tokens: estInTokens,
    completion_tokens: 400,
  });

  aiLog("resume", "OPENAI_REQUEST_PREPARE", {
    purpose: "cv_professional_copy",
    model,
    cvChars,
    cvCharsSent,
    cvTruncated: cvChars > 60_000,
    promptChars,
    estPromptTokens: estInTokens,
    roughEstimatedUsdIfTypicalOutput: formatUsd(roughPreUsd),
    billed: true,
    tip: "Second paid call — only runs when CV extraction found no summary",
  });

  const client = new OpenAI({ apiKey: env.openaiApiKey() });
  const started = Date.now();
  try {
    aiLog("openai", "CALL_START", {
      feature: "resume",
      purpose: "cv_professional_copy",
      model,
    });
    const completion = await client.chat.completions.parse({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: zodResponseFormat(professionalCopySchema, "professional_copy"),
    });
    const durationMs = Date.now() - started;
    const usage = completion.usage
      ? {
          prompt_tokens: completion.usage.prompt_tokens,
          completion_tokens: completion.usage.completion_tokens,
          total_tokens: completion.usage.total_tokens,
        }
      : null;
    aiLogOpenAiCall({
      feature: "resume",
      purpose: "cv_professional_copy",
      model,
      durationMs,
      usage,
    });

    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      aiWarn("resume", "OPENAI_NO_PARSED_RESULT", {
        durationMs,
        model,
        purpose: "cv_professional_copy",
      });
      throw new ProfessionalCopyError("The AI provider returned no structured result.");
    }

    aiLog("resume", "OPENAI_RESULT_SUMMARY", {
      purpose: "cv_professional_copy",
      headlineChars: parsed.headline.length,
      summaryChars: parsed.summary.length,
      estimatedUsd: formatUsd(estimateUsd(usage)),
    });
    return {
      headline: parsed.headline.trim().slice(0, 140),
      summary: parsed.summary.trim().slice(0, 2000),
    };
  } catch (error) {
    aiError("resume", "OPENAI_CALL_FAILED", error, {
      model,
      purpose: "cv_professional_copy",
      durationMs: Date.now() - started,
      billedMaybe: true,
    });
    if (error instanceof ProfessionalCopyError) throw error;
    throw new ProfessionalCopyError(
      "The AI provider could not draft a professional summary. Please try again.",
    );
  }
}
