/**
 * Candidate merge planning: conflicts, per-field winners, and the reversible
 * audit payload.
 *
 * Three properties this module guarantees, all of them checked by tests:
 *
 *   1. A merge cannot be planned without a named human actor.
 *   2. A merge cannot be planned while any conflicting field is undecided —
 *      there is no "just take the primary" default, because a silent default is
 *      how a merge quietly deletes the better record.
 *   3. Every plan carries a before-snapshot sufficient to restore both records,
 *      and `buildRevertPlan` turns that snapshot back into concrete writes.
 *
 * Pure — no I/O. The server action in `/hq/merge-review` applies the plan.
 */
import type { ProvenanceRecord } from "@/lib/candidates/provenance";
import { isMachineSource } from "@/lib/candidates/constants";
import { normalizeText } from "@/lib/candidates/normalize";

export type MergeSide = "primary" | "duplicate";

/** Profile fields the merge review compares side by side. */
export const MERGEABLE_PROFILE_FIELDS = [
  "given_name",
  "middle_name",
  "family_name",
  "contact_email",
  "headline",
  "summary",
  "city",
  "country_code",
  "date_of_birth",
  "availability",
] as const;
export type MergeableProfileField = (typeof MERGEABLE_PROFILE_FIELDS)[number];

export type MergeableProfile = {
  id: string;
} & Partial<Record<MergeableProfileField, string | null>>;

export interface MergeFieldConflict {
  fieldPath: MergeableProfileField;
  primaryValue: string | null;
  duplicateValue: string | null;
  /** Provenance behind each side, when we have it — the reviewer's evidence. */
  primarySource: ProvenanceRecord | null;
  duplicateSource: ProvenanceRecord | null;
  /** What the system would pick. Advisory: the reviewer still has to choose. */
  recommended: MergeSide;
  recommendationReason: string;
}

export interface MergeFieldDecision {
  fieldPath: MergeableProfileField;
  winner: MergeSide;
  chosenBy: string;
}

function valueOf(profile: MergeableProfile, field: MergeableProfileField): string | null {
  const value = profile[field];
  return value == null || value === "" ? null : value;
}

function provenanceFor(
  rows: readonly ProvenanceRecord[],
  candidateId: string,
  field: string,
): ProvenanceRecord | null {
  return (
    rows.find(
      (r) =>
        r.candidateId === candidateId &&
        r.targetEntity === "profile" &&
        r.fieldPath === field &&
        r.targetEntityId == null,
    ) ??
    rows.find(
      (r) => r.candidateId === candidateId && r.targetEntity === "profile" && r.fieldPath === field,
    ) ??
    null
  );
}

/**
 * Recommend a side for one field. Human-established beats machine; between two
 * machine values the more confident wins; a present value beats an absent one.
 */
function recommend(
  primaryValue: string | null,
  duplicateValue: string | null,
  primarySource: ProvenanceRecord | null,
  duplicateSource: ProvenanceRecord | null,
): { recommended: MergeSide; reason: string } {
  if (primaryValue && !duplicateValue) return { recommended: "primary", reason: "only_value" };
  if (!primaryValue && duplicateValue) return { recommended: "duplicate", reason: "only_value" };

  const primaryHuman = primarySource != null && !isMachineSource(primarySource.source);
  const duplicateHuman = duplicateSource != null && !isMachineSource(duplicateSource.source);
  if (primaryHuman && !duplicateHuman) return { recommended: "primary", reason: "human_confirmed" };
  if (duplicateHuman && !primaryHuman)
    return { recommended: "duplicate", reason: "human_confirmed" };

  const primaryConfidence = primarySource?.confidence ?? -1;
  const duplicateConfidence = duplicateSource?.confidence ?? -1;
  if (duplicateConfidence > primaryConfidence)
    return { recommended: "duplicate", reason: "higher_confidence" };
  if (primaryConfidence > duplicateConfidence)
    return { recommended: "primary", reason: "higher_confidence" };

  return { recommended: "primary", reason: "primary_record_default" };
}

/**
 * Fields where the two records genuinely disagree. Fields that agree (after
 * normalization) or that only one side has a value for are not conflicts and
 * are not put to the reviewer — a review queue full of non-decisions trains
 * people to click through.
 */
