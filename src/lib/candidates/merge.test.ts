/**
 * The acceptance criterion here: a merge requires an explicit human action and
 * writes a reversible audit. The planner refuses to produce a plan without a
 * named actor or with an undecided conflict, and every plan round-trips through
 * `buildRevertPlan` back to the original values.
 */
import { describe, it, expect } from "vitest";
import {
  buildMergeConflicts,
  buildMergePlan,
  buildRevertPlan,
  buildUncontestedFills,
  MergeNotPermittedError,
  MERGEABLE_PROFILE_FIELDS,
  type MergeableProfile,
  type MergeFieldDecision,
} from "@/lib/candidates/merge";
import {
  confirmedProvenance,
  extractedProvenance,
  type ProvenanceRecord,
} from "@/lib/candidates/provenance";

const PRIMARY_ID = "prim-1";
const DUPLICATE_ID = "dup-1";
const ACTOR = "hq-user-1";
const NOW = "2026-08-05T10:00:00.000Z";

const primary: MergeableProfile = {
  id: PRIMARY_ID,
  given_name: "Asha",
  family_name: "Mwakalinga",
  contact_email: "asha@example.com",
  city: "Dar es Salaam",
  headline: null,
};

const duplicate: MergeableProfile = {
  id: DUPLICATE_ID,
  given_name: "Asha",
  family_name: "Mwakalinga-Juma",
  contact_email: "asha@example.com",
  city: "Dodoma",
  headline: "Accountant",
};

function decision(fieldPath: string, winner: "primary" | "duplicate"): MergeFieldDecision {
  return {
    fieldPath: fieldPath as MergeFieldDecision["fieldPath"],
    winner,
    chosenBy: ACTOR,
  };
}

describe("buildMergeConflicts", () => {
  it("reports only fields where the two records genuinely disagree", () => {
    const conflicts = buildMergeConflicts(primary, duplicate);
    expect(conflicts.map((c) => c.fieldPath).sort()).toEqual(["city", "family_name"]);
  });

  it("does not treat a value only one side has as a conflict", () => {
    const conflicts = buildMergeConflicts(primary, duplicate);
    expect(conflicts.some((c) => c.fieldPath === "headline")).toBe(false);
    expect(buildUncontestedFills(primary, duplicate)).toEqual([
      { fieldPath: "headline", value: "Accountant" },
    ]);
  });

  it("ignores differences that are only formatting", () => {
    const conflicts = buildMergeConflicts(
      { id: PRIMARY_ID, city: "Dar es Salaam" },
      { id: DUPLICATE_ID, city: "  DAR ES SALAAM " },
    );
    expect(conflicts).toEqual([]);
  });

  it("recommends the human-confirmed side over the machine-extracted one", () => {
    const provenance: ProvenanceRecord[] = [
      confirmedProvenance({
        candidateId: DUPLICATE_ID,
        targetEntity: "profile",
        targetEntityId: null,
        fieldPath: "family_name",
        valueText: "Mwakalinga-Juma",
        confirmedBy: "cand-user",
        confirmedAt: NOW,
      }),
      extractedProvenance({
        candidateId: PRIMARY_ID,
        targetEntity: "profile",
        targetEntityId: null,
        fieldPath: "family_name",
        valueText: "Mwakalinga",
        confidence: 0.99,
        parserVersion: "openai:test",
        parseRunId: null,
        evidenceText: null,
        extractedAt: NOW,
      }),
    ];
    const conflict = buildMergeConflicts(primary, duplicate, provenance).find(
      (c) => c.fieldPath === "family_name",
    );
    expect(conflict).toMatchObject({
      recommended: "duplicate",
      recommendationReason: "human_confirmed",
    });
  });

  it("falls back to the more confident machine value", () => {
    const provenance: ProvenanceRecord[] = [
      extractedProvenance({
        candidateId: PRIMARY_ID,
        targetEntity: "profile",
        targetEntityId: null,
        fieldPath: "city",
        valueText: "Dar es Salaam",
        confidence: 0.4,
        parserVersion: "openai:test",
        parseRunId: null,
        evidenceText: null,
        extractedAt: NOW,
      }),
      extractedProvenance({
        candidateId: DUPLICATE_ID,
        targetEntity: "profile",
        targetEntityId: null,
        fieldPath: "city",
        valueText: "Dodoma",
        confidence: 0.9,
        parserVersion: "openai:test",
        parseRunId: null,
        evidenceText: null,
        extractedAt: NOW,
      }),
    ];
    const conflict = buildMergeConflicts(primary, duplicate, provenance).find(
      (c) => c.fieldPath === "city",
    );
    expect(conflict).toMatchObject({
      recommended: "duplicate",
      recommendationReason: "higher_confidence",
    });
  });

  it("recommendations are advisory — nothing in the conflict decides the merge", () => {
    for (const conflict of buildMergeConflicts(primary, duplicate)) {
      expect(conflict).not.toHaveProperty("winner");
    }
  });
});

