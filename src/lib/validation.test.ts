import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  signUpSchema,
  stageChangeSchema,
  jobOrderSchema,
  candidateProfileSchema,
  certificationSchema,
  languageSchema,
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
    const r = stageChangeSchema.safeParse({ application_id: id, to_stage: "shortlisted" });
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
