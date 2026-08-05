import type { Json } from "@/lib/database.types";

export type ResultVisibilityTier = "candidate_full" | "candidate_limited" | "completion_only";

export interface AssessmentResultSnapshot {
  assignment_id: string;
  provider: string;
  permitted_payload: Json;
  visibility_tier: ResultVisibilityTier;
  captured_at: string;
}

export interface CandidateVisibleEvent {
  id: number;
  candidate_id: string;
  application_id: string | null;
  event_type:
    | "application_submitted"
    | "stage_changed"
    | "assessment_assigned"
    | "assessment_updated"
    | "result_available"
    | "interview_assigned"
    | "interview_updated"
    | "consent_requested"
    | "result_shared"
    | "result_revoked"
    | "cv_shared"
    | "help_requested"
    | "reschedule_requested"
    | "duplicate_review_requested";
  label: string;
  details: Json;
  occurred_at: string;
}

export interface ResultShareGrant {
  id: string;
  candidate_id: string;
  assignment_id: string;
  recipient_org_id: string;
  purpose: string;
  job_order_id: string;
  scope: Json;
  consent_id: string;
  shared_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  recipient_name?: string;
  job_title?: string;
}

export interface CvShareEvent {
  id: string;
  application_id: string;
  recipient_org_id: string;
  document_id: string;
  consent_id: string;
  channel: "portal_link";
  portal_path: string;
  created_at: string;
}

export interface CandidateAssessmentListItem {
  id: string;
  application_id: string;
  job_order_id: string;
  assessment_mode: "shugulika" | "employer" | "both";
  assessment_seniority: "junior" | "senior";
  status: "assigned" | "opened" | "in_progress" | "submitted" | "graded" | "cancelled" | "expired";
  assigned_at: string;
  due_at: string | null;
  opened_at: string | null;
  submitted_at: string | null;
  provider: string | null;
  paid_by: "candidate" | "employer";
}
