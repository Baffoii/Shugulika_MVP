/**
 * The staged import state machine.
 *
 * inventory → map → dry_run → quarantine → match → human_review
 *          → canonical_upsert → reconcile → report
 *
 * Stages advance one at a time and only forwards. That is deliberate: an import
 * that can jump straight from `inventory` to `canonical_upsert` is an import
 * that can write unvalidated Zoho records into candidate_profiles, which is the
 * exact failure this pipeline exists to prevent.
 *
 * Pure — no I/O.
 */
import { IMPORT_STAGES, type ImportStage } from "@/lib/candidates/constants";

export const STAGE_ORDER: readonly ImportStage[] = IMPORT_STAGES;

export const STAGE_LABELS: Record<ImportStage, string> = {
  inventory: "Inventory",
  map: "Map to canonical fields",
  dry_run: "Dry run",
  quarantine: "Quarantine",
  match: "Match against the pool",
  human_review: "Human review",
  canonical_upsert: "Write canonical records",
  reconcile: "Reconcile",
  report: "Report",
};

export const STAGE_DESCRIPTIONS: Record<ImportStage, string> = {
  inventory: "Count and fingerprint the source records without reading them into the platform.",
  map: "Translate each source record into a canonical candidate draft.",
  dry_run: "Validate every draft and project what a real import would change.",
  quarantine: "Hold back records that failed validation, each with a stated reason.",
  match: "Compare each remaining draft against the existing candidate pool.",
  human_review: "Resolve ambiguous matches and quarantined records.",
  canonical_upsert: "Write the approved records and record their external mapping.",
  reconcile: "Re-read what was written and confirm it matches the source.",
  report: "Publish the batch outcome.",
};

/** The stage that follows, or null at the end of the pipeline. */
export function nextStage(stage: ImportStage): ImportStage | null {
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0 || index >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[index + 1] ?? null;
}

export function stageIndex(stage: ImportStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/** Only a single step forward is legal. */
export function canAdvance(from: ImportStage, to: ImportStage): boolean {
  return nextStage(from) === to;
}

/**
 * The stage that must be reached before canonical records may be written. An
 * import that has not been through human review has not had its ambiguous
 * matches resolved.
 */
export const REVIEW_GATE_STAGE: ImportStage = "human_review";

export interface StageTransition {
  stage: ImportStage;
  at: string;
  note: string | null;
}

export class ImportStageError extends Error {}

/**
 * Advance a batch's stage, appending to its history.
 *
 * Throws on a skipped or backwards transition rather than clamping: silently
 * accepting an illegal transition would let a caller believe validation ran
 * when it did not.
 */
export function advanceStage(
  current: ImportStage,
  to: ImportStage,
  at: string,
  history: readonly StageTransition[] = [],
  note: string | null = null,
): { stage: ImportStage; history: StageTransition[] } {
  if (!canAdvance(current, to)) {
    throw new ImportStageError(
      `Illegal import transition ${current} → ${to}; the next stage is ${nextStage(current) ?? "(none)"}.`,
    );
  }
  return { stage: to, history: [...history, { stage: to, at, note }] };
}

export interface BatchTotals {
  inventoried: number;
  mapped: number;
  quarantined: number;
  matched: number;
  needsReview: number;
  upserted: number;
  skipped: number;
  failed: number;
}

export function emptyTotals(): BatchTotals {
  return {
    inventoried: 0,
    mapped: 0,
    quarantined: 0,
    matched: 0,
    needsReview: 0,
    upserted: 0,
    skipped: 0,
    failed: 0,
  };
}

/**
 * Whether a batch may proceed to write canonical records.
 *
 * Three independent conditions, all required: the batch is past human review,
 * it is not a dry run, and nothing is still waiting on a person.
 */
export function canWriteCanonicalRecords(batch: {
  stage: ImportStage;
  isDryRun: boolean;
  totals: BatchTotals;
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (batch.isDryRun) reasons.push("batch is a dry run");
  if (stageIndex(batch.stage) < stageIndex(REVIEW_GATE_STAGE)) {
    reasons.push(`batch has not reached ${REVIEW_GATE_STAGE}`);
  }
  if (batch.totals.needsReview > 0) {
    reasons.push(`${batch.totals.needsReview} record(s) still need human review`);
  }
  return { allowed: reasons.length === 0, reasons };
}
