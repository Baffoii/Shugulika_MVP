/** Local job-order workflow types (database.types.ts is frozen during parallel work). */

export type JobOrderOrigin = "employer_online" | "shugulika_offline";

export type JobOrderWorkflowStatus =
  | "draft"
  | "awaiting_employer_approval"
  | "submitted_to_shugulika"
  | "changes_requested"
  | "approved_by_employer"
  | "approved_by_shugulika"
  | "submitted"
  | "approved"
  | "active"
  | "on_hold"
  | "paused"
  | "filled"
  | "partially_filled"
  | "cancelled"
  | "closed"
  | "denied";

export type JobOrderMaterialSnapshot = {
  employer_org_id: string;
  responsible_org_id: string;
  origin: JobOrderOrigin;
  title: string;
  department: string;
  description: string;
  responsibilities: string;
  requirements: string;
  employment_type: string;
  work_arrangement: string;
  experience_level: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_public: boolean;
  benefits: string;
  country_code: string;
  city: string;
  vacancy_count: number;
  recruitment_path: "A" | "B";
  is_confidential: boolean;
  application_deadline: string | null;
  target_start_date: string | null;
};

export type JobOrderWorkflowRow = {
  id: string;
  employer_org_id: string;
  responsible_org_id: string;
  title: string;
  department: string | null;
  description: string | null;
  responsibilities: string | null;
  requirements: string | null;
  employment_type: string | null;
  work_arrangement: string | null;
  experience_level: string | null;
  country_code: string;
  city: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_public: boolean;
  benefits: string | null;
  vacancy_count: number;
  recruitment_path: "A" | "B";
  is_confidential: boolean;
  application_deadline: string | null;
  target_start_date: string | null;
  status: string;
  origin: JobOrderOrigin;
  approved_snapshot: JobOrderMaterialSnapshot | null;
  approved_snapshot_hash: string | null;
  employer_approved_by: string | null;
  employer_approved_at: string | null;
  shugulika_approved_by: string | null;
  shugulika_approved_at: string | null;
  current_owner_user_id: string | null;
  denial_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type JobOrderEventRow = {
  id: string;
  job_order_id: string;
  from_status: string | null;
  to_status: string;
  event_type: string;
  actor_user_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
};

export type JobOrderChangeRequestRow = {
  id: string;
  job_order_id: string;
  requested_by: string;
  message: string;
  requested_changes: unknown[];
  status: "open" | "addressed" | "cancelled";
  created_at: string;
  resolved_at: string | null;
};

export type JobApprovalNotificationKind =
  | "submitted_to_shugulika"
  | "awaiting_employer_approval"
  | "changes_requested"
  | "approved_by_employer"
  | "approved_by_shugulika"
  | "published"
  | "denied";
