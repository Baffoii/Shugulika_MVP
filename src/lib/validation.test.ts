import { describe, it, expect } from "vitest";
import { signUpSchema, stageChangeSchema, jobOrderSchema, candidateProfileSchema } from "@/lib/validation";

describe("sign-up validation", () => {
  it("accepts a candidate registration", () => {
    const r = signUpSchema.safeParse({ fullName: "Amina Hassan", email: "a@b.co", password: "password1", role: "candidate" });
    expect(r.success).toBe(true);
  });
  it("rejects a privileged role via public sign-up", () => {
    const r = signUpSchema.safeParse({ fullName: "X Y", email: "a@b.co", password: "password1", role: "hq_admin" });
    expect(r.success).toBe(false);
  });
  it("rejects short passwords and bad emails", () => {
    expect(signUpSchema.safeParse({ fullName: "X Y", email: "a@b.co", password: "short", role: "candidate" }).success).toBe(false);
    expect(signUpSchema.safeParse({ fullName: "X Y", email: "nope", password: "password1", role: "candidate" }).success).toBe(false);
  });
});

describe("stage change requires a reason to reject", () => {
  const id = "00000000-0000-0000-0000-000000000000";
  it("blocks a rejection with no reason", () => {
    const r = stageChangeSchema.safeParse({ application_id: id, to_stage: "rejected" });
    expect(r.success).toBe(false);
  });
  it("allows a rejection with a reason", () => {
    const r = stageChangeSchema.safeParse({ application_id: id, to_stage: "rejected", rejection_reason: "missing_skill" });
    expect(r.success).toBe(true);
  });
  it("allows a normal stage move without a reason", () => {
    const r = stageChangeSchema.safeParse({ application_id: id, to_stage: "shortlisted" });
    expect(r.success).toBe(true);
  });
});

describe("job order validation", () => {
  it("requires a title, country and path", () => {
    expect(jobOrderSchema.safeParse({ title: "Analyst", country_code: "TZ", vacancy_count: 1, recruitment_path: "B" }).success).toBe(true);
    expect(jobOrderSchema.safeParse({ title: "", country_code: "TZ", vacancy_count: 1, recruitment_path: "B" }).success).toBe(false);
    expect(jobOrderSchema.safeParse({ title: "Analyst", country_code: "TZ", vacancy_count: 1, recruitment_path: "C" }).success).toBe(false);
  });
});

describe("candidate profile validation", () => {
  it("requires a first name", () => {
    expect(candidateProfileSchema.safeParse({ given_name: "" }).success).toBe(false);
    expect(candidateProfileSchema.safeParse({ given_name: "Amina" }).success).toBe(true);
  });
});
