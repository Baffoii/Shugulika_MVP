import { z } from "zod";
import { entityIdSchema } from "@/lib/validation";

export const interviewPlanQuestionSchema = z.object({
  ordinal: z.number().int().min(1).max(5),
  question_text: z.string().min(8).max(2000),
  competency: z.string().min(2).max(120),
  expected_evidence: z.string().min(8).max(1000),
  rubric_anchors: z
    .array(
      z.object({
        level: z.number().int().min(1).max(4),
        description: z.string().min(4).max(400),
      }),
    )
    .min(4)
    .max(4),
  source_context: z.string().min(4).max(500),
  follow_up_policy: z.literal("one_clarification"),
  timing_seconds: z.number().int().min(60).max(180),
});

export const interviewPlanSchema = z.object({
  questions: z.array(interviewPlanQuestionSchema).min(4).max(5),
  interviewer_instructions: z.string().min(40).max(4000),
  welcome_script: z.string().min(20).max(800),
  close_script: z.string().min(20).max(800),
  policy_warnings: z.array(z.string()).default([]),
});

export type InterviewPlan = z.infer<typeof interviewPlanSchema>;
export type InterviewPlanQuestion = z.infer<typeof interviewPlanQuestionSchema>;

export const evidenceItemSchema = z.object({
  assignment_question_id: entityIdSchema,
  competency: z.string(),
  rubric_level: z.number().int().min(1).max(4).nullable(),
  evidence_text: z.string().nullable(),
  audio_timestamp_seconds: z.number().nullable(),
  explanation: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  insufficient_evidence: z.boolean(),
  possible_transcription_error: z.boolean(),
  suggested_human_follow_up: z.string().nullable(),
});

export const interviewEvidenceSchema = z.object({
  question_results: z.array(evidenceItemSchema).min(1),
  overall_confidence: z.enum(["high", "medium", "low"]),
  review_flags: z.array(z.string()).default([]),
  summary_for_recruiter: z.string().max(2000),
});

export type InterviewEvidence = z.infer<typeof interviewEvidenceSchema>;
