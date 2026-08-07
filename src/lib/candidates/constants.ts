/**
 * ATS enums for parser provenance, duplicate detection, merge review, and the
 * staged Zoho candidate import.
 *
 * These deliberately live here rather than in `src/lib/constants.ts`: they are
 * back-office ATS vocabulary with no bearing on the public product surface, and
 * keeping them local means the generated database types stay untouched.
 *
 * Every value mirrors a CHECK constraint in the 20260809* migrations. Changing
 * one without changing the other will fail at insert time, not at compile time.
 */

/** Where a candidate field value came from. Mirrors candidate_field_provenance.source. */
export const PROVENANCE_SOURCES = [
  "cv_parse",
  "candidate_confirmed",
  "recruiter_entry",
  "zoho_import",
] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

/** Sources produced by a machine. These can never overwrite a confirmed value. */
export const MACHINE_PROVENANCE_SOURCES: readonly ProvenanceSource[] = ["cv_parse", "zoho_import"];

export function isMachineSource(source: ProvenanceSource): boolean {
  return MACHINE_PROVENANCE_SOURCES.includes(source);
}

/** Entity a provenance row or suggestion targets. Mirrors resume_field_suggestions.target_entity. */
export const PROVENANCE_ENTITIES = [
  "profile",
  "experience",
  "education",
  "skill",
  "certification",
  "language",
] as const;
export type ProvenanceEntity = (typeof PROVENANCE_ENTITIES)[number];

/**
 * Profile fields whose absence makes a candidate record unusable for matching
 * or submission. Drives the "missing critical fields" data-quality metric.
 */
export const CRITICAL_PROFILE_FIELDS = [
  "given_name",
  "family_name",
  "phone",
  "email",
  "country_code",
] as const;
export type CriticalProfileField = (typeof CRITICAL_PROFILE_FIELDS)[number];

/** Mirrors candidate_duplicate_links.status. */
export const DUPLICATE_LINK_STATUSES = [
  "suspected",
  "confirmed_duplicate",
  "not_duplicate",
  "merged",
] as const;
export type DuplicateLinkStatus = (typeof DUPLICATE_LINK_STATUSES)[number];

/** Mirrors candidate_duplicate_links.match_kind. */
export const DUPLICATE_MATCH_KINDS = ["exact", "probabilistic"] as const;
export type DuplicateMatchKind = (typeof DUPLICATE_MATCH_KINDS)[number];

/**
 * Version stamped onto every link this detector writes. Bump it when the
 * scoring changes, so an old score is never silently compared to a new one.
 */
export const DEDUPE_DETECTOR_VERSION = "candidate-dedupe-v1";

/** Version stamped onto provenance rows written by the rule-based extractor. */
export const RULE_BASED_PARSER_VERSION = "rule-based-v1";

/** Prefix for provenance written by the OpenAI extractor; the model name is appended. */
export const AI_PARSER_VERSION_PREFIX = "openai";

/** Mirrors the stage enum shared by both zoho_candidate_import_* tables. */
export const IMPORT_STAGES = [
  "inventory",
  "map",
  "dry_run",
  "quarantine",
  "match",
  "human_review",
  "canonical_upsert",
  "reconcile",
  "report",
] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];

/** Mirrors zoho_candidate_import_batches.status. */
export const IMPORT_BATCH_STATUSES = [
  "open",
  "running",
  "blocked",
  "completed",
  "cancelled",
  "failed",
] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

/** Mirrors zoho_candidate_import_records.status. */
export const IMPORT_RECORD_STATUSES = [
  "pending",
  "mapped",
  "quarantined",
  "matched",
  "needs_human_review",
  "upserted",
  "skipped",
  "failed",
] as const;
export type ImportRecordStatus = (typeof IMPORT_RECORD_STATUSES)[number];

/** Mirrors zoho_candidate_import_records.decision. */
export const IMPORT_DECISIONS = ["create_new", "link_existing", "skip"] as const;
export type ImportDecision = (typeof IMPORT_DECISIONS)[number];

/**
 * Why a staged record could not proceed. Every quarantined row carries at least
 * one of these (the database enforces it), so an operator never sees a rejected
 * record with no explanation.
 */
export const QUARANTINE_REASONS = [
  "missing_name",
  "missing_contact",
  "invalid_email",
  "invalid_phone",
  "invalid_date",
  "unmapped_country",
  "duplicate_in_batch",
  "consent_missing",
  "prohibited_field_present",
  "payload_too_large",
] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

export const QUARANTINE_REASON_LABELS: Record<QuarantineReason, string> = {
  missing_name: "No usable name",
  missing_contact: "No email or phone",
  invalid_email: "Email is not a valid address",
  invalid_phone: "Phone number could not be normalized",
  invalid_date: "A date field could not be parsed",
  unmapped_country: "Country does not map to a supported country code",
  duplicate_in_batch: "Another record in this batch has the same identity",
  consent_missing: "No processing consent recorded for this record",
  prohibited_field_present: "Source record carries a prohibited field",
  payload_too_large: "Source record exceeds the staging size limit",
};

/**
 * Source fields that must never be carried into a canonical candidate record.
 * Nationality and its synonyms are employment-discrimination risks under
 * Tanzania's Employment and Labour Relations Act; the rest are protected
 * characteristics with no lawful role in matching or ranking.
 *
 * A staged record carrying any of these with a value is quarantined rather than
 * silently stripped, so the operator sees that the source system holds data we
 * refuse to ingest.
 */
/**
 * Fields an import must refuse rather than silently strip.
 *
 * Nationality, ethnicity and religion left this list when
 * 20260813090000_candidate_source_demographics added columns for them: an ATS
 * migration has to carry what the source system already held. They remain
 * banned as screening, scoring, matching and KPI inputs — nationality-ban.test.ts
 * and no-nationality.test.ts still enforce that and are unchanged.
 *
 * Everything still listed here has no column, no consumer, and no reason to
 * enter the system at all.
 */
export const PROHIBITED_IMPORT_FIELDS = [
  "race",
  "marital_status",
  "gender",
  "sex",
  "date_of_birth_public",
  "hiv_status",
  "disability_status",
] as const;
export type ProhibitedImportField = (typeof PROHIBITED_IMPORT_FIELDS)[number];

export function isProhibitedImportField(key: string): boolean {
  const normalized = key.trim().toLowerCase().replace(/\s+/g, "_");
  return (PROHIBITED_IMPORT_FIELDS as readonly string[]).includes(normalized);
}
