import { describe, it, expect } from "vitest";
import {
  shouldFlagAuthenticityForReview,
  isVerbatimQuoteInAnswer,
  filterValidEvidenceQuotes,
  filterValidSentenceLabels,
  dampenAuthenticityProbability,
  AI_AUTHENTICITY_EVIDENCE_CAP,
} from "@/lib/assessments/ai-authenticity";

describe("shouldFlagAuthenticityForReview", () => {
  it("flags ai_likely classification regardless of probability", () => {
    expect(
      shouldFlagAuthenticityForReview({
        classification: "ai_likely",
        aiProbability: 0.4,
      }),
    ).toBe(true);
  });

  it("flags when probability meets the threshold", () => {
    expect(
      shouldFlagAuthenticityForReview({
        classification: "mixed",
        aiProbability: 0.7,
      }),
    ).toBe(true);
    expect(
      shouldFlagAuthenticityForReview({
        classification: "human_likely",
        aiProbability: 0.69,
      }),
    ).toBe(false);
  });
});

describe("isVerbatimQuoteInAnswer", () => {
  it("matches case-insensitively and rejects invents", () => {
    const answer = "I'd apologize for the late delivery and gather order details.";
    expect(isVerbatimQuoteInAnswer(answer, "apologize for the late delivery")).toBe(true);
    expect(isVerbatimQuoteInAnswer(answer, "APOLOGIZE FOR THE LATE DELIVERY")).toBe(true);
    expect(isVerbatimQuoteInAnswer(answer, "I would ensure seamless resolution")).toBe(false);
    expect(isVerbatimQuoteInAnswer(answer, "ab")).toBe(false);
  });
});

describe("filterValidEvidenceQuotes", () => {
  it("keeps only verbatim quotes from the answer", () => {
    const answer = "Not applicable to this role. I'd apologize first.";
    const filtered = filterValidEvidenceQuotes(answer, [
      { quote: "Not applicable to this role", label: "supports_human", note: "hedging" },
      { quote: "seamless customer journey", label: "supports_ai", note: "invented" },
      { quote: "  ", label: "neutral", note: "empty" },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.label).toBe("supports_human");
  });
});

describe("filterValidSentenceLabels", () => {
  it("drops sentences not present in the answer", () => {
    const answer = "Hello there. How are you?";
    const filtered = filterValidSentenceLabels(answer, [
      { sentence: "Hello there.", label: "human" },
      { sentence: "This was never written.", label: "ai" },
    ]);
    expect(filtered).toEqual([{ sentence: "Hello there.", label: "human" }]);
  });
});

describe("dampenAuthenticityProbability", () => {
  it("caps high probability without supports_ai quotes", () => {
    const result = dampenAuthenticityProbability({
      aiProbability: 0.82,
      confidence: 0.9,
      rationale: "Looks polished.",
      evidence: [
        { quote: "I'd apologize", label: "supports_human", note: "informal" },
      ],
      sentenceLabels: [],
    });
    expect(result.dampened).toBe(true);
    expect(result.aiProbability).toBe(AI_AUTHENTICITY_EVIDENCE_CAP);
    expect(result.confidence).toBeLessThanOrEqual(0.45);
    expect(result.rationale).toMatch(/Insufficient quote evidence/i);
  });

  it("does not cap when supports_ai quotes exist", () => {
    const result = dampenAuthenticityProbability({
      aiProbability: 0.82,
      confidence: 0.9,
      rationale: "Template closing.",
      evidence: [
        {
          quote: "I would ensure a seamless resolution moving forward",
          label: "supports_ai",
          note: "stock closing",
        },
      ],
      sentenceLabels: [{ sentence: "I would ensure a seamless resolution moving forward", label: "ai" }],
    });
    expect(result.dampened).toBe(false);
    expect(result.aiProbability).toBe(0.82);
  });

  it("dampens when most sentence labels are human", () => {
    const result = dampenAuthenticityProbability({
      aiProbability: 0.75,
      confidence: 0.8,
      rationale: "Mixed cues.",
      evidence: [
        { quote: "seamless resolution", label: "supports_ai", note: "generic" },
      ],
      sentenceLabels: [
        { sentence: "One.", label: "human" },
        { sentence: "Two.", label: "human" },
        { sentence: "Three.", label: "ai" },
      ],
    });
    expect(result.dampened).toBe(true);
    expect(result.aiProbability).toBe(AI_AUTHENTICITY_EVIDENCE_CAP);
  });
});