export function buildMergeConflicts(
  primary: MergeableProfile,
  duplicate: MergeableProfile,
  provenance: readonly ProvenanceRecord[] = [],
): MergeFieldConflict[] {
  const conflicts: MergeFieldConflict[] = [];

  for (const field of MERGEABLE_PROFILE_FIELDS) {
    const primaryValue = valueOf(primary, field);
    const duplicateValue = valueOf(duplicate, field);
    if (primaryValue == null && duplicateValue == null) continue;
    if (normalizeText(primaryValue) === normalizeText(duplicateValue)) continue;
    if (primaryValue == null || duplicateValue == null) continue;

    const primarySource = provenanceFor(provenance, primary.id, field);
    const duplicateSource = provenanceFor(provenance, duplicate.id, field);
    const { recommended, reason } = recommend(
      primaryValue,
      duplicateValue,
      primarySource,
      duplicateSource,
    );

    conflicts.push({
      fieldPath: field,
      primaryValue,
      duplicateValue,
      primarySource,
      duplicateSource,
      recommended,
      recommendationReason: reason,
    });
  }

  return conflicts;
}

/**
 * Fields the duplicate can contribute for free: the primary has nothing there.
 * These are applied without a decision because there is nothing to decide.
 */
export function buildUncontestedFills(
  primary: MergeableProfile,
  duplicate: MergeableProfile,
): Array<{ fieldPath: MergeableProfileField; value: string }> {
  const fills: Array<{ fieldPath: MergeableProfileField; value: string }> = [];
  for (const field of MERGEABLE_PROFILE_FIELDS) {
    const primaryValue = valueOf(primary, field);
    const duplicateValue = valueOf(duplicate, field);
    if (primaryValue == null && duplicateValue != null) {
      fills.push({ fieldPath: field, value: duplicateValue });
    }
  }
  return fills;
}

export interface MergeSnapshot {
  primary: MergeableProfile;
  duplicate: MergeableProfile;
  /** Child rows moved by the merge, so a revert can move them back. */
  reassigned: {
    experiences: string[];
    education: string[];
    skills: string[];
    certifications: string[];
    languages: string[];
    documents: string[];
    applications: string[];
    externalMappings: string[];
  };
  capturedAt: string;
}

export interface MergeChildRows {
  experiences?: readonly string[];
  education?: readonly string[];
  skills?: readonly string[];
  certifications?: readonly string[];
  languages?: readonly string[];
  documents?: readonly string[];
  applications?: readonly string[];
  externalMappings?: readonly string[];
}

export interface MergePlanInput {
  primary: MergeableProfile;
  duplicate: MergeableProfile;
  /** One decision per conflicting field. Incomplete input is rejected. */
  decisions: readonly MergeFieldDecision[];
  provenance?: readonly ProvenanceRecord[];
  /** Child rows owned by the duplicate that the merge will re-point. */
  duplicateChildRows?: MergeChildRows;
  duplicateLinkId?: string | null;
  /** profiles.id of the HQ user performing the merge. Required. */
  performedBy: string;
  performedAt: string;
}

export interface MergePlan {
  primaryCandidateId: string;
  mergedCandidateId: string;
  duplicateLinkId: string | null;
  /** Field → value to write onto the primary profile. */
  profileUpdates: Partial<Record<MergeableProfileField, string | null>>;
  /** Recorded on the audit row; one entry per decided conflict. */
  fieldDecisions: Array<{
    fieldPath: MergeableProfileField;
    winner: MergeSide;
    winningValue: string | null;
    losingValue: string | null;
    chosenBy: string;
  }>;
  beforeSnapshot: MergeSnapshot;
  performedBy: string;
  performedAt: string;
}

export class MergeNotPermittedError extends Error {}

/**
 * Turn a reviewer's decisions into a concrete, reversible plan.
 *
 * Throws rather than defaulting: an unnamed actor or an undecided conflict is a
 * programming error in the caller, and quietly picking a winner would produce a
 * merge nobody chose.
 */
