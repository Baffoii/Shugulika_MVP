import "server-only";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { COUNTRIES } from "@/lib/constants";
import { resumeExtractionSchema, type ResumeExtraction } from "@/lib/resume/extraction-schema";

/** Thrown on any OpenAI/provider failure — never propagate the raw provider error to the client. */
export class ResumeExtractionError extends Error {}

const SYSTEM_PROMPT = `You are an information-extraction assistant for a recruitment platform. You are given the raw text of a candidate's CV/resume. Extract only information that is explicitly present in the text — never invent or guess values. For every field or list item, provide a confidence score from 0 to 1 reflecting how certain you are the extracted value is correct, and a short verbatim evidence_text excerpt (max ~200 characters) from the source text that supports it. If a field is not present in the CV, return null for it (or an empty array for lists). Dates must be formatted as YYYY-MM-DD when a day is known, or YYYY-MM-01 when only a month/year is known; leave a date null if it cannot be determined. For country_code, only use one of these ISO codes if the candidate's country can be confidently inferred: ${COUNTRIES.map((c) => `${c.code} (${c.name})`).join(", ")}. The candidate's name usually appears at the very top of the document — split it into given_name (first name), middle_name (any middle name/initial, null if none), and family_name (last name/surname). Extract the phone number exactly as written (keep the original formatting/country code), and extract an email address if one is present anywhere in the document (contact details are sometimes in a sidebar/"Contact" block that appears after other sections, not necessarily at the top). For education entries, "qualification" should capture the degree or diploma level (e.g. "Bachelor of Commerce", "Master of Science in Finance", "Advanced Certificate of Secondary Education") — this is very often on the line right before or right after the institution/date line, not necessarily on the same line.`;

/**
 * Calls OpenAI with a strict structured-output schema to extract candidate
 * profile fields from raw CV text. Never logs the raw API key or CV bytes.
 */
export async function extractResumeFields(resumeText: string): Promise<ResumeExtraction> {
  const client = new OpenAI({ apiKey: env.openaiApiKey() });
  try {
    const completion = await client.chat.completions.parse({
      model: env.openaiResumeModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `CV text:\n\n${resumeText.slice(0, 60_000)}` },
      ],
      response_format: zodResponseFormat(resumeExtractionSchema, "resume_extraction"),
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) throw new ResumeExtractionError("The AI provider returned no structured result.");
    return parsed;
  } catch (error) {
    if (error instanceof ResumeExtractionError) throw error;
    throw new ResumeExtractionError("The AI provider could not process this CV. Please try again.");
  }
}
