import { JUNIOR_QUESTION_BANK } from "@/lib/assessments/banks/junior";
import { SENIOR_QUESTION_BANK } from "@/lib/assessments/banks/senior";
import {
  toCandidateFacingQuestions,
  type AssessmentQuestionBank,
  type AssessmentSeniority,
  type BankQuestion,
  type CandidateFacingQuestion,
} from "@/lib/assessments/question-bank-types";

const BANKS: Record<AssessmentSeniority, AssessmentQuestionBank> = {
  junior: JUNIOR_QUESTION_BANK,
  senior: SENIOR_QUESTION_BANK,
};

export function getQuestionBank(seniority: AssessmentSeniority): AssessmentQuestionBank {
  return BANKS[seniority];
}

/** Full bank including absolute MCQ keys and free-response rubrics (staff only). */
export function getStaffAnswerKey(seniority: AssessmentSeniority): AssessmentQuestionBank {
  return getQuestionBank(seniority);
}

export function getCandidateQuestions(seniority: AssessmentSeniority): CandidateFacingQuestion[] {
  return toCandidateFacingQuestions(getQuestionBank(seniority).questions);
}

export function getBankQuestions(seniority: AssessmentSeniority): BankQuestion[] {
  return getQuestionBank(seniority).questions;
}

export function listQuestionBanks(): AssessmentQuestionBank[] {
  return [JUNIOR_QUESTION_BANK, SENIOR_QUESTION_BANK];
}
