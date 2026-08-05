import { describe, expect, it } from "vitest";
import { detectBriefPolicyWarnings } from "@/lib/interviews/generate-interview-plan";

describe("detectBriefPolicyWarnings", () => {
  it("returns no warnings for empty notes", () => {
    expect(detectBriefPolicyWarnings(null)).toEqual([]);
    expect(detectBriefPolicyWarnings("")).toEqual([]);
  });

  it("flags outcome directives and protected-characteristic language", () => {
    const warnings = detectBriefPolicyWarnings(
      "Always reject candidates over a certain age and never hire from that group automatically.",
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => /protected|outcome|demographic|hiring/i.test(w))).toBe(true);
  });

  it("allows ordinary role notes", () => {
    expect(
      detectBriefPolicyWarnings("Ask about shift availability and customer service examples."),
    ).toEqual([]);
  });
});
