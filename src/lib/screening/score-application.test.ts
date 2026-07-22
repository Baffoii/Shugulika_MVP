import { describe, it, expect } from "vitest";
import {
  requirementsFingerprint,
  type ScreeningRequirement,
} from "@/lib/screening/score-application";
import { screeningResultSchema } from "@/lib/screening/screening-schema";

const req = (over: Partial<ScreeningRequirement>): ScreeningRequirement => ({
  id: "r1",
  category: "skill",
  label: "React",
  detail: null,
  importance: "must_have",
  min_years: null,
  ...over,
});

describe("requirementsFingerprint", () => {
  it("is stable for the same set", () => {
    const set = [req({ id: "a" }), req({ id: "b", label: "SQL" })];
    expect(requirementsFingerprint(set)).toBe(requirementsFingerprint(set));
  });

  it("is order-independent", () => {
    const a = [req({ id: "a" }), req({ id: "b", label: "SQL" })];
    const b = [req({ id: "b", label: "SQL" }), req({ id: "a" })];
    expect(requirementsFingerprint(a)).toBe(requirementsFingerprint(b));
  });

  it("changes when a requirement's content changes", () => {
    const base = [req({ id: "a" })];
    const changed = [req({ id: "a", importance: "nice_to_have" })];
    expect(requirementsFingerprint(base)).not.toBe(requirementsFingerprint(changed));
  });

  it("is empty-set safe", () => {
    expect(requirementsFingerprint([])).toEqual(expect.any(String));
  });
});

describe("screeningResultSchema", () => {
  const valid = {
    overall_score: 72,
    fit_verdict: "possible_fit" as const,
    summary: "Strong React background; unproven on the required backend work.",
    strengths: "5 years React at scale.",
    concerns: "No evidence of Node/Postgres; 2021-2022 employment gap unexplained.",
    recommended_questions: ["Walk me through a backend service you owned end-to-end."],
    model_reasoning: "Meets frontend must-haves, misses backend must-have.",
    items: [
      {
        requirement_id: "r1",
        item_type: "requirement_match" as const,
        label: "3+ years React",
        assessment: "met" as const,
        explanation: "Held a Senior React role for 5 years.",
        evidence_text: "Senior Frontend Engineer (React), 2019–2024",
        confidence: 0.9,
      },
      {
        requirement_id: null,
        item_type: "concern" as const,
        label: "Employment gap",
        assessment: null,
        explanation: "No listed role between 2021 and 2022.",
        evidence_text: null,
        confidence: 0.6,
      },
    ],
  };

  it("accepts a well-formed result", () => {
    expect(screeningResultSchema.parse(valid)).toMatchObject({ overall_score: 72 });
  });

  it("rejects an out-of-range score", () => {
    expect(() => screeningResultSchema.parse({ ...valid, overall_score: 140 })).toThrow();
  });

  it("rejects an unknown item_type", () => {
    const bad = { ...valid, items: [{ ...valid.items[0], item_type: "vibes" }] };
    expect(() => screeningResultSchema.parse(bad)).toThrow();
  });
});
