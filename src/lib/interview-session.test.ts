import { describe, expect, it } from "vitest";
import {
  clearStoredSessionToken,
  isUnusualInterruption,
  progressStorageKey,
  readPersistedProgress,
  readStoredSessionToken,
  remainingFromStartedAt,
  resolveRestoredTimers,
  sessionTokenStorageKey,
  writePersistedProgress,
  writeStoredSessionToken,
  type PersistedInterviewProgress,
} from "@/lib/interview-session";

describe("interview session token storage", () => {
  it("round-trips a session token for accidental reconnection", () => {
    const assignmentId = "assignment-reconnect-1";
    expect(sessionTokenStorageKey(assignmentId)).toContain(assignmentId);
    writeStoredSessionToken(assignmentId, "token-abc");
    expect(readStoredSessionToken(assignmentId)).toBe("token-abc");
    clearStoredSessionToken(assignmentId);
    expect(readStoredSessionToken(assignmentId)).toBeNull();
  });

  it("treats tab close and unauthorized restart as unusual", () => {
    expect(
      isUnusualInterruption({
        interruptionCount: 1,
        duringRecording: false,
        reason: "tab_close",
      }),
    ).toBe(true);
    expect(
      isUnusualInterruption({
        interruptionCount: 1,
        duringRecording: false,
        reason: "unauthorized_restart",
      }),
    ).toBe(true);
  });
});

describe("wall-clock interview timers", () => {
  it("counts remaining preparation/recording time from startedAt", () => {
    const started = Date.parse("2026-07-20T12:00:00.000Z");
    expect(remainingFromStartedAt(started, 30, started + 12_000)).toBe(18);
    expect(remainingFromStartedAt(started, 120, started + 120_000)).toBe(0);
    expect(remainingFromStartedAt(null, 30, started)).toBe(0);
  });

  it("auto-starts recording when preparation has elapsed while away", () => {
    const started = Date.parse("2026-07-20T12:00:00.000Z");
    expect(
      resolveRestoredTimers({
        phase: "preparing",
        prepStartedAt: started,
        preparationSeconds: 30,
        recordingStartedAt: null,
        recordingMaxSeconds: null,
        responseSeconds: 120,
        nowMs: started + 35_000,
      }),
    ).toMatchObject({ phase: "recording", prepRemaining: 0, recordingMaxSeconds: 120 });
  });

  it("continues a mid-response timer with remaining capture budget", () => {
    const started = Date.parse("2026-07-20T12:00:00.000Z");
    expect(
      resolveRestoredTimers({
        phase: "recording",
        prepStartedAt: null,
        preparationSeconds: 30,
        recordingStartedAt: started,
        recordingMaxSeconds: 120,
        responseSeconds: 120,
        nowMs: started + 45_000,
      }),
    ).toMatchObject({
      phase: "recording",
      recordingRemaining: 75,
      recordingMaxSeconds: 75,
    });
  });

  it("moves to preview when response time expired while the tab was closed", () => {
    const started = Date.parse("2026-07-20T12:00:00.000Z");
    expect(
      resolveRestoredTimers({
        phase: "recording",
        prepStartedAt: null,
        preparationSeconds: 30,
        recordingStartedAt: started,
        recordingMaxSeconds: 120,
        responseSeconds: 120,
        nowMs: started + 130_000,
      }).phase,
    ).toBe("preview");
  });
});

describe("persisted interview progress", () => {
  it("stores and restores progress for the same assignment", () => {
    const assignmentId = "assignment-progress-1";
    const progress: PersistedInterviewProgress = {
      version: 1,
      assignmentId,
      questionId: "q1",
      activeIndex: 1,
      screen: "questions",
      phase: "uploading",
      prepStartedAt: null,
      recordingStartedAt: null,
      recordingMaxSeconds: null,
      registeredAttempt: {
        id: "attempt-1",
        attempt_number: 1,
        storage_bucket: "interview-recordings",
        storage_path: "path.webm",
      },
      recordingMimeType: "video/webm",
      recordingDurationSeconds: 12,
      hasBlob: true,
      updatedAt: Date.now(),
    };
    expect(progressStorageKey(assignmentId)).toContain(assignmentId);
    writePersistedProgress(progress);
    expect(readPersistedProgress(assignmentId)).toMatchObject({
      questionId: "q1",
      phase: "uploading",
      hasBlob: true,
      registeredAttempt: { id: "attempt-1" },
    });
  });
});
