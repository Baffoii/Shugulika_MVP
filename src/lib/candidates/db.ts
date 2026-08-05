/**
 * Row shapes and a typed Supabase fragment for the tables added by the
 * 20260809* ATS migrations.
 *
 * `src/lib/database.types.ts` is hand-maintained and deliberately not
 * regenerated in this workstream, so — following the same pattern as
 * `src/lib/kpi/db-extensions.ts` — these live here as a local schema fragment.
 * Keep them in sync with:
 *   * 20260809090000_ats_parser_provenance.sql
 *   * 20260809091000_candidate_dedupe.sql
 *   * 20260809092000_zoho_candidate_import.sql
 *   * 20260809093000_work_authorization.sql
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DuplicateLinkStatus,
  DuplicateMatchKind,
  ImportBatchStatus,
  ImportDecision,
  ImportRecordStatus,
  ImportStage,
  ProvenanceEntity,
  ProvenanceSource,
} from "@/lib/candidates/constants";
import type { ProvenanceRecord } from "@/lib/candidates/provenance";
import type { MatchSignal } from "@/lib/candidates/match";

export type Jsonish = Record<string, unknown>;

export type CandidateFieldProvenanceRow = {
  id: string;
  candidate_id: string;
  target_entity: ProvenanceEntity;
  target_entity_id: string | null;
  field_path: string;
  value_text: string | null;
  source: ProvenanceSource;
  confidence: number | null;
  parser_version: string | null;
  parse_run_id: string | null;
  evidence_text: string | null;
  extracted_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateDuplicateLinkRow = {
  id: string;
  candidate_id_low: string;
  candidate_id_high: string;
  status: DuplicateLinkStatus;
  match_kind: DuplicateMatchKind;
  score: number;
  signals: MatchSignal[];
  detector_version: string;
  detected_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateMergeEventRow = {
  id: string;
  duplicate_link_id: string | null;
  primary_candidate_id: string;
  merged_candidate_id: string;
  status: "merged" | "reverted";
  field_decisions: Jsonish[];
  before_snapshot: Jsonish;
  performed_by: string;
  performed_at: string;
  reverted_by: string | null;
  reverted_at: string | null;
  revert_reason: string | null;
};

/**
 * candidate_profiles as this workstream reads it: the merge columns added by
 * 20260809091000 plus the identity fields dedupe compares. Declared together so
 * a matcher can load a pool in one query.
 */
export type CandidateMergeColumns = {
  id: string;
  given_name: string | null;
  middle_name: string | null;
  family_name: string | null;
  contact_email: string | null;
  city: string | null;
  country_code: string | null;
  merged_into_candidate_id: string | null;
  merged_at: string | null;
};