export function buildMergePlan(input: MergePlanInput): MergePlan {
  if (!input.performedBy?.trim()) {
    throw new MergeNotPermittedError("A merge requires the id of the person performing it.");
  }
  if (input.primary.id === input.duplicate.id) {
    throw new MergeNotPermittedError("A candidate cannot be merged into itself.");
  }

  const conflicts = buildMergeConflicts(input.primary, input.duplicate, input.provenance ?? []);
  const decisionByField = new Map(input.decisions.map((d) => [d.fieldPath, d]));

  const undecided = conflicts
    .filter((c) => !decisionByField.has(c.fieldPath))
    .map((c) => c.fieldPath);
  if (undecided.length > 0) {
    throw new MergeNotPermittedError(
      `Every conflicting field must be decided before merging. Undecided: ${undecided.join(", ")}`,
    );
  }

  const profileUpdates: Partial<Record<MergeableProfileField, string | null>> = {};
  const fieldDecisions: MergePlan["fieldDecisions"] = [];

  for (const conflict of conflicts) {
    const decision = decisionByField.get(conflict.fieldPath);
    if (!decision) continue;
    const winningValue =
      decision.winner === "primary" ? conflict.primaryValue : conflict.duplicateValue;
    const losingValue =
      decision.winner === "primary" ? conflict.duplicateValue : conflict.primaryValue;

    if (decision.winner === "duplicate") profileUpdates[conflict.fieldPath] = winningValue;
    fieldDecisions.push({
      fieldPath: conflict.fieldPath,
      winner: decision.winner,
      winningValue,
      losingValue,
      chosenBy: decision.chosenBy || input.performedBy,
    });
  }

  for (const fill of buildUncontestedFills(input.primary, input.duplicate)) {
    profileUpdates[fill.fieldPath] = fill.value;
  }

  const child = input.duplicateChildRows ?? {};
  const beforeSnapshot: MergeSnapshot = {
    primary: { ...input.primary },
    duplicate: { ...input.duplicate },
    reassigned: {
      experiences: [...(child.experiences ?? [])],
      education: [...(child.education ?? [])],
      skills: [...(child.skills ?? [])],
      certifications: [...(child.certifications ?? [])],
      languages: [...(child.languages ?? [])],
      documents: [...(child.documents ?? [])],
      applications: [...(child.applications ?? [])],
      externalMappings: [...(child.externalMappings ?? [])],
    },
    capturedAt: input.performedAt,
  };

  return {
    primaryCandidateId: input.primary.id,
    mergedCandidateId: input.duplicate.id,
    duplicateLinkId: input.duplicateLinkId ?? null,
    profileUpdates,
    fieldDecisions,
    beforeSnapshot,
    performedBy: input.performedBy,
    performedAt: input.performedAt,
  };
}

export interface RevertPlan {
  primaryCandidateId: string;
  mergedCandidateId: string;
  /** Values to restore on the primary profile. */
  profileRestores: Partial<Record<MergeableProfileField, string | null>>;
  /** Child rows to re-point back at the merged-away candidate. */
  reassignBack: MergeSnapshot["reassigned"];
  revertedBy: string;
  revertedAt: string;
}

/**
 * Rebuild the writes that undo a merge, from the audit row alone. The snapshot
 * is the source of truth: whatever happened to the primary since the merge, the
 * fields the merge changed go back to what they were.
 */
export function buildRevertPlan(input: {
  primaryCandidateId: string;
  mergedCandidateId: string;
  beforeSnapshot: MergeSnapshot;
  fieldDecisions: readonly MergePlan["fieldDecisions"][number][];
  revertedBy: string;
  revertedAt: string;
}): RevertPlan {
  if (!input.revertedBy?.trim()) {
    throw new MergeNotPermittedError("A revert requires the id of the person performing it.");
  }

  const profileRestores: Partial<Record<MergeableProfileField, string | null>> = {};
  const before = input.beforeSnapshot.primary;

  // Restore every field the merge could have touched: the decided conflicts and
  // the uncontested fills the merge copied across.
  for (const field of MERGEABLE_PROFILE_FIELDS) {
    const changedByDecision = input.fieldDecisions.some(
      (d) => d.fieldPath === field && d.winner === "duplicate",
    );
    const wasFilled =
      (before[field] ?? null) == null && (input.beforeSnapshot.duplicate[field] ?? null) != null;
    if (changedByDecision || wasFilled) {
      profileRestores[field] = before[field] ?? null;
    }
  }

  return {
    primaryCandidateId: input.primaryCandidateId,
    mergedCandidateId: input.mergedCandidateId,
    profileRestores,
    reassignBack: input.beforeSnapshot.reassigned,
    revertedBy: input.revertedBy,
    revertedAt: input.revertedAt,
  };
}
