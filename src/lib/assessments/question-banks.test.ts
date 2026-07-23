import { describe, expect, it } from "vitest";
import { getCandidateQuestions, getStaffAnswerKey } from "@/lib/assessments/question-banks";
import { gradeMcqAnswers } from "@/lib/assessments/mcq-grade";

describe("Shugulika question banks", () => {
  it("exposes absolute MCQ keys to staff but strips them for candidates", () => {
    const staff = getStaffAnswerKey("junior");
    const candidate = getCandidateQuestions("junior");
    expect(staff.questions).toHaveLength(7);
    expect(candidate).toHaveLength(7);
    const staffMcq = staff.questions.find((q) => q.kind === "mcq" && q.id === "jr_q1");
    const candidateMcq = candidate.find((q) => q.kind === "mcq" && q.id === "jr_q1");
    expect(staffMcq && staffMcq.kind === "mcq" && staffMcq.correctChoiceIds).toEqual(["b"]);
    expect(candidateMcq && "correctChoiceIds" in candidateMcq).toBe(false);
  });

  it("grades junior MCQs with the absolute key", () => {
    const staff = getStaffAnswerKey("junior");
    const mcqs = staff.questions.filter((q) => q.kind === "mcq");
    const answers = mcqs.map((q) =>
      q.kind === "mcq"
        ? { questionId: q.id, selectedChoiceIds: [...q.correctChoiceIds] }
        : { questionId: q.id, selectedChoiceIds: [] },
    );
    const result = gradeMcqAnswers(
      mcqs.map((q) =>
        q.kind === "mcq"
          ? {
              id: q.id,
              prompt: q.prompt,
              choices: q.choices,
              correctChoiceIds: q.correctChoiceIds,
              points: q.points,
            }
          : {
              id: q.id,
              prompt: "",
              choices: [],
              correctChoiceIds: [],
              points: 0,
            },
      ),
      answers,
      65,
    );
    expect(result.percent).toBe(100);
    expect(result.passed).toBe(true);
  });
});
