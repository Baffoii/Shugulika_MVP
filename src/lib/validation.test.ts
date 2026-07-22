import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  signUpSchema,
  stageChangeSchema,
  jobOrderSchema,
  candidateProfileSchema,
  certificationSchema,
  languageSchema,
  interviewAssignmentSchema,
  interviewQuestionSchema,
  interviewReviewSchema,
  interviewTemplateSchema,
  fieldErrors,
} from "@/lib/validation";

describe("sign-up validation", () => {
  it("accepts a candidate registration", () => {
    const r = signUpSchema.safeParse({
      fullName: "Amina Hassan",
      email: "a@b.co",
      password: "password1",
      role: "candidate",
    });
    expect(r.success).toBe(true);
  });
  it("rejects a privileged role via public sign-up", () => {
    const r = signUpSchema.safeParse({
      fullName: "X Y",
      email: "a@b.co",
      password: "password1",
      role: "hq_admin",
    });
    expect(r.success).toBe(false);
  });
  it("rejects short passwords and bad emails", () => {
    expect(
      signUpSchema.safeParse({
        fullName: "X Y",
        email: "a@b.co",
        password: "short",
        role: "candidate",
      }).success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({
        fullName: "X Y",
        email: "nope",
        password: "password1",
        role: "candidate",
      }).success,
    ).toBe(false);
  });
});

describe("stage change requires a reason to reject", () => {
  const id = "00000000-0000-0000-0000-000000000000";
  it("blocks a rejection with no reason", () => {
    const r = stageChangeSchema.safeParse({ application_id: id, to_stage: "rejected" });
    expect(r.success).toBe(false);
  });
  it("allows a rejection with a reason", () => {
    const r = stageChangeSchema.safeParse({
      application_id: id,
      to_stage: "rejected",
      rejection_reason: "missing_skill",
    });
    expect(r.success).toBe(true);
  });
  it("allows a normal stage move without a reason", () => {
    const r = stageChangeSchema.safeParse({ application_id: id, to_stage: "cv_review" });
    expect(r.success).toBe(true);
  });
});

describe("job order validation", () => {
  it("requires a title, country and path", () => {
    expect(
      jobOrderSchema.safeParse({
        title: "Analyst",
        country_code: "TZ",
        vacancy_count: 1,
        recruitment_path: "B",
      }).success,
    ).toBe(true);
    expect(
      jobOrderSchema.safeParse({
        title: "",
        country_code: "TZ",
        vacancy_count: 1,
        recruitment_path: "B",
      }).success,
    ).toBe(false);
    expect(
      jobOrderSchema.safeParse({
        title: "Analyst",
        country_code: "TZ",
        vacancy_count: 1,
        recruitment_path: "C",
      }).success,
    ).toBe(false);
  });
});

describe("candidate profile validation", () => {
  it("requires a first name", () => {
    expect(candidateProfileSchema.safeParse({ given_name: "" }).success).toBe(false);
    expect(candidateProfileSchema.safeParse({ given_name: "Amina" }).success).toBe(true);
  });

  it("allows contact email to be blank, but requires a valid address when provided", () => {
    expect(candidateProfileSchema.safeParse({ given_name: "Amina", email: "" }).success).toBe(true);
    expect(
      candidateProfileSchema.safeParse({ given_name: "Amina", email: "not-an-email" }).success,
    ).toBe(false);
    expect(
      candidateProfileSchema.safeParse({ given_name: "Amina", email: "amina@example.com" }).success,
    ).toBe(true);
  });

  it("allows an optional middle name and phone", () => {
    expect(
      candidateProfileSchema.safeParse({
        given_name: "Amina",
        email: "amina@example.com",
        middle_name: "Grace",
        phone: "+255700000000",
      }).success,
    ).toBe(true);
    expect(candidateProfileSchema.safeParse({ given_name: "Amina" }).success).toBe(true);
  });
});

describe("certification validation", () => {
  it("requires a name but allows issuer/date to be omitted", () => {
    expect(certificationSchema.safeParse({ name: "" }).success).toBe(false);
    expect(certificationSchema.safeParse({ name: "PMP" }).success).toBe(true);
    expect(
      certificationSchema.safeParse({ name: "PMP", issuer: "PMI", issued_on: "2022-01-01" })
        .success,
    ).toBe(true);
  });
});

describe("language validation", () => {
  it("requires a language but allows proficiency to be omitted", () => {
    expect(languageSchema.safeParse({ language: "" }).success).toBe(false);
    expect(languageSchema.safeParse({ language: "Swahili" }).success).toBe(true);
    expect(languageSchema.safeParse({ language: "English", proficiency: "Fluent" }).success).toBe(
      true,
    );
  });

  it("normalizes proficiency casing and aliases to Title Case", () => {
    const lower = languageSchema.safeParse({ language: "English", proficiency: "professional" });
    expect(lower.success).toBe(true);
    if (lower.success) expect(lower.data.proficiency).toBe("Professional");

    const alias = languageSchema.safeParse({ language: "Swahili", proficiency: "mother tongue" });
    expect(alias.success).toBe(true);
    if (alias.success) expect(alias.data.proficiency).toBe("Native");

    const upper = languageSchema.safeParse({ language: "French", proficiency: "FLUENT" });
    expect(upper.success).toBe(true);
    if (upper.success) expect(upper.data.proficiency).toBe("Fluent");
  });

  it("rejects unknown proficiency values", () => {
    const r = languageSchema.safeParse({ language: "English", proficiency: "kinda ok" });
    expect(r.success).toBe(false);
  });
});

