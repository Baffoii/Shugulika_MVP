/**
 * The acceptance criterion this file exists for: a value the candidate has
 * confirmed is never overwritten by a lower-confidence re-parse. The database
 * trigger in 20260809090000 enforces the same rule; these tests cover the
 * decision logic that keeps callers from ever reaching it.
 */
import { describe, it, expect } from "vitest";
import {
  CONFIDENCE_REVIEW_THRESHOLD,
  confirmedProvenance,
  decideProvenanceWrite,
  extractedProvenance,
  parserVersion,
  planProvenanceWrites,
  provenanceKey,
  suggestionIsRedundant,
  summarizeProvenance,
  type ProvenanceRecord,
} from "@/lib/candidates/provenance";

const CANDIDATE = "cand-1";

function extracted(over: Partial<ProvenanceRecord> = {}): ProvenanceRecord {
  return {
    ...extractedProvenance({
      candidateId: CANDIDATE,
      targetEntity: "profile",
      targetEntityId: null,
      fieldPath: "family_name",
      valueText: "Mwakalinga",
      confidence: 0.9,
      parserVersion: "openai:gpt-4.1-mini",
      parseRunId: "run-1",
      evidenceText: "Asha Mwakalinga",
      extractedAt: "2026-08-01T00:00:00.000Z",
    }),
    ...over,
  };
}

function confirmed(over: Partial<ProvenanceRecord> = {}): ProvenanceRecord {
  return {
    ...confirmedProvenance({
      candidateId: CANDIDATE,
      targetEntity: "profile",
      targetEntityId: null,
      fieldPath: "family_name",
      valueText: "Mwakalinga",
      confirmedBy: "user-1",
      confirmedAt: "2026-08-02T00:00:00.000Z",
    }),
    ...over,
  };
}

describe("decideProvenanceWrite", () => {
  it("writes when nothing is on file", () => {
    expect(decideProvenanceWrite(null, extracted()).outcome).toBe("write");
  });

  it("refuses to overwrite a candidate-confirmed value with a lower-confidence re-parse", () => {
    const decision = decideProvenanceWrite(
      confirmed(),
      extracted({ valueText: "Mwakalynga", confidence: 0.4 }),
    );
    expect(decision).toMatchObject({ outcome: "skip", reason: "human_established" });
    if (decision.outcome === "skip") expect(decision.keeps.valueText).toBe("Mwakalinga");
  });

  it("refuses even when the re-parse claims perfect confidence", () => {
    const decision = decideProvenanceWrite(
      confirmed(),
      extracted({ valueText: "Something Else", confidence: 1 }),
    );
    expect(decision).toMatchObject({ outcome: "skip", reason: "human_established" });
  });

  it("refuses a Zoho import over a confirmed value too", () => {
    const decision = decideProvenanceWrite(
      confirmed(),
      extracted({ source: "zoho_import", valueText: "Zoho Value", confidence: 0.95 }),
    );
    expect(decision).toMatchObject({ outcome: "skip", reason: "human_established" });
  });

  it("protects a recruiter correction from machine overwrite", () => {
    const recruiterValue: ProvenanceRecord = {
      ...confirmed(),
      source: "recruiter_entry",
      confirmedBy: "staff-1",
    };
    expect(decideProvenanceWrite(recruiterValue, extracted({ confidence: 1 }))).toMatchObject({
      outcome: "skip",
      reason: "human_established",
    });
  });

  it("lets a human decision replace an earlier human decision", () => {
    const decision = decideProvenanceWrite(
      confirmed(),
      confirmed({ valueText: "Mwakalinga-Juma" }),
    );
    expect(decision.outcome).toBe("write");
  });

  it("lets a human decision replace a machine extraction", () => {
    expect(decideProvenanceWrite(extracted(), confirmed({ valueText: "Corrected" })).outcome).toBe(
      "write",
    );
  });

  it("rejects a lower-confidence machine value over a higher-confidence one", () => {
    const decision = decideProvenanceWrite(
      extracted({ confidence: 0.9 }),
      extracted({ valueText: "Mwakalynga", confidence: 0.5 }),
    );
    expect(decision).toMatchObject({ outcome: "skip", reason: "lower_confidence" });
  });

  it("accepts an equally or more confident machine re-extraction", () => {
    expect(
      decideProvenanceWrite(
        extracted({ confidence: 0.7 }),
        extracted({ valueText: "Mwakalinga Juma", confidence: 0.7 }),
      ).outcome,
    ).toBe("write");
    expect(
      decideProvenanceWrite(
        extracted({ confidence: 0.7 }),
        extracted({ valueText: "Mwakalinga Juma", confidence: 0.95 }),
      ).outcome,
    ).toBe("write");
  });

  it("never writes an empty value over anything", () => {
    expect(decideProvenanceWrite(extracted(), extracted({ valueText: "  " }))).toMatchObject({
      outcome: "skip",
      reason: "empty_value",
    });
    expect(decideProvenanceWrite(null, extracted({ valueText: null }))).toMatchObject({
      outcome: "skip",
      reason: "empty_value",
    });
  });

  it("skips an unchanged value from the same source", () => {
    expect(decideProvenanceWrite(extracted(), extracted())).toMatchObject({
      outcome: "skip",
      reason: "unchanged",
    });
  });
});

