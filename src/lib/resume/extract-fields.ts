import "server-only";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { COUNTRIES } from "@/lib/constants";
import { resumeExtractionSchema, type ResumeExtraction } from "@/lib/resume/extraction-schema";
import {
  aiError,
  aiLog,
  aiLogOpenAiCall,
  aiWarn,
  estimateTokensFromChars,
  estimateUsd,
  formatUsd,
} from "@/lib/ai-cost-log";

/** Thrown on any OpenAI/provider failure — never propagate the raw provider error to the client. */
export class ResumeExtractionError extends Error {}

const SYSTEM_PROMPT = `You are an information-extraction assistant for a recruitment platform. You are given the raw text of a candidate's CV/resume. Extract only information that is explicitly present in the text — never invent or guess values. For every field or list item, provide a confidence score from 0 to 1 reflecting how certain you are the extracted value is correct, and a short verbatim evidence_text excerpt (max ~200 characters) from the source text that supports it. If a field is not present in the CV, return null for it (or an empty array for lists). Dates must be formatted as YYYY-MM-DD when a day is known, or YYYY-MM-01 when only a month/year is known; leave a date null if it cannot be determined. For country_code, only use one of these ISO codes if the candidate's country can be confidently inferred: ${COUNTRIES.map((c) => `${c.code} (${c.name})`).join(", ")}. The candidate's name usually appears at the very top of the document — split it into given_name (first name), middle_name (any middle name/initial, null if none), and family_name (last name/surname). Extract the phone number exactly as written (keep the original formatting/country code), and extract an email address if one is present anywhere in the document (contact details are sometimes in a sidebar/"Contact" block that appears after other sections, not necessarily at the top). For education entries, "qualification" should capture the degree or diploma level (e.g. "Bachelor of Commerce", "Master of Science in Finance", "Advanced Certificate of Secondary Education") — this is very often on the line right before or right after the institution/date line, not necessarily on the same line.`;

/**
 * Calls OpenAI with a strict structured-output schema to extract candidate
 * profile fields from raw CV text. Never logs the raw API key or CV bytes.
 */
export async function extractResumeFields(resumeText: string): Promise<ResumeExtraction> {
  const model = env.openaiResumeModel();
  const cvChars = resumeText.length;
  const cvCharsSent = Math.min(cvChars, 60_000);
  const userContent = `CV text:\n\n${resumeText.slice(0, 60_000)}`;
  const promptChars = SYSTEM_PROMPT.length + userContent.length;
  const estInTokens = estimateTokensFromChars(promptChars);
  const roughPreUsd = estimateUsd({
    prompt_tokens: estInTokens,
    completion_tokens: 2_000,
  });

  aiLog("resume", "OPENAI_REQUEST_PREPARE", {
    purpose: "cv_field_extraction",
    model,
    cvChars,
    cvCharsSent,
    cvTruncated: cvChars > 60_000,
    promptChars,
    estPromptTokens: estInTokens,
    roughEstimatedUsdIfTypicalOutput: formatUsd(roughPreUsd),
    billed: true,
    tip: "This is a PAID call — rule-based stub is free when OPENAI_API_KEY is unset",
  });

  const client = new OpenAI({ apiKey: env.openaiApiKey() });
  const started = Date.now();
  try {
    aiLog("openai", "CALL_START", {
      feature: "resume",
      purpose: "cv_field_extraction",
      model,
    });
    const completion = await client.chat.completions.parse({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: zodResponseFormat(resumeExtractionSchema, "resume_extraction"),
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
      feature: "resume",
      purpose: "cv_field_extraction",
      model,
      durationMs,
      usage,
    });

    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      aiWarn("resume", "OPENAI_NO_PARSED_RESULT", { durationMs, model });
      throw new ResumeExtractionError("The AI provider returned no structured result.");
    }

    aiLog("resume", "OPENAI_RESULT_SUMMARY", {
      experienceCount: parsed.experience?.length ?? 0,
      educationCount: parsed.education?.length ?? 0,
      skillCount: parsed.skills?.length ?? 0,
      certificationCount: parsed.certifications?.length ?? 0,
      languageCount: parsed.languages?.length ?? 0,
      personalNonNull: Object.values(parsed.personal ?? {}).filter((v) => v != null).length,
      estimatedUsd: formatUsd(estimateUsd(usage)),
    });
    return parsed;
  } catch (error) {
    aiError("resume", "OPENAI_CALL_FAILED", error, {
      model,
      durationMs: Date.now() - started,
      billedMaybe: true,
    });
    if (error instanceof ResumeExtractionError) throw error;
    throw new ResumeExtractionError("The AI provider could not process this CV. Please try again.");
  }
}
