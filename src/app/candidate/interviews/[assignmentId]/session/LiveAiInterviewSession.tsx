"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/ui/primitives";
import { MicLevelMeter } from "@/components/interviews/MicLevelMeter";
import {
  attachLiveSessionAudioAction,
  completeLiveAiInterviewAction,
  liveInterviewToolAction,
  markLiveSessionLiveAction,
  startLiveAiSessionAction,
} from "@/app/recruiter/ai-interview-actions";
import {
  checkRecordingSupport,
  pickSupportedMimeType,
  startMicLevelMeter,
  startRecording,
  stopStream,
  type MicLevelSample,
  type RecorderHandle,
} from "@/lib/media/recording";
import { createClient } from "@/lib/supabase/client";
import type { InterviewAssignmentQuestionRow, InterviewAssignmentRow } from "@/lib/database.types";
import {
  AI_INTERVIEW_INSTRUCTIONS_VERSION,
  AI_INTERVIEW_PRIVACY_NOTICE_VERSION,
} from "@/lib/interviews/ai-interview-constants";

type Props = {
  assignment: InterviewAssignmentRow;
  questions: InterviewAssignmentQuestionRow[];
  jobTitle: string;
};

function formatTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LiveAiInterviewSession({ assignment, questions, jobTitle }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<"disclosure" | "device" | "live" | "ending" | "done">(
    assignment.consented_at ? "device" : "disclosure",
  );
  const [consentChecked, setConsentChecked] = useState(Boolean(assignment.consented_at));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Idle");
  const [remaining, setRemaining] = useState(assignment.duration_seconds ?? 600);
  const [micLevel, setMicLevel] = useState<MicLevelSample | null>(null);
  const [pending, startTransition] = useTransition();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const recorderHandleRef = useRef<RecorderHandle | null>(null);
  const recordingResultRef = useRef<Promise<{ blob: Blob; mimeType: string }> | null>(null);
  const meterStopRef = useRef<(() => void) | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttempts = useRef(0);
  const finishingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const completedQuestionIdsRef = useRef(
    new Set(questions.filter((q) => q.status === "completed").map((q) => q.id)),
  );

  const duration = assignment.duration_seconds ?? 600;

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    meterStopRef.current?.();
    meterStopRef.current = null;
    try {
      recorderHandleRef.current?.stop();
    } catch {
      /* ignore */
    }
    recorderHandleRef.current = null;
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    if (localStreamRef.current) stopStream(localStreamRef.current);
    localStreamRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  async function giveConsent() {
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("interview_assignments")
      .update({
        consented_at: new Date().toISOString(),
        privacy_notice_version: AI_INTERVIEW_PRIVACY_NOTICE_VERSION,
        instructions_version: AI_INTERVIEW_INSTRUCTIONS_VERSION,
        status: assignment.status === "invited" ? "in_progress" : assignment.status,
        started_at: assignment.started_at ?? new Date().toISOString(),
      })
      .eq("id", assignment.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await supabase.from("interview_events").insert({
      assignment_id: assignment.id,
      event_type: "consent_given",
      metadata: { mode: "live_ai_voice" },
    });
    setPhase("device");
  }

  async function getMicStream(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  }

  async function testDevices() {
    setError(null);
    const supportError = checkRecordingSupport();
    if (supportError) {
      setError(supportError.message);
      return;
    }
    try {
      const stream = await getMicStream();
      localStreamRef.current = stream;
      meterStopRef.current = startMicLevelMeter(stream, setMicLevel);
      setStatus("Microphone OK — ready to start");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not access microphone.");
    }
  }

  function resolveLocalQuestionId(args: Record<string, unknown>): string | null {
    const ordered = [...questions].sort((a, b) => a.display_order - b.display_order);
    const orderRaw = args.question_order ?? args.order ?? args.question_number;
    if (typeof orderRaw === "number" && Number.isFinite(orderRaw)) {
      return ordered[Math.trunc(orderRaw) - 1]?.id ?? null;
    }
    if (typeof orderRaw === "string" && /^\d+$/.test(orderRaw.trim())) {
      return ordered[Number(orderRaw.trim()) - 1]?.id ?? null;
    }
    return null;
  }

  function ackToolCall(callId: string, output: Record<string, unknown>) {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output),
        },
      }),
    );
    dc.send(JSON.stringify({ type: "response.create" }));
  }

  async function handleToolCall(name: string, callId: string, argsJson: string) {
    const sid = sessionIdRef.current;
    if (!sid) return;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }

    if (name === "finish_interview") {
      const result = await liveInterviewToolAction({ sessionId: sid, tool: name, args });
      if (!result.ok) {
        setError(result.error ?? "Tool call failed");
      }
      await finishSession(
        (typeof args.completion_reason === "string" ? args.completion_reason : "completed") as
          "completed" | "time_limit" | "technical" | "candidate_left",
      );
      return;
    }

    const localQuestionId = resolveLocalQuestionId(args);
    if (name === "start_question" && localQuestionId) {
      setCurrentQuestion(localQuestionId);
    }
    if (name === "complete_question" && localQuestionId) {
      completedQuestionIdsRef.current.add(localQuestionId);
      const allDone = questions.every((q) => completedQuestionIdsRef.current.has(q.id));
      if (allDone) {
        window.setTimeout(() => {
          if (!finishingRef.current) void finishSession("completed");
        }, 12_000);
      }
    }

    // Unblock the model's next spoken turn — do not await DB for non-finish tools.
    ackToolCall(callId, {
      ok: true,
      error: null,
      question_id: localQuestionId,
    });

    void liveInterviewToolAction({ sessionId: sid, tool: name, args }).then((result) => {
      if (!result.ok) {
        setError(result.error ?? "Could not save interview progress (conversation continues).");
        return;
      }
      setError(null);
      if (name === "start_question" && result.id) {
        setCurrentQuestion(result.id);
      }
    });
  }

  async function connectWebRtc(clientSecret: string, liveSessionId: string) {
    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;

    pc.ontrack = (event) => {
      audioEl.srcObject = event.streams[0] ?? null;
    };

    let stream = localStreamRef.current;
    if (!stream) {
      stream = await getMicStream();
      localStreamRef.current = stream;
      meterStopRef.current = startMicLevelMeter(stream, setMicLevel);
    }
    for (const track of stream.getAudioTracks()) {
      pc.addTrack(track, stream);
    }

    const mime = pickSupportedMimeType() ?? "audio/webm";
    try {
      const { handle, result } = startRecording(stream, mime, duration + 30);
      recorderHandleRef.current = handle;
      recordingResultRef.current = result;
    } catch {
      /* optional */
    }

    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type?: string;
          name?: string;
          call_id?: string;
          arguments?: string;
        };
        if (msg.type === "response.function_call_arguments.done" && msg.name && msg.call_id) {
          void handleToolCall(msg.name, msg.call_id, msg.arguments ?? "{}");
        }
      } catch {
        /* ignore */
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!sdpResponse.ok) {
      throw new Error("Could not connect to the live interviewer.");
    }
    const answer = await sdpResponse.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });

    await markLiveSessionLiveAction(liveSessionId);
    setStatus("Connected — interview in progress");
    setPhase("live");

    // Prompt the model to start
    setTimeout(() => {
      if (dc.readyState === "open") {
        dc.send(
          JSON.stringify({
            type: "response.create",
          }),
        );
      }
    }, 500);

    const started = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const left = Math.max(0, duration - elapsed);
      setRemaining(left);
      if (left <= 0) {
        void finishSession("time_limit");
      }
    }, 500);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        if (reconnectAttempts.current < 1) {
          reconnectAttempts.current += 1;
          setStatus("Connection lost — reconnecting once…");
          void restartConnection();
        } else {
          setError("Connection lost. Session marked incomplete.");
          void finishSession("technical");
        }
      }
    };
  }

  async function restartConnection() {
    if (timerRef.current) clearInterval(timerRef.current);
    dcRef.current?.close();
    pcRef.current?.close();
    const result = await startLiveAiSessionAction(assignment.id);
    if (!result.ok || !result.clientSecret || !result.sessionId) {
      setError(result.error ?? "Reconnect failed");
      return;
    }
    sessionIdRef.current = result.sessionId;
    setSessionId(result.sessionId);
    await connectWebRtc(result.clientSecret, result.sessionId);
  }

  async function beginLive() {
    setError(null);
    startTransition(async () => {
      const result = await startLiveAiSessionAction(assignment.id);
      if (!result.ok || !result.clientSecret || !result.sessionId) {
        setError(result.error ?? "Could not start live session");
        return;
      }
      sessionIdRef.current = result.sessionId;
      setSessionId(result.sessionId);
      try {
        await connectWebRtc(result.clientSecret, result.sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "WebRTC failed");
        cleanup();
      }
    });
  }

  async function finishSession(
    reason: "completed" | "time_limit" | "technical" | "candidate_left" = "completed",
  ) {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase("ending");
    setStatus("Ending interview…");
    setError(null);
    if (timerRef.current) clearInterval(timerRef.current);

    // Stop media first so the candidate hears the session end even if upload/submit is slow.
    try {
      dcRef.current?.close();
    } catch {
      /* ignore */
    }
    dcRef.current = null;
    try {
      pcRef.current?.close();
    } catch {
      /* ignore */
    }
    pcRef.current = null;

    const sid = sessionIdRef.current;
    if (sid) {
      await liveInterviewToolAction({
        sessionId: sid,
        tool: "finish_interview",
        args: { completion_reason: reason },
      });
    }

    try {
      recorderHandleRef.current?.stop();
      const recordingPromise = recordingResultRef.current;
      recorderHandleRef.current = null;
      const recording = recordingPromise
        ? await Promise.race([
            recordingPromise,
            new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 8_000)),
          ])
        : null;
      if (recording && sid) {
        const supabase = createClient();
        const path = `organization/${assignment.organization_id}/interviews/${assignment.id}/live/${sid}/candidate.webm`;
        const { error: uploadError } = await supabase.storage
          .from("interview-recordings")
          .upload(path, recording.blob, {
            contentType: recording.mimeType || "audio/webm",
            upsert: true,
          });
        if (!uploadError) {
          await attachLiveSessionAudioAction({
            sessionId: sid,
            storagePath: path,
            mimeType: recording.mimeType || "audio/webm",
          });
        }
      }
    } catch {
      /* non-fatal */
    }

    if (sid) {
      const result = await completeLiveAiInterviewAction(sid);
      if (!result.ok) {
        setError(result.error ?? "Could not submit interview");
        // Still leave the live UI — confirmation page will finalize if needed.
      }
    }

    cleanup();
    setPhase("done");
    setStatus("Interview submitted");
    router.replace(`/candidate/interviews/${assignment.id}`);
  }

  const activeQuestion = questions.find((q) => q.id === currentQuestion);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="AI voice interview"
        description={`${jobTitle} — live structured interview with a Shugulika AI interviewer.`}
      />

      {error ? (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {phase === "disclosure" ? (
        <Card>
          <CardHeader>
            <CardTitle>Before you begin</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4 text-sm text-ink">
            <ul className="list-disc space-y-2 pl-5 text-ink-muted">
              <li>The interviewer is an AI voice agent, not a human.</li>
              <li>Your microphone audio will be recorded for recruiter review.</li>
              <li>A transcript and AI-assisted evidence notes may be created afterward.</li>
              <li>
                A human recruiter makes every hiring-stage decision — the AI cannot advance or
                reject you.
              </li>
              <li>
                Privacy notice {AI_INTERVIEW_PRIVACY_NOTICE_VERSION}; recordings are retained for{" "}
                {assignment.retention_days} days.
              </li>
              <li>Session length is about {Math.round(duration / 60)} minutes.</li>
            </ul>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
              />
              <span>I understand and consent to recording for recruitment review.</span>
            </label>
            <Button disabled={!consentChecked} onClick={() => void giveConsent()}>
              Continue to device check
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {phase === "device" ? (
        <Card>
          <CardHeader>
            <CardTitle>Microphone check</CardTitle>
            <Badge tone="neutral">{questions.length} questions</Badge>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-ink-muted">
              Test your microphone, then start the live interview. The timer starts only after you
              connect. You can skip a question if needed — just say so. The interviewer may ask
              brief follow-ups.
            </p>
            <Button type="button" variant="outline" onClick={() => void testDevices()}>
              Test microphone
            </Button>
            {micLevel ? <MicLevelMeter sample={micLevel} /> : null}
            <p className="text-xs text-ink-subtle">{status}</p>
            <Button disabled={pending} onClick={() => void beginLive()}>
              {pending ? "Connecting…" : "Start AI voice interview"}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {phase === "live" || phase === "ending" ? (
        <Card>
          <CardHeader>
            <CardTitle>Live interview</CardTitle>
            <Badge tone={remaining < 60 ? "danger" : "brand"}>{formatTimer(remaining)}</Badge>
          </CardHeader>
          <CardBody className="space-y-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase text-ink-subtle">Role</dt>
                <dd>{jobTitle}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-ink-subtle">Status</dt>
                <dd>{status}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase text-ink-subtle">Current question</dt>
                <dd>{activeQuestion?.question_text_snapshot ?? "Waiting for interviewer…"}</dd>
              </div>
            </dl>
            {micLevel ? <MicLevelMeter sample={micLevel} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!sessionId}
                onClick={() =>
                  sessionId &&
                  void liveInterviewToolAction({
                    sessionId,
                    tool: "report_technical_issue",
                    args: { issue_type: "other" },
                  })
                }
              >
                Report issue
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={phase === "ending"}
                onClick={() => void finishSession("candidate_left")}
              >
                Leave interview
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {phase === "done" ? (
        <Card>
          <CardHeader>
            <CardTitle>Interview complete</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Alert tone="success">
              Your AI voice interview was submitted. A recruiter will review the recording and
              evidence before any pipeline decision.
            </Alert>
            <Button type="button" onClick={() => router.push("/candidate/interviews")}>
              Back to interviews
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