describe("planProvenanceWrites", () => {
  it("separates the accepted writes from the held-back ones with reasons", () => {
    const existing = [
      confirmed({ fieldPath: "family_name" }),
      extracted({ fieldPath: "headline", confidence: 0.9, valueText: "Accountant" }),
    ];
    const incoming = [
      extracted({ fieldPath: "family_name", valueText: "Wrong", confidence: 0.99 }),
      extracted({ fieldPath: "headline", valueText: "Junior Accountant", confidence: 0.3 }),
      extracted({ fieldPath: "city", valueText: "Dodoma", confidence: 0.8 }),
    ];

    const { writes, skipped } = planProvenanceWrites(existing, incoming);
    expect(writes.map((w) => w.fieldPath)).toEqual(["city"]);
    expect(skipped.map((s) => [s.record.fieldPath, s.reason])).toEqual([
      ["family_name", "human_established"],
      ["headline", "lower_confidence"],
    ]);
  });

  it("compares a later value in the batch against the one just accepted", () => {
    const incoming = [
      extracted({ fieldPath: "city", valueText: "Dodoma", confidence: 0.9 }),
      extracted({ fieldPath: "city", valueText: "Dar", confidence: 0.2 }),
    ];
    const { writes, skipped } = planProvenanceWrites([], incoming);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.valueText).toBe("Dodoma");
    expect(skipped[0]?.reason).toBe("lower_confidence");
  });

  it("is a no-op on empty input", () => {
    expect(planProvenanceWrites([], [])).toEqual({ writes: [], skipped: [] });
  });
});

describe("provenanceKey", () => {
  it("distinguishes profile fields from collection-row fields", () => {
    expect(
      provenanceKey({ targetEntity: "profile", targetEntityId: null, fieldPath: "city" }),
    ).toBe("profile:-:city");
    expect(
      provenanceKey({ targetEntity: "experience", targetEntityId: "exp-1", fieldPath: "title" }),
    ).toBe("experience:exp-1:title");
  });
});

describe("suggestionIsRedundant", () => {
  it("is true when the candidate already confirmed that exact value", () => {
    expect(suggestionIsRedundant(confirmed(), "  mwakalinga ")).toBe(true);
  });

  it("is false when the value differs, so the candidate still gets to choose", () => {
    expect(suggestionIsRedundant(confirmed(), "Mwakalinga Juma")).toBe(false);
  });

  it("is false when the value on file is only machine-extracted", () => {
    expect(suggestionIsRedundant(extracted(), "Mwakalinga")).toBe(false);
  });

  it("is false when nothing is on file", () => {
    expect(suggestionIsRedundant(null, "Anything")).toBe(false);
  });
});

describe("parserVersion", () => {
  it("names the model so a re-parse after a model change is visibly different", () => {
    expect(parserVersion({ usingAi: true, model: "gpt-4.1-mini" })).toBe("openai:gpt-4.1-mini");
    expect(parserVersion({ usingAi: true, model: null })).toBe("openai");
    expect(parserVersion({ usingAi: false })).toBe("rule-based-v1");
  });
});

describe("summarizeProvenance", () => {
  it("reports confirmation rate and low-confidence coverage", () => {
    const summary = summarizeProvenance([
      confirmed({ fieldPath: "family_name" }),
      confirmed({ fieldPath: "given_name" }),
      extracted({ fieldPath: "city", confidence: 0.9 }),
      extracted({ fieldPath: "headline", confidence: 0.2 }),
    ]);
    expect(summary).toEqual({
      trackedFields: 4,
      confirmedFields: 2,
      machineFields: 2,
      confirmationRate: 0.5,
      lowConfidenceFields: 1,
    });
  });

  it("reports a null rate rather than a fake zero when nothing is tracked", () => {
    expect(summarizeProvenance([]).confirmationRate).toBeNull();
  });

  it("treats a missing confidence as low", () => {
    const summary = summarizeProvenance([extracted({ confidence: null })]);
    expect(summary.lowConfidenceFields).toBe(1);
    expect(CONFIDENCE_REVIEW_THRESHOLD).toBeGreaterThan(0);
  });
});
