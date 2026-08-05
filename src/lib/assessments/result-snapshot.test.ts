import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  permittedCandidatePayload,
  readCandidateResultSnapshot,
} from "@/lib/assessments/result-snapshot";

describe("candidate assessment result snapshots", () => {
  it("limits payloads by visibility tier and strips internal fields recursively", () => {
    const payload = {
      completion_status: "completed",
      score_percent: 82,
      result_band: "strong",
      summary: "Good command of the assessed skills.",
      mcq_score_percent: 90,
      grading_notes: "internal",
      detail: { recruiter_note: "private", permitted: "visible" },
    };

    expect(permittedCandidatePayload(payload, "candidate_limited")).toEqual({
      completion_status: "completed",
      score_percent: 82,
      result_band: "strong",
      summary: "Good command of the assessed skills.",
    });
    expect(permittedCandidatePayload(payload, "completion_only")).toEqual({
      completion_status: "completed",
    });
    expect(permittedCandidatePayload(payload, "candidate_full")).toEqual({
      completion_status: "completed",
      score_percent: 82,
      result_band: "strong",
      summary: "Good command of the assessed skills.",
      mcq_score_percent: 90,
      detail: { permitted: "visible" },
    });
  });

  it("reads the stored snapshot while the provider is offline", async () => {
    const providerFetch = vi.fn().mockRejectedValue(new Error("provider offline"));
    const assignmentChain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    assignmentChain.select.mockReturnValue(assignmentChain);
    assignmentChain.eq.mockReturnValue(assignmentChain);
    assignmentChain.maybeSingle.mockResolvedValue({ data: { id: "a1", candidate_id: "c1" } });
    const snapshotChain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    snapshotChain.select.mockReturnValue(snapshotChain);
    snapshotChain.eq.mockReturnValue(snapshotChain);
    snapshotChain.maybeSingle.mockResolvedValue({
      data: {
        assignment_id: "a1",
        provider: "offline-provider",
        permitted_payload: { completion_status: "completed", result_band: "ready" },
        visibility_tier: "candidate_limited",
        captured_at: "2026-08-04T00:00:00Z",
      },
    });
    const client = {
      from: vi.fn((table: string) =>
        table === "assessment_assignments" ? assignmentChain : snapshotChain,
      ),
    } as unknown as SupabaseClient;

    const result = await readCandidateResultSnapshot(client, "c1", "a1");

    expect(result?.permitted_payload).toEqual({
      completion_status: "completed",
      result_band: "ready",
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
