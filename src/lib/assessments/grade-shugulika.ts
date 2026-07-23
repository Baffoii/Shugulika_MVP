import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { env, isResumeParsingConfigured } from "@/lib/env";
import {
  aiError,
  aiLog,
  aiLogOpenAiCall,
  estimateTokensFromChars,
  estimateUsd,
} from "@/lib/ai-cost-log";
import { gradeMcqAnswers, type McqAnswer, type McqQuestion } from "@/lib/assessments/mcq-grade";
import {
  buildFreeResponseGradingPayload,
  requiresHumanReview,
  type FreeResponseGradeResult,
} from "@/lib/assessments/free-response-grading";
import { getQuestionBank } from "@/lib/assessments/question-banks";
import type { AssessmentSeniority } from "@/lib/assessments/question-bank-types";
import type {
  BankFreeResponseQuestion,
  BankMcqQuestion,
} from "@/lib/assessments/question-bank-types";

export type StoredAssessmentResponses = {
  mcq: McqAnswer[];
  freeResponse: Array<{ questionId: string; text: string }>;
};

const freeResponseModelSchema = z.object({
  score: z.number(),
  max_score: z.number(),
  percent: z.number(),
  explanation: z.string(),
  evidence: z.array(
    z.object({
      criterion_id: z.string(),
      quote: z.string().nullable(),
      note: z.string(),
    }),
  ),
  confidence: z.number(),
});

export class AssessmentGradingError extends Error {}

function toMcqQuestions(questions: BankMcqQuestion[]): McqQuestion[] {
  return questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    choices: question.choices,
    correctChoiceIds: question.correctChoiceIds,
    points: question.points,
    requireExactSet: question.requireExactSet,
  }));
}

async function gradeOneFreeResponse(
  question: BankFreeResponseQuestion,
  answerText: string,
  passThresholdPercent: number,
): Promise<FreeResponseGradeResult> {
  const model = env.openaiScreeningModel();
  const rubricLines = question.rubric.criteria
    .map(
      (criterion) =>
        `- id: ${criterion.id} | max ${criterion.maxPoints}: ${criterion.label} — ${criterion.guidance}`,
    )
    .join("\n");
  const system = `You grade a free-response aptitude answer against a fixed rubric.
Return structured JSON only. Be strict and evidence-based. Do not invent facts from the answer.
score must be between 0 and max_score. confidence is 0-1.
Never recommend rejecting a candidate yourself — only score the answer.`;
  const user = [
    `QUESTION: ${question.prompt}`,
    `MAX POINTS: ${question.points}`,
    `PASS THRESHOLD PERCENT (context): ${passThresholdPercent}`,
    `RUBRIC:`,
    rubricLines,
    ``,
    `CANDIDATE ANSWER:`,
    answerText.trim() || "(empty)",
  ].join("\n");

  const started = Date.now();
  const client = new OpenAI({ apiKey: env.openaiApiKey() });
  aiLog("openai", "CALL_START", {
    purpose: "assessment_free_response",
    model,
    est_input_tokens: estimateTokensFromChars(system.length + user.length),
  });
  try {
    const completion = await client.chat.completions.parse({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: zodResponseFormat(freeResponseModelSchema, "free_response_grade"),
    });
    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) throw new AssessmentGradingError("Empty grading response from model.");
    const usage = completion.usage;
    const durationMs = Date.now() - started;
    aiLogOpenAiCall({
      feature: "assessment",
      purpose: "assessment_free_response",
      model,
      durationMs,
      usage,
    });

    const maxScore = question.points;
    const score = Math.max(0, Math.min(maxScore, parsed.score));
    const percent = maxScore === 0 ? 0 : (score / maxScore) * 100;
    const confidence = Math.max(0, Math.min(1, parsed.confidence));
    const humanReviewRequired = requiresHumanReview({
      percent,
      passThresholdPercent,
      confidence,
      minConfidenceForAutoAccept: question.rubric.minConfidenceForAutoAccept,
      borderlineMarginPercent: question.rubric.borderlineMarginPercent,
    });

    return {
      questionId: question.id,
      rubricId: question.rubric.id,
      score,
      maxScore,
      percent,
      explanation: parsed.explanation,
      evidence: parsed.evidence.map((item) => ({
        criterionId: item.criterion_id,
        quote: item.quote,
        note: item.note,
      })),
      confidence,
      humanReviewRequired,
      model,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      estimatedUsd: estimateUsd(usage),
    };
  } catch (error) {
    aiError("openai", "CALL_FAILED", error, { purpose: "assessment_free_response" });
    throw new AssessmentGradingError(
      error instanceof Error ? error.message : "Free-response grading failed.",
    );
  }
}