describe("buildMergePlan requires explicit human action", () => {
  it("refuses without an actor", () => {
    expect(() =>
      buildMergePlan({
        primary,
        duplicate,
        decisions: [decision("family_name", "primary"), decision("city", "primary")],
        performedBy: "",
        performedAt: NOW,
      }),
    ).toThrow(MergeNotPermittedError);
  });

  it("refuses while any conflicting field is undecided", () => {
    expect(() =>
      buildMergePlan({
        primary,
        duplicate,
        decisions: [decision("family_name", "primary")],
        performedBy: ACTOR,
        performedAt: NOW,
      }),
    ).toThrow(/Undecided: city/);
  });

  it("refuses to merge a record into itself", () => {
    expect(() =>
      buildMergePlan({
        primary,
        duplicate: { ...duplicate, id: PRIMARY_ID },
        decisions: [],
        performedBy: ACTOR,
        performedAt: NOW,
      }),
    ).toThrow(MergeNotPermittedError);
  });

  it("produces a plan once every conflict is decided", () => {
    const plan = buildMergePlan({
      primary,
      duplicate,
      decisions: [decision("family_name", "duplicate"), decision("city", "primary")],
      performedBy: ACTOR,
      performedAt: NOW,
    });

    expect(plan.profileUpdates).toEqual({
      family_name: "Mwakalinga-Juma",
      headline: "Accountant",
    });
    expect(plan.fieldDecisions).toEqual([
      {
        fieldPath: "family_name",
        winner: "duplicate",
        winningValue: "Mwakalinga-Juma",
        losingValue: "Mwakalinga",
        chosenBy: ACTOR,
      },
      {
        fieldPath: "city",
        winner: "primary",
        winningValue: "Dar es Salaam",
        losingValue: "Dodoma",
        chosenBy: ACTOR,
      },
    ]);
  });

  it("captures a before-snapshot of both records and every row it will move", () => {
    const plan = buildMergePlan({
      primary,
      duplicate,
      decisions: [decision("family_name", "duplicate"), decision("city", "primary")],
      duplicateChildRows: { experiences: ["e1", "e2"], documents: ["d1"], applications: ["a1"] },
      performedBy: ACTOR,
      performedAt: NOW,
    });

    expect(plan.beforeSnapshot.primary).toEqual(primary);
    expect(plan.beforeSnapshot.duplicate).toEqual(duplicate);
    expect(plan.beforeSnapshot.reassigned.experiences).toEqual(["e1", "e2"]);
    expect(plan.beforeSnapshot.reassigned.documents).toEqual(["d1"]);
    expect(plan.beforeSnapshot.reassigned.skills).toEqual([]);
    expect(plan.beforeSnapshot.capturedAt).toBe(NOW);
  });

  it("snapshots by value, so a later mutation of the input cannot corrupt the audit", () => {
    const mutable: MergeableProfile = { ...primary };
    const plan = buildMergePlan({
      primary: mutable,
      duplicate,
      decisions: [decision("family_name", "primary"), decision("city", "primary")],
      performedBy: ACTOR,
      performedAt: NOW,
    });
    mutable.city = "Somewhere else";
    expect(plan.beforeSnapshot.primary.city).toBe("Dar es Salaam");
  });
});

describe("buildRevertPlan", () => {
  it("restores every field the merge changed", () => {
    const plan = buildMergePlan({
      primary,
      duplicate,
      decisions: [decision("family_name", "duplicate"), decision("city", "primary")],
      duplicateChildRows: { experiences: ["e1"], documents: ["d1"] },
      performedBy: ACTOR,
      performedAt: NOW,
    });

    const revert = buildRevertPlan({
      primaryCandidateId: plan.primaryCandidateId,
      mergedCandidateId: plan.mergedCandidateId,
      beforeSnapshot: plan.beforeSnapshot,
      fieldDecisions: plan.fieldDecisions,
      revertedBy: ACTOR,
      revertedAt: "2026-08-06T10:00:00.000Z",
    });

    // family_name was taken from the duplicate; headline was an uncontested fill.
    expect(revert.profileRestores).toEqual({
      family_name: "Mwakalinga",
      headline: null,
    });
    expect(revert.reassignBack.experiences).toEqual(["e1"]);
    expect(revert.reassignBack.documents).toEqual(["d1"]);
  });

  it("leaves untouched fields alone rather than rewriting the whole profile", () => {
    const plan = buildMergePlan({
      primary,
      duplicate,
      decisions: [decision("family_name", "primary"), decision("city", "primary")],
      performedBy: ACTOR,
      performedAt: NOW,
    });
    const revert = buildRevertPlan({
      primaryCandidateId: plan.primaryCandidateId,
      mergedCandidateId: plan.mergedCandidateId,
      beforeSnapshot: plan.beforeSnapshot,
      fieldDecisions: plan.fieldDecisions,
      revertedBy: ACTOR,
      revertedAt: NOW,
    });
    expect(Object.keys(revert.profileRestores)).toEqual(["headline"]);
    expect("city" in revert.profileRestores).toBe(false);
  });

  it("refuses without an actor", () => {
    const plan = buildMergePlan({
      primary,
      duplicate,
      decisions: [decision("family_name", "primary"), decision("city", "primary")],
      performedBy: ACTOR,
      performedAt: NOW,
    });
    expect(() =>
      buildRevertPlan({
        primaryCandidateId: plan.primaryCandidateId,
        mergedCandidateId: plan.mergedCandidateId,
        beforeSnapshot: plan.beforeSnapshot,
        fieldDecisions: plan.fieldDecisions,
        revertedBy: "   ",
        revertedAt: NOW,
      }),
    ).toThrow(MergeNotPermittedError);
  });
});

describe("mergeable field list", () => {
  it("carries no protected characteristic", () => {
    const forbidden = [
      "nationality",
      "citizenship",
      "national_origin",
      "ethnicity",
      "religion",
      "gender",
    ];
    for (const field of MERGEABLE_PROFILE_FIELDS) {
      expect(forbidden).not.toContain(field);
    }
  });
});
