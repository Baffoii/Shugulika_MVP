import { describe, it, expect } from "vitest";
import {
  advanceStage,
  canAdvance,
  canWriteCanonicalRecords,
  emptyTotals,
  ImportStageError,
  nextStage,
  REVIEW_GATE_STAGE,
  STAGE_ORDER,
  stageIndex,
} from "@/lib/integrations/zoho-recruit/import/stages";
import { buildImportGateStatus } from "@/lib/integrations/zoho-recruit/import/gates";

describe("stage order", () => {
  it("runs inventory → … → report", () => {
    expect(STAGE_ORDER).toEqual([
      "inventory",
      "map",
      "dry_run",
      "quarantine",
      "match",
      "human_review",
      "canonical_upsert",
      "reconcile",
      "report",
    ]);
  });

  it("puts human review before anything is written", () => {
    expect(stageIndex(REVIEW_GATE_STAGE)).toBeLessThan(stageIndex("canonical_upsert"));
  });

  it("ends after report", () => {
    expect(nextStage("report")).toBeNull();
  });
});

describe("advanceStage", () => {
  it("moves forward one stage and records the transition", () => {
    const result = advanceStage("inventory", "map", "2026-08-05T00:00:00.000Z", [], "42 records");
    expect(result.stage).toBe("map");
    expect(result.history).toEqual([
      { stage: "map", at: "2026-08-05T00:00:00.000Z", note: "42 records" },
    ]);
  });

  it("refuses to skip a stage", () => {
    expect(() => advanceStage("inventory", "canonical_upsert", "now")).toThrow(ImportStageError);
    expect(canAdvance("inventory", "canonical_upsert")).toBe(false);
  });

  it("refuses to go backwards", () => {
    expect(() => advanceStage("match", "map", "now")).toThrow(ImportStageError);
  });

  it("refuses to stay put", () => {
    expect(() => advanceStage("map", "map", "now")).toThrow(ImportStageError);
  });

  it("appends rather than replacing history", () => {
    const first = advanceStage("inventory", "map", "t1");
    const second = advanceStage("map", "dry_run", "t2", first.history);
    expect(second.history.map((h) => h.stage)).toEqual(["map", "dry_run"]);
  });
});

describe("canWriteCanonicalRecords", () => {
  const totals = emptyTotals();

  it("refuses on a dry-run batch", () => {
    const result = canWriteCanonicalRecords({
      stage: "canonical_upsert",
      isDryRun: true,
      totals,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("batch is a dry run");
  });

  it("refuses before human review", () => {
    const result = canWriteCanonicalRecords({ stage: "match", isDryRun: false, totals });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("human_review");
  });

  it("refuses while anything is still awaiting a person", () => {
    const result = canWriteCanonicalRecords({
      stage: "canonical_upsert",
      isDryRun: false,
      totals: { ...totals, needsReview: 3 },
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("3 record(s) still need human review");
  });

  it("allows only when every condition holds", () => {
    const result = canWriteCanonicalRecords({
      stage: "canonical_upsert",
      isDryRun: false,
      totals,
    });
    expect(result).toEqual({ allowed: true, reasons: [] });
  });
});

describe("import gates", () => {
  it("default to off when no flag is set", () => {
    const gates = buildImportGateStatus({}, false);
    expect(gates.enabled).toBe(false);
    expect(gates.stagingAllowed).toBe(false);
    expect(gates.canonicalWriteAllowed).toBe(false);
  });

  it("allow staging without allowing a canonical write", () => {
    const gates = buildImportGateStatus({ zoho_candidate_import_enabled: true }, true);
    expect(gates.stagingAllowed).toBe(true);
    expect(gates.canonicalWriteAllowed).toBe(false);
    expect(gates.blockedReasons).toContain("zoho_candidate_import_write_enabled is off");
  });

  it("still refuse a canonical write when the master Zoho gate is off", () => {
    const gates = buildImportGateStatus(
      { zoho_candidate_import_enabled: true, zoho_candidate_import_write_enabled: true },
      false,
    );
    expect(gates.canonicalWriteAllowed).toBe(false);
  });

  it("allow a canonical write only with all three", () => {
    const gates = buildImportGateStatus(
      { zoho_candidate_import_enabled: true, zoho_candidate_import_write_enabled: true },
      true,
    );
    expect(gates.canonicalWriteAllowed).toBe(true);
    expect(gates.blockedReasons).toEqual([]);
  });
});
