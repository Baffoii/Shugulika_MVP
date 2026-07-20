import { describe, it, expect } from "vitest";
import {
  PIPELINE_STAGES,
  CANDIDATE_STAGES,
  stageByKey,
  CANDIDATE_FACING_STATUS,
} from "@/lib/constants";

describe("pipeline stages", () => {
  it("has all 15 Spine stages", () => {
    expect(PIPELINE_STAGES).toHaveLength(15);
  });

  it("keeps 12 candidate-application stages", () => {
    expect(CANDIDATE_STAGES).toHaveLength(12);
  });

  it("treats Advertised, Invoiced, Closed as job/accounts milestones, not candidate stages", () => {
    expect(stageByKey("advertised")?.stageClass).toBe("job");
    expect(stageByKey("invoiced")?.stageClass).toBe("accounts");
    expect(stageByKey("closed")?.stageClass).toBe("job");
    expect(CANDIDATE_STAGES.map((s) => s.key)).not.toContain("advertised");
    expect(CANDIDATE_STAGES.map((s) => s.key)).not.toContain("invoiced");
  });

  it("gates Shortlisted on a screening scorecard and Client Submission on consent", () => {
    expect(stageByKey("shortlisted")?.gated).toBe("screening_scorecard");
    expect(stageByKey("client_submission")?.gated).toBe("employer_consent");
    expect(stageByKey("hired")?.gated).toBe("accepted_offer");
  });

  it("maps internal stages to simpler candidate-facing statuses", () => {
    expect(CANDIDATE_FACING_STATUS["cv_screening"]).toBe("Resume under review");
    expect(CANDIDATE_FACING_STATUS["ai_interview_screening"]).toBe("Video interview stage");
    expect(CANDIDATE_FACING_STATUS["client_submission"]).toBe("Submitted to employer");
    expect(CANDIDATE_FACING_STATUS["hired"]).toBe("Hired");
  });

  it("stage ordinals are strictly increasing", () => {
    const ordinals = PIPELINE_STAGES.map((s) => s.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
  });
});
