import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { aiError, aiLog, aiWarn } from "@/lib/ai-cost-log";
import {
  AI_INTERVIEW_PROMPT_VERSION,
  AI_INTERVIEW_RESERVE_USD,
  AI_INTERVIEW_RUBRIC_VERSION,
} from "@/lib/interviews/ai-interview-flags";
import type { InterviewAssignmentQuestionRow, InterviewAssignmentRow } from "@/lib/database.types";

export class RealtimeSessionError extends Error {}

export interface EphemeralSessionResult {
  clientSecret: string;
  expiresAt: string | null;
  model: string;
  sessionIdHint: string | null;
}

function safetyIdentifier(userId: string): string {
  return createHash("sha256").update(`shugulika-interview:${userId}`).digest("hex").slice(0, 64);
}

function buildRealtimeInstructions(
  assignment: InterviewAssignmentRow,
  questions: InterviewAssignmentQuestionRow[],
  jobTitle: string,
): string {
  const frozen = (assignment.frozen_context ?? {}) as Record<string, unknown>;
  const ordered = [...questions].sort((a, b) => a.display_order - b.display_order);
  const questionBlock = ordered
    .map(
      (q, index) =>
        `- order=${index + 1} competency=${q.competency ?? "general"} text=${JSON.stringify(q.question_text_snapshot)}`,
    )
    .join("\n");

  return [
    "You are Shugulika's AI voice interviewer conducting a structured recruitment interview.",
    `Job title: ${jobTitle}.`,
    `Language: ${assignment.language ?? "en"}.`,
    `Hard time limit: ${assignment.duration_seconds ?? 600} seconds. Finish gracefully when time is low.`,
    "You MUST ask the core questions below in order. You may rephrase for clarity but must not replace competencies.",
    "Ask one question at a time. Keep interviewer turns short. Allow interruption — stop speaking when the candidate starts.",
    "",
    "FOLLOW-UPS:",
    "After a core answer, ask 1–2 short follow-ups when useful (vague/incomplete answers, strong claims needing evidence, or interesting details worth probing: what / how / example / outcome).",
    "Follow-ups must stay on the same competency; keep them brief and natural, like a human interviewer.",
    "If the answer is already clear and evidenced, skip follow-ups and move on.",
    "Cap at 2 follow-ups per core question. Call record_clarification before each follow-up (follow_up_index 1 or 2).",
    "Only call complete_question after the core answer and any follow-ups for that item are done (or after a skip).",
    "",
    "SKIPS:",
    "If the candidate asks to skip, says they don’t know / prefer not to answer, or clearly wants to move on: acknowledge briefly, call complete_question with evidence_status=skipped, and continue without pressuring or follow-ups.",
    "Never refuse a clear skip request; do not grill after a skip.",
    "",
    "Never coach toward rubric answers. Never promise hire/reject/pay/advancement.",
    "Never ask about protected characteristics, health, religion, age, family status, or politics.",
    "Use tools with question_order as the 1-based integer from the list (1, 2, 3…). Never invent UUIDs.",
    "After the last question is answered or skipped, call finish_interview with completion_reason=completed.",
    "",
    `Welcome guidance: ${typeof frozen.welcome_script === "string" ? frozen.welcome_script : "Disclose you are AI; a human recruiter decides."}`,
    `Close guidance: ${typeof frozen.close_script === "string" ? frozen.close_script : "Thank the candidate and end."}`,
    typeof frozen.interviewer_instructions === "string"
      ? `Staff instructions: ${frozen.interviewer_instructions}`
      : "",
    "",
    "CORE QUESTIONS (use question_order):",
    questionBlock,
    "",
    `prompt_version=${assignment.prompt_version ?? AI_INTERVIEW_PROMPT_VERSION}`,
    `rubric_version=${assignment.rubric_version ?? AI_INTERVIEW_RUBRIC_VERSION}`,
    `reserve_usd=${AI_INTERVIEW_RESERVE_USD}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const LIVE_TOOLS = [
  {
    type: "function",
    name: "start_question",
    description:
      "Call when you begin asking a core question. Pass question_order from the list (1-based).",
    parameters: {
      type: "object",
      properties: {
        question_order: {
          type: "integer",
          description: "1-based order from CORE QUESTIONS",
          minimum: 1,
        },
      },
      required: ["question_order"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "complete_question",
    description:
      "Call when done with a core question (after any follow-ups), or immediately when the candidate skips.",
    parameters: {
      type: "object",
      properties: {
        question_order: { type: "integer", minimum: 1 },
        evidence_status: {
          type: "string",
          enum: ["sufficient", "partial", "insufficient", "skipped"],
        },
      },
      required: ["question_order", "evidence_status"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "record_clarification",
    description:
      "Call when asking a follow-up or clarification on the current core question (max 2 per question).",
    parameters: {
      type: "object",
      properties: {
        question_order: { type: "integer", minimum: 1 },
        reason: { type: "string", description: "Why you are probing" },
        follow_up_index: {
          type: "integer",
          minimum: 1,
          maximum: 2,
          description: "1 for first follow-up, 2 for second",
        },
      },
      required: ["question_order", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "report_technical_issue",
    description: "Call when the candidate reports a technical problem.",
    parameters: {
      type: "object",
      properties: {
        issue_type: {
          type: "string",
          enum: ["audio", "connection", "other"],
        },
      },
      required: ["issue_type"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "finish_interview",
    description:
      "Call after the farewell once all core questions are done, or when the session must end.",
    parameters: {
      type: "object",
      properties: {
        completion_reason: {
          type: "string",
          enum: ["completed", "time_limit", "candidate_left", "technical"],
        },
      },
      required: ["completion_reason"],
      additionalProperties: false,
    },
  },
] as const;

/**
 * Mint a short-lived OpenAI Realtime client secret using the server OPENAI_API_KEY.
 * The permanent key never reaches the browser.
 */
export async function createRealtimeClientSecret(opts: {
  userId: string;
  assignment: InterviewAssignmentRow;
  questions: InterviewAssignmentQuestionRow[];
  jobTitle: string;
}): Promise<EphemeralSessionResult> {
  const model = opts.assignment.model || env.openaiRealtimeModel();
  const instructions = buildRealtimeInstructions(opts.assignment, opts.questions, opts.jobTitle);
  const started = Date.now();

  aiLog("interview", "REALTIME_SECRET_PREPARE", {
    model,
    assignmentId: opts.assignment.id,
    questionCount: opts.questions.length,
  });

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey()}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier(opts.userId),
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          instructions,
          audio: {
            input: {
              turn_detection: {
                type: "semantic_vad",
                eagerness: "high",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice: "marin" },
          },
          reasoning: { effort: "low" },
          tools: LIVE_TOOLS,
        },
      }),
    });

    const durationMs = Date.now() - started;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      aiWarn("interview", "REALTIME_SECRET_FAILED", {
        status: response.status,
        durationMs,
        bodyPreview: body.slice(0, 200),
      });
      throw new RealtimeSessionError("Could not start the live interview session.");
    }

    const data = (await response.json()) as {
      value?: string;
      client_secret?: { value?: string; expires_at?: number };
      expires_at?: number;
      session?: { id?: string };
    };
    const clientSecret = data.value ?? data.client_secret?.value;
    if (!clientSecret) {
      throw new RealtimeSessionError("OpenAI did not return a client secret.");
    }

    const expiresRaw = data.expires_at ?? data.client_secret?.expires_at;
    aiLog("interview", "REALTIME_SECRET_OK", {
      durationMs,
      model,
      hasSecret: true,
    });

    return {
      clientSecret,
      expiresAt: expiresRaw ? new Date(expiresRaw * 1000).toISOString() : null,
      model,
      sessionIdHint: data.session?.id ?? null,
    };
  } catch (error) {
    if (error instanceof RealtimeSessionError) throw error;
    aiError("interview", "REALTIME_SECRET_ERROR", error, {});
    throw new RealtimeSessionError("Could not start the live interview session.");
  }
}

export { buildRealtimeInstructions, LIVE_TOOLS };
