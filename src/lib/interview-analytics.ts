/**
 * Deterministic, factual helpers for interview analytics presentation.
 * All metrics derive from timestamps and attempt records — never judgment.
 * The heavy lifting lives in the SQL views (migration 0019); these helpers
 * format those numbers and derive a few client-side conveniences.
 */
import type {
  InterviewAssignmentQuestionRow,
  InterviewResponseAttemptRow,
} from "@/lib/database.types";

/** "1:23" / "12:05" — mm:ss for timers and durations. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** "1m 23s" / "45s" / "1h 2m" — human duration for analytics cards. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(Number(seconds))) return "—";
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r > 0 ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** Attempts that actually produced (or tried to produce) a recording. */
export function attemptsUsed(attempts: InterviewResponseAttemptRow[]): number {
  return attempts.filter((a) => a.recording_started_at !== null || a.upload_status !== "pending")
    .length;
}

/** retry_count = max(attempts_used - 1, 0). The first recording is attempt one. */
export function retryCount(attempts: InterviewResponseAttemptRow[]): number {
  return Math.max(attemptsUsed(attempts) - 1, 0);
}

export function selectedAttempt(
  attempts: InterviewResponseAttemptRow[],
): InterviewResponseAttemptRow | undefined {
  return attempts.find((a) => a.is_selected_submission);
}

/** Remaining retries for the candidate UI given the configured cap. */
export function remainingAttempts(
  attempts: InterviewResponseAttemptRow[],
  maxAttempts: number,
): number {
  return Math.max(maxAttempts - attempts.length, 0);
}

export function averageAttemptDuration(attempts: InterviewResponseAttemptRow[]): number | null {
  const durations = attempts
    .map((a) => a.duration_seconds)
    .filter((d): d is number => d !== null && d !== undefined);
  if (durations.length === 0) return null;
  return durations.reduce((sum, d) => sum + Number(d), 0) / durations.length;
}

export function totalAttemptDuration(attempts: InterviewResponseAttemptRow[]): number {
  return attempts.reduce((sum, a) => sum + Number(a.duration_seconds ?? 0), 0);
}

export function uploadFailureCount(attempts: InterviewResponseAttemptRow[]): number {
  return attempts.filter((a) => a.upload_status === "failed").length;
}

/** Expected total duration shown on the invitation page (prep + response). */
export function expectedTotalSeconds(
  questions: Pick<InterviewAssignmentQuestionRow, "preparation_seconds" | "response_seconds">[],
): number {
  return questions.reduce((sum, q) => sum + q.preparation_seconds + q.response_seconds, 0);
}

/** All required questions completed with an uploaded, selected response? */
export function requiredQuestionsComplete(
  questions: Pick<InterviewAssignmentQuestionRow, "id" | "is_required" | "status">[],
  attemptsByQuestion: Map<string, InterviewResponseAttemptRow[]>,
): boolean {
  return questions
    .filter((q) => q.is_required)
    .every((q) => {
      if (q.status !== "completed") return false;
      const selected = selectedAttempt(attemptsByQuestion.get(q.id) ?? []);
      return selected?.upload_status === "uploaded";
    });
}
