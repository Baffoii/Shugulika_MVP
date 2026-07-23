import { describe, expect, it } from "vitest";
import { gradeMcqAnswers, type McqQuestion } from "@/lib/assessments/mcq-grade";
import { requiresHumanReview } from "@/lib/assessments/free-response-grading";

const QUESTIONS: McqQuestion[] = [
  {
    id: "q1",
    prompt: "Pick A",
    choices: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    correctChoiceIds: ["a"],
    points: 1,
  },
  {
    id: "q2",
    prompt: "Pick both",
    choices: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
    correctChoiceIds: ["a", "b"],
    points: 2,
    requireExactSet: true,
  },
];

describe("gradeMcqAnswers", () => {
  it("scores single and multi-select deterministically", () => {
    const result = gradeMcqAnswers(
      QUESTIONS,
      [
        { questionId: "q1", selectedChoiceIds: ["a"] },
        { questionId: "q2", selectedChoiceIds: ["b", "a"] },
      ],
      65,
    );
    expect(result.pointsAwarded).toBe(3);
    expect(result.percent).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("fails below the configured threshold", () => {
    const result = gradeMcqAnswers(
      QUESTIONS,
      [
        { questionId: "q1", selectedChoiceIds: ["b"] },
        { questionId: "q2", selectedChoiceIds: ["a"] },
      ],
      65,
    );
    expect(result.pointsAwarded).toBe(0);
    expect(result.passed).toBe(false);
  });
});

describe("requiresHumanReview", () => {
  it("flags low confidence and borderline scores", () => {
    expect(
      requiresHumanReview({
        percent: 80,
        passThresholdPercent: 65,
        confidence: 0.4,
        minConfidenceForAutoAccept: 0.7,
        borderlineMarginPercent: 5,
      }),
    ).toBe(true);
    expect(
      requiresHumanReview({
        percent: 66,
        passThresholdPercent: 65,
        confidence: 0.9,
        minConfidenceForAutoAccept: 0.7,
        borderlineMarginPercent: 5,
      }),
    ).toBe(true);
    expect(
      requiresHumanReview({
        percent: 85,
        passThresholdPercent: 65,
        confidence: 0.9,
        minConfidenceForAutoAccept: 0.7,
        borderlineMarginPercent: 5,
      }),
    ).toBe(false);
  });

  it("flags high AI-writing authenticity likelihood", () => {
    expect(
      requiresHumanReview({
        percent: 85,
        passThresholdPercent: 65,
        confidence: 0.95,
        minConfidenceForAutoAccept: 0.7,
        borderlineMarginPercent: 5,
        authenticityFlagged: true,
      }),
    ).toBe(true);
  });
});
