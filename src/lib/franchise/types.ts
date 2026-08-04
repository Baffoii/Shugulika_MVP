/**
 * Franchise-local types. Do not edit src/lib/database.types.ts during this workstream.
 * Additive employer_application ops columns live in migration 20260806090000_*.
 */

export type EmployerAppNextAction =
  | "open_review"
  | "decide"
  | "await_employer"
  | "await_hq"
  | "close_out"
  | "none";

/** Additive ops fields not yet in generated database.types.ts */
export type EmployerApplicationOpsFields = {
  owner_user_id: string | null;
  sla_due_at: string | null;
  next_action: EmployerAppNextAction | null;
};

export type FranchisePeriodGrain =
  | "day"
  | "week"
  | "month"
  | "year"
  | "7d"
  | "30d"
  | "90d"
  | "ytd"
  | "custom";

export type FranchiseSortMode = "alpha_asc" | "alpha_desc" | "newest" | "oldest" | "sla_first";

export const FRANCHISE_NEXT_ACTION_LABELS: Record<EmployerAppNextAction, string> = {
  open_review: "Open review",
  decide: "Decide",
  await_employer: "Await employer",
  await_hq: "Await HQ",
  close_out: "Close out",
  none: "None",
};

export const FRANCHISE_FINANCE_ATTRIBUTION_FLAG = "franchise_finance_attribution";

/** Metrics where a higher franchise override is stricter than the HQ platform floor. */
export const FRANCHISE_TARGET_MIN_KEYS = [
  "target_placement_rate_pct",
  "min_interview_conversion_pct",
  "min_client_submission_acceptance_pct",
  "target_offer_to_hire_ratio_pct",
  "target_apps_reviewed_per_week",
] as const;

/** Metrics where a lower franchise override is stricter than the HQ platform ceiling. */
export const FRANCHISE_TARGET_MAX_KEYS = [
  "max_time_to_first_review_hours",
  "max_time_to_client_submission_days",
  "target_time_to_fill_days",
  "max_active_workload",
  "max_stalled_application_count",
] as const;

export type FranchiseTargetMetricKey =
  | (typeof FRANCHISE_TARGET_MIN_KEYS)[number]
  | (typeof FRANCHISE_TARGET_MAX_KEYS)[number];
