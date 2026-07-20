"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Circle,
  FileText,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  Square,
  Upload,
} from "lucide-react";
import {
  beginOrResumeSessionAction,
  completeQuestionAction,
  createAttemptAction,
  logInterviewEventAction,
  markAttemptFailedAction,
  markAttemptUploadedAction,
  openQuestionAction,
  recordSessionEventAction,
  selectAttemptAction,
  submitInterviewAction,
} from "@/app/candidate/interview-actions";
import { MicLevelMeter } from "@/components/interviews/MicLevelMeter";
import { RecordingPlayback } from "@/components/interviews/RecordingPlayback";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/ui/primitives";
import { Field, Select } from "@/components/ui/form";
import type {
  InterviewAssignmentQuestionRow,
  InterviewDocumentSnapshotItem,
  InterviewResponseAttemptRow,
} from "@/lib/database.types";
import type { CandidateInterviewDetail } from "@/lib/data/video-interviews";
import { formatClock, remainingAttempts } from "@/lib/interview-analytics";
import {
  clearPersistedProgress,
  clearStoredSessionToken,
  persistRecordingBlob,
  readPersistedBlob,
  readPersistedProgress,
  readStoredSessionToken,
  remainingFromStartedAt,
  resolveRestoredTimers,
  writePersistedProgress,
  writeStoredSessionToken,
  type PersistedQuestionPhase,
  type PersistedRegisteredAttempt,
  type PersistedScreen,
} from "@/lib/interview-session";
import {
  checkRecordingSupport,
  classifyMediaError,
  listMediaDevices,
  MEDIA_ERROR_HELP,
  pickSupportedMimeType,
  requestInterviewStream,
  startMicLevelMeter,
  startRecording,
  stopStream,
  type MicLevelSample,
  type RecorderHandle,
} from "@/lib/media/recording";
import { uploadRecording } from "@/lib/media/upload";
import { titleCase } from "@/lib/format";

type Screen = PersistedScreen;
type QuestionPhase = PersistedQuestionPhase;
type RegisteredAttempt = PersistedRegisteredAttempt;

/** In-memory recording ready for preview/upload (blob + a stable object URL). */
type UploadableClip = { blob: Blob; mimeType: string; durationSeconds: number };
type Clip = UploadableClip & { url: string };

function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-surface-border"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <div
        className="h-full rounded-full bg-brand-600 transition-[width]"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function asDocumentSnapshot(value: unknown): InterviewDocumentSnapshotItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is InterviewDocumentSnapshotItem =>
      Boolean(item) && typeof item === "object" && "document_id" in item,
  );
}