export type CombinedAssessmentGrade = {
  scorePercent: number;
  mcqScorePercent: number | null;
  freeResponseScorePercent: number | null;
  passed: boolean;
  resultBand: "pass" | "fail" | "review";
  humanReviewRequired: boolean;
  aiConfidence: number | null;
  gradingPayload: Record<string, unknown>;
  gradingNotes: string;
};

export async function gradeShugulikaAssessment(opts: {
  seniority: AssessmentSeniority;
  responses: StoredAssessmentResponses;
  passThresholdPercent: number;
}): Promise<CombinedAssessmentGrade> {
  const bank = getQuestionBank(opts.seniority);
  const mcqBank = bank.questions.filter((q): q is BankMcqQuestion => q.kind === "mcq");
  const frBank = bank.questions.filter(
    (q): q is BankFreeResponseQuestion => q.kind === "free_response",
  );

  const mcq = gradeMcqAnswers(
    toMcqQuestions(mcqBank),
    opts.responses.mcq,
    opts.passThresholdPercent,
  );

  const frResults: FreeResponseGradeResult[] = [];
  if (frBank.length > 0) {
    if (!isResumeParsingConfigured()) {
      for (const question of frBank) {
        frResults.push({
          questionId: question.id,
          rubricId: question.rubric.id,
          score: 0,
          maxScore: question.points,
          percent: 0,
          explanation: "OpenAI is not configured. Free-response answers require recruiter review.",
          evidence: [],
          confidence: 0,
          humanReviewRequired: true,
          model: "none",
          promptTokens: null,
          completionTokens: null,
          estimatedUsd: null,
        });
      }
    } else {
      for (const question of frBank) {
        const answer =
          opts.responses.freeResponse.find((item) => item.questionId === question.id)?.text ?? "";
        frResults.push(await gradeOneFreeResponse(question, answer, opts.passThresholdPercent));
      }
    }
  }

  const mcqPointsPossible = mcq.pointsPossible;
  const frPointsPossible = frResults.reduce((sum, item) => sum + item.maxScore, 0);
  const frPointsAwarded = frResults.reduce((sum, item) => sum + item.score, 0);
  const pointsPossible = mcqPointsPossible + frPointsPossible;
  const pointsAwarded = mcq.pointsAwarded + frPointsAwarded;
  const scorePercent = pointsPossible === 0 ? 0 : (pointsAwarded / pointsPossible) * 100;
  const mcqScorePercent =
    mcqPointsPossible === 0 ? null : (mcq.pointsAwarded / mcqPointsPossible) * 100;
  const freeResponseScorePercent =
    frPointsPossible === 0 ? null : (frPointsAwarded / frPointsPossible) * 100;

  const humanReviewRequired = frResults.some((item) => item.humanReviewRequired);
  const confidences = frResults.map((item) => item.confidence).filter((c) => c > 0);
  const aiConfidence =
    confidences.length === 0
      ? null
      : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;

  let resultBand: "pass" | "fail" | "review" = "fail";
  if (humanReviewRequired) resultBand = "review";
  else if (scorePercent >= opts.passThresholdPercent) resultBand = "pass";

  return {
    scorePercent: Math.round(scorePercent * 100) / 100,
    mcqScorePercent: mcqScorePercent == null ? null : Math.round(mcqScorePercent * 100) / 100,
    freeResponseScorePercent:
      freeResponseScorePercent == null ? null : Math.round(freeResponseScorePercent * 100) / 100,
    passed: !humanReviewRequired && scorePercent >= opts.passThresholdPercent,
    resultBand,
    humanReviewRequired,
    aiConfidence,
    gradingPayload: {
      version: 1,
      bankId: bank.id,
      mcq,
      freeResponse: buildFreeResponseGradingPayload(frResults),
      scorePercent,
      passThresholdPercent: opts.passThresholdPercent,
    },
    gradingNotes: humanReviewRequired
      ? "Free-response grading needs recruiter review before a reject decision."
      : `Deterministic MCQ + AI free-response graded against ${bank.id}.`,
  };
}
