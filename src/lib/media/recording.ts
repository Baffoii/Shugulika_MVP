/**
 * Browser media helpers for the async video interview (client-only).
 * Wraps getUserMedia + MediaRecorder with: capability detection, friendly
 * error classification, a preferred-MIME picker, 720p/bitrate constraints and
 * a max-duration auto-stop. No external services — browser APIs only.
 */
import { INTERVIEW_LIMITS } from "@/lib/constants";
import { fixRecordingDuration, resolveRecordingDurationSeconds } from "@/lib/media/webm-duration";

export type MediaErrorKind =
  | "insecure_context"
  | "unsupported_browser"
  | "permission_denied"
  | "no_camera"
  | "no_microphone"
  | "device_in_use"
  | "unknown";

export interface MediaCheckError {
  kind: MediaErrorKind;
  message: string;
}

/** Candidate-facing troubleshooting copy per failure class. */
export const MEDIA_ERROR_HELP: Record<MediaErrorKind, string> = {
  insecure_context:
    "Camera access needs a secure (https) connection. Open this page over https and try again.",
  unsupported_browser:
    "Your browser does not support in-browser video recording. Use a recent version of Chrome, Edge, Firefox, or Safari.",
  permission_denied:
    "Camera or microphone access was blocked. Click the camera icon in your browser's address bar, allow access, then press Retry.",
  no_camera: "No camera was found. Connect a camera (or use a device with one) and press Retry.",
  no_microphone: "No microphone was found. Connect a microphone and press Retry.",
  device_in_use:
    "Your camera appears to be in use by another app (for example a video call). Close it and press Retry.",
  unknown: "Something went wrong accessing your camera or microphone. Please try again.",
};

export function classifyMediaError(err: unknown): MediaCheckError {
  const name = err instanceof DOMException ? err.name : "";
  const kind: MediaErrorKind =
    name === "NotAllowedError" || name === "SecurityError"
      ? "permission_denied"
      : name === "NotFoundError" || name === "OverconstrainedError"
        ? "no_camera"
        : name === "NotReadableError" || name === "AbortError"
          ? "device_in_use"
          : "unknown";
  return { kind, message: MEDIA_ERROR_HELP[kind] };
}

/** Preflight support check. Returns null when the environment can record. */
export function checkRecordingSupport(): MediaCheckError | null {
  if (typeof window === "undefined") return null;
  if (!window.isSecureContext) {
    return { kind: "insecure_context", message: MEDIA_ERROR_HELP.insecure_context };
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === "undefined") {
    return { kind: "unsupported_browser", message: MEDIA_ERROR_HELP.unsupported_browser };
  }
  return null;
}

/**
 * Best browser-supported recording MIME type via MediaRecorder.isTypeSupported.
 * webm (vp9 → vp8) preferred for size; mp4 for Safari. Returns null when
 * nothing is supported (treated as unsupported browser).
 */
export function pickSupportedMimeType(): string | null {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return null;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // isTypeSupported can throw on some engines; keep trying.
    }
  }
  return null;
}

/** File extension matching the storage path convention (webm|mp4). */
export function extensionForMimeType(mimeType: string): "webm" | "mp4" {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

export interface StreamOptions {
  videoDeviceId?: string;
  audioDeviceId?: string;
}

/** Request a camera+mic stream at the MVP 720p target. */
export async function requestInterviewStream(opts: StreamOptions = {}): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: INTERVIEW_LIMITS.videoWidth },
      height: { ideal: INTERVIEW_LIMITS.videoHeight },
      ...(opts.videoDeviceId ? { deviceId: { exact: opts.videoDeviceId } } : {}),
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      ...(opts.audioDeviceId ? { deviceId: { exact: opts.audioDeviceId } } : {}),
    },
  });
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  startedAt: Date;
  endedAt: Date;
}

export interface RecorderHandle {
  /** Stop early. Resolves the same promise returned by start(). */
  stop: () => void;
  /** True while the recorder is active. */
  isActive: () => boolean;
}

/**
 * Record the given stream until stop() or maxDurationSeconds. Chunks are
 * gathered incrementally; the caller owns the resulting Blob (and should
 * revoke any object URL created from it after use).
 */
