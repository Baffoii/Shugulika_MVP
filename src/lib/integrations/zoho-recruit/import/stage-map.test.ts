import { describe, it, expect } from "vitest";
import {
  mapZohoStatusToStage,
  normaliseZohoStatus,
  knownZohoStatuses,
} from "@/lib/integrations/zoho-recruit/import/stage-map";

describe("normaliseZohoStatus", () => {
  it("folds the casing and separator variants Zoho installs differ on", () => {
    for (const raw of ["Submitted-to-Client", "submitted_to_client", "  SUBMITTED TO CLIENT  "]) {
      expect(normaliseZohoStatus(raw)).toBe("submitted to client");
    }
  });

  it("treats null, undefined and blank as empty rather than throwing", () => {
    expect(normaliseZohoStatus(null)).toBe("");
    expect(normaliseZohoStatus(undefined)).toBe("");
    expect(normaliseZohoStatus("   ")).toBe("");
  });
});

describe("mapZohoStatusToStage", () => {
  it("maps the ordinary progression onto real pipeline stages", () => {
    expect(mapZohoStatusToStage("Qualified").stage).toBe("cv_review");
    expect(mapZohoStatusToStage("Interview Scheduled").stage).toBe("interview_screening");
    expect(mapZohoStatusToStage("Interviewed").stage).toBe("interview_review");
    expect(mapZohoStatusToStage("Submitted to Client").stage).toBe("client_submission");
    expect(mapZohoStatusToStage("Offer Made").stage).toBe("offer");
  });

  it("marks Hired terminal", () => {
    const hired = mapZohoStatusToStage("Hired");
    expect(hired.stage).toBe("hired");
    expect(hired.isTerminal).toBe(true);
  });

  it("routes every rejection shape to `rejected` and records where it happened", () => {
    const byClient = mapZohoStatusToStage("Rejected-by-Client");
    expect(byClient.stage).toBe("rejected");
    expect(byClient.isTerminal).toBe(true);
    expect(byClient.rejectedFromStage).toBe("client_submission");

    const declined = mapZohoStatusToStage("Offer Declined");
    expect(declined.stage).toBe("rejected");
    expect(declined.rejectedFromStage).toBe("offer");

    // A plain rejection has no richer origin than CV review.
    expect(mapZohoStatusToStage("Rejected").rejectedFromStage).toBe("cv_review");
  });

  it("carries On Hold as a flag rather than losing it", () => {
    const held = mapZohoStatusToStage("On Hold");
    expect(held.stage).toBe("zoho_on_hold");
    expect(held.isOnHold).toBe(true);
    expect(held.isTerminal).toBe(false);
  });

  it("never invents progress for pre-screening statuses", () => {
    // These must NOT be promoted into cv_review — Zoho had not evaluated them.
    expect(mapZohoStatusToStage("New").stage).toBe("zoho_new");
    expect(mapZohoStatusToStage("Waiting for Evaluation").stage).toBe("zoho_waiting_evaluation");
    expect(mapZohoStatusToStage("Attempted to Contact").stage).toBe("zoho_contacted");
  });

  it("flags an unrecognised status instead of flattening it into cv_review", () => {
    const unknown = mapZohoStatusToStage("Bespoke Client Status 47");
    expect(unknown.stage).toBe("zoho_unmapped");
    expect(unknown.isUnmapped).toBe(true);
  });

  it("treats a missing status as unmapped, not as a new application", () => {
    for (const empty of [null, undefined, ""]) {
      const result = mapZohoStatusToStage(empty);
      expect(result.stage).toBe("zoho_unmapped");
      expect(result.isUnmapped).toBe(true);
    }
  });

  it("only ever emits stages the migration registered", () => {
    // Guards against a typo'd key that would fail the pipeline_stages FK at
    // insert time, deep inside a long-running import.
    const allowed = new Set([
      "cv_review",
      "testing",
      "test_review",
      "interview_screening",
      "interview_review",
      "reference_checks",
      "client_submission",
      "offer",
      "hired",
      "rejected",
      "zoho_new",
      "zoho_waiting_evaluation",
      "zoho_contacted",
      "zoho_unqualified",
      "zoho_junk",
      "zoho_on_hold",
      "zoho_unmapped",
    ]);
    for (const status of knownZohoStatuses()) {
      const mapped = mapZohoStatusToStage(status);
      expect(allowed.has(mapped.stage), `${status} → ${mapped.stage}`).toBe(true);
      if (mapped.rejectedFromStage) {
        expect(allowed.has(mapped.rejectedFromStage), `${status} rejectedFrom`).toBe(true);
      }
    }
  });

  it("maps every known status to something other than unmapped", () => {
    const leaked = knownZohoStatuses().filter((s) => mapZohoStatusToStage(s).isUnmapped);
    expect(leaked, `known statuses falling through: ${leaked.join(", ")}`).toEqual([]);
  });
});
