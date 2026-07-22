import { describe, expect, it } from "vitest";
import {
  mergeProfessionalCopyIntoPersonal,
  resumeLacksProfessionalSummary,
  professionalCopySchema,
} from "@/lib/resume/professional-copy-logic";
import {
  AI_DRAFTED_CONFIDENCE,
  AI_DRAFTED_EVIDENCE,
} from "@/lib/resume/professional-copy-constants";

describe("resumeLacksProfessionalSummary", () => {
  it("is true when summary is null, empty, or whitespace", () => {
    expect(resumeLacksProfessionalSummary(null)).toBe(true);
    expect(resumeLacksProfessionalSummary(undefined)).toBe(true);
    expect(resumeLacksProfessionalSummary({ value: "" })).toBe(true);
    expect(resumeLacksProfessionalSummary({ value: "   " })).toBe(true);
  });

  it("is false when a real summary was extracted", () => {
    expect(resumeLacksProfessionalSummary({ value: "Analyst with 5 years…" })).toBe(false);
  });
});

describe("mergeProfessionalCopyIntoPersonal", () => {
  const drafted = {
    headline: "Financial Analyst · Reporting",
    summary: "Financial analyst with experience in IFRS reporting and month-end close.",
  };

  it("fills summary and headline when both CV and profile lack them", () => {
    const result = mergeProfessionalCopyIntoPersonal({
      personal: { headline: null, summary: null },
      profileHeadline: null,
      profileSummary: null,
      drafted,
    });
    expect(result.filled).toEqual(["summary", "headline"]);
    expect(result.summary).toEqual({
      value: drafted.summary,
      confidence: AI_DRAFTED_CONFIDENCE,
      evidence_text: AI_DRAFTED_EVIDENCE,
    });
    expect(result.headline).toEqual({
      value: drafted.headline,
      confidence: AI_DRAFTED_CONFIDENCE,
      evidence_text: AI_DRAFTED_EVIDENCE,
    });
  });

  it("keeps a verbatim CV headline and only fills summary", () => {
    const existingHeadline = {
      value: "Senior Accountant",
      confidence: 0.9,
      evidence_text: "Senior Accountant",
    };
    const result = mergeProfessionalCopyIntoPersonal({
      personal: { headline: existingHeadline, summary: null },
      profileHeadline: null,
      profileSummary: null,
      drafted,
    });
    expect(result.filled).toEqual(["summary"]);
    expect(result.headline).toBe(existingHeadline);
    expect(result.summary?.evidence_text).toBe(AI_DRAFTED_EVIDENCE);
  });

  it("does not overwrite an existing profile summary or headline", () => {
    const result = mergeProfessionalCopyIntoPersonal({
      personal: { headline: null, summary: null },
      profileHeadline: "Already set",
      profileSummary: "Already written by candidate",
      drafted,
    });
    expect(result.filled).toEqual([]);
    expect(result.headline).toBeNull();
    expect(result.summary).toBeNull();
  });
});

describe("professionalCopySchema", () => {
  it("accepts valid drafted copy", () => {
    const parsed = professionalCopySchema.safeParse({
      headline: "Ops Manager",
      summary: "Operations manager with supply-chain experience across East Africa.",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty fields", () => {
    expect(professionalCopySchema.safeParse({ headline: "", summary: "x" }).success).toBe(false);
  });
});
