import { z } from "zod";
import {
  INTERVIEW_LIMITS,
  LANGUAGE_PROFICIENCIES,
  PUBLIC_SIGNUP_ROLES,
  type LanguageProficiency,
} from "@/lib/constants";

/** Maps CV / form casing and common aliases to the Title Case DB enum. */
const PROFICIENCY_ALIASES: Record<string, LanguageProficiency> = {
  basic: "Basic",
  beginner: "Basic",
  elementary: "Basic",
  conversational: "Conversational",
  intermediate: "Conversational",
  professional: "Professional",
  working: "Professional",
  "working proficiency": "Professional",
  business: "Professional",
  proficient: "Professional",
  fluent: "Fluent",
  advanced: "Fluent",
  native: "Native",
  "mother tongue": "Native",
  "native speaker": "Native",
};

/** Empty → ""; known value (any case) → Title Case; unknown → null (invalid). */
export function normalizeLanguageProficiency(
  raw: string | null | undefined,
): LanguageProficiency | "" | null {
  if (raw == null) return "";
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return "";
  return PROFICIENCY_ALIASES[key] ?? null;
}

export const signUpSchema = z.object({
  fullName: z.string().min(2, "Please enter your name").max(120),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
  role: z.enum(PUBLIC_SIGNUP_ROLES as [string, ...string[]]),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

export const candidateProfileSchema = z.object({
  given_name: z.string().min(1, "Required").max(80),
  middle_name: z.string().max(80).optional().or(z.literal("")),
  family_name: z.string().max(80).optional().or(z.literal("")),
  headline: z.string().max(140).optional().or(z.literal("")),
  summary: z.string().max(2000).optional().or(z.literal("")),
  country_code: z.string().length(2).optional().or(z.literal("")),
  city: z.string().max(120).optional().or(z.literal("")),
  availability: z.string().max(120).optional().or(z.literal("")),
  open_to_work: z.boolean().optional(),
  phone: z.string().max(40).optional().or(z.literal("")),
  // Professional contact email on the candidate profile — independent of the
  // Auth sign-in address. Optional; when present must be a valid email.
  email: z.string().email("Enter a valid email").max(160).optional().or(z.literal("")),
});
export type CandidateProfileInput = z.infer<typeof candidateProfileSchema>;

export const experienceSchema = z.object({
  title: z.string().min(1, "Required").max(140),
  employer_name: z.string().max(140).optional().or(z.literal("")),
  location: z.string().max(140).optional().or(z.literal("")),
  start_date: z.string().optional().or(z.literal("")),
  end_date: z.string().optional().or(z.literal("")),
  is_current: z.boolean().optional(),
  description: z.string().max(2000).optional().or(z.literal("")),
});

export const educationSchema = z.object({
  institution: z.string().min(1, "Required").max(160),
  qualification: z.string().max(160).optional().or(z.literal("")),
  field_of_study: z.string().max(160).optional().or(z.literal("")),
  start_date: z.string().optional().or(z.literal("")),
  end_date: z.string().optional().or(z.literal("")),
  is_current: z.boolean().optional(),
});

export const certificationSchema = z.object({
  name: z.string().min(1, "Required").max(160),
  issuer: z.string().max(160).optional().or(z.literal("")),
  issued_on: z.string().optional().or(z.literal("")),
});

export const languageSchema = z.object({
  language: z.string().min(1, "Required").max(80),
  proficiency: z.preprocess(
    (val) => {
      if (val == null || val === "") return "";
      const normalized = normalizeLanguageProficiency(String(val));
      // Keep an invalid token so z.enum fails with a clear message.
      return normalized === null ? "__invalid__" : normalized;
    },
    z.union([
      z.literal(""),
      z.enum(LANGUAGE_PROFICIENCIES, {
        errorMap: () => ({
          message: "Use Basic, Conversational, Professional, Fluent, or Native",
        }),
      }),
    ]),
  ),
});

// ---------------------------------------------------------------------------
// Employer onboarding (Workflow 1) — one schema per wizard section so the
// form can autosave after each completed section.
// ---------------------------------------------------------------------------
export const employerCompanySectionSchema = z.object({
  legal_name: z.string().min(2, "Enter the registered company name").max(200),
  trading_name: z.string().max(200).optional().or(z.literal("")),
  organization_type: z.string().min(1, "Choose an organization type"),
  industry: z.string().min(1, "Enter the industry").max(120),
  company_size: z.string().min(1, "Choose a company size"),
  year_established: z
    .union([z.literal(""), z.coerce.number().int().min(1800, "Enter a valid year").max(2100)])
    .optional(),
  website: z
    .string()
    .url("Enter a valid website URL (https://…)")
    .max(300)
    .optional()
    .or(z.literal("")),
});

export const employerAddressSectionSchema = z.object({
  country_code: z.string().length(2, "Choose a country"),
  region: z.string().min(1, "Enter the region/state/province").max(120),
  city: z.string().min(1, "Enter the city").max(120),
  physical_address: z.string().min(4, "Enter the physical address").max(400),
  postal_address: z.string().max(400).optional().or(z.literal("")),
});

export const employerContactSectionSchema = z.object({
  contact_name: z.string().min(2, "Enter the contact person's full name").max(160),
  contact_job_title: z.string().min(1, "Enter the job title").max(120),
  contact_email: z.string().email("Enter a valid work email").max(160),
  contact_phone: z.string().min(6, "Enter a phone number").max(40),
  contact_is_authorized: z.literal(true, {
    errorMap: () => ({ message: "Confirm this person may administer the account" }),
  }),
});

export const employerRoutingSectionSchema = z
  .object({
    routing_mode: z.enum(["auto", "franchise", "hq"]),
    requested_franchise_id: z.string().uuid().optional().or(z.literal("")),
  })
  .refine((v) => v.routing_mode !== "franchise" || !!v.requested_franchise_id, {
    message: "Choose a Shugulika office",
    path: ["requested_franchise_id"],
  });

export const employerDeclarationsSectionSchema = z.object({
  declared_accurate: z.literal(true, {
    errorMap: () => ({ message: "Confirm the information is accurate" }),
  }),
  declared_authorized: z.literal(true, {
    errorMap: () => ({ message: "Confirm you are authorized to represent the company" }),
  }),
  accepted_terms: z.literal(true, {
    errorMap: () => ({ message: "Accept the employer and privacy terms" }),
  }),
});

export const jobOrderSchema = z.object({
  title: z.string().min(2, "Required").max(160),
  department: z.string().max(120).optional().or(z.literal("")),
  description: z.string().max(4000).optional().or(z.literal("")),
  requirements: z.string().max(4000).optional().or(z.literal("")),
  country_code: z.string().length(2),
  city: z.string().max(120).optional().or(z.literal("")),
  employment_type: z.string().optional().or(z.literal("")),
  work_arrangement: z.string().optional().or(z.literal("")),
  experience_level: z.string().optional().or(z.literal("")),
  vacancy_count: z.coerce
    .number({ invalid_type_error: "Enter at least 1 vacancy" })
    .int("Vacancies must be a whole number")
    .min(1, "Enter at least 1 vacancy")
    .max(999),
  recruitment_path: z.enum(["A", "B"]),
  salary_min: z.coerce.number().nonnegative().optional(),
  salary_max: z.coerce.number().nonnegative().optional(),
  salary_public: z.boolean().optional(),
  application_deadline: z.string().optional().or(z.literal("")),
});

/** Recruiter stage change — reason required when rejecting. */
export const stageChangeSchema = z
  .object({
    application_id: z.string().uuid(),
    to_stage: z.string().min(1),
    rejection_reason: z.string().optional(),
    note: z.string().max(1000).optional(),
  })
  .refine(
    (v) => v.to_stage !== "rejected" || (v.rejection_reason && v.rejection_reason.length > 0),
    {
      message: "A rejection reason is required",
      path: ["rejection_reason"],
    },
  );

export const consentSchema = z.object({
  candidate_id: z.string().uuid(),
  purpose: z.string().min(1),
  covered_org_id: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Asynchronous video interviews
// ---------------------------------------------------------------------------
export const interviewTemplateSchema = z.object({
  name: z.string().min(2, "Give the template a name").max(160),
  description: z.string().max(1000).optional().or(z.literal("")),
  instructions: z.string().max(4000).optional().or(z.literal("")),
  default_preparation_seconds: z.coerce
    .number()
    .int()
    .min(0)
    .max(INTERVIEW_LIMITS.maxPreparationSeconds),
  default_response_seconds: z.coerce
    .number()
    .int()
    .min(INTERVIEW_LIMITS.minResponseSeconds)
    .max(INTERVIEW_LIMITS.maxResponseSeconds),
  default_max_attempts: z.coerce.number().int().min(1).max(INTERVIEW_LIMITS.maxAttempts),
  retention_days: z.coerce.number().int().min(1).max(3650),
  allow_pause_between_questions: z.boolean().default(false),
  allow_response_review: z.boolean().default(true),
  default_deadline_days: z.preprocess(
    (value) => (value === undefined || value === null || value === "" ? 7 : value),
    z.coerce
      .number()
      .int()
      .min(INTERVIEW_LIMITS.minDeadlineDays)
      .max(INTERVIEW_LIMITS.maxDeadlineDays),
  ),
  expiration_grace_hours: z.preprocess(
    (value) => (value === undefined || value === null || value === "" ? 0 : value),
    z.coerce.number().int().min(0).max(INTERVIEW_LIMITS.maxExpirationGraceHours),
  ),
});
export type InterviewTemplateInput = z.infer<typeof interviewTemplateSchema>;

export const interviewQuestionSchema = z.object({
  question_text: z.string().min(1, "Enter the question").max(2000),
  guidance: z.string().max(2000).optional().or(z.literal("")),
  // Blank string = inherit the template default.
  preparation_seconds: z
    .union([
      z.literal(""),
      z.coerce.number().int().min(0).max(INTERVIEW_LIMITS.maxPreparationSeconds),
    ])
    .optional(),
  response_seconds: z
    .union([
      z.literal(""),
      z.coerce
        .number()
        .int()
        .min(INTERVIEW_LIMITS.minResponseSeconds)
        .max(INTERVIEW_LIMITS.maxResponseSeconds),
    ])
    .optional(),
  max_attempts: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(INTERVIEW_LIMITS.maxAttempts)])
    .optional(),
  is_required: z.boolean().optional(),
});
export type InterviewQuestionInput = z.infer<typeof interviewQuestionSchema>;

export const interviewAssignmentSchema = z.object({
  application_id: z.string().uuid(),
  template_id: z.string().uuid(),
  expires_at: z.string().min(1, "Set a submission deadline"),
  candidate_instructions: z.string().max(2000).optional().or(z.literal("")),
});
export type InterviewAssignmentInput = z.infer<typeof interviewAssignmentSchema>;

export const interviewReviewSchema = z.object({
  assignment_id: z.string().uuid(),
  overall_rating: z.union([z.literal(""), z.coerce.number().int().min(1).max(5)]).optional(),
  internal_notes: z.string().max(4000).optional().or(z.literal("")),
});

/** Normalize Zod issues to a simple field->message map for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
