/**
 * Structured-output schema for CV/resume extraction via the OpenAI API.
 * Every property must be present (OpenAI strict JSON schema mode does not
 * support optional keys) — absent values are represented as `null`.
 */
import { z } from "zod";

const personalFieldSchema = z
  .object({
    value: z.string().min(1),
    confidence: z.number().min(0).max(1),
    evidence_text: z.string().max(300).nullable(),
  })
  .nullable();

export const resumeExtractionSchema = z.object({
  personal: z.object({
    given_name: personalFieldSchema,
    middle_name: personalFieldSchema,
    family_name: personalFieldSchema,
    phone: personalFieldSchema,
    email: personalFieldSchema,
    headline: personalFieldSchema,
    summary: personalFieldSchema,
    city: personalFieldSchema,
    country_code: personalFieldSchema,
    availability: personalFieldSchema,
  }),
  experience: z.array(
    z.object({
      title: z.string(),
      employer_name: z.string().nullable(),
      location: z.string().nullable(),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
      is_current: z.boolean(),
      description: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      evidence_text: z.string().max(300).nullable(),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      qualification: z.string().nullable(),
      field_of_study: z.string().nullable(),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
      is_current: z.boolean(),
      confidence: z.number().min(0).max(1),
      evidence_text: z.string().max(300).nullable(),
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string(),
      confidence: z.number().min(0).max(1),
      evidence_text: z.string().max(300).nullable(),
    }),
  ),
  certifications: z.array(
    z.object({
      name: z.string(),
      issuer: z.string().nullable(),
      issued_on: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      evidence_text: z.string().max(300).nullable(),
    }),
  ),
  languages: z.array(
    z.object({
      language: z.string(),
      proficiency: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      evidence_text: z.string().max(300).nullable(),
    }),
  ),
});

export type ResumeExtraction = z.infer<typeof resumeExtractionSchema>;
