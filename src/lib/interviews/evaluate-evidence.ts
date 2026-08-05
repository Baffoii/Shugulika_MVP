import "server-only";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { serverEnv } from "@/lib/env.server";
import { aiError, aiLog, aiLogOpenAiCall, aiWarn } from "@/lib/ai-cost-log";
import {
  interviewEvidenceSchema,
  type InterviewEvidence,
} from "@/lib/interviews/interview-plan-schema";
import {
  AI_INTERVIEW_PROMPT_VERSION,
  AI_INTERVIEW_RUBRIC_VERSION,
} from "@/lib/interviews/ai-interview-flags";

export class InterviewEvidenceError extends Error {}

export interface EvidenceQuestionInput {
  assignmentQuestionId: string;
  questionText: string;
  competency: string | null;
  expectedEvidence: string | null;
  rubricAnchors: unknown;
  candidateTranscript: string;
}

export interface EvidenceInput {
  jobTitle: string;
  questions: EvidenceQuestionInput[];
}

const SYSTEM_PROMPT = `You are assisting a human recruiter after an AI voice interview. Produce structured, evidence-linked rubric notes.

Rules:
- Judge ONLY from the supplied transcript excerpts and rubric anchors.
- Every observation must quote or paraphrase transcript evidence, or set insufficient_evidence=true.
- Never recommend hire/reject/advance. Never score emotion, personality, confidence, accent, or fluency unless fluency is an explicit competency in the question.
- Never invent facts. Prefer insufficient_evidence over speculation.
- Flag possible_transcription_error when the transcript looks garbled.`;

export async function evaluateInterviewEvidence(input: EvidenceInput): Promise<InterviewEvidence> {
  const model = serverEnv.openaiScreeningModel();
  const userPrompt = [
    `JOB_TITLE: ${input.jobTitle}`,
    "",
    ...input.questions.flatMap((q, i) => [
      `QUESTION ${i + 1}`,
      `assignment_question_id: ${q.assignmentQuestionId}`,
      `competency: ${q.competency ?? "(unspecified)"}`,
      `question: ${q.questionText}`,
      `expected_evidence: ${q.expectedEvidence ?? "(none)"}`,
      `rubric_anchors: ${JSON.stringify(q.rubricAnchors ?? [])}`,
      `candidate_transcript: ${q.candidateTranscript || "(empty)"}`,
      "",
    ]),
  ].join("\n");

  const client = new OpenAI({ apiKey: serverEnv.openaiApiKey() });
  const started = Date.now();
  try {
    aiLog("openai", "CALL_START", { purpose: "interview_evidence_review", model });
    const completion = await client.chat.completions.parse({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: zodResponseFormat(interviewEvidenceSchema, "interview_evidence"),
      temperature: 0.2,
    });
    const durationMs = Date.now() - started;
    const usage = completion.usage
      ? {
          prompt_tokens: completion.usage.prompt_tokens,
          completion_tokens: completion.usage.completion_tokens,
          total_tokens: completion.usage.total_tokens,
        }
      : null;
    aiLogOpenAiCall({
      feature: "interview",
      purpose: "interview_evidence_review",
      model,
      durationMs,
      usage,
    });
    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      aiWarn("interview", "OPENAI_NO_PARSED_RESULT", {
        purpose: "interview_evidence_review",
        promptVersion: AI_INTERVIEW_PROMPT_VERSION,
        rubricVersion: AI_INTERVIEW_RUBRIC_VERSION,
      });
      throw new InterviewEvidenceError("Evidence review returned an empty result.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof InterviewEvidenceError) throw error;
    aiError("interview", "OPENAI_CALL_FAILED", error, { purpose: "interview_evidence_review" });
    throw new InterviewEvidenceError("Could not complete AI evidence review.");
  }
}