export function startRecording(
  stream: MediaStream,
  mimeType: string,
  maxDurationSeconds: number,
  onTick?: (elapsedSeconds: number) => void,
): { handle: RecorderHandle; result: Promise<RecordingResult> } {
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: INTERVIEW_LIMITS.videoBitsPerSecond,
    audioBitsPerSecond: INTERVIEW_LIMITS.audioBitsPerSecond,
  });
  const chunks: Blob[] = [];
  const startedAt = new Date();
  let stopped = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  const result = new Promise<RecordingResult>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error("Recording failed. Please try again."));
    };
    recorder.onstop = () => {
      cleanup();
      const endedAt = new Date();
      const durationSeconds = resolveRecordingDurationSeconds({
        durationSeconds: (endedAt.getTime() - startedAt.getTime()) / 1000,
        maxDurationSeconds,
        startedAt,
        endedAt,
      });
      const rawBlob = new Blob(chunks, { type: mimeType.split(";")[0] });
      // Repair WebM Duration metadata so native <video> controls show 0:00..actual
      // length instead of a guessed multi-minute duration.
      void fixRecordingDuration(rawBlob, durationSeconds).then((blob) => {
        resolve({
          blob,
          mimeType: mimeType.split(";")[0] ?? mimeType,
          durationSeconds,
          startedAt,
          endedAt,
        });
      });
    };
  });

  function cleanup() {
    if (tickTimer) clearInterval(tickTimer);
    if (maxTimer) clearTimeout(maxTimer);
    tickTimer = null;
    maxTimer = null;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (recorder.state !== "inactive") recorder.stop();
  }

  recorder.start(1000); // timeslice keeps memory bounded per chunk
  if (onTick) {
    tickTimer = setInterval(() => {
      onTick((Date.now() - startedAt.getTime()) / 1000);
    }, 250);
  }
  maxTimer = setTimeout(stop, maxDurationSeconds * 1000);

  return {
    handle: { stop, isActive: () => !stopped },
    result,
  };
}

export type MicLevelStatus = "disconnected" | "muted" | "too_quiet" | "normal" | "hot" | "clipping";

export interface MicLevelSample {
  /** Linear 0..1 RMS-derived level for the meter fill. */
  level: number;
  status: MicLevelStatus;
  /** Peak sample magnitude 0..1 for clipping detection. */
  peak: number;
}

/** Classify mic health from RMS level + peak. Green is the normal active state. */
export function classifyMicLevel(
  level: number,
  peak: number,
  opts?: { muted?: boolean; connected?: boolean },
): MicLevelStatus {
  if (opts?.connected === false) return "disconnected";
  if (opts?.muted) return "muted";
  if (peak >= 0.98 || level >= 0.95) return "clipping";
  if (level >= 0.78) return "hot";
  if (level < 0.04) return "too_quiet";
  return "normal";
}

/**
 * Zoom-style microphone activity meter. Returns a stop function; onSample
 * receives level + status roughly every animation frame.
 */
export function startMicLevelMeter(
  stream: MediaStream,
  onSample: (sample: MicLevelSample) => void,
): () => void {
  type AudioContextCtor = typeof AudioContext;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) {
    onSample({ level: 0, peak: 0, status: "disconnected" });
    return () => {};
  }
  const audioTracks = stream.getAudioTracks();
  const ctx = new Ctor();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.35;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let raf = 0;
  let stopped = false;
  const loop = () => {
    if (stopped) return;
    const track = audioTracks[0];
    const connected = Boolean(track && track.readyState === "live");
    const muted = Boolean(track && (track.muted || !track.enabled));
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    let peak = 0;
    for (const v of data) {
      const centered = (v - 128) / 128;
      const abs = Math.abs(centered);
      if (abs > peak) peak = abs;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / data.length);
    // Scale so conversational speech lands in the green mid-range (~0.25–0.7).
    const level = Math.min(1, rms * 4.2);
    onSample({
      level,
      peak,
      status: classifyMicLevel(level, peak, { muted, connected }),
    });
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    source.disconnect();
    void ctx.close();
  };
}

/** List available cameras/microphones (labels appear after permission). */
export async function listMediaDevices(): Promise<{
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
}> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((d) => d.kind === "videoinput"),
    microphones: devices.filter((d) => d.kind === "audioinput"),
  };
}
