/**
 * Field-level provenance rules for candidate data.
 *
 * The rule this module exists for: **a value a human established is never
 * replaced by a machine extraction.** Not by a newer parser, not by a higher
 * stated confidence, not by a Zoho import. Machine sources only compete with
 * other machine sources, and then only when the newcomer is at least as
 * confident as what it would replace.
 *
 * The same rule is enforced by a trigger in
 * `20260809090500_ats_parser_provenance.sql`. This module is the fast path that
 * keeps callers from ever tripping it; the trigger is the backstop for code
 * that does not come through here.
 *
 * Pure — no I/O, no Supabase, no Next imports.
 */
import {
  AI_PARSER_VERSION_PREFIX,
  RULE_BASED_PARSER_VERSION,
  isMachineSource,
  type ProvenanceEntity,
  type ProvenanceSource,
} from "@/lib/candidates/constants";
import { normalizeText } from "@/lib/candidates/normalize";

export interface ProvenanceRecord {
  candidateId: string;
  targetEntity: ProvenanceEntity;
  /** null for a value that belongs to the profile row itself. */
  targetEntityId: string | null;
  fieldPath: string;
  valueText: string | null;
  source: ProvenanceSource;
  /** 0–1. Null for human sources, which are not scored. */
  confidence: number | null;
  parserVersion: string | null;
  parseRunId: string | null;
  evidenceText: string | null;
  extractedAt: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

export type ProvenanceSkipReason =
  "empty_value" | "human_established" | "lower_confidence" | "unchanged";

export type ProvenanceDecision =
  | { outcome: "write"; record: ProvenanceRecord }
  | { outcome: "skip"; reason: ProvenanceSkipReason; keeps: ProvenanceRecord };

/** Stable key for a provenance row — matches the unique index on the table. */
export function provenanceKey(
  record: Pick<ProvenanceRecord, "targetEntity" | "targetEntityId" | "fieldPath">,
): string {
  return `${record.targetEntity}:${record.targetEntityId ?? "-"}:${record.fieldPath}`;
}

function sameValue(a: string | null, b: string | null): boolean {
  return normalizeText(a) === normalizeText(b);
}

/**
 * Decide whether `incoming` may replace `existing`.
 *
 * Precedence, highest first:
 *   1. `candidate_confirmed` / `recruiter_entry` — human-established.
 *   2. Machine sources, ranked by confidence.
 *
 * A human source always wins, including over another human source: the most
 * recent human decision is the current truth. Between machine sources, the
 * incoming value must be at least as confident, so a degraded re-parse (a
 * scanned PDF, a truncated CV) cannot erode a good extraction.
 */
export function decideProvenanceWrite(
  existing: ProvenanceRecord | null,
  incoming: ProvenanceRecord,
): ProvenanceDecision {
  const hasValue = (incoming.valueText ?? "").trim().length > 0;
  if (!hasValue) {
    return {
      outcome: "skip",
      reason: "empty_value",
      keeps: existing ?? incoming,
    };
  }

  if (!existing) return { outcome: "write", record: incoming };

  const existingIsHuman = !isMachineSource(existing.source);
  const incomingIsMachine = isMachineSource(incoming.source);

  if (existingIsHuman && incomingIsMachine) {
    return { outcome: "skip", reason: "human_established", keeps: existing };
  }

  if (
    incomingIsMachine &&
    isMachineSource(existing.source) &&
    existing.confidence != null &&
    incoming.confidence != null &&
    incoming.confidence < existing.confidence
  ) {
    return { outcome: "skip", reason: "lower_confidence", keeps: existing };
  }

  if (sameValue(existing.valueText, incoming.valueText) && existing.source === incoming.source) {
    return { outcome: "skip", reason: "unchanged", keeps: existing };
  }

  return { outcome: "write", record: incoming };
}

/**
 * Apply a batch of extracted values against the provenance already on file.
 * Returns the rows to write and the ones that were held back, so the caller can
 * log why a re-parse changed less than expected.
 */
export function planProvenanceWrites(
  existing: ProvenanceRecord[],
  incoming: ProvenanceRecord[],
): {
  writes: ProvenanceRecord[];
  skipped: Array<{ record: ProvenanceRecord; reason: ProvenanceSkipReason }>;
} {
  const byKey = new Map(existing.map((row) => [provenanceKey(row), row]));
  const writes: ProvenanceRecord[] = [];
  const skipped: Array<{ record: ProvenanceRecord; reason: ProvenanceSkipReason }> = [];

  for (const record of incoming) {
    const decision = decideProvenanceWrite(byKey.get(provenanceKey(record)) ?? null, record);
    if (decision.outcome === "write") {
      writes.push(decision.record);
      // A later value in the same batch competes with the one just accepted,
      // not with the stale database row.
      byKey.set(provenanceKey(record), decision.record);
    } else {
      skipped.push({ record, reason: decision.reason });
    }
  }

  return { writes, skipped };
}

/**
 * True when a parsed suggestion should not even be offered to the candidate,
 * because they already confirmed that exact field with that exact value.
 * Offering it again reads as the product ignoring them.
 */
export function suggestionIsRedundant(
  existing: ProvenanceRecord | null,
  suggestedValue: string | null,
): boolean {
  if (!existing) return false;
  if (isMachineSource(existing.source)) return false;
  return sameValue(existing.valueText, suggestedValue);
}

/** Build the provenance row a candidate confirmation produces. */
export function confirmedProvenance(input: {
  candidateId: string;
  targetEntity: ProvenanceEntity;
  targetEntityId: string | null;
  fieldPath: string;
  valueText: string | null;
  confirmedBy: string;
  confirmedAt: string;
  /** Carried through so we can still see which parser proposed the value. */
  parserVersion?: string | null;
  parseRunId?: string | null;
  evidenceText?: string | null;
}): ProvenanceRecord {
  return {
    candidateId: input.candidateId,
    targetEntity: input.targetEntity,
    targetEntityId: input.targetEntityId,
    fieldPath: input.fieldPath,
    valueText: input.valueText,
    source: "candidate_confirmed",
    confidence: null,
    parserVersion: input.parserVersion ?? null,
    parseRunId: input.parseRunId ?? null,
    evidenceText: input.evidenceText ?? null,
    extractedAt: null,
    confirmedAt: input.confirmedAt,
    confirmedBy: input.confirmedBy,
  };
}

/** Build the provenance row a machine extraction produces. */
export function extractedProvenance(input: {
  candidateId: string;
  targetEntity: ProvenanceEntity;
  targetEntityId: string | null;
  fieldPath: string;
  valueText: string | null;
  confidence: number;
  parserVersion: string;
  parseRunId: string | null;
  evidenceText: string | null;
  extractedAt: string;
  source?: Extract<ProvenanceSource, "cv_parse" | "zoho_import">;
}): ProvenanceRecord {
  return {
    candidateId: input.candidateId,
    targetEntity: input.targetEntity,
    targetEntityId: input.targetEntityId,
    fieldPath: input.fieldPath,
    valueText: input.valueText,
    source: input.source ?? "cv_parse",
    confidence: input.confidence,
    parserVersion: input.parserVersion,
    parseRunId: input.parseRunId,
    evidenceText: input.evidenceText,
    extractedAt: input.extractedAt,
    confirmedAt: null,
    confirmedBy: null,
  };
}

/**
 * Version string stamped on every run and every provenance row it writes.
 * Including the model means a re-parse after a model change is visibly a
 * different parser, not a mysterious change of answer.
 */
export function parserVersion(input: { usingAi: boolean; model?: string | null }): string {
  if (!input.usingAi) return RULE_BASED_PARSER_VERSION;
  const model = (input.model ?? "").trim();
  return model ? `${AI_PARSER_VERSION_PREFIX}:${model}` : AI_PARSER_VERSION_PREFIX;
}

export interface ProvenanceCoverage {
  /** Fields with any provenance at all. */
  trackedFields: number;
  confirmedFields: number;
  machineFields: number;
  /** confirmedFields / trackedFields, 0–1. Null when nothing is tracked. */
  confirmationRate: number | null;
  /** Machine-sourced fields still sitting below the review threshold. */
  lowConfidenceFields: number;
}

/** Confidence at or above which a machine extraction is considered reliable. */
export const CONFIDENCE_REVIEW_THRESHOLD = 0.6;

export function summarizeProvenance(rows: ProvenanceRecord[]): ProvenanceCoverage {
  let confirmed = 0;
  let machine = 0;
  let lowConfidence = 0;

  for (const row of rows) {
    if (isMachineSource(row.source)) {
      machine += 1;
      if ((row.confidence ?? 0) < CONFIDENCE_REVIEW_THRESHOLD) lowConfidence += 1;
    } else {
      confirmed += 1;
    }
  }

  return {
    trackedFields: rows.length,
    confirmedFields: confirmed,
    machineFields: machine,
    confirmationRate: rows.length > 0 ? confirmed / rows.length : null,
    lowConfidenceFields: lowConfidence,
  };
}
