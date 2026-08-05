import type { JobOrderOrigin, JobOrderWorkflowStatus } from "@/lib/jobs/types";

export const JOB_ORDER_ORIGINS = ["employer_online", "shugulika_offline"] as const;

export const JOB_ORDER_ORIGIN_LABELS: Record<JobOrderOrigin, string> = {
  employer_online: "Employer online",
  shugulika_offline: "Shugulika offline",
};

export const JOB_ORDER_WORKFLOW_STATUSES = [
  "draft",
  "awaiting_employer_approval",
  "submitted_to_shugulika",
  "changes_requested",
  "approved_by_employer",
  "approved_by_shugulika",
  "submitted",
  "approved",
  "active",
  "on_hold",
  "paused",
  "filled",
  "partially_filled",
  "cancelled",
  "closed",
  "denied",
] as const satisfies readonly JobOrderWorkflowStatus[];

export const JOB_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  awaiting_employer_approval: "Awaiting employer approval",
  submitted_to_shugulika: "Submitted to Shugulika",
  changes_requested: "Changes requested",
  approved_by_employer: "Approved by employer",
  approved_by_shugulika: "Approved by Shugulika",
  submitted: "Submitted",
  approved: "Approved",
  active: "Active",
  on_hold: "On hold",
  paused: "Paused",
  filled: "Filled",
  partially_filled: "Partially filled",
  cancelled: "Cancelled",
  closed: "Closed",
  denied: "Denied",
};

/** Statuses an employer may withdraw. */
export const JOB_ORDER_WITHDRAWABLE_STATUSES = new Set([
  "draft",
  "submitted",
  "submitted_to_shugulika",
  "awaiting_employer_approval",
  "changes_requested",
  "approved_by_employer",
  "approved_by_shugulika",
  "approved",
  "active",
  "on_hold",
  "paused",
]);

/** Statuses that can receive a recruiter owner assignment. */
export const JOB_ORDER_ASSIGNABLE_STATUSES = new Set([
  "approved",
  "approved_by_employer",
  "approved_by_shugulika",
  "active",
  "on_hold",
  "paused",
]);

/** Staff may approve (Shugulika) these statuses for online orders. */
export const JOB_ORDER_SHUGULIKA_APPROVABLE_STATUSES = new Set(["submitted_to_shugulika"]);

/** Staff may deny while under review. */
export const JOB_ORDER_DENIABLE_STATUSES = new Set([
  "submitted",
  "submitted_to_shugulika",
  "awaiting_employer_approval",
  "changes_requested",
  "approved_by_employer",
  "approved_by_shugulika",
]);

/** Employer may approve offline orders in this status. */
export const JOB_ORDER_EMPLOYER_APPROVABLE_STATUSES = new Set(["awaiting_employer_approval"]);

/** Material fields that invalidate approval when changed. */
export const JOB_ORDER_MATERIAL_FIELDS = [
  "title",
  "description",
  "requirements",
  "salary_min",
  "salary_max",
  "salary_currency",
  "country_code",
  "city",
  "vacancy_count",
  "recruitment_path",
  "application_deadline",
] as const;
