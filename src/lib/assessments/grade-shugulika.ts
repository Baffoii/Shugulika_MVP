import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { env, isOpenAiConfigured } from "@/lib/env";
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
import { detectAnswerAuthenticity } from "@/lib/assessments/ai-authenticity";
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
      points_awarded: z.number(),
      quote: z.string().nullable(),
      note: z.string(),
    }),
  ),
  confidence: z.number(),
});

export class AssessmentGradingError extends Error {}

/** Avoid float noise like 1.2999999999999998 from summing rubric points. */
function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

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

For EVERY rubric criterion, include an evidence item with:
- criterion_id matching the rubric id
- points_awarded between 0 and that criterion's max
- quote: a short verbatim snippet from the answer that supports the award, or null if nothing relevant
- note: 1-2 sentences explaining why those points were awarded (or withheld)

score must equal the sum of points_awarded, clamped to max_score.
explanation must be 2–4 sentences summarizing the overall score: what the answer did well, what it missed against the rubric, and why the total was awarded.
confidence is 0–1 reflecting how clearly the answer maps to the rubric (use lower confidence when the answer is vague, off-topic, or borderline).
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

  // Run rubric grading and authenticity check in parallel.
  const authenticityPromise = detectAnswerAuthenticity(answerText);

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
    void aiLogOpenAiCall({
      feature: "assessment",
      purpose: "assessment_free_response",
      model,
      durationMs,
      usage,
    });

    const authenticity = await authenticityPromise;

    const maxScore = question.points;
    const criterionMax = new Map(
      question.rubric.criteria.map((criterion) => [criterion.id, criterion.maxPoints]),
    );
    const evidence = parsed.evidence.map((item) => {
      const maxForCriterion = criterionMax.get(item.criterion_id) ?? 0;
      const pointsAwarded = roundToHundredths(
        Math.max(0, Math.min(maxForCriterion, item.points_awarded)),
      );
      return {
        criterionId: item.criterion_id,
        pointsAwarded,
        quote: item.quote,
        note: item.note,
      };
    });

    // Prefer summing criterion awards when the model returned a full evidence set.
    const evidenceSum = evidence.reduce((sum, item) => sum + item.pointsAwarded, 0);
    const rawScore =
      evidence.length >= question.rubric.criteria.length ? evidenceSum : parsed.score;
    const score = roundToHundredths(Math.max(0, Math.min(maxScore, rawScore)));
    const percent = maxScore === 0 ? 0 : roundToHundredths((score / maxScore) * 100);
    const confidence = Math.max(0, Math.min(1, parsed.confidence));
    const humanReviewRequired = requiresHumanReview({
      percent,
      passThresholdPercent,
      confidence,
      minConfidenceForAutoAccept: question.rubric.minConfidenceForAutoAccept,
      borderlineMarginPercent: question.rubric.borderlineMarginPercent,
      authenticityFlagged: authenticity.flaggedForReview,
    });

    return {
      questionId: question.id,
      rubricId: question.rubric.id,
      score,
      maxScore,
      percent,
      explanation: parsed.explanation,
      evidence,
      confidence,
      humanReviewRequired,
      model,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      estimatedUsd: estimateUsd(usage),
      authenticity,
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
    if (!isOpenAiConfigured()) {
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
          authenticity: null,
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
  const authenticityFlagged = frResults.some((item) => item.authenticity?.flaggedForReview);
  const confidences = frResults.map((item) => item.confidence).filter((c) => c > 0);
  const aiConfidence =
    confidences.length === 0
      ? null
      : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;

  let resultBand: "pass" | "fail" | "review" = "fail";
  if (humanReviewRequired) resultBand = "review";
  else if (scorePercent >= opts.passThresholdPercent) resultBand = "pass";

  let gradingNotes: string;
  if (humanReviewRequired && authenticityFlagged) {
    gradingNotes =
      "Free-response grading needs recruiter review (AI-writing likelihood and/or low confidence).";
  } else if (humanReviewRequired) {
    gradingNotes = "Free-response grading needs recruiter review before a reject decision.";
  } else {
    gradingNotes = `Deterministic MCQ + AI free-response graded against ${bank.id}.`;
  }

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
    gradingNotes,
  };
}
