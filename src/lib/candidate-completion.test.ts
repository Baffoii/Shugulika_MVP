import { describe, it, expect } from "vitest";
import { computeCompletion } from "@/lib/candidate-completion";

const empty = { profile: null, experiences: 0, education: 0, skills: 0, documents: 0 };

describe("computeCompletion", () => {
  it("is 0 for an empty candidate", () => {
    expect(computeCompletion(empty)).toBe(0);
  });

  it("weights each section and clamps to 100", () => {
    const full = {
      profile: { given_name: "A", headline: "h", summary: "s", city: "Dar" },
      experiences: 2,
      education: 1,
      skills: 5,
      documents: 1,
    };
    expect(computeCompletion(full)).toBe(100);
  });

  it("adds partial credit for partial profiles", () => {
    const partial = {
      profile: { given_name: "A", headline: null, summary: null, city: null },
      experiences: 0,
      education: 0,
      skills: 0,
      documents: 0,
    };
    expect(computeCompletion(partial)).toBe(15);
  });

  it("counts sections only when present", () => {
    const withExp = { ...empty, experiences: 1 };
    expect(computeCompletion(withExp)).toBe(20);
    const withDocs = { ...empty, documents: 3 };
    expect(computeCompletion(withDocs)).toBe(10);
  });

  it("never exceeds 100 even with many sections", () => {
    const over = {
      profile: { given_name: "A", headline: "h", summary: "s", city: "c" },
      experiences: 99,
      education: 99,
      skills: 99,
      documents: 99,
    };
    expect(computeCompletion(over)).toBeLessThanOrEqual(100);
  });
});
