import { describe, it, expect } from "vitest";
import {
  PIPELINE_STAGES,
  CANDIDATE_STAGES,
  stageByKey,
  CANDIDATE_FACING_STATUS,
  allowedNextStages,
  APPLICATION_ENTRY_STAGE,
} from "@/lib/constants";

describe("pipeline stages", () => {
  it("starts applications in CV Review", () => {
    expect(APPLICATION_ENTRY_STAGE).toBe("cv_review");
  });

  it("exposes the simplified active candidate stages", () => {
    expect(CANDIDATE_STAGES.map((s) => s.key)).toEqual([
      "cv_review",
      "testing",
      "test_review",
      "interview_screening",
      "interview_review",
      "reference_checks",
      "client_submission",
      "offer",
      "hired",
    ]);
  });

  it("keeps Advertised, Invoiced, Closed as non-candidate milestones", () => {
    expect(stageByKey("advertised")?.stageClass).toBe("job");
    expect(stageByKey("invoiced")?.stageClass).toBe("accounts");
    expect(stageByKey("closed")?.stageClass).toBe("job");
    expect(CANDIDATE_STAGES.map((s) => s.key)).not.toContain("advertised");
    expect(CANDIDATE_STAGES.map((s) => s.key)).not.toContain("invoiced");
  });

  it("treats hired and rejected as terminal", () => {
    expect(stageByKey("hired")?.terminal).toBe(true);
    expect(stageByKey("rejected")?.terminal).toBe(true);
    expect(stageByKey("hired")?.gated).toBe("accepted_offer");
  });

  it("maps internal stages to simpler candidate-facing statuses", () => {
    expect(CANDIDATE_FACING_STATUS["cv_review"]).toBe("Resume under review");
    expect(CANDIDATE_FACING_STATUS["test_review"]).toBe("Assessment under review");
    expect(CANDIDATE_FACING_STATUS["interview_screening"]).toBe("Interview scheduled");
    expect(CANDIDATE_FACING_STATUS["client_submission"]).toBe("Submitted to employer");
    expect(CANDIDATE_FACING_STATUS["hired"]).toBe("Hired");
  });

  it("only allows forward moves and optional skips", () => {
    expect(allowedNextStages("cv_review").map((s) => s.key)).toEqual(["testing"]);
    expect(allowedNextStages("testing").map((s) => s.key)).toEqual(["client_submission"]);
    expect(allowedNextStages("test_review").map((s) => s.key)).toEqual([
      "interview_screening",
      "client_submission",
    ]);
    expect(allowedNextStages("interview_screening").map((s) => s.key)).toEqual([
      "client_submission",
    ]);
    expect(allowedNextStages("interview_review").map((s) => s.key)).toEqual([
      "reference_checks",
      "client_submission",
    ]);
    expect(allowedNextStages("rejected")).toEqual([]);
    expect(allowedNextStages("hired")).toEqual([]);
  });

  it("keeps active stage ordinals strictly increasing", () => {
    const active = PIPELINE_STAGES.filter((s) => !s.legacy);
    const ordinals = active.map((s) => s.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
  });
});
