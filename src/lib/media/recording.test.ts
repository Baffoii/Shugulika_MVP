import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRecordingSupport,
  classifyMediaError,
  extensionForMimeType,
  listMediaDevices,
  pickSupportedMimeType,
  requestInterviewStream,
  startRecording,
  stopStream,
} from "@/lib/media/recording";

class MockMediaRecorder {
  static supported = new Set<string>();
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported = vi.fn((type: string) => MockMediaRecorder.supported.has(type));

  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["video"]) } as BlobEvent);
    this.onstop?.(new Event("stop"));
  });

  constructor(
    public readonly stream: MediaStream,
    public readonly options?: MediaRecorderOptions,
  ) {
    MockMediaRecorder.instances.push(this);
  }
}

function installRecorder() {
  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: MockMediaRecorder,
  });
}

function installMediaDevices(overrides: Partial<MediaDevices> = {}) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(),
      enumerateDevices: vi.fn().mockResolvedValue([]),
      ...overrides,
    },
  });
}

describe("recording capability and MIME selection", () => {
  beforeEach(() => {
    MockMediaRecorder.supported.clear();
    MockMediaRecorder.instances = [];
    MockMediaRecorder.isTypeSupported.mockClear();
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    installRecorder();
    installMediaDevices();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("prefers VP9 WebM, then falls back through the supported list", () => {
    MockMediaRecorder.supported.add("video/webm;codecs=vp9,opus");
    MockMediaRecorder.supported.add("video/mp4");
    expect(pickSupportedMimeType()).toBe("video/webm;codecs=vp9,opus");

    MockMediaRecorder.supported.delete("video/webm;codecs=vp9,opus");
    expect(pickSupportedMimeType()).toBe("video/mp4");
    MockMediaRecorder.supported.clear();
    expect(pickSupportedMimeType()).toBeNull();
  });

  it("continues when a browser throws during a MIME probe", () => {
    MockMediaRecorder.isTypeSupported
      .mockImplementationOnce(() => {
        throw new Error("bad codec query");
      })
      .mockImplementation((type) => type === "video/webm;codecs=vp8,opus");
    expect(pickSupportedMimeType()).toBe("video/webm;codecs=vp8,opus");
  });

  it("reports insecure and unsupported environments", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    expect(checkRecordingSupport()?.kind).toBe("insecure_context");

    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: undefined });
    expect(checkRecordingSupport()?.kind).toBe("unsupported_browser");

    installRecorder();
    expect(checkRecordingSupport()).toBeNull();
  });

  it.each([
    ["NotAllowedError", "permission_denied"],
    ["SecurityError", "permission_denied"],
    ["NotFoundError", "no_camera"],
    ["OverconstrainedError", "no_camera"],
    ["NotReadableError", "device_in_use"],
    ["AbortError", "device_in_use"],
    ["UnknownError", "unknown"],
  ] as const)("classifies %s as %s", (name, kind) => {
    expect(classifyMediaError(new DOMException("failed", name)).kind).toBe(kind);
  });

  it("maps MIME types to storage extensions", () => {
    expect(extensionForMimeType("video/mp4;codecs=avc1")).toBe("mp4");
    expect(extensionForMimeType("video/webm")).toBe("webm");
  });
});

describe("media device helpers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests 720p camera and audio processing with exact selected devices", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    installMediaDevices({ getUserMedia } as Partial<MediaDevices>);

    await expect(
      requestInterviewStream({ videoDeviceId: "camera-2", audioDeviceId: "mic-3" }),
    ).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        deviceId: { exact: "camera-2" },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        deviceId: { exact: "mic-3" },
      },
    });
  });

  it("stops every stream track and separates cameras from microphones", async () => {
    const stop = vi.fn();
    stopStream({ getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(() => stopStream(null)).not.toThrow();

    const devices = [
      { kind: "videoinput", deviceId: "cam" },
      { kind: "audioinput", deviceId: "mic" },
      { kind: "audiooutput", deviceId: "speaker" },
    ] as MediaDeviceInfo[];
    installMediaDevices({
      enumerateDevices: vi.fn().mockResolvedValue(devices),
    } as Partial<MediaDevices>);
    await expect(listMediaDevices()).resolves.toEqual({
      cameras: [devices[0]],
      microphones: [devices[1]],
    });
  });
});

describe("recording lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));
    MockMediaRecorder.instances = [];
    installRecorder();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts with bounded-memory timeslices, ticks, and auto-stops at the limit", async () => {
    const onTick = vi.fn();
    const { handle, result } = startRecording(
      {} as MediaStream,
      "video/webm;codecs=vp9",
      2,
      onTick,
    );
    const recorder = MockMediaRecorder.instances[0]!;

    expect(recorder.options).toMatchObject({
      mimeType: "video/webm;codecs=vp9",
      videoBitsPerSecond: 1_200_000,
      audioBitsPerSecond: 96_000,
    });
    expect(recorder.start).toHaveBeenCalledWith(1000);
    expect(handle.isActive()).toBe(true);

    await vi.advanceTimersByTimeAsync(2_000);
    const recording = await result;
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(handle.isActive()).toBe(false);
    expect(onTick).toHaveBeenCalled();
    expect(recording.mimeType).toBe("video/webm");
    expect(recording.blob.size).toBeGreaterThan(0);
    expect(recording.durationSeconds).toBe(2);
  });

  it("supports an early idempotent stop", async () => {
    const { handle, result } = startRecording({} as MediaStream, "video/mp4", 30);
    await vi.advanceTimersByTimeAsync(1_500);
    handle.stop();
    handle.stop();

    await expect(result).resolves.toMatchObject({ mimeType: "video/mp4", durationSeconds: 1.5 });
    expect(MockMediaRecorder.instances[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("rejects and clears timers when the recorder errors", async () => {
    const onTick = vi.fn();
    const { result } = startRecording({} as MediaStream, "video/webm", 30, onTick);
    MockMediaRecorder.instances[0]!.onerror?.(new Event("error"));
    await expect(result).rejects.toThrow("Recording failed");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(onTick).not.toHaveBeenCalled();
  });
});
