import { describe, expect, it } from "vitest";
import type { InterviewResponseAttemptRow } from "@/lib/database.types";
import {
  attemptsUsed,
  averageAttemptDuration,
  expectedTotalSeconds,
  formatBytes,
  formatClock,
  formatDuration,
  remainingAttempts,
  requiredQuestionsComplete,
  retryCount,
  selectedAttempt,
  totalAttemptDuration,
  uploadFailureCount,
} from "@/lib/interview-analytics";

function attempt(
  overrides: Partial<InterviewResponseAttemptRow> = {},
): InterviewResponseAttemptRow {
  return {
    id: crypto.randomUUID(),
    assignment_question_id: "question-1",
    assignment_id: "assignment-1",
    candidate_id: "candidate-1",
    attempt_number: 1,
    storage_bucket: "interview-recordings",
    storage_path: "recording.webm",
    mime_type: "video/webm",
    file_size_bytes: null,
    duration_seconds: null,
    preparation_time_used_seconds: null,
    recording_started_at: null,
    recording_ended_at: null,
    uploaded_at: null,
    upload_status: "pending",
    is_selected_submission: false,
    discarded_at: null,
    client_metadata: {},
    created_at: "2026-07-17T12:00:00Z",
    ...overrides,
  };
}

describe("interview analytics formatting", () => {
  it.each([
    [-1, "0:00"],
    [0, "0:00"],
    [65.9, "1:05"],
    [3_605, "60:05"],
  ])("formats clock seconds %s as %s", (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected);
  });

  it.each([
    [null, "—"],
    [Number.NaN, "—"],
    [45.4, "45s"],
    [60, "1m"],
    [83, "1m 23s"],
    [3_600, "1h"],
    [3_720, "1h 2m"],
  ])("formats duration %s as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it.each([
    [null, "—"],
    [0, "—"],
    [512, "512 B"],
    [1_536, "2 KB"],
    [1_572_864, "1.5 MB"],
    [2_147_483_648, "2.00 GB"],
  ])("formats byte count %s as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("interview attempt metrics", () => {
  const attempts = [
    attempt(),
    attempt({
      attempt_number: 2,
      recording_started_at: "2026-07-17T12:00:00Z",
      duration_seconds: 20,
      upload_status: "failed",
    }),
    attempt({
      attempt_number: 3,
      duration_seconds: 40,
      upload_status: "uploaded",
      is_selected_submission: true,
    }),
  ];

  it("counts only attempts which started recording or left pending", () => {
    expect(attemptsUsed(attempts)).toBe(2);
    expect(retryCount(attempts)).toBe(1);
    expect(remainingAttempts(attempts, 5)).toBe(2);
    expect(remainingAttempts(attempts, 2)).toBe(0);
  });

  it("derives selected, duration, and failure metrics", () => {
    expect(selectedAttempt(attempts)?.attempt_number).toBe(3);
    expect(averageAttemptDuration(attempts)).toBe(30);
    expect(totalAttemptDuration(attempts)).toBe(60);
    expect(uploadFailureCount(attempts)).toBe(1);
    expect(averageAttemptDuration([attempt()])).toBeNull();
  });

  it("sums preparation and response limits", () => {
    expect(
      expectedTotalSeconds([
        { preparation_seconds: 30, response_seconds: 120 },
        { preparation_seconds: 15, response_seconds: 60 },
      ]),
    ).toBe(225);
  });
});

describe("required interview completion", () => {
  const required = { id: "required", is_required: true, status: "completed" as const };
  const optional = { id: "optional", is_required: false, status: "pending" as const };

  it("requires every required question to have a selected uploaded attempt", () => {
    const attempts = new Map([
      [required.id, [attempt({ upload_status: "uploaded", is_selected_submission: true })]],
    ]);
    expect(requiredQuestionsComplete([required, optional], attempts)).toBe(true);
  });

  it("rejects incomplete, unselected, or failed required responses", () => {
    expect(requiredQuestionsComplete([{ ...required, status: "in_progress" }], new Map())).toBe(
      false,
    );
    expect(
      requiredQuestionsComplete(
        [required],
        new Map([[required.id, [attempt({ upload_status: "uploaded" })]]]),
      ),
    ).toBe(false);
    expect(
      requiredQuestionsComplete(
        [required],
        new Map([
          [required.id, [attempt({ upload_status: "failed", is_selected_submission: true })]],
        ]),
      ),
    ).toBe(false);
  });

  it("treats an interview with no required questions as complete", () => {
    expect(requiredQuestionsComplete([optional], new Map())).toBe(true);
  });
});
