/**
 * Deterministic MCQ grading — no OpenAI.
 * Correct answers and scoring rules are stored with the question bank;
 * this helper only applies those rules.
 */
export type McqChoice = {
  id: string;
  label: string;
};

export type McqQuestion = {
  id: string;
  prompt: string;
  choices: McqChoice[];
  /** One or more correct choice ids. */
  correctChoiceIds: string[];
  points: number;
  /** When true, every correct choice must be selected and no incorrect ones. */
  requireExactSet?: boolean;
};

export type McqAnswer = {
  questionId: string;
  selectedChoiceIds: string[];
};

export type McqGradeItem = {
  questionId: string;
  pointsAwarded: number;
  pointsPossible: number;
  correct: boolean;
};

export type McqGradeResult = {
  items: McqGradeItem[];
  pointsAwarded: number;
  pointsPossible: number;
  percent: number;
  passed: boolean;
};

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

export function gradeMcqAnswers(
  questions: McqQuestion[],
  answers: McqAnswer[],
  passThresholdPercent: number,
): McqGradeResult {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  const items: McqGradeItem[] = questions.map((question) => {
    const selected = byId.get(question.id)?.selectedChoiceIds ?? [];
    const correct = question.requireExactSet
      ? sameSet(selected, question.correctChoiceIds)
      : selected.length === 1 &&
        question.correctChoiceIds.length === 1 &&
        selected[0] === question.correctChoiceIds[0];
    return {
      questionId: question.id,
      pointsAwarded: correct ? question.points : 0,
      pointsPossible: question.points,
      correct,
    };
  });
  const pointsAwarded = items.reduce((sum, item) => sum + item.pointsAwarded, 0);
  const pointsPossible = items.reduce((sum, item) => sum + item.pointsPossible, 0);
  const percent = pointsPossible === 0 ? 0 : (pointsAwarded / pointsPossible) * 100;
  return {
    items,
    pointsAwarded,
    pointsPossible,
    percent,
    passed: percent >= passThresholdPercent,
  };
}
