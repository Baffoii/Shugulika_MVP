"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  INTERVIEW_INSTRUCTIONS_VERSION,
  INTERVIEW_LIMITS,
  INTERVIEW_PRIVACY_NOTICE_VERSION,
} from "@/lib/constants";
import type {
  InterviewAssignmentQuestionRow,
  InterviewAssignmentRow,
  InterviewEventType,
  InterviewResponseAttemptRow,
  Json,
} from "@/lib/database.types";
import type { ActionResult } from "@/app/candidate/actions";

const INTERVIEWS_PATH = "/candidate/interviews";

interface AssignmentContext {
  assignment: InterviewAssignmentRow;
  candidateId: string;
}

/** Load an assignment and verify the signed-in candidate owns it. */
async function loadOwnAssignment(assignmentId: string): Promise<AssignmentContext | null> {
  const supabase = createClient();
  const { data: cand } = await supabase.from("candidate_profiles").select("id").maybeSingle();
  const candidateId = (cand as { id: string } | null)?.id;
  if (!candidateId) return null;
  const { data } = await supabase
    .from("interview_assignments")
    .select("*")
    .eq("id", assignmentId)
    .eq("candidate_id", candidateId)
    .maybeSingle();
  const assignment = data as InterviewAssignmentRow | null;
  if (!assignment) return null;
  return { assignment, candidateId };
}

function isExpired(assignment: InterviewAssignmentRow): boolean {
  if (assignment.expires_at === null) return false;
  const expiresAt = new Date(assignment.expires_at).getTime();
  if (assignment.status === "in_progress" && assignment.expiration_grace_hours > 0) {
    return Date.now() > expiresAt + assignment.expiration_grace_hours * 60 * 60 * 1000;
  }
  return Date.now() > expiresAt;
}

async function logEvent(
  assignmentId: string,
  eventType: InterviewEventType,
  assignmentQuestionId?: string | null,
  metadata?: Json,
): Promise<void> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;
  await supabase.from("interview_events").insert({
    assignment_id: assignmentId,
    assignment_question_id: assignmentQuestionId ?? null,
    actor_user_id: userData.user.id,
    event_type: eventType,
    metadata: metadata ?? {},
  });
}

const CANDIDATE_EVENT_TYPES: InterviewEventType[] = [
  "interview_opened",
  "permissions_requested",
  "permissions_denied",
  "preparation_started",
  "recording_started",
  "recording_stopped",
  "retry_selected",
  "upload_started",
];

const SESSION_EVENT_TYPES = [
  "session_heartbeat",
  "session_interrupted",
  "session_resumed",
  "visibility_hidden",
  "visibility_visible",
  "page_unload_warned",
  "connection_lost",
  "connection_restored",
  "break_started",
  "break_ended",
  "document_change_attempted",
] as const;

/** Client-driven factual event logging (whitelisted event types only). */
export async function logInterviewEventAction(
  assignmentId: string,
  eventType: string,
  assignmentQuestionId?: string | null,
): Promise<ActionResult> {
  if (!CANDIDATE_EVENT_TYPES.includes(eventType as InterviewEventType)) {
    return { ok: false, error: "Unsupported event type." };
  }
  const ctx = await loadOwnAssignment(assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  await logEvent(assignmentId, eventType as InterviewEventType, assignmentQuestionId);
  return { ok: true };
}

/**
 * Explicit consent + start. Idempotent: an already-started interview simply
 * succeeds so a refreshed session can continue.
 */
export async function startInterviewAction(
  assignmentId: string,
  consentGiven: boolean,
): Promise<ActionResult> {
  const ctx = await loadOwnAssignment(assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  const { assignment } = ctx;

  if (assignment.status === "in_progress") return { ok: true };
  if (assignment.status === "submitted" || assignment.status === "reviewed") {
    return { ok: false, error: "This interview has already been submitted." };
  }
  if (assignment.status === "cancelled") {
    return { ok: false, error: "This interview was cancelled by the recruiting team." };
  }
  if (assignment.status === "expired" || isExpired(assignment)) {
    return { ok: false, error: "This interview has expired." };
  }
  if (assignment.status !== "invited") {
    return { ok: false, error: "This interview cannot be started." };
  }
  if (!consentGiven) {
    return { ok: false, error: "Please confirm the recording notice to continue." };
  }

  const supabase = createClient();
  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("interview_assignments")
    .update({
      status: "in_progress",
      started_at: now,
      consented_at: now,
      privacy_notice_version: INTERVIEW_PRIVACY_NOTICE_VERSION,
      instructions_version: INTERVIEW_INSTRUCTIONS_VERSION,
    })
    .eq("id", assignmentId)
    .eq("status", "invited")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "This interview could not be started. It may have been cancelled or expired.",
    };
  }

  await logEvent(assignmentId, "consent_given", null, {
    privacy_notice_version: INTERVIEW_PRIVACY_NOTICE_VERSION,
  });
  // Lock application documents before the session begins so they cannot be
  // substituted mid-interview. The RPC is idempotent.
  const { error: lockError } = await supabase.rpc("lock_interview_document_snapshot", {
    p_assignment_id: assignmentId,
  });
  if (lockError) return { ok: false, error: lockError.message };
  revalidatePath(INTERVIEWS_PATH);
  return { ok: true };
}