/** resume_parse_runs, including the parser_version column added by 20260809090000. */
export type ResumeParseRunParserColumns = {
  id: string;
  candidate_id: string;
  document_id: string;
  provider: string;
  model: string | null;
  parser_version: string;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

/** resume_field_suggestions, including the provenance columns added by 20260809090000. */
export type ResumeFieldSuggestionParserColumns = {
  id: string;
  parse_run_id: string;
  candidate_id: string;
  target_entity: ProvenanceEntity;
  target_entity_id: string | null;
  field_path: string;
  suggested_value: unknown;
  current_value: unknown;
  confidence: number;
  status: string;
  evidence_text: string | null;
  parser_version: string | null;
  extracted_at: string;
  resolved_at: string | null;
  created_at: string;
};

export type ZohoCandidateImportBatchRow = {
  id: string;
  connection_id: string;
  stage: ImportStage;
  status: ImportBatchStatus;
  is_dry_run: boolean;
  source_module: string;
  requested_by: string | null;
  totals: Jsonish;
  stage_history: Jsonish[];
  report: Jsonish;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ZohoCandidateImportRecordRow = {
  id: string;
  batch_id: string;
  zoho_record_id: string;
  stage: ImportStage;
  status: ImportRecordStatus;
  quarantine_reasons: string[];
  mapped_payload: Jsonish;
  source_fingerprint: string | null;
  matched_candidate_id: string | null;
  match_score: number | null;
  match_kind: "exact" | "probabilistic" | "none" | null;
  duplicate_link_id: string | null;
  decision: ImportDecision | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateWorkAuthorizationRow = {
  id: string;
  candidate_id: string;
  work_country_code: string | null;
  eligibility_status:
    | "unknown"
    | "eligible_without_permit"
    | "eligible_with_permit"
    | "permit_required"
    | "not_eligible";
  permit_type: string | null;
  permit_expires_on: string | null;
  source: "candidate_declared" | "document_verified" | "recruiter_entry";
  verified_at: string | null;
  verified_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type Tbl<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] };

/**
 * Minimal `Database` fragment covering only the ATS tables, so this workstream
 * can query them type-safely without regenerating the shared types.
 */
export type AtsDatabase = {
  public: {
    Tables: {
      candidate_field_provenance: Tbl<CandidateFieldProvenanceRow>;
      candidate_duplicate_links: Tbl<CandidateDuplicateLinkRow>;
      candidate_merge_events: Tbl<CandidateMergeEventRow>;
      candidate_profiles: Tbl<CandidateMergeColumns>;
      resume_parse_runs: Tbl<ResumeParseRunParserColumns>;
      resume_field_suggestions: Tbl<ResumeFieldSuggestionParserColumns>;
      zoho_candidate_import_batches: Tbl<ZohoCandidateImportBatchRow>;
      zoho_candidate_import_records: Tbl<ZohoCandidateImportRecordRow>;
      candidate_work_authorizations: Tbl<CandidateWorkAuthorizationRow>;
    };
    Views: Record<string, never>;
    Functions: {
      purge_zoho_candidate_import_batch: {
        Args: { p_batch_id: string };
        Returns: number;
      };
      apply_candidate_merge: {
        Args: {
          p_primary_candidate_id: string;
          p_merged_candidate_id: string;
          p_duplicate_link_id: string | null;
          p_field_decisions: Jsonish[];
          p_profile_updates: Jsonish;
          p_before_snapshot: Jsonish;
        };
        Returns: string;
      };
      revert_candidate_merge: {
        Args: {
          p_merge_event_id: string;
          p_profile_restores: Jsonish;
          p_reason: string | null;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type AtsClient = SupabaseClient<AtsDatabase>;

/**
 * Re-type an existing Supabase client for the ATS tables. The cast is the whole
 * point: the runtime client is unchanged (same auth, same RLS), only the
 * compile-time schema differs.
 */
export function asAtsClient(client: unknown): AtsClient {
  return client as AtsClient;
}

// ---------------------------------------------------------------------------
// Row ↔ domain mappers
// ---------------------------------------------------------------------------

export function toProvenanceRecord(row: CandidateFieldProvenanceRow): ProvenanceRecord {
  return {
    candidateId: row.candidate_id,
    targetEntity: row.target_entity,
    targetEntityId: row.target_entity_id,
    fieldPath: row.field_path,
    valueText: row.value_text,
    source: row.source,
    confidence: row.confidence,
    parserVersion: row.parser_version,
    parseRunId: row.parse_run_id,
    evidenceText: row.evidence_text,
    extractedAt: row.extracted_at,
    confirmedAt: row.confirmed_at,
    confirmedBy: row.confirmed_by,
  };
}

export function fromProvenanceRecord(
  record: ProvenanceRecord,
): Omit<CandidateFieldProvenanceRow, "id" | "created_at" | "updated_at"> {
  return {
    candidate_id: record.candidateId,
    target_entity: record.targetEntity,
    target_entity_id: record.targetEntityId,
    field_path: record.fieldPath,
    value_text: record.valueText,
    source: record.source,
    confidence: record.confidence,
    parser_version: record.parserVersion,
    parse_run_id: record.parseRunId,
    evidence_text: record.evidenceText,
    extracted_at: record.extractedAt,
    confirmed_at: record.confirmedAt,
    confirmed_by: record.confirmedBy,
  };
}
