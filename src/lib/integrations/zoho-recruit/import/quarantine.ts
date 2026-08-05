/**
 * Quarantine decisions for staged import records.
 *
 * A record is quarantined, never silently dropped and never silently repaired.
 * Every quarantined row carries at least one stated reason (the database
 * enforces that too), so an operator opening the batch always sees why a record
 * did not make it rather than a count that does not add up.
 *
 * Pure — no I/O.
 */
import { QUARANTINE_REASON_LABELS, type QuarantineReason } from "@/lib/candidates/constants";
import type { CandidateDraft, MappingResult } from "@/lib/integrations/zoho-recruit/import/mapping";

export interface QuarantineDecision {
  quarantined: boolean;
  reasons: QuarantineReason[];
  /** Human-readable reasons, in the same order. */
  labels: string[];
}

/**
 * Reasons that can never be waived. A record carrying a protected
 * characteristic, or with no way to contact the person, does not become
 * importable because an operator clicks past it.
 */
export const UNWAIVABLE_REASONS: readonly QuarantineReason[] = [
  "prohibited_field_present",
  "consent_missing",
  "missing_name",
  "missing_contact",
];

export function decideQuarantine(
  mapping: MappingResult,
  extra: { duplicateInBatch?: boolean } = {},
): QuarantineDecision {
  const reasons = [...mapping.problems];
  if (extra.duplicateInBatch && !reasons.includes("duplicate_in_batch")) {
    reasons.push("duplicate_in_batch");
  }

  return {
    quarantined: reasons.length > 0,
    reasons,
    labels: reasons.map((r) => QUARANTINE_REASON_LABELS[r]),
  };
}

/** True when an operator may release this record into the import after fixing it upstream. */
export function isWaivable(reasons: readonly QuarantineReason[]): boolean {
  return reasons.every((r) => !UNWAIVABLE_REASONS.includes(r));
}

export interface QuarantineSummary {
  total: number;
  byReason: Record<string, number>;
  waivable: number;
  unwaivable: number;
}

export function summarizeQuarantine(
  decisions: ReadonlyArray<QuarantineDecision>,
): QuarantineSummary {
  const byReason: Record<string, number> = {};
  let waivable = 0;
  let unwaivable = 0;

  for (const decision of decisions) {
    if (!decision.quarantined) continue;
    for (const reason of decision.reasons) {
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
    if (isWaivable(decision.reasons)) waivable += 1;
    else unwaivable += 1;
  }

  return { total: waivable + unwaivable, byReason, waivable, unwaivable };
}

/**
 * Fields a draft is missing that the platform treats as critical. Reported on
 * the batch so an operator can see a systemic mapping problem (every record
 * missing a phone usually means the wrong Zoho field name, not 500 bad records).
 */
export function missingCriticalFields(draft: CandidateDraft): string[] {
  const missing: string[] = [];
  if (!draft.givenName) missing.push("given_name");
  if (!draft.familyName) missing.push("family_name");
  if (!draft.email) missing.push("email");
  if (!draft.phone) missing.push("phone");
  if (!draft.countryCode) missing.push("country_code");
  return missing;
}
