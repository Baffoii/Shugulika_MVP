import { z } from "zod";
import { PUBLIC_SIGNUP_ROLES } from "@/lib/constants";

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
  family_name: z.string().max(80).optional().or(z.literal("")),
  headline: z.string().max(140).optional().or(z.literal("")),
  summary: z.string().max(2000).optional().or(z.literal("")),
  country_code: z.string().length(2).optional().or(z.literal("")),
  city: z.string().max(120).optional().or(z.literal("")),
  availability: z.string().max(120).optional().or(z.literal("")),
  open_to_work: z.boolean().optional(),
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
  vacancy_count: z.coerce.number().int().min(1).max(999),
  recruitment_path: z.enum(["A", "B"]),
  salary_min: z.coerce.number().nonnegative().optional(),
  salary_max: z.coerce.number().nonnegative().optional(),
  salary_public: z.boolean().optional(),
});

/** Recruiter stage change — reason required when rejecting. */
export const stageChangeSchema = z
  .object({
    application_id: z.string().uuid(),
    to_stage: z.string().min(1),
    rejection_reason: z.string().optional(),
    note: z.string().max(1000).optional(),
  })
  .refine((v) => v.to_stage !== "rejected" || (v.rejection_reason && v.rejection_reason.length > 0), {
    message: "A rejection reason is required",
    path: ["rejection_reason"],
  });

export const consentSchema = z.object({
  candidate_id: z.string().uuid(),
  purpose: z.string().min(1),
  covered_org_id: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
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