describe("fieldErrors normalizes Zod issues for forms", () => {
  it("maps each failing field path to its message", () => {
    const r = signUpSchema.safeParse({
      fullName: "X",
      email: "nope",
      password: "x",
      role: "candidate",
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const errs = fieldErrors(r.error);
    expect(errs.fullName).toBeDefined();
    expect(errs.email).toBe("Enter a valid email");
    expect(errs.password).toBeDefined();
    expect(errs.role).toBeUndefined();
  });

  it("keeps the first message when a field has multiple issues", () => {
    const error = new z.ZodError([
      { code: "custom", path: ["email"], message: "first" },
      { code: "custom", path: ["email"], message: "second" },
    ]);
    expect(fieldErrors(error).email).toBe("first");
  });

  it("buckets a top-level (empty path) issue under _form", () => {
    const error = new z.ZodError([{ code: "custom", path: [], message: "whole form is invalid" }]);
    expect(fieldErrors(error)._form).toBe("whole form is invalid");
  });

  it("joins nested paths with dots and returns an empty map for no issues", () => {
    const nested = new z.ZodError([
      { code: "custom", path: ["experience", 0, "title"], message: "Required" },
    ]);
    expect(fieldErrors(nested)["experience.0.title"]).toBe("Required");
    expect(fieldErrors(new z.ZodError([]))).toEqual({});
  });
});

describe("asynchronous interview validation", () => {
  const uuid = "00000000-0000-4000-8000-000000000001";

  it("accepts template limits and coerces numeric form values", () => {
    const result = interviewTemplateSchema.safeParse({
      name: "First-round screen",
      description: "",
      instructions: "",
      default_preparation_seconds: "600",
      default_response_seconds: "300",
      default_max_attempts: "5",
      retention_days: "180",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.default_response_seconds).toBe(300);
      expect(result.data.default_max_attempts).toBe(5);
      expect(result.data.allow_response_review).toBe(true);
      expect(result.data.default_deadline_days).toBe(7);
      expect(result.data.expiration_grace_hours).toBe(0);
    }
  });

  it("accepts explicit session and deadline settings", () => {
    const result = interviewTemplateSchema.safeParse({
      name: "Screen",
      default_preparation_seconds: 30,
      default_response_seconds: 120,
      default_max_attempts: 2,
      retention_days: 180,
      allow_pause_between_questions: true,
      allow_response_review: false,
      default_deadline_days: 14,
      expiration_grace_hours: 24,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allow_pause_between_questions).toBe(true);
      expect(result.data.allow_response_review).toBe(false);
      expect(result.data.default_deadline_days).toBe(14);
    }
  });

  it.each([
    ["name", "x"],
    ["default_preparation_seconds", 601],
    ["default_response_seconds", 9],
    ["default_response_seconds", 301],
    ["default_max_attempts", 0],
    ["default_max_attempts", 6],
    ["retention_days", 0],
    ["default_deadline_days", 0],
    ["expiration_grace_hours", 100],
  ])("rejects an invalid template %s", (field, value) => {
    expect(
      interviewTemplateSchema.safeParse({
        name: "Screen",
        default_preparation_seconds: 30,
        default_response_seconds: 120,
        default_max_attempts: 2,
        retention_days: 180,
        default_deadline_days: 7,
        expiration_grace_hours: 0,
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it("allows blank question overrides to inherit template defaults", () => {
    expect(
      interviewQuestionSchema.safeParse({
        question_text: "Tell us about yourself",
        preparation_seconds: "",
        response_seconds: "",
        max_attempts: "",
        is_required: true,
      }).success,
    ).toBe(true);
  });

  it("enforces question text and override limits", () => {
    expect(interviewQuestionSchema.safeParse({ question_text: "" }).success).toBe(false);
    expect(
      interviewQuestionSchema.safeParse({
        question_text: "Question",
        response_seconds: 9,
        max_attempts: 6,
      }).success,
    ).toBe(false);
  });

  it("requires UUID assignment links and a deadline", () => {
    expect(
      interviewAssignmentSchema.safeParse({
        application_id: uuid,
        template_id: uuid,
        expires_at: "2026-08-01T12:00:00Z",
        candidate_instructions: "",
      }).success,
    ).toBe(true);
    expect(
      interviewAssignmentSchema.safeParse({
        application_id: "not-a-uuid",
        template_id: uuid,
        expires_at: "",
      }).success,
    ).toBe(false);
  });

  it("accepts a blank review rating but rejects ratings outside one to five", () => {
    expect(
      interviewReviewSchema.safeParse({
        assignment_id: uuid,
        overall_rating: "",
        internal_notes: "",
      }).success,
    ).toBe(true);
    expect(
      interviewReviewSchema.safeParse({ assignment_id: uuid, overall_rating: 0 }).success,
    ).toBe(false);
    expect(
      interviewReviewSchema.safeParse({ assignment_id: uuid, overall_rating: "5" }).success,
    ).toBe(true);
  });
});
