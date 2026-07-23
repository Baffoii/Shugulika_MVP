/**
 * Shared types for Shugulika aptitude question banks.
 * Candidate-facing payloads never include correct answers or rubrics.
 */

export type AssessmentSeniority = "junior" | "senior";

export type BankMcqChoice = {
  id: string;
  label: string;
};

export type BankMcqQuestion = {
  id: string;
  kind: "mcq";
  prompt: string;
  choices: BankMcqChoice[];
  /** Absolute correct choice id(s). Staff/grading only. */
  correctChoiceIds: string[];
  points: number;
  requireExactSet?: boolean;
};

export type BankFreeResponseQuestion = {
  id: string;
  kind: "free_response";
  prompt: string;
  points: number;
  /** Rubric OpenAI (and humans) use to score written answers. Staff/grading only. */
  rubric: {
    id: string;
    criteria: Array<{
      id: string;
      label: string;
      maxPoints: number;
      guidance: string;
    }>;
    minConfidenceForAutoAccept: number;
    borderlineMarginPercent: number;
  };
};

export type BankQuestion = BankMcqQuestion | BankFreeResponseQuestion;

export type AssessmentQuestionBank = {
  id: string;
  seniority: AssessmentSeniority;
  title: string;
  description: string;
  passThresholdPercent: number;
  questions: BankQuestion[];
};

/** Safe for candidates — strips answer keys and rubrics. */
export type CandidateFacingQuestion =
  | {
      id: string;
      kind: "mcq";
      prompt: string;
      choices: BankMcqChoice[];
      points: number;
    }
  | {
      id: string;
      kind: "free_response";
      prompt: string;
      points: number;
    };

export function toCandidateFacingQuestions(questions: BankQuestion[]): CandidateFacingQuestion[] {
  return questions.map((question) => {
    if (question.kind === "mcq") {
      return {
        id: question.id,
        kind: "mcq",
        prompt: question.prompt,
        choices: question.choices,
        points: question.points,
      };
    }
    return {
      id: question.id,
      kind: "free_response",
      prompt: question.prompt,
      points: question.points,
    };
  });
}

export function totalPoints(questions: BankQuestion[]): number {
  return questions.reduce((sum, question) => sum + question.points, 0);
}