function LockedDocumentsPanel({
  documents,
  lockedAt,
}: {
  documents: InterviewDocumentSnapshotItem[];
  lockedAt: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Locked application documents</CardTitle>
        {lockedAt ? <Badge tone="success">Locked</Badge> : <Badge tone="warn">Pending lock</Badge>}
      </CardHeader>
      <CardBody className="space-y-2">
        <p className="text-xs text-ink-muted">
          Identity and supporting documents were locked before this interview began. They cannot be
          replaced during the session. Attempted changes are recorded for recruiter review — this is
          an audit trail, not proof that a document is fraudulent.
        </p>
        {documents.length === 0 ? (
          <p className="text-sm text-ink-subtle">No active documents were on file at lock time.</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <li
                key={doc.document_id}
                className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {doc.title || titleCase(doc.doc_type)}
                    {doc.is_primary ? (
                      <span className="ml-2 text-xs font-normal text-ink-subtle">Primary</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-ink-subtle">
                    {titleCase(doc.doc_type)} · {doc.object_path}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function DeviceCheck({
  assignmentId,
  onReady,
}: {
  assignmentId: string;
  onReady: (stream: MediaStream) => void;
}) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handedOffRef = useRef(false);
  const testRecorderRef = useRef<RecorderHandle | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [microphoneId, setMicrophoneId] = useState("");
  const [micSample, setMicSample] = useState<MicLevelSample>({
    level: 0,
    peak: 0,
    status: "disconnected",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testUrl, setTestUrl] = useState<string | null>(null);
  const [testDuration, setTestDuration] = useState(0);

  const connect = useCallback(
    async (videoId?: string, audioId?: string) => {
      setBusy(true);
      setError(null);
      setTestUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      await logInterviewEventAction(assignmentId, "permissions_requested");
      const supportError = checkRecordingSupport();
      if (supportError) {
        setError(supportError.message);
        setBusy(false);
        return;
      }
      try {
        stopStream(streamRef.current);
        const next = await requestInterviewStream({
          videoDeviceId: videoId || undefined,
          audioDeviceId: audioId || undefined,
        });
        streamRef.current = next;
        setStream(next);
        const devices = await listMediaDevices();
        setCameras(devices.cameras);
        setMicrophones(devices.microphones);
        setCameraId(videoId || next.getVideoTracks()[0]?.getSettings().deviceId || "");
        setMicrophoneId(audioId || next.getAudioTracks()[0]?.getSettings().deviceId || "");
      } catch (cause) {
        let mediaError = classifyMediaError(cause);
        if (
          cause instanceof DOMException &&
          (cause.name === "NotFoundError" || cause.name === "OverconstrainedError")
        ) {
          try {
            const devices = await listMediaDevices();
            if (devices.cameras.length === 0) {
              mediaError = { kind: "no_camera", message: MEDIA_ERROR_HELP.no_camera };
            } else if (devices.microphones.length === 0) {
              mediaError = { kind: "no_microphone", message: MEDIA_ERROR_HELP.no_microphone };
            }
          } catch {
            // Keep the original browser error classification.
          }
        }
        setError(mediaError.message);
        await logInterviewEventAction(assignmentId, "permissions_denied");
      } finally {
        setBusy(false);
      }
    },
    [assignmentId],
  );

  useEffect(() => {
    void connect();
    return () => {
      testRecorderRef.current?.stop();
      if (!handedOffRef.current) stopStream(streamRef.current);
    };
  }, [connect]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = stream;
    if (!stream) {
      setMicSample({ level: 0, peak: 0, status: "disconnected" });
      return;
    }
    return startMicLevelMeter(stream, setMicSample);
  }, [stream]);

  useEffect(
    () => () => {
      if (testUrl) URL.revokeObjectURL(testUrl);
    },
    [testUrl],
  );

  async function recordTest() {
    if (!stream) return;
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      setError("This browser cannot record a supported video format.");
      return;
    }
    setTesting(true);
    setTestUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    const { handle, result } = startRecording(stream, mimeType, 8);
    testRecorderRef.current = handle;
    try {
      const recording = await result;
      setTestDuration(recording.durationSeconds);
      setTestUrl(URL.createObjectURL(recording.blob));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The test recording failed.");
    } finally {
      setTesting(false);
      testRecorderRef.current = null;
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Check your camera and microphone"
        description="Your test clip stays on this device and is never uploaded."
      />
      <Alert tone="info">
        This interview is one continuous session. Leaving, refreshing, or closing the tab is
        recorded. Progress is saved after each completed question; an interrupted recording must be
        restarted.
      </Alert>
      {error ? (
        <div className="mt-3">
          <Alert tone="danger" title="Device check failed">
            {error}
          </Alert>
        </div>
      ) : null}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden bg-black">
          {testUrl ? (
            <RecordingPlayback
              src={testUrl}
              durationSeconds={testDuration}
              aria-label="Test recording playback"
            />
          ) : (
            <div className="relative aspect-video w-full bg-black">
              <video
                ref={previewRef}
                autoPlay
                muted
                playsInline
                className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
                aria-label="Live camera preview"
              />
              {stream ? (
                <div className="absolute right-3 top-3">
                  <MicLevelMeter sample={micSample} compact />
                </div>
              ) : null}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Devices</CardTitle>
            {stream ? <Badge tone="success">Ready</Badge> : <Badge tone="warn">Not ready</Badge>}
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label="Camera" htmlFor="camera">
              <Select
                id="camera"
                value={cameraId}
                disabled={!stream || busy}
                onChange={(event) => void connect(event.target.value, microphoneId)}
              >
                {cameras.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Microphone" htmlFor="microphone">
              <Select
                id="microphone"
                value={microphoneId}
                disabled={!stream || busy}
                onChange={(event) => void connect(cameraId, event.target.value)}
              >
                {microphones.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </Select>
            </Field>
            <MicLevelMeter sample={micSample} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void connect()} disabled={busy}>
                <RefreshCw className="h-4 w-4" aria-hidden />
                {busy ? "Checking…" : "Retry devices"}
              </Button>
              {testing ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => testRecorderRef.current?.stop()}
                >
                  <Square className="h-4 w-4" aria-hidden />
                  Stop test
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void recordTest()}
                  disabled={!stream}
                >
                  <Camera className="h-4 w-4" aria-hidden />
                  Record test
                </Button>
              )}
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={!stream || testing}
              onClick={() => {
                handedOffRef.current = true;
                onReady(stream!);
              }}
            >
              Continue to questions
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export function InterviewSession({ initialDetail }: { initialDetail: CandidateInterviewDetail }) {
  const router = useRouter();
  const { assignment } = initialDetail;
  const allowPause = Boolean(assignment.allow_pause_between_questions);
  const allowReview = assignment.allow_response_review !== false;
  const lockedDocuments = asDocumentSnapshot(assignment.document_snapshot);

  const [screen, setScreen] = useState<Screen>(
    assignment.status === "submitted" || assignment.status === "reviewed"
      ? "submitted"
      : initialDetail.questions.every((q) => q.status === "completed")
        ? "review"
        : "device",
  );
  const [questions, setQuestions] = useState(initialDetail.questions);
  const [attempts, setAttempts] = useState(initialDetail.attempts);
  const [activeIndex, setActiveIndex] = useState(() => {
    const index = initialDetail.questions.findIndex((q) => q.status !== "completed");
    return index >= 0 ? index : 0;
  });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [phase, setPhase] = useState<QuestionPhase>("prompt");
  const [prepStartedAt, setPrepStartedAt] = useState<number | null>(null);
  const [prepRemaining, setPrepRemaining] = useState(0);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingMaxSeconds, setRecordingMaxSeconds] = useState<number | null>(null);
  const [recordingRemaining, setRecordingRemaining] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [registeredAttempt, setRegisteredAttempt] = useState<RegisteredAttempt | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [interruptedNotice, setInterruptedNotice] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, startSubmitTransition] = useTransition();
  const [micSample, setMicSample] = useState<MicLevelSample>({
    level: 0,
    peak: 0,
    status: "disconnected",
  });
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const recorderRef = useRef<RecorderHandle | null>(null);
  const sessionStreamRef = useRef<MediaStream | null>(null);
  const recordingUrlRef = useRef<string | null>(null);
  const livePreviewRef = useRef<HTMLVideoElement>(null);
  const prepStartedAtRef = useRef<number | null>(null);
  const phaseRef = useRef<QuestionPhase>(phase);
  const sessionTokenRef = useRef<string | null>(null);
  const bootstrappedRef = useRef(false);
  const initialInterruptedAttemptIdsRef = useRef(
    new Set(
      initialDetail.attempts
        .filter(
          (attempt) => attempt.upload_status === "pending" || attempt.upload_status === "failed",
        )
        .map((attempt) => attempt.id),
    ),
  );
  const restartedAttemptIdsRef = useRef(new Set<string>());
  const currentReplacementAttemptIdRef = useRef<string | undefined>(undefined);

  const question = questions[activeIndex];
  const questionAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.assignment_question_id === question?.id),
    [attempts, question?.id],
  );
  const interruptedAttempt = questionAttempts.find(
    (attempt) =>
      initialInterruptedAttemptIdsRef.current.has(attempt.id) &&
      !restartedAttemptIdsRef.current.has(attempt.id) &&
      (attempt.upload_status === "pending" || attempt.upload_status === "failed"),
  );
  const attemptsLeft = question ? remainingAttempts(questionAttempts, question.max_attempts) : 0;
  const canRecordAgainAfterInterruption = attemptsLeft > 0 || Boolean(interruptedAttempt);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    sessionTokenRef.current = sessionToken;
  }, [sessionToken]);

  useEffect(() => {
    prepStartedAtRef.current = prepStartedAt;
  }, [prepStartedAt]);

  useEffect(() => {
    recordingUrlRef.current = clip?.url ?? null;
  }, [clip]);

  useEffect(() => {
    if (livePreviewRef.current) livePreviewRef.current.srcObject = stream;
  }, [stream, phase, activeIndex]);

  useEffect(() => {
    const showingLiveFeed =
      screen === "questions" &&
      stream &&
      phase !== "preview" &&
      phase !== "uploading" &&
      phase !== "registering";
    if (!showingLiveFeed) {
      setMicSample({ level: 0, peak: 0, status: stream ? "too_quiet" : "disconnected" });
      return;
    }
    return startMicLevelMeter(stream, setMicSample);
  }, [stream, phase, screen]);

  /** Replace the active clip, revoking the previous object URL to avoid leaks. */
  const applyClip = useCallback((blob: Blob, mimeType: string, durationSeconds: number) => {
    setClip((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { blob, mimeType, durationSeconds, url: URL.createObjectURL(blob) };
    });
  }, []);

  const clearClip = useCallback(() => {
    setClip((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
  }, []);

  function releaseCamera() {
    stopStream(sessionStreamRef.current);
    sessionStreamRef.current = null;
    setStream(null);
  }

  function acceptDevices(nextStream: MediaStream) {
    sessionStreamRef.current = nextStream;
    setStream(nextStream);
    setScreen("questions");
  }

  /** Open the question and start its wall-clock preparation countdown (or jump straight to recording). */
  const beginQuestionAuto = useCallback(
    async (target: InterviewAssignmentQuestionRow) => {
      setError(null);
      setInterruptedNotice(false);
      clearClip();
      setRegisteredAttempt(null);
      currentReplacementAttemptIdRef.current = undefined;
      if (target.preparation_seconds <= 0) {
        setPrepStartedAt(null);
        setPhase("recording");
        void openQuestionAction(assignment.id, target.id);
        void beginRecordingRef.current({ maxSeconds: target.response_seconds });
        return;
      }
      const now = Date.now();
      setPrepStartedAt(now);
      setPhase("preparing");
      const opened = await openQuestionAction(assignment.id, target.id);
      if (!opened.ok) {
        setError(opened.error ?? "Could not open this question.");
      }
      await logInterviewEventAction(assignment.id, "preparation_started", target.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignment.id, clearClip],
  );
  const beginQuestionAutoRef = useRef(beginQuestionAuto);
  useEffect(() => {
    beginQuestionAutoRef.current = beginQuestionAuto;
  }, [beginQuestionAuto]);

  function advanceAfterQuestion(nextQuestions: InterviewAssignmentQuestionRow[]) {
    const nextIndex = nextQuestions.findIndex(
      (item, index) => index > activeIndex && item.status !== "completed",
    );
    const nextQuestion = nextIndex >= 0 ? nextQuestions[nextIndex] : undefined;
    if (nextQuestion) {
      setActiveIndex(nextIndex);
      if (allowPause) {
        setPhase("prompt");
        setScreen("break");
        const token = sessionTokenRef.current;
        if (token) {
          void recordSessionEventAction({
            assignmentId: assignment.id,
            sessionToken: token,
            eventType: "break_started",
            questionId: nextQuestion.id,
          });
        }
      } else {
        setScreen("questions");
        void beginQuestionAutoRef.current(nextQuestion);
      }
    } else {
      releaseCamera();
      setScreen("review");
    }
  }

  function skipOptionalQuestion() {
    if (!question || question.is_required) return;
    clearPersistedProgress(assignment.id);
    const nextIndex = questions.findIndex(
      (item, index) => index > activeIndex && item.status !== "completed",
    );
    setError(null);
    setInterruptedNotice(false);
    clearClip();
    setRegisteredAttempt(null);
    setPrepStartedAt(null);
    setRecordingStartedAt(null);
    setRecordingMaxSeconds(null);
    const nextQuestion = nextIndex >= 0 ? questions[nextIndex] : undefined;
    if (nextQuestion) {
      setActiveIndex(nextIndex);
      if (allowPause) {
        setPhase("prompt");
        setScreen("break");
      } else {
        void beginQuestionAutoRef.current(nextQuestion);
      }
    } else {
      releaseCamera();
      setScreen("review");
    }
  }

  /** Start (or resume) capture. Always read via beginRecordingRef so intervals never see a stale closure. */
  const beginRecording = useCallback(
    async (opts?: { maxSeconds?: number }) => {
      if (!stream || !question) return;
      if (recorderRef.current?.isActive()) return;
      const mimeType = pickSupportedMimeType();
      if (!mimeType) {
        setError("This browser cannot record a supported video format.");
        return;
      }
      setError(null);
      setInterruptedNotice(false);
      const replaceId =
        currentReplacementAttemptIdRef.current ?? interruptedAttempt?.id ?? registeredAttempt?.id;
      currentReplacementAttemptIdRef.current = replaceId;
      const maxSeconds = opts?.maxSeconds ?? question.response_seconds;
      const startWall = Date.now();
      setRecordingStartedAt(startWall);
      setRecordingMaxSeconds(maxSeconds);
      setPhase("recording");
      void logInterviewEventAction(assignment.id, "recording_started", question.id);
      const { handle, result } = startRecording(stream, mimeType, maxSeconds);
      recorderRef.current = handle;
      try {
        const captured = await result;
        recorderRef.current = null;
        applyClip(captured.blob, captured.mimeType, captured.durationSeconds);
        setPhase("registering");
        await persistRecordingBlob(assignment.id, captured.blob);
        void logInterviewEventAction(assignment.id, "recording_stopped", question.id);

        const prepUsed = prepStartedAtRef.current
          ? Math.min(
              question.preparation_seconds,
              Math.max(0, (captured.startedAt.getTime() - prepStartedAtRef.current) / 1000),
            )
          : 0;
        const created = await createAttemptAction({
          assignmentId: assignment.id,
          questionId: question.id,
          mimeType: captured.mimeType,
          durationSeconds: captured.durationSeconds,
          preparationSecondsUsed: prepUsed,
          recordingStartedAt: captured.startedAt.toISOString(),
          recordingEndedAt: captured.endedAt.toISOString(),
          replaceAttemptId: replaceId,
        });
        if (!created.ok || !created.attempt) {
          setError(created.error ?? "Could not register this attempt.");
          setPhase("preview");
          return;
        }
        if (replaceId) restartedAttemptIdsRef.current.add(replaceId);
        setRegisteredAttempt(created.attempt);
        setAttempts((current) => {
          const nextAttempt: InterviewResponseAttemptRow = {
            id: created.attempt!.id,
            assignment_question_id: question.id,
            assignment_id: assignment.id,
            candidate_id: assignment.candidate_id,
            attempt_number: created.attempt!.attempt_number,
            storage_bucket: created.attempt!.storage_bucket,
            storage_path: created.attempt!.storage_path,
            mime_type: captured.mimeType,
            file_size_bytes: null,
            duration_seconds: captured.durationSeconds,
            preparation_time_used_seconds: prepUsed,
            recording_started_at: captured.startedAt.toISOString(),
            recording_ended_at: captured.endedAt.toISOString(),
            uploaded_at: null,
            upload_status: "pending",
            is_selected_submission: false,
            discarded_at: null,
            client_metadata: {},
            created_at: new Date().toISOString(),
          };
          return current.some((attempt) => attempt.id === nextAttempt.id)
            ? current.map((attempt) => (attempt.id === nextAttempt.id ? nextAttempt : attempt))
            : [...current, nextAttempt];
        });
        if (allowReview) {
          setPhase("preview");
        } else {
          setPhase("uploading");
          await uploadAndCompleteWithRef.current(
            {
              blob: captured.blob,
              mimeType: captured.mimeType,
              durationSeconds: captured.durationSeconds,
            },
            created.attempt,
          );
        }
      } catch (cause) {
        recorderRef.current = null;
        setError(cause instanceof Error ? cause.message : "Recording failed.");
        setInterruptedNotice(true);
        setPhase("prompt");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream, question, interruptedAttempt, registeredAttempt, allowReview, applyClip, assignment.id, assignment.candidate_id],
  );
  const beginRecordingRef = useRef(beginRecording);
  useEffect(() => {
    beginRecordingRef.current = beginRecording;
  }, [beginRecording]);

  function retryRecording() {
    if (!question) return;
    const replaceable =
      registeredAttempt ??
      interruptedAttempt ??
      [...questionAttempts]
        .reverse()
        .find(
          (attempt) => attempt.upload_status === "pending" || attempt.upload_status === "failed",
        );
    if (!replaceable && remainingAttempts(questionAttempts, question.max_attempts) <= 0) {
      setError("You have used all attempts for this question.");
      return;
    }
    void logInterviewEventAction(assignment.id, "retry_selected", question.id);
    clearClip();
    currentReplacementAttemptIdRef.current = replaceable?.id;
    setRegisteredAttempt(null);
    setError(null);
    void beginRecordingRef.current({ maxSeconds: question.response_seconds });
  }

  function recordAgainAfterInterruption() {
    if (!question) return;
    const replaceable = registeredAttempt ?? interruptedAttempt;
    currentReplacementAttemptIdRef.current = replaceable?.id;
    setRegisteredAttempt(null);
    setInterruptedNotice(false);
    setError(null);
    void beginRecordingRef.current({ maxSeconds: question.response_seconds });
  }

  /** Upload a captured clip and complete the question. Always called via uploadAndCompleteWithRef. */
  const uploadAndCompleteWith = useCallback(
    async (activeClip: UploadableClip, activeAttempt: RegisteredAttempt) => {
      if (!question) {
        setError("This attempt was not registered. Record a new attempt.");
        return;
      }
      setPhase("uploading");
      setError(null);
      setUploadProgress(0);
      await logInterviewEventAction(assignment.id, "upload_started", question.id);
      let uploadConfirmed = false;
      try {
        await uploadRecording({
          bucket: activeAttempt.storage_bucket,
          path: activeAttempt.storage_path,
          blob: activeClip.blob,
          onProgress: setUploadProgress,
        });
        const uploaded = await markAttemptUploadedAction(
          assignment.id,
          activeAttempt.id,
          activeClip.blob.size,
        );
        if (!uploaded.ok) throw new Error(uploaded.error ?? "Could not confirm the upload.");
        uploadConfirmed = true;
        const selected = await selectAttemptAction(assignment.id, activeAttempt.id);
        if (!selected.ok) throw new Error(selected.error ?? "Could not select this response.");
        const completed = await completeQuestionAction(assignment.id, question.id);
        if (!completed.ok) throw new Error(completed.error ?? "Could not complete this question.");

        setAttempts((current) =>
          current.map((attempt) =>
            attempt.assignment_question_id === question.id
              ? {
                  ...attempt,
                  upload_status:
                    attempt.id === activeAttempt.id ? ("uploaded" as const) : attempt.upload_status,
                  is_selected_submission: attempt.id === activeAttempt.id,
                  uploaded_at:
                    attempt.id === activeAttempt.id ? new Date().toISOString() : attempt.uploaded_at,
                  file_size_bytes:
                    attempt.id === activeAttempt.id
                      ? activeClip.blob.size
                      : attempt.file_size_bytes,
                }
              : attempt,
          ),
        );
        const nextQuestions = questions.map((item) =>
          item.id === question.id
            ? { ...item, status: "completed" as const, completed_at: new Date().toISOString() }
            : item,
        );
        setQuestions(nextQuestions);
        clearPersistedProgress(assignment.id);
        clearClip();
        setRegisteredAttempt(null);
        setPrepStartedAt(null);
        setRecordingStartedAt(null);
        setRecordingMaxSeconds(null);
        advanceAfterQuestion(nextQuestions);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Upload failed.";
        if (!uploadConfirmed) {
          await markAttemptFailedAction(assignment.id, activeAttempt.id, message);
          setAttempts((current) =>
            current.map((attempt) =>
              attempt.id === activeAttempt.id
                ? { ...attempt, upload_status: "failed" as const }
                : attempt,
            ),
          );
          setError(`${message} Your recording is still available — press Retry upload.`);
        } else {
          setError(`${message} The file uploaded; press Use this response again to finish.`);
        }
        setPhase("preview");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question, questions, assignment.id, clearClip],
  );
  const uploadAndCompleteWithRef = useRef(uploadAndCompleteWith);
  useEffect(() => {
    uploadAndCompleteWithRef.current = uploadAndCompleteWith;
  }, [uploadAndCompleteWith]);

  async function uploadAndComplete() {
    if (!clip || !registeredAttempt) {
      setError("This attempt was not registered. Record a new attempt.");
      return;
    }
    await uploadAndCompleteWithRef.current(
      { blob: clip.blob, mimeType: clip.mimeType, durationSeconds: clip.durationSeconds },
      registeredAttempt,
    );
  }

  function submitInterview() {
    startSubmitTransition(async () => {
      setError(null);
      const result = await submitInterviewAction(assignment.id);
      if (!result.ok) {
        setError(result.error ?? "Could not submit the interview.");
        return;
      }
      clearStoredSessionToken(assignment.id);
      clearPersistedProgress(assignment.id);
      releaseCamera();
      setScreen("submitted");
      router.refresh();
    });
  }

  function endBreak() {
    const token = sessionTokenRef.current;
    if (token) {
      void recordSessionEventAction({
        assignmentId: assignment.id,
        sessionToken: token,
        eventType: "break_ended",
        questionId: question?.id,
      });
    }
    setScreen("questions");
    if (question) void beginQuestionAutoRef.current(question);
  }

  // Continuous session bootstrap + integrity listeners.
  useEffect(() => {
    if (assignment.status !== "in_progress") return;
    let cancelled = false;
    const previous = readStoredSessionToken(assignment.id);
    void beginOrResumeSessionAction(
      assignment.id,
      previous,
      previous ? "accidental_reconnect" : "initial",
    ).then((result) => {
      if (cancelled || !result.ok || !result.sessionToken) {
        if (!cancelled && result.error) setError(result.error);
        return;
      }
      writeStoredSessionToken(assignment.id, result.sessionToken);
      setSessionToken(result.sessionToken);
      if (result.resumed) {
        setSessionNotice(
          "Reconnected to your existing interview session. Leaving again will be recorded.",
        );
      } else if (result.hasUnusualInterruptions || (result.interruptionCount ?? 0) > 0) {
        setSessionNotice(
          "An interruption was recorded on this interview and may be flagged for recruiter review.",
        );
      }
    });

    const log = (
      eventType:
        | "session_heartbeat"
        | "session_interrupted"
        | "visibility_hidden"
        | "visibility_visible"
        | "page_unload_warned"
        | "connection_lost"
        | "connection_restored",
      metadata: Record<string, unknown> = {},
    ) => {
      const token = sessionTokenRef.current ?? readStoredSessionToken(assignment.id);
      if (!token) return;
      void recordSessionEventAction({
        assignmentId: assignment.id,
        sessionToken: token,
        eventType,
        questionId: question?.id,
        metadata: {
          ...metadata,
          during_recording: phaseRef.current === "recording",
          phase: phaseRef.current,
        },
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        log("visibility_hidden", { reason: "visibility_hidden" });
      } else {
        log("visibility_visible", { reason: "visibility_visible" });
      }
    };
    const onOffline = () => log("connection_lost", { reason: "connection_lost" });
    const onOnline = () => log("connection_restored", { reason: "connection_restored" });
    const onPageHide = () =>
      log("page_unload_warned", {
        reason: "tab_close",
        persisted: (window.event as PageTransitionEvent | undefined)?.persisted ?? false,
      });
    const warn = (event: BeforeUnloadEvent) => {
      log("page_unload_warned", { reason: "navigation" });
      event.preventDefault();
      event.returnValue = "";
    };
    const heartbeat = window.setInterval(() => log("session_heartbeat"), 60_000);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", warn);
    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", warn);
    };
    // question id is read via closure for metadata only; rebinding listeners each
    // question would spam reconnect events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment.id, assignment.status]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      stopStream(sessionStreamRef.current);
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    };
  }, []);

  // Wall-clock preparation countdown — ticks off Date.now(), so it survives
  // background tabs/throttled timers, and auto-starts recording at zero.
  useEffect(() => {
    if (phase !== "preparing" || !question || prepStartedAt == null) return;
    const preparationSeconds = question.preparation_seconds;
    const responseSeconds = question.response_seconds;
    let intervalId: number | null = null;
    let startedRecording = false;
    const tick = () => {
      const remaining = remainingFromStartedAt(prepStartedAt, preparationSeconds);
      setPrepRemaining(remaining);
      if (remaining <= 0 && !startedRecording) {
        startedRecording = true;
        if (intervalId != null) window.clearInterval(intervalId);
        void beginRecordingRef.current({ maxSeconds: responseSeconds });
      }
    };
    tick();
    intervalId = window.setInterval(tick, 250);
    return () => {
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [phase, prepStartedAt, question]);

  // Wall-clock recording countdown for display only — MediaRecorder auto-stops
  // itself via the maxDurationSeconds passed into startRecording().
  useEffect(() => {
    if (phase !== "recording" || recordingStartedAt == null || recordingMaxSeconds == null) return;
    const tick = () => setRecordingRemaining(remainingFromStartedAt(recordingStartedAt, recordingMaxSeconds));
    tick();
    const intervalId = window.setInterval(tick, 250);
    return () => window.clearInterval(intervalId);
  }, [phase, recordingStartedAt, recordingMaxSeconds]);

  // Persist enough state to exactly resume this question after a refresh/close.
  useEffect(() => {
    if (screen !== "questions" && screen !== "break") return;
    if (!question) return;
    writePersistedProgress({
      version: 1,
      assignmentId: assignment.id,
      questionId: question.id,
      activeIndex,
      screen,
      phase,
      prepStartedAt,
      recordingStartedAt,
      recordingMaxSeconds,
      registeredAttempt: registeredAttempt ?? null,
      recordingMimeType: clip?.mimeType ?? null,
      recordingDurationSeconds: clip?.durationSeconds ?? null,
      hasBlob: clip != null,
      updatedAt: Date.now(),
    });
  }, [
    assignment.id,
    screen,
    phase,
    activeIndex,
    question,
    prepStartedAt,
    recordingStartedAt,
    recordingMaxSeconds,
    registeredAttempt,
    clip,
  ]);

  // Once devices are ready, resume exactly where we left off (if anything was
  // persisted for this assignment), otherwise auto-begin the first open question.
  useEffect(() => {
    if (screen !== "questions" || !stream || bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    async function restoreOrBegin() {
      const persisted = readPersistedProgress(assignment.id);
      const restoredIndex = persisted ? questions.findIndex((q) => q.id === persisted.questionId) : -1;
      const restoredQuestion = restoredIndex >= 0 ? questions[restoredIndex] : null;

      if (persisted && restoredQuestion && restoredQuestion.status !== "completed") {
        setActiveIndex(restoredIndex);
        if (persisted.registeredAttempt) setRegisteredAttempt(persisted.registeredAttempt);

        if (persisted.screen === "break") {
          setScreen("break");
          setPhase("prompt");
          return;
        }

        switch (persisted.phase) {
          case "preparing": {
            const timers = resolveRestoredTimers({
              phase: "preparing",
              prepStartedAt: persisted.prepStartedAt,
              preparationSeconds: restoredQuestion.preparation_seconds,
              recordingStartedAt: null,
              recordingMaxSeconds: null,
              responseSeconds: restoredQuestion.response_seconds,
            });
            if (timers.phase === "preparing") {
              setPrepStartedAt(persisted.prepStartedAt);
              setPhase("preparing");
            } else {
              void beginRecordingRef.current({ maxSeconds: restoredQuestion.response_seconds });
            }
            break;
          }
          case "recording":
          case "ready": {
            const timers = resolveRestoredTimers({
              phase: "recording",
              prepStartedAt: null,
              preparationSeconds: restoredQuestion.preparation_seconds,
              recordingStartedAt: persisted.recordingStartedAt,
              recordingMaxSeconds: persisted.recordingMaxSeconds,
              responseSeconds: restoredQuestion.response_seconds,
            });
            if (timers.phase === "recording" && timers.recordingRemaining > 0) {
              void beginRecordingRef.current({ maxSeconds: timers.recordingMaxSeconds });
            } else {
              // Recording window already elapsed while away — restart prep if attempts remain.
              setInterruptedNotice(true);
              void beginQuestionAutoRef.current(restoredQuestion);
            }
            break;
          }
          case "registering":
          case "preview":
          case "uploading": {
            if (persisted.hasBlob && persisted.registeredAttempt) {
              const blob = await readPersistedBlob(assignment.id);
              if (blob) {
                const mimeType = persisted.recordingMimeType ?? blob.type ?? "video/webm";
                const durationSeconds = persisted.recordingDurationSeconds ?? 0;
                applyClip(blob, mimeType, durationSeconds);
                setRegisteredAttempt(persisted.registeredAttempt);
                // Resume an in-flight upload immediately. If they were reviewing,
                // restore the review screen so they can submit or retry (when allowed).
                if (persisted.phase === "preview" && allowReview) {
                  setPhase("preview");
                } else {
                  setPhase("uploading");
                  void uploadAndCompleteWithRef.current(
                    { blob, mimeType, durationSeconds },
                    persisted.registeredAttempt,
                  );
                }
                break;
              }
            }
            setInterruptedNotice(true);
            void beginQuestionAutoRef.current(restoredQuestion);
            break;
          }
          default:
            // Persisted "prompt" (or unknown) — auto-start prep so the countdown never stalls.
            void beginQuestionAutoRef.current(restoredQuestion);
        }
        return;
      }

      if (persisted) clearPersistedProgress(assignment.id);
      const nextIncomplete = questions.findIndex((q) => q.status !== "completed");
      const nextQuestion = nextIncomplete >= 0 ? questions[nextIncomplete] : undefined;
      if (nextQuestion) {
        setActiveIndex(nextIncomplete);
        void beginQuestionAutoRef.current(nextQuestion);
      } else {
        releaseCamera();
        setScreen("review");
      }
    }

    void restoreOrBegin();
    // Runs exactly once when the camera becomes ready; guarded by bootstrappedRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, stream]);

  if (screen === "submitted") {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <Card>
          <CardBody className="flex flex-col items-center px-6 py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-status-success" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold text-ink">Interview submitted</h1>
            <p className="mt-2 max-w-md text-sm text-ink-muted">
              Your responses were submitted successfully. The recruiting team can now review them.
            </p>
            <div className="mt-6 flex gap-2">
              <ButtonLink href="/candidate/interviews" variant="outline">
                Back to interviews
              </ButtonLink>
              <ButtonLink href="/candidate/applications">My applications</ButtonLink>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (screen === "device") {
    return (
      <div className="space-y-4">
        <DeviceCheck assignmentId={assignment.id} onReady={acceptDevices} />
        <div className="mx-auto max-w-4xl">
          <LockedDocumentsPanel
            documents={lockedDocuments}
            lockedAt={assignment.documents_locked_at}
          />
        </div>
      </div>
    );
  }

  if (screen === "break") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader
          title="Take a short break"
          description="This pause is allowed by the recruiter. Leaving the interview page is still recorded as an interruption."
        />
        <Alert tone="warn">
          Keep this tab open. Closing or refreshing will be logged and may be flagged for recruiter
          review.
        </Alert>
        <Card>
          <CardBody className="space-y-4">
            <p className="text-sm text-ink-muted">
              Next up: Question {activeIndex + 1} of {questions.length}
            </p>
            <Button type="button" onClick={endBreak}>
              <Play className="h-4 w-4" aria-hidden />
              Continue to next question
            </Button>
          </CardBody>
        </Card>
        <LockedDocumentsPanel
          documents={lockedDocuments}
          lockedAt={assignment.documents_locked_at}
        />
      </div>
    );
  }

  if (screen === "review") {
    const allRequiredComplete = questions
      .filter((item) => item.is_required)
      .every((item) => item.status === "completed");
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader
          title="Review your interview"
          description="Confirm every required response uploaded successfully before final submission."
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {assignment.has_unusual_interruptions ? (
          <Alert tone="warn">
            Unusual interruptions were recorded during this session and may be visible to the
            recruiting team.
          </Alert>
        ) : null}
        <div className="space-y-3">
          {questions.map((item, index) => {
            const selected = attempts.find(
              (attempt) =>
                attempt.assignment_question_id === item.id && attempt.is_selected_submission,
            );
            return (
              <Card key={item.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    {selected?.upload_status === "uploaded" ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-status-success" aria-hidden />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 text-ink-subtle" aria-hidden />
                    )}
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                        Question {index + 1}
                      </p>
                      <p className="mt-1 text-sm font-medium text-ink">
                        {item.question_text_snapshot}
                      </p>
                      {selected?.duration_seconds != null ? (
                        <p className="mt-1 text-xs text-ink-subtle">
                          Duration {formatClock(Number(selected.duration_seconds))}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <Badge tone={selected?.upload_status === "uploaded" ? "success" : "warn"}>
                    {selected?.upload_status === "uploaded" ? "Uploaded" : "Incomplete"}
                  </Badge>
                </div>
              </Card>
            );
          })}
        </div>
        <LockedDocumentsPanel
          documents={lockedDocuments}
          lockedAt={assignment.documents_locked_at}
        />
        <Card>
          <CardBody className="space-y-4">
            <Alert tone="info">
              Final submission locks your responses. You will not be able to record or select
              another attempt afterward.
            </Alert>
            {confirmSubmit ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={submitInterview}
                  disabled={submitting || !allRequiredComplete}
                >
                  {submitting ? "Submitting…" : "Yes, submit interview"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmSubmit(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                onClick={() => setConfirmSubmit(true)}
                disabled={!allRequiredComplete}
              >
                Submit complete interview
              </Button>
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!question) return null;
  const completedCount = questions.filter((item) => item.status === "completed").length;
  const showingClipPlayback = clip && (phase === "preview" || phase === "uploading");
  const showMicOverlay = Boolean(
    stream && (phase === "preparing" || phase === "recording" || phase === "prompt"),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={`Question ${activeIndex + 1} of ${questions.length}`}
        description={`${completedCount} of ${questions.length} responses uploaded`}
      />
      <ProgressBar value={(completedCount / questions.length) * 100} />
      {sessionNotice ? <Alert tone="warn">{sessionNotice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {interruptedNotice ? (
        <Alert tone="warn" title="Your last recording was interrupted">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            The response time limit passed while you were away, so this attempt could not be
            saved.
            {canRecordAgainAfterInterruption
              ? " Press Record your response below to try again."
              : " You have used all attempts for this question."}
          </span>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
        <Card className="overflow-hidden">
          <div className="relative aspect-video w-full bg-black">
            {showingClipPlayback ? (
              <RecordingPlayback
                src={clip!.url}
                durationSeconds={clip!.durationSeconds}
                className="absolute inset-0 h-full w-full"
                aria-label="Recorded response preview"
              />
            ) : (
              <video
                ref={livePreviewRef}
                autoPlay
                muted
                playsInline
                className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
                aria-label="Live camera preview"
              />
            )}

            {showMicOverlay ? (
              <div className="absolute bottom-3 left-3 z-10">
                <MicLevelMeter sample={micSample} compact />
              </div>
            ) : null}

            {phase === "preparing" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-center text-white">
                <p className="text-xs font-semibold uppercase tracking-widest text-white/70">
                  Get ready
                </p>
                <p className="mt-2 text-7xl font-bold tabular-nums">{Math.ceil(prepRemaining)}</p>
                <p className="mt-2 text-sm text-white/70">Recording starts automatically</p>
              </div>
            ) : null}

            {phase === "recording" ? (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                Recording {formatClock(recordingRemaining)}
              </div>
            ) : null}

            {phase === "registering" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm font-medium text-white">
                Saving your response…
              </div>
            ) : null}
          </div>

          <CardBody className="space-y-3 border-t border-surface-border">
            {phase === "prompt" && !interruptedNotice ? (
              <p className="text-sm text-ink-muted">Preparing your next question…</p>
            ) : null}
            {phase === "prompt" && interruptedNotice ? (
              <div className="flex flex-wrap gap-2">
                {canRecordAgainAfterInterruption ? (
                  <Button type="button" onClick={recordAgainAfterInterruption}>
                    <Play className="h-4 w-4" aria-hidden />
                    Record your response
                  </Button>
                ) : null}
              </div>
            ) : null}
            {phase === "preparing" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => void beginRecordingRef.current()}>
                  <Play className="h-4 w-4" aria-hidden />
                  Start recording early
                </Button>
                {!question.is_required ? (
                  <Button type="button" variant="ghost" onClick={skipOptionalQuestion}>
                    <SkipForward className="h-4 w-4" aria-hidden />
                    Skip optional question
                  </Button>
                ) : null}
              </div>
            ) : null}
            {phase === "recording" ? (
              <Button type="button" variant="danger" onClick={() => recorderRef.current?.stop()}>
                <Square className="h-4 w-4" aria-hidden />
                Stop recording
              </Button>
            ) : null}
            {phase === "registering" ? (
              <p className="text-sm text-ink-muted">Saving attempt details…</p>
            ) : null}
            {phase === "preview" ? (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted">
                  {allowReview
                    ? "Review this recording. Uploading it will select this attempt and complete the question."
                    : "Review is disabled for this interview. Uploading your response…"}
                </p>
                {clip ? (
                  <p className="text-xs text-ink-subtle">
                    Recorded duration {formatClock(clip.durationSeconds)} (starts at 0:00)
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void uploadAndComplete()}
                    disabled={!registeredAttempt}
                  >
                    <Upload className="h-4 w-4" aria-hidden />
                    {attempts.find((item) => item.id === registeredAttempt?.id)?.upload_status ===
                    "failed"
                      ? "Retry upload"
                      : "Use this response"}
                  </Button>
                  {allowReview ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={retryRecording}
                      disabled={attemptsLeft <= 0}
                    >
                      Record another attempt ({attemptsLeft} left)
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {phase === "uploading" ? (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-ink-muted">
                  <span>Uploading response…</span>
                  <span>{Math.round(uploadProgress * 100)}%</span>
                </div>
                <ProgressBar value={uploadProgress * 100} />
                <p className="text-xs text-ink-subtle">
                  Keep this page open. If the upload fails, you can retry without recording again.
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Question {activeIndex + 1}</CardTitle>
              {question.is_required ? <Badge tone="brand">Required</Badge> : null}
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-lg font-semibold leading-relaxed text-ink">
                {question.question_text_snapshot}
              </p>
              {question.question_description_snapshot ? (
                <p className="text-sm text-ink-muted">{question.question_description_snapshot}</p>
              ) : null}
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-3 text-sm">
                <div>
                  <p className="text-xs text-ink-subtle">Preparation</p>
                  <p className="font-medium text-ink">{formatClock(question.preparation_seconds)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-subtle">Response limit</p>
                  <p className="font-medium text-ink">{formatClock(question.response_seconds)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-subtle">Attempts used</p>
                  <p className="font-medium text-ink">
                    {questionAttempts.length} of {question.max_attempts}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-subtle">Retries remaining</p>
                  <p className="font-medium text-ink">{attemptsLeft}</p>
                </div>
              </div>
              {allowPause ? (
                <p className="flex items-center gap-2 text-xs text-ink-subtle">
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                  Controlled breaks between questions are enabled for this interview.
                </p>
              ) : null}
            </CardBody>
          </Card>
          <LockedDocumentsPanel
            documents={lockedDocuments}
            lockedAt={assignment.documents_locked_at}
          />
        </div>
      </div>
    </div>
  );
}
