/**
 * Maps Zoho Recruit candidate statuses onto Shugulika pipeline stages.
 *
 * Pure and dependency-free so it can be unit-tested and reasoned about without
 * a Zoho connection or a database.
 *
 * Two rules shape this map:
 *
 *  1. Never invent progress. Where a Zoho status is ambiguous about how far a
 *     candidate actually got, it maps to the *earlier* stage. A migrated record
 *     claiming someone reached "Offer" when Zoho only said "Contacted" would
 *     corrupt the very reporting this migration exists to inform.
 *
 *  2. Never silently discard. A status with no clean equivalent maps to a
 *     `zoho_*` legacy stage (registered in 20260812090000_zoho_test_migration)
 *     rather than being flattened into `cv_review`. An unmapped status stays
 *     visible as unmapped.
 */

/** Shugulika stage keys this module is allowed to produce. */
export type PipelineStageKey =
  | "cv_review"
  | "testing"
  | "test_review"
  | "interview_screening"
  | "interview_review"
  | "reference_checks"
  | "client_submission"
  | "offer"
  | "hired"
  | "rejected"
  | "zoho_new"
  | "zoho_associated"
  | "zoho_waiting_evaluation"
  | "zoho_contacted"
  | "zoho_unqualified"
  | "zoho_junk"
  | "zoho_on_hold"
  | "zoho_unmapped";

export interface StageMapping {
  stage: PipelineStageKey;
  /** True when the candidate's journey ended here (Hired / any rejection). */
  isTerminal: boolean;
  /** Zoho "On Hold" carries a stage *and* a hold flag; applications.is_on_hold. */
  isOnHold: boolean;
  /** True when we could not map the status and fell back to zoho_unmapped. */
  isUnmapped: boolean;
  /** Set when the mapping represents a rejection, for applications.rejected_from_stage. */
  rejectedFromStage: PipelineStageKey | null;
}

/**
 * Zoho status (normalised) → Shugulika stage.
 *
 * Zoho installs vary: these are the stock statuses plus the common renames.
 * Anything absent falls through to `zoho_unmapped`, which is the point.
 */
const DIRECT: Record<string, { stage: PipelineStageKey; terminal?: boolean; onHold?: boolean }> = {
  // --- Pre-screening -------------------------------------------------------
  new: { stage: "zoho_new" },
  // Zoho's default when a candidate is attached to a job opening and nothing
  // more has happened. It is NOT evidence of screening, so it must not be
  // promoted into cv_review.
  associated: { stage: "zoho_associated" },
  "waiting for evaluation": { stage: "zoho_waiting_evaluation" },
  contacted: { stage: "zoho_contacted" },
  "attempted to contact": { stage: "zoho_contacted" },
  "contact in future": { stage: "zoho_contacted" },

  // --- Screening / review --------------------------------------------------
  qualified: { stage: "cv_review" },
  "in review": { stage: "cv_review" },
  screening: { stage: "cv_review" },
  shortlisted: { stage: "cv_review" },

  // --- Assessment ----------------------------------------------------------
  "test scheduled": { stage: "testing" },
  testing: { stage: "testing" },
  assessment: { stage: "testing" },
  "test completed": { stage: "test_review" },
  "assessment completed": { stage: "test_review" },

  // --- Interview -----------------------------------------------------------
  "interview scheduled": { stage: "interview_screening" },
  "interview to be scheduled": { stage: "interview_screening" },
  interviewed: { stage: "interview_review" },
  "interview completed": { stage: "interview_review" },
  "second interview": { stage: "interview_review" },

  // --- References ----------------------------------------------------------
  "reference check": { stage: "reference_checks" },
  "references requested": { stage: "reference_checks" },

  // --- Client submission ---------------------------------------------------
  "submitted to client": { stage: "client_submission" },
  submitted: { stage: "client_submission" },
  "client review": { stage: "client_submission" },
  "client interview": { stage: "client_submission" },

  // --- Offer ---------------------------------------------------------------
  "offer made": { stage: "offer" },
  offered: { stage: "offer" },
  "offer extended": { stage: "offer" },
  "offer accepted": { stage: "offer" },

  // --- Terminal ------------------------------------------------------------
  hired: { stage: "hired", terminal: true },
  placed: { stage: "hired", terminal: true },
  "on hold": { stage: "zoho_on_hold", onHold: true },
};

/**
 * Rejection-shaped statuses. Kept separate because they all land on `rejected`
 * but differ in *where* the candidate was rejected from, which the schema
 * records in applications.rejected_from_stage.
 */
const REJECTIONS: Record<string, PipelineStageKey> = {
  rejected: "cv_review",
  "not qualified": "cv_review",
  unqualified: "zoho_unqualified",
  junk: "zoho_junk",
  "junk candidate": "zoho_junk",
  "rejected by client": "client_submission",
  "client rejected": "client_submission",
  "offer declined": "offer",
  "offer rejected": "offer",
  "candidate withdrew": "cv_review",
  withdrawn: "cv_review",
  "no show": "interview_screening",
  "interview rejected": "interview_review",
};

/**
 * Lowercase and reduce every separator Zoho installs vary on to a single space,
 * so "Submitted-to-Client", "submitted_to_client" and "Submitted to Client" all
 * resolve to one key.
 */
export function normaliseZohoStatus(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapZohoStatusToStage(raw: string | null | undefined): StageMapping {
  const key = normaliseZohoStatus(raw);

  if (!key) {
    return {
      stage: "zoho_unmapped",
      isTerminal: false,
      isOnHold: false,
      isUnmapped: true,
      rejectedFromStage: null,
    };
  }

  const rejectedFrom = REJECTIONS[key];
  if (rejectedFrom) {
    return {
      stage: "rejected",
      isTerminal: true,
      isOnHold: false,
      isUnmapped: false,
      rejectedFromStage: rejectedFrom,
    };
  }

  const direct = DIRECT[key];
  if (direct) {
    return {
      stage: direct.stage,
      isTerminal: direct.terminal === true,
      isOnHold: direct.onHold === true,
      isUnmapped: false,
      rejectedFromStage: null,
    };
  }

  return {
    stage: "zoho_unmapped",
    isTerminal: false,
    isOnHold: false,
    isUnmapped: true,
    rejectedFromStage: null,
  };
}

/** Every Zoho status this module recognises. Used by the coverage report. */
export function knownZohoStatuses(): string[] {
  return [...Object.keys(DIRECT), ...Object.keys(REJECTIONS)].sort();
}
