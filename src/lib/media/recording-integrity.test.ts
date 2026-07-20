import { describe, expect, it } from "vitest";
import { fixRecordingDuration, resolveRecordingDurationSeconds } from "@/lib/media/webm-duration";
import { classifyMicLevel } from "@/lib/media/recording";
import { isUnusualInterruption } from "@/lib/interview-session";

describe("resolveRecordingDurationSeconds", () => {
  it("uses wall-clock start/end and ignores inflated client duration", () => {
    expect(
      resolveRecordingDurationSeconds({
        durationSeconds: 169,
        maxDurationSeconds: 120,
        startedAt: "2026-07-20T12:00:00.000Z",
        endedAt: "2026-07-20T12:00:30.000Z",
      }),
    ).toBe(30);
  });

  it("never includes preparation or idle time beyond the response cap", () => {
    expect(
      resolveRecordingDurationSeconds({
        durationSeconds: 45,
        maxDurationSeconds: 30,
        startedAt: new Date("2026-07-20T12:00:00Z"),
        endedAt: new Date("2026-07-20T12:00:45Z"),
      }),
    ).toBe(30);
  });

  it("falls back to the reported duration when timestamps are missing", () => {
    expect(
      resolveRecordingDurationSeconds({
        durationSeconds: 12.5,
        maxDurationSeconds: 120,
      }),
    ).toBe(12.5);
  });
});

describe("fixRecordingDuration", () => {
  it("leaves non-WebM blobs unchanged", async () => {
    const blob = new Blob(["mp4-bytes"], { type: "video/mp4" });
    await expect(fixRecordingDuration(blob, 30)).resolves.toBe(blob);
  });

  it("returns the original blob when WebM structure cannot be parsed", async () => {
    const blob = new Blob(["not-a-real-webm"], { type: "video/webm" });
    const fixed = await fixRecordingDuration(blob, 30);
    expect(fixed.type).toContain("webm");
    expect(fixed.size).toBe(blob.size);
    expect(fixed).toBe(blob);
  });
});

describe("classifyMicLevel", () => {
  it("uses green-range normal status rather than treating activity as a binary bar", () => {
    expect(classifyMicLevel(0.35, 0.4)).toBe("normal");
    expect(classifyMicLevel(0.02, 0.03)).toBe("too_quiet");
    expect(classifyMicLevel(0.85, 0.9)).toBe("hot");
    expect(classifyMicLevel(0.96, 0.99)).toBe("clipping");
    expect(classifyMicLevel(0.4, 0.4, { muted: true })).toBe("muted");
    expect(classifyMicLevel(0.4, 0.4, { connected: false })).toBe("disconnected");
  });
});

describe("session interruption classification", () => {
  it("flags recording-time leaves and repeated interruptions for recruiter review", () => {
    expect(
      isUnusualInterruption({
        interruptionCount: 1,
        duringRecording: true,
        reason: "visibility_hidden",
      }),
    ).toBe(true);
    expect(
      isUnusualInterruption({
        interruptionCount: 2,
        duringRecording: false,
        reason: "connection_lost",
      }),
    ).toBe(true);
    expect(
      isUnusualInterruption({
        interruptionCount: 0,
        duringRecording: false,
        reason: "accidental_reconnect",
      }),
    ).toBe(false);
  });
});
