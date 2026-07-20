import { INTERVIEW_SESSION_TOKEN_KEY } from "@/lib/constants";

export function sessionTokenStorageKey(assignmentId: string) {
  return `${INTERVIEW_SESSION_TOKEN_KEY}.${assignmentId}`;
}

export function progressStorageKey(assignmentId: string) {
  return `${INTERVIEW_SESSION_TOKEN_KEY}.progress.${assignmentId}`;
}

export function readStoredSessionToken(assignmentId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(sessionTokenStorageKey(assignmentId));
  } catch {
    return null;
  }
}

export function writeStoredSessionToken(assignmentId: string, token: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(sessionTokenStorageKey(assignmentId), token);
  } catch {
    // Private mode / quota — session recovery simply won't be seamless.
  }
}

export function clearStoredSessionToken(assignmentId: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(sessionTokenStorageKey(assignmentId));
  } catch {
    // ignore
  }
}

export type InterruptionReason =
  | "tab_close"
  | "refresh"
  | "navigation"
  | "visibility_hidden"
  | "connection_lost"
  | "unauthorized_restart"
  | "accidental_reconnect";

/** True when interruptions should be highlighted for recruiter review. */
export function isUnusualInterruption(input: {
  interruptionCount: number;
  duringRecording: boolean;
  reason: InterruptionReason | string;
}): boolean {
  if (input.duringRecording) return true;
  if (input.interruptionCount >= 2) return true;
  return ["tab_close", "refresh", "navigation", "unauthorized_restart"].includes(input.reason);
}

export type PersistedQuestionPhase =
  | "prompt"
  | "preparing"
  | "ready"
  | "recording"
  | "registering"
  | "preview"
  | "uploading";

export type PersistedScreen = "device" | "questions" | "break" | "review" | "submitted";

export type PersistedRegisteredAttempt = {
  id: string;
  attempt_number: number;
  storage_bucket: string;
  storage_path: string;
};

/** Client-side interview progress for exact restore after refresh/close. */
export type PersistedInterviewProgress = {
  version: 1;
  assignmentId: string;
  questionId: string;
  activeIndex: number;
  screen: PersistedScreen;
  phase: PersistedQuestionPhase;
  /** Wall-clock start of preparation countdown. */
  prepStartedAt: number | null;
  /** Wall-clock start of the current recording segment. */
  recordingStartedAt: number | null;
  /** Max seconds for the current recording segment (may be remaining after reconnect). */
  recordingMaxSeconds: number | null;
  registeredAttempt: PersistedRegisteredAttempt | null;
  recordingMimeType: string | null;
  recordingDurationSeconds: number | null;
  hasBlob: boolean;
  updatedAt: number;
};

/** Remaining whole seconds based on wall clock (never negative). */
export function remainingFromStartedAt(
  startedAtMs: number | null | undefined,
  limitSeconds: number,
  nowMs = Date.now(),
): number {
  if (startedAtMs == null || !Number.isFinite(startedAtMs) || limitSeconds <= 0) return 0;
  const elapsed = (nowMs - startedAtMs) / 1000;
  return Math.max(0, limitSeconds - elapsed);
}

export function readPersistedProgress(assignmentId: string): PersistedInterviewProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(progressStorageKey(assignmentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedInterviewProgress;
    if (parsed?.version !== 1 || parsed.assignmentId !== assignmentId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistedProgress(progress: PersistedInterviewProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      progressStorageKey(progress.assignmentId),
      JSON.stringify({ ...progress, updatedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

export function clearPersistedProgress(assignmentId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(progressStorageKey(assignmentId));
  } catch {
    // ignore
  }
  void clearPersistedBlob(assignmentId);
}

const IDB_NAME = "shugulika-interview";
const IDB_STORE = "recording-blobs";

function openInterviewIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

export async function persistRecordingBlob(assignmentId: string, blob: Blob): Promise<void> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
  try {
    const db = await openInterviewIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(blob, assignmentId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    });
    db.close();
  } catch {
    // Blob persistence is best-effort; upload can still proceed in-memory.
  }
}

export async function readPersistedBlob(assignmentId: string): Promise<Blob | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return null;
  try {
    const db = await openInterviewIdb();
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(assignmentId);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
    });
    db.close();
    return blob;
  } catch {
    return null;
  }
}

export async function clearPersistedBlob(assignmentId: string): Promise<void> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
  try {
    const db = await openInterviewIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(assignmentId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
    });
    db.close();
  } catch {
    // ignore
  }
}

/**
 * Resolve what to resume after a reconnect using wall-clock timers.
 * Recording blobs cannot resume mid-MediaRecorder; remaining time restarts capture.
 */
export function resolveRestoredTimers(input: {
  phase: PersistedQuestionPhase;
  prepStartedAt: number | null;
  preparationSeconds: number;
  recordingStartedAt: number | null;
  recordingMaxSeconds: number | null;
  responseSeconds: number;
  nowMs?: number;
}): {
  phase: PersistedQuestionPhase;
  prepRemaining: number;
  recordingRemaining: number;
  recordingMaxSeconds: number;
} {
  const now = input.nowMs ?? Date.now();
  if (input.phase === "preparing") {
    const prepRemaining = remainingFromStartedAt(input.prepStartedAt, input.preparationSeconds, now);
    if (prepRemaining <= 0) {
      return {
        phase: "recording",
        prepRemaining: 0,
        recordingRemaining: input.responseSeconds,
        recordingMaxSeconds: input.responseSeconds,
      };
    }
    return {
      phase: "preparing",
      prepRemaining,
      recordingRemaining: input.responseSeconds,
      recordingMaxSeconds: input.responseSeconds,
    };
  }
  if (input.phase === "recording" || input.phase === "ready") {
    const limit = input.recordingMaxSeconds ?? input.responseSeconds;
    const started =
      input.recordingStartedAt ??
      (input.phase === "recording" ? now : null);
    const recordingRemaining =
      started == null ? limit : remainingFromStartedAt(started, limit, now);
    if (recordingRemaining <= 0) {
      // Time expired while away — land on preview path without a fresh capture.
      return {
        phase: "preview",
        prepRemaining: 0,
        recordingRemaining: 0,
        recordingMaxSeconds: limit,
      };
    }
    return {
      phase: "recording",
      prepRemaining: 0,
      recordingRemaining,
      recordingMaxSeconds: recordingRemaining,
    };
  }
  return {
    phase: input.phase,
    prepRemaining: 0,
    recordingRemaining: input.responseSeconds,
    recordingMaxSeconds: input.responseSeconds,
  };
}