/** Mark an overdue assignment as expired (server-verified). */
export async function markInterviewExpiredAction(assignmentId: string): Promise<ActionResult> {
  const ctx = await loadOwnAssignment(assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  if (!isExpired(ctx.assignment) || ctx.assignment.status === "expired") return { ok: true };
  const supabase = createClient();
  await supabase
    .from("interview_assignments")
    .update({ status: "expired" })
    .eq("id", assignmentId)
    .in("status", ["invited", "in_progress"]);
  revalidatePath(INTERVIEWS_PATH);
  return { ok: true };
}

/** Open a question: stamps started_at and logs the event (idempotent). */
export async function openQuestionAction(
  assignmentId: string,
  questionId: string,
): Promise<ActionResult> {
  const ctx = await loadOwnAssignment(assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  if (ctx.assignment.status !== "in_progress" || isExpired(ctx.assignment)) {
    return { ok: false, error: "This interview is not active." };
  }
  const supabase = createClient();
  const { data } = await supabase
    .from("interview_assignment_questions")
    .select("*")
    .eq("id", questionId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  const question = data as InterviewAssignmentQuestionRow | null;
  if (!question) return { ok: false, error: "Question not found." };
  if (question.status === "completed") {
    return { ok: false, error: "This question is already completed." };
  }
  if (question.status === "pending") {
    await supabase
      .from("interview_assignment_questions")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", questionId)
      .eq("status", "pending");
    await logEvent(assignmentId, "question_opened", questionId);
  }
  return { ok: true };
}

export interface CreateAttemptResult extends ActionResult {
  attempt?: Pick<
    InterviewResponseAttemptRow,
    "id" | "attempt_number" | "storage_bucket" | "storage_path"
  >;
  remainingAttempts?: number;
}

/**
 * Register a recording attempt AFTER the local recording finishes. The server
 * generates the attempt id and the private storage path (never the client),
 * enforces the attempt cap, and returns the exact path to upload to.
 */
export async function createAttemptAction(input: {
  assignmentId: string;
  questionId: string;
  mimeType: string;
  durationSeconds: number;
  preparationSecondsUsed: number;
  recordingStartedAt: string;
  recordingEndedAt: string;
  /** Reuse a pending/failed row whose local Blob was lost on refresh. */
  replaceAttemptId?: string;
}): Promise<CreateAttemptResult> {
  const ctx = await loadOwnAssignment(input.assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  const { assignment, candidateId } = ctx;
  if (assignment.status !== "in_progress" || isExpired(assignment)) {
    return { ok: false, error: "This interview is not active." };
  }

  const supabase = createClient();
  const { data: qData } = await supabase
    .from("interview_assignment_questions")
    .select("*")
    .eq("id", input.questionId)
    .eq("assignment_id", input.assignmentId)
    .maybeSingle();
  const question = qData as InterviewAssignmentQuestionRow | null;
  if (!question) return { ok: false, error: "Question not found." };
  if (question.status === "completed") {
    return { ok: false, error: "This question is already completed." };
  }

  const { data: existing } = await supabase
    .from("interview_response_attempts")
    .select("*")
    .eq("assignment_question_id", input.questionId)
    .order("attempt_number", { ascending: false });
  const attempts = (existing as InterviewResponseAttemptRow[] | null) ?? [];
  const replacement = input.replaceAttemptId
    ? attempts.find(
        (attempt) =>
          attempt.id === input.replaceAttemptId &&
          (attempt.upload_status === "pending" || attempt.upload_status === "failed"),
      )
    : undefined;
  if (attempts.length >= question.max_attempts) {
    if (!replacement) {
      return { ok: false, error: "You have used all attempts for this question." };
    }
  }
  const attemptNumber = replacement?.attempt_number ?? (attempts[0]?.attempt_number ?? 0) + 1;

  const normalizedMime = (input.mimeType.split(";")[0] ?? "").toLowerCase();
  if (normalizedMime !== "video/webm" && normalizedMime !== "video/mp4") {
    return {
      ok: false,
      error: "Unsupported recording format. Please use Chrome, Edge, or Firefox.",
    };
  }
  const extension = normalizedMime === "video/mp4" ? "mp4" : "webm";
  const attemptId = replacement?.id ?? randomUUID();
  const storagePath =
    replacement?.storage_path ??
    `organization/${assignment.organization_id}/interviews/${assignment.id}/questions/${question.id}/attempts/${attemptId}.${extension}`;
  if (replacement && !storagePath.endsWith(`.${extension}`)) {
    return {
      ok: false,
      error:
        "The restarted recording format changed. Please use the same browser or contact support.",
    };
  }

  const startedAt = Date.parse(input.recordingStartedAt);
  const endedAt = Date.parse(input.recordingEndedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return { ok: false, error: "Invalid recording timestamps." };
  }
  // Prefer wall-clock span; never inflate with prep/idle time or a stale client figure.
  const measuredDuration = (endedAt - startedAt) / 1000;
  const duration = Math.min(
    Math.max(0, Number.isFinite(input.durationSeconds) ? Math.min(measuredDuration, input.durationSeconds) : measuredDuration),
    question.response_seconds + 5, // small grace over the limit for encoder flush
  );
  // Allow a short encoder/UI grace under the template minimum.
  if (duration + 1 < Math.min(INTERVIEW_LIMITS.minResponseSeconds, question.response_seconds)) {
    return {
      ok: false,
      error: `Record at least ${Math.min(INTERVIEW_LIMITS.minResponseSeconds, question.response_seconds)} seconds before stopping.`,
    };
  }

  const values = {
    mime_type: normalizedMime,
    duration_seconds: Number(duration.toFixed(2)),
    preparation_time_used_seconds: Number(Math.max(input.preparationSecondsUsed, 0).toFixed(2)),
    recording_started_at: new Date(startedAt).toISOString(),
    recording_ended_at: new Date(endedAt).toISOString(),
    upload_status: "pending" as const,
  };
  const { data: saved, error } = replacement
    ? await supabase
        .from("interview_response_attempts")
        .update(values)
        .eq("id", replacement.id)
        .eq("assignment_id", assignment.id)
        .in("upload_status", ["pending", "failed"])
        .select("id")
        .maybeSingle()
    : await supabase
        .from("interview_response_attempts")
        .insert({
          id: attemptId,
          assignment_question_id: question.id,
          assignment_id: assignment.id,
          candidate_id: candidateId,
          attempt_number: attemptNumber,
          storage_bucket: "interview-recordings",
          storage_path: storagePath,
          ...values,
        })
        .select("id")
        .maybeSingle();
  if (error) {
    if (error.message.includes("maximum attempts")) {
      return { ok: false, error: "You have used all attempts for this question." };
    }
    return { ok: false, error: "Could not register the attempt. Please try again." };
  }
  if (!saved) {
    return { ok: false, error: "Could not register the attempt. Please try again." };
  }

  if (attemptNumber > 1 && !replacement) {
    await logEvent(assignment.id, "retry_selected", question.id);
  }

  return {
    ok: true,
    attempt: {
      id: attemptId,
      attempt_number: attemptNumber,
      storage_bucket: "interview-recordings",
      storage_path: storagePath,
    },
    remainingAttempts: question.max_attempts - attemptNumber,
  };
}

/**
 * Confirm an upload: verifies the object actually exists in Storage before
 * marking the attempt uploaded (never trust the client's word alone).
 */
export async function markAttemptUploadedAction(
  assignmentId: string,
  attemptId: string,
  fileSizeBytes: number,
): Promise<ActionResult> {
  const ctx = await loadOwnAssignment(assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  if (ctx.assignment.status !== "in_progress" || isExpired(ctx.assignment)) {
    return { ok: false, error: "This interview is not active." };
  }
  const supabase = createClient();

  const { data } = await supabase
    .from("interview_response_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  const attempt = data as InterviewResponseAttemptRow | null;
  if (!attempt) return { ok: false, error: "Attempt not found." };
  if (attempt.upload_status === "uploaded") return { ok: true };

  // Server-side existence check: list the attempt folder and match the file.
  const folder = attempt.storage_path.slice(0, attempt.storage_path.lastIndexOf("/"));
  const filename = attempt.storage_path.slice(attempt.storage_path.lastIndexOf("/") + 1);
  const { data: objects, error: listError } = await supabase.storage
    .from(attempt.storage_bucket)
    .list(folder, { search: filename });
  const object = objects?.find((o) => o.name === filename);
  if (listError || !object) {
    return { ok: false, error: "The upload has not reached storage yet. Please retry." };
  }

  const objectUpdatedAt = object.updated_at ? Date.parse(object.updated_at) : NaN;
  const recordingEndedAt = attempt.recording_ended_at
    ? Date.parse(attempt.recording_ended_at)
    : NaN;
  if (
    Number.isFinite(objectUpdatedAt) &&
    Number.isFinite(recordingEndedAt) &&
    objectUpdatedAt < recordingEndedAt - 5_000
  ) {
    return {
      ok: false,
      error: "A previous recording is still at this path. Please upload the new recording again.",
    };
  }

  const reportedSize = Math.max(1, Math.round(fileSizeBytes));
  if (reportedSize > INTERVIEW_LIMITS.maxUploadBytes) {
    return { ok: false, error: "The recording exceeds the maximum allowed size." };
  }
  const storageSize =
    typeof object.metadata?.size === "number"
      ? object.metadata.size
      : typeof object.metadata?.size === "string"
        ? Number(object.metadata.size)
        : null;
  if (storageSize != null && Number.isFinite(storageSize) && storageSize > 0) {
    const delta = Math.abs(storageSize - reportedSize);
    if (delta > Math.max(4096, reportedSize * 0.05)) {
      return {
        ok: false,
        error: "Uploaded file size does not match this recording. Please retry the upload.",
      };
    }
  }

  const { data: updated, error } = await supabase
    .from("interview_response_attempts")
    .update({
      upload_status: "uploaded",
      uploaded_at: new Date().toISOString(),
      file_size_bytes: storageSize && storageSize > 0 ? Math.round(storageSize) : reportedSize,
    })
    .eq("id", attemptId)
    .in("upload_status", ["pending", "uploading", "failed"])
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Could not confirm the upload. Please retry." };

  await logEvent(assignmentId, "upload_completed", attempt.assignment_question_id, {
    attempt_number: attempt.attempt_number,
  });
  return { ok: true };
}

/** Record a failed upload so it counts in analytics and can be retried. */
export async function markAttemptFailedAction(
  assignmentId: string,
  attemptId: string,
  reason?: string,
): Promise<ActionResult> {
  const ctx = await loadOwnAssignment(assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  const supabase = createClient();
  const { data } = await supabase
    .from("interview_response_attempts")
    .select("id,assignment_question_id,upload_status")
    .eq("id", attemptId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  const attempt = data as Pick<
    InterviewResponseAttemptRow,
    "id" | "assignment_question_id" | "upload_status"
  > | null;
  if (!attempt) return { ok: false, error: "Attempt not found." };
  if (attempt.upload_status === "uploaded") return { ok: true };
  await supabase
    .from("interview_response_attempts")
    .update({ upload_status: "failed" })
    .eq("id", attemptId);
  await logEvent(assignmentId, "upload_failed", attempt.assignment_question_id, {
    reason: reason?.slice(0, 300) ?? null,
  });
  return { ok: true };
}

/** Choose which uploaded attempt is the submitted response for its question. */
export async function selectAttemptAction(
  assignmentId: string,
  attemptId: string,
): Promise<ActionResult> {
  const ctx = await loadOwnAssignment(assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  if (ctx.assignment.status !== "in_progress" || isExpired(ctx.assignment)) {
    return { ok: false, error: "This interview is not active." };
  }
  const supabase = createClient();
  const { data } = await supabase
    .from("interview_response_attempts")
    .select("id,assignment_question_id,upload_status")
    .eq("id", attemptId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  const attempt = data as Pick<
    InterviewResponseAttemptRow,
    "id" | "assignment_question_id" | "upload_status"
  > | null;
  if (!attempt) return { ok: false, error: "Attempt not found." };
  if (attempt.upload_status !== "uploaded") {
    return { ok: false, error: "This attempt has not finished uploading." };
  }

  // The question must not already be completed (no replacing after completion).
  const { data: qData } = await supabase
    .from("interview_assignment_questions")
    .select("status")
    .eq("id", attempt.assignment_question_id)
    .maybeSingle();
  if ((qData as { status: string } | null)?.status === "completed") {
    return { ok: false, error: "This question has already been completed." };
  }

  // Clear any previous selection first (partial unique index allows only one).
  const { error: clearError } = await supabase
    .from("interview_response_attempts")
    .update({ is_selected_submission: false })
    .eq("assignment_question_id", attempt.assignment_question_id)
    .eq("is_selected_submission", true);
  if (clearError) return { ok: false, error: clearError.message };
  const { error } = await supabase
    .from("interview_response_attempts")
    .update({ is_selected_submission: true })
    .eq("id", attemptId);
  if (error) return { ok: false, error: error.message };

  await logEvent(assignmentId, "response_selected", attempt.assignment_question_id, {
    attempt_id: attemptId,
  });
  return { ok: true };
}

/** Complete a question — only valid with an uploaded, selected response. */
export async function completeQuestionAction(
  assignmentId: string,
  questionId: string,
): Promise<ActionResult> {
  const ctx = await loadOwnAssignment(assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  if (ctx.assignment.status !== "in_progress" || isExpired(ctx.assignment)) {
    return { ok: false, error: "This interview is not active." };
  }
  const supabase = createClient();
  const { data: selected } = await supabase
    .from("interview_response_attempts")
    .select("id,upload_status")
    .eq("assignment_question_id", questionId)
    .eq("is_selected_submission", true)
    .maybeSingle();
  if ((selected as { upload_status: string } | null)?.upload_status !== "uploaded") {
    return { ok: false, error: "Select an uploaded response before completing the question." };
  }
  const { data: completed, error } = await supabase
    .from("interview_assignment_questions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", questionId)
    .eq("assignment_id", assignmentId)
    .eq("status", "in_progress")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!completed) {
    return { ok: false, error: "Could not complete this question. Open it and try again." };
  }
  await logEvent(assignmentId, "question_completed", questionId);
  revalidatePath(INTERVIEWS_PATH);
  return { ok: true };
}

/**
 * Final submission — delegates to the idempotent submit_interview RPC which
 * validates completeness, stamps the server time, locks the assignment and
 * notifies the recruiter.
 */
export async function submitInterviewAction(assignmentId: string): Promise<ActionResult> {
  const ctx = await loadOwnAssignment(assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  const supabase = createClient();
  const { error } = await supabase.rpc("submit_interview", { p_assignment_id: assignmentId });
  if (error) {
    const msg = error.message.includes("incomplete")
      ? "Some required questions are not finished yet."
      : error.message.includes("expired")
        ? "This interview has expired."
        : error.message;
    return { ok: false, error: msg };
  }
  revalidatePath(INTERVIEWS_PATH);
  return { ok: true };
}

export interface SessionBootstrapResult extends ActionResult {
  sessionToken?: string;
  resumed?: boolean;
  interruptionCount?: number;
  hasUnusualInterruptions?: boolean;
}

/** Begin or recover a continuous interview session (HireVue-style integrity). */
export async function beginOrResumeSessionAction(
  assignmentId: string,
  previousToken: string | null,
  reason?: string,
): Promise<SessionBootstrapResult> {
  const ctx = await loadOwnAssignment(assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  if (ctx.assignment.status !== "in_progress" || isExpired(ctx.assignment)) {
    return { ok: false, error: "This interview is not active." };
  }
  const supabase = createClient();
  // Ensure documents are locked even if the candidate refreshed after consent.
  if (!ctx.assignment.documents_locked_at) {
    const { error: lockError } = await supabase.rpc("lock_interview_document_snapshot", {
      p_assignment_id: assignmentId,
    });
    if (lockError) return { ok: false, error: lockError.message };
  }
  const { data, error } = await supabase.rpc("begin_or_resume_interview_session", {
    p_assignment_id: assignmentId,
    p_previous_token: previousToken,
    p_reason: reason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.session_token) return { ok: false, error: "Could not establish the interview session." };
  return {
    ok: true,
    sessionToken: row.session_token as string,
    resumed: Boolean(row.resumed),
    interruptionCount: Number(row.interruption_count ?? 0),
    hasUnusualInterruptions: Boolean(row.has_unusual_interruptions),
  };
}

/** Append a session-integrity event (visibility, disconnect, break, etc.). */
export async function recordSessionEventAction(input: {
  assignmentId: string;
  sessionToken: string;
  eventType: (typeof SESSION_EVENT_TYPES)[number];
  questionId?: string | null;
  metadata?: Json;
}): Promise<ActionResult> {
  if (!SESSION_EVENT_TYPES.includes(input.eventType)) {
    return { ok: false, error: "Unsupported session event." };
  }
  const ctx = await loadOwnAssignment(input.assignmentId);
  if (!ctx) return { ok: false, error: "Interview not found." };
  const supabase = createClient();
  const { error } = await supabase.rpc("record_interview_session_event", {
    p_assignment_id: input.assignmentId,
    p_session_token: input.sessionToken,
    p_event_type: input.eventType,
    p_assignment_question_id: input.questionId ?? null,
    p_metadata: input.metadata ?? {},
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
