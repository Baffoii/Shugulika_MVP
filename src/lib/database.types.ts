/**
 * Hand-authored Supabase types matching supabase/migrations/0001_mvp_schema.sql.
 * (Generated types are unavailable without a service key/CLI; keep this in sync
 * with the migrations.) Row types are exact; Insert/Update are permissive
 * partials — runtime validation is done by Zod + database constraints.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Tbl<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] };

export type CountryRow = {
  code: string;
  name: string;
  currency: string | null;
  is_active: boolean;
  sort_order: number;
};
export type PipelineStageRow = {
  key: string;
  label: string;
  ordinal: number;
  stage_class: "job" | "candidate" | "accounts";
};
export type RejectionReasonRow = { key: string; label: string; applies_to: string };
export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  headline: string | null;
  onboarded: boolean;
  created_at: string;
  updated_at: string;
};
export type OrganizationRow = {
  id: string;
  org_type: "hq" | "franchise" | "employer";
  name: string;
  country_code: string | null;
  parent_id: string | null;
  status: string;
  industry: string | null;
  website: string | null;
  company_size: string | null;
  verification_status: string;
  trading_name: string | null;
  legal_type: string | null;
  year_established: number | null;
  region: string | null;
  city: string | null;
  physical_address: string | null;
  postal_address: string | null;
  /** Franchise geographic coverage inside its country. NULL = whole country. */
  coverage_regions: string[] | null;
  created_at: string;
  updated_at: string;
};
export type MembershipRow = {
  id: string;
  user_id: string;
  organization_id: string | null;
  role: string;
  country_code: string | null;
  /** Present for recruiter memberships: generic | head | junior */
  recruiter_level: "generic" | "head" | "junior" | null;
  status: string;
  /** First employer administrator flag (company administration capability). */
  is_org_admin: boolean;
  created_at: string;
};

// ---- Employer onboarding (Workflow 1) ---------------------------------------
export type EmployerApplicationStatusDb =
  | "draft"
  | "submitted"
  | "under_review"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "withdrawn";

export type EmployerApplicationRow = {
  id: string;
  applicant_user_id: string;
  status: EmployerApplicationStatusDb;
  version: number;
  legal_name: string | null;
  trading_name: string | null;
  organization_type: string | null;
  industry: string | null;
  company_size: string | null;
  year_established: number | null;
  website: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  physical_address: string | null;
  postal_address: string | null;
  contact_name: string | null;
  contact_job_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_is_authorized: boolean;
  routing_mode: "auto" | "franchise" | "hq";
  requested_franchise_id: string | null;
  /** Responsible review queue. NULL = HQ queue. */
  assigned_org_id: string | null;
  declared_accurate: boolean;
  declared_authorized: boolean;
  accepted_terms: boolean;
  duplicate_warning: boolean;
  duplicate_reasons: string[];
  changes_requested_message: string | null;
  requested_changes: Json;
  rejection_category: string | null;
  rejection_reason: string | null;
  reapply_allowed: boolean | null;
  previous_application_id: string | null;
  resulting_org_id: string | null;
  submitted_at: string | null;
  first_submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployerApplicationEventRow = {
  id: number;
  application_id: string;
  actor_id: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  assigned_org_id: string | null;
  message: string | null;
  visible_to_employer: boolean;
  metadata: Json;
  created_at: string;
};

export type EligibleFranchiseRow = {
  id: string;
  name: string;
  country_code: string;
  coverage_regions: string[] | null;
};

export type JobRoleRow = {
  id: string;
  label: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type RecruiterRoleAssignmentRow = {
  id: string;
  recruiter_id: string;
  recruiter_organization_id: string | null;
  job_role_id: string;
  assigned_by: string | null;
  assigned_region_code: string | null;
  status: "active" | "inactive" | "archived";
  created_at: string;
  updated_at: string;
};

export type RecruiterKpiTargetRow = {
  id: string;
  recruiter_level: "generic" | "head" | "junior";
  organization_id: string | null;
  target_time_to_fill_days: number;
  target_placement_rate_pct: number;
  target_apps_reviewed_per_week: number;
  target_offer_to_hire_ratio_pct: number;
  min_aptitude_test_score: number | null;
  created_at: string;
  updated_at: string;
};
export type CandidateProfileRow = {
  id: string;
  user_id: string;
  given_name: string | null;
  middle_name: string | null;
  family_name: string | null;
  /** Professional contact email — independent of the Auth sign-in email. */
  contact_email: string | null;
  headline: string | null;
  summary: string | null;
  country_code: string | null;
  city: string | null;
  date_of_birth: string | null;
  availability: string | null;
  open_to_work: boolean;
  profile_status: string;
  completion_pct: number;
  created_at: string;
  updated_at: string;
};
export type CandidateExperienceRow = {
  id: string;
  candidate_id: string;
  title: string;
  employer_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  description: string | null;
  kind: string;
  created_at: string;
};
export type CandidateEducationRow = {
  id: string;
  candidate_id: string;
  institution: string;
  qualification: string | null;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  created_at: string;
};
export type CandidateSkillRow = {
  id: string;
  candidate_id: string;
  name: string;
  level: string | null;
  is_searchable: boolean;
};
export type CandidateLanguageRow = {
  id: string;
  candidate_id: string;
  language: string;
  proficiency: string | null;
};
export type CandidateCertificationRow = {
  id: string;
  candidate_id: string;
  name: string;
  issuer: string | null;
  issued_on: string | null;
};
export type CandidatePreferenceRow = {
  candidate_id: string;
  desired_roles: string[];
  preferred_industries: string[];
  preferred_locations: string[];
  min_salary: number | null;
  max_salary: number | null;
  salary_currency: string | null;
  salary_private: boolean;
  willing_to_relocate: boolean;
  remote_preference: string | null;
  employment_types: string[];
  notice_period: string | null;
  updated_at: string;
};
export type CandidateVisibilityRow = {
  candidate_id: string;
  is_searchable: boolean;
  approved_fields: string[];
  updated_at: string;
};
export type CandidateDocumentRow = {
  id: string;
  candidate_id: string;
  doc_type: string;
  title: string | null;
  bucket_id: string;
  object_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_primary: boolean;
  status: string;
  parse_status: "none" | "queued" | "processing" | "succeeded" | "failed";
  created_at: string;
};
export type ResumeParseRunRow = {
  id: string;
  candidate_id: string;
  document_id: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  provider: string;
  model: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};
export type ResumeSuggestionTargetEntity =
  "profile" | "experience" | "education" | "skill" | "certification" | "language";
export type ResumeSuggestionStatus = "pending" | "accepted" | "edited" | "rejected";
export type ResumeFieldSuggestionRow = {
  id: string;
  parse_run_id: string;
  candidate_id: string;
  target_entity: ResumeSuggestionTargetEntity;
  target_entity_id: string | null;
  field_path: string;
  suggested_value: Json;
  current_value: Json | null;
  confidence: number;
  status: ResumeSuggestionStatus;
  evidence_text: string | null;
  resolved_at: string | null;
  created_at: string;
};
export type JobRequirementCategory =
  "skill" | "experience" | "education" | "language" | "certification" | "responsibility" | "other";
export type JobRequirementImportance = "must_have" | "nice_to_have";
export type JobRequirementRow = {
  id: string;
  job_order_id: string;
  category: JobRequirementCategory;
  label: string;
  detail: string | null;
  importance: JobRequirementImportance;
  min_years: number | null;
  ordinal: number;
  source: "manual" | "ai_parsed";
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type ApplicationAiReviewStatus = "queued" | "processing" | "succeeded" | "failed";
export type ApplicationAiReviewVerdict =
  "strong_fit" | "possible_fit" | "weak_fit" | "insufficient_evidence";
export type ApplicationAiReviewRow = {
  id: string;
  application_id: string;
  job_order_id: string;
  status: ApplicationAiReviewStatus;
  provider: string;
  model: string | null;
  overall_score: number | null;
  fit_verdict: ApplicationAiReviewVerdict | null;
  summary: string | null;
  strengths: string | null;
  concerns: string | null;
  recommended_questions: Json | null;
  model_reasoning: string | null;
  cv_document_id: string | null;
  requirements_fingerprint: string | null;
  error_message: string | null;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
export type ApplicationAiReviewItemType =
  "requirement_match" | "strength" | "gap" | "concern" | "question";
export type ApplicationAiReviewItemAssessment = "met" | "partial" | "missing" | "unclear";
export type ApplicationAiReviewItemRow = {
  id: string;
  review_id: string;
  requirement_id: string | null;
  item_type: ApplicationAiReviewItemType;
  label: string;
  assessment: ApplicationAiReviewItemAssessment | null;
  explanation: string;
  evidence_text: string | null;
  confidence: number | null;
  ordinal: number;
  created_at: string;
};
export type AiUsageFeature = "resume" | "screening" | "assessment";
export type AiUsageEventRow = {
  id: string;
  feature: AiUsageFeature;
  purpose: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  estimated_usd: number | null;
  duration_ms: number | null;
  actor_id: string | null;
  created_at: string;
};
export type CandidateConsentRow = {
  id: string;
  candidate_id: string;
  purpose: string;
  covered_org_id: string | null;
  scope: Json;
  method: string;
  granted_at: string;
  withdrawn_at: string | null;
  note: string | null;
};
export type JobOrderRow = {
  id: string;
  employer_org_id: string;
  responsible_org_id: string;
  title: string;
  department: string | null;
  description: string | null;
  responsibilities: string | null;
  requirements: string | null;
  country_code: string;
  city: string | null;
  employment_type: string | null;
  work_arrangement: string | null;
  experience_level: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_public: boolean;
  benefits: string | null;
  vacancy_count: number;
  recruitment_path: "A" | "B";
  is_confidential: boolean;
  status: string;
  application_deadline: string | null;
  target_start_date: string | null;
  closed_reason: string | null;
  denial_reason: string | null;
  created_by: string | null;
  /** Controlled vocabulary from job_roles.id */
  job_role: string | null;
  assessment_mode: "shugulika" | "employer" | "both";
  assessment_seniority: "junior" | "senior";
  /** Passing score percent for the Shugulika aptitude plan (typically 60–70). */
  assessment_pass_threshold: number;
  assessment_file_bucket: string | null;
  assessment_file_path: string | null;
  assessment_file_name: string | null;
  assessment_file_mime: string | null;
  assessment_file_size: number | null;
  created_at: string;
  updated_at: string;
};
export type AssessmentAssignmentRow = {
  id: string;
  application_id: string;
  job_order_id: string;
  candidate_id: string;
  assessment_mode: "shugulika" | "employer" | "both";
  assessment_seniority: "junior" | "senior";
  status: "assigned" | "opened" | "in_progress" | "submitted" | "graded" | "cancelled" | "expired";
  assigned_by: string;
  assigned_at: string;
  due_at: string | null;
  opened_at: string | null;
  submitted_at: string | null;
  score: number | null;
  result_band: string | null;
  grader_id: string | null;
  graded_at: string | null;
  grading_notes: string | null;
  /** Optional future provider key; null means first-party / manual. */
  provider: string | null;
  external_reference: string | null;
  pass_threshold: number | null;
  mcq_score: number | null;
  free_response_score: number | null;
  human_review_required: boolean;
  ai_confidence: number | null;
  grading_payload: Json;
  responses: Json;
  created_at: string;
  updated_at: string;
};
export type JobOrderAssessmentFileRow = {
  id: string;
  job_order_id: string;
  kind: "candidate_test" | "answer_key";
  bucket_id: string;
  object_path: string;
  file_name: string;
  mime_type: string | null;
  byte_size: number | null;
  uploaded_by: string | null;
  created_at: string;
};
export type JobRow = {
  id: string;
  job_order_id: string;
  status: string;
  public_slug: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
export type JobScreeningQuestionRow = {
  id: string;
  job_order_id: string;
  prompt: string;
  qtype: string;
  options: Json;
  is_required: boolean;
  ordinal: number;
};
export type JobAssignmentRow = {
  id: string;
  job_order_id: string;
  recruiter_user_id: string;
  role: string;
};
export type SavedJobRow = { id: string; candidate_id: string; job_id: string; created_at: string };
export type SourcedContactStatus = "not_contacted" | "contacted" | "interested" | "declined";

export type ApplicationRow = {
  id: string;
  candidate_id: string;
  job_order_id: string;
  owning_org_id: string;
  recruitment_path: "A" | "B";
  entry_source: string;
  /** False when the recruiter sourced the candidate onto the job (R-064). */
  is_direct_application: boolean;
  sourced_contact_status: SourcedContactStatus | null;
  sourced_contacted_at: string | null;
  current_stage: string;
  assigned_recruiter_id: string | null;
  consent_status: string;
  cv_document_id: string | null;
  priority: string;
  is_on_hold: boolean;
  next_action: string | null;
  next_action_due: string | null;
  withdrawn_at: string | null;
  rejected_from_stage: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  test_name: string | null;
  test_score: string | null;
  created_at: string;
  updated_at: string;
};

/** Ring-2 discovery projection — only candidate-approved fields (R-012). */
export type DiscoverableCandidateRow = {
  candidate_id: string;
  given_name: string | null;
  family_name: string | null;
  headline: string | null;
  country_code: string | null;
  city: string | null;
  skills: string[];
  education_level: string | null;
  experience_summary: string | null;
  experience_years: number | null;
  languages: string[];
  availability: string | null;
  desired_roles: string[];
  approved_fields: string[];
  open_to_work: boolean;
  has_own_engagement: boolean;
};

export type CandidateSearchAccessEventRow = {
  id: number;
  actor_id: string | null;
  candidate_id: string;
  org_context_id: string | null;
  access_kind: string;
  metadata: Json;
  created_at: string;
};
export type ApplicationAnswerRow = {
  id: string;
  application_id: string;
  question_id: string | null;
  prompt: string | null;
  answer: Json;
};
export type ApplicationStageHistoryRow = {
  id: number;
  application_id: string;
  from_stage: string | null;
  to_stage: string;
  actor_id: string | null;
  actor_role: string | null;
  reason: string | null;
  note: string | null;
  source: string;
  created_at: string;
};
export type RecruiterNoteRow = {
  id: string;
  subject_type: string;
  subject_id: string;
  owning_org_id: string;
  author_id: string;
  body: string;
  visibility: string;
  created_at: string;
};
export type CandidateTagRow = {
  id: string;
  candidate_id: string;
  owning_org_id: string;
  tag: string;
};
export type EmployerSubmissionRow = {
  id: string;
  application_id: string | null;
  candidate_id: string;
  job_order_id: string;
  employer_org_id: string;
  submitting_org_id: string;
  submitting_recruiter_id: string | null;
  consent_id: string | null;
  status: string;
  is_masked: boolean;
  summary: string | null;
  disclosed_profile: Json;
  disclosed_fields: string[];
  cv_document_id: string | null;
  submitted_at: string | null;
  access_expires_at: string | null;
  access_revoked_at: string | null;
  created_at: string;
  updated_at: string;
};
export type EmployerCommentRow = {
  id: string;
  submission_id: string;
  author_id: string;
  body: string;
  created_at: string;
};
export type InterviewRow = {
  id: string;
  application_id: string | null;
  submission_id: string | null;
  owning_org_id: string;
  interview_type: string;
  round_no: number;
  status: string;
  scheduled_at: string | null;
  duration_minutes: number | null;
  location_or_link: string | null;
  instructions: string | null;
  expires_at: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
};
export type OfferRow = {
  id: string;
  application_id: string;
  owning_org_id: string;
  employer_org_id: string;
  status: string;
  position_title: string | null;
  compensation: number | null;
  currency: string | null;
  start_date: string | null;
  conditions: string | null;
  expires_at: string | null;
  declined_reason: string | null;
  created_at: string;
  updated_at: string;
};
export type PlacementRow = {
  id: string;
  offer_id: string;
  application_id: string;
  employer_org_id: string;
  owning_org_id: string;
  recruiter_id: string | null;
  start_date: string | null;
  fee: number | null;
  currency: string | null;
  guarantee_days: number | null;
  status: string;
  created_at: string;
};
export type PackageRow = {
  id: string;
  key: string;
  name: string;
  tier: number;
  is_active: boolean;
};
export type PackageEntitlementRow = {
  id: string;
  package_id: string;
  key: string;
  limit_value: number | null;
  period: string;
};
export type EmployerSubscriptionRow = {
  id: string;
  employer_org_id: string;
  package_id: string;
  status: string;
  is_trial: boolean;
  trial_ends_on: string | null;
  starts_on: string;
  expires_on: string | null;
  created_at: string;
};
export type InvoiceRow = {
  id: string;
  invoice_number: string;
  owning_org_id: string;
  employer_org_id: string | null;
  subscription_id: string | null;
  placement_id: string | null;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
  payment_status: string;
  issue_date: string | null;
  due_date: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};
export type InvoiceItemRow = {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_amount: number;
  line_total: number;
};
export type PaymentRecordRow = {
  id: string;
  invoice_id: string;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  status: string;
  recorded_by: string | null;
  paid_at: string | null;
  note: string | null;
  created_at: string;
};
export type NotificationRow = {
  id: string;
  user_id: string;
  category: string;
  title: string;
  body: string | null;
  subject_type: string | null;
  subject_id: string | null;
  read_at: string | null;
  created_at: string;
};
export type ActivityEventRow = {
  id: number;
  owning_org_id: string | null;
  subject_type: string;
  subject_id: string;
  event_type: string;
  actor_id: string | null;
  summary: string | null;
  metadata: Json;
  created_at: string;
};
export type AuditLogRow = {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  org_context_id: string | null;
  before_value: Json;
  after_value: Json;
  metadata: Json;
  created_at: string;
};
export type DocumentAccessEventRow = {
  id: number;
  actor_id: string | null;
  source_kind: "candidate_document" | "assessment_file";
  source_id: string;
  access_scope: "preview" | "export";
  bucket_id: string;
  object_path: string;
  job_order_id: string | null;
  application_id: string | null;
  submission_id: string | null;
  org_context_id: string | null;
  watermark_text: string | null;
  metadata: Json;
  created_at: string;
};
export type IntegrationConnectionRow = {
  id: string;
  key: string;
  name: string;
  status: string;
  config: Json;
  updated_at: string;
};
export type FeatureFlagRow = { key: string; is_enabled: boolean; notes: string | null };

// ---- Asynchronous video interviews (migrations 0016–0019) -------------------
export type InterviewAssignmentStatus =
  "draft" | "invited" | "in_progress" | "submitted" | "reviewed" | "expired" | "cancelled";
export type InterviewQuestionStatus = "pending" | "in_progress" | "completed";
export type InterviewUploadStatus = "pending" | "uploading" | "uploaded" | "failed";
export type InterviewReviewStatus = "pending" | "reviewed" | "advanced" | "not_selected";
export type InterviewEventType =
  | "interview_opened"
  | "consent_given"
  | "permissions_requested"
  | "permissions_denied"
  | "question_opened"
  | "preparation_started"
  | "recording_started"
  | "recording_stopped"
  | "retry_selected"
  | "upload_started"
  | "upload_completed"
  | "upload_failed"
  | "response_selected"
  | "question_completed"
  | "interview_submitted"
  | "session_started"
  | "session_heartbeat"
  | "session_interrupted"
  | "session_resumed"
  | "visibility_hidden"
  | "visibility_visible"
  | "page_unload_warned"
  | "connection_lost"
  | "connection_restored"
  | "break_started"
  | "break_ended"
  | "document_change_attempted"
  | "document_snapshot_locked";

export type InterviewDocumentSnapshotItem = {
  document_id: string;
  doc_type: string;
  title: string | null;
  bucket_id: string;
  object_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_primary: boolean;
  status: string;
  created_at: string;
};

export type InterviewTemplateRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  default_preparation_seconds: number;
  default_response_seconds: number;
  default_max_attempts: number;
  retention_days: number;
  allow_pause_between_questions: boolean;
  allow_response_review: boolean;
  default_deadline_days: number;
  expiration_grace_hours: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type InterviewTemplateQuestionRow = {
  id: string;
  template_id: string;
  question_text: string;
  guidance: string | null;
  display_order: number;
  preparation_seconds: number | null;
  response_seconds: number | null;
  max_attempts: number | null;
  is_required: boolean;
  created_at: string;
  updated_at: string;
};
export type InterviewAssignmentRow = {
  id: string;
  template_id: string;
  candidate_id: string;
  application_id: string;
  job_order_id: string;
  organization_id: string;
  assigned_by: string | null;
  status: InterviewAssignmentStatus;
  invited_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  expires_at: string | null;
  cancelled_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  candidate_instructions: string | null;
  template_name_snapshot: string;
  template_instructions_snapshot: string | null;
  consented_at: string | null;
  privacy_notice_version: string | null;
  instructions_version: string | null;
  retention_days: number;
  allow_pause_between_questions: boolean;
  allow_response_review: boolean;
  expiration_grace_hours: number;
  session_token: string | null;
  session_token_issued_at: string | null;
  interruption_count: number;
  has_unusual_interruptions: boolean;
  documents_locked_at: string | null;
  document_snapshot: InterviewDocumentSnapshotItem[] | Json;
  created_at: string;
  updated_at: string;
};
export type InterviewAssignmentQuestionRow = {
  id: string;
  assignment_id: string;
  source_template_question_id: string | null;
  question_text_snapshot: string;
  question_description_snapshot: string | null;
  display_order: number;
  preparation_seconds: number;
  response_seconds: number;
  max_attempts: number;
  is_required: boolean;
  status: InterviewQuestionStatus;
  started_at: string | null;
  completed_at: string | null;
};
export type InterviewResponseAttemptRow = {
  id: string;
  assignment_question_id: string;
  assignment_id: string;
  candidate_id: string;
  attempt_number: number;
  storage_bucket: string;
  /** Private storage path (never a public URL). */
  storage_path: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  preparation_time_used_seconds: number | null;
  recording_started_at: string | null;
  recording_ended_at: string | null;
  uploaded_at: string | null;
  upload_status: InterviewUploadStatus;
  is_selected_submission: boolean;
  discarded_at: string | null;
  client_metadata: Json;
  created_at: string;
};
export type InterviewReviewRow = {
  id: string;
  assignment_id: string;
  recruiter_id: string;
  overall_rating: number | null;
  review_status: InterviewReviewStatus;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
};
export type InterviewEventRow = {
  id: number;
  assignment_id: string;
  assignment_question_id: string | null;
  actor_user_id: string | null;
  event_type: InterviewEventType;
  event_timestamp: string;
  metadata: Json;
};
export type InterviewQuestionAnalyticsRow = {
  assignment_question_id: string;
  assignment_id: string;
  display_order: number;
  is_required: boolean;
  status: InterviewQuestionStatus;
  attempts_used: number;
  retry_count: number;
  selected_attempt_number: number | null;
  selected_response_duration_seconds: number | null;
  average_attempt_duration_seconds: number | null;
  total_attempt_duration_seconds: number;
  preparation_time_used_seconds: number | null;
  time_from_question_opened_to_completion_seconds: number | null;
  upload_failure_count: number;
};
export type InterviewAssignmentAnalyticsRow = {
  assignment_id: string;
  status: InterviewAssignmentStatus;
  required_question_count: number;
  total_question_count: number;
  completed_question_count: number;
  completion_percentage: number;
  started_at: string | null;
  submitted_at: string | null;
  total_elapsed_seconds: number | null;
  total_attempts: number;
  total_retries: number;
  average_final_response_duration_seconds: number | null;
  average_attempts_per_question: number | null;
  total_final_recording_duration_seconds: number;
  total_recording_duration_seconds: number;
  upload_failure_count: number;
  total_uploaded_bytes: number;
};
export type PublicJobRow = {
  job_id: string;
  public_slug: string | null;
  published_at: string | null;
  status: string;
  job_order_id: string;
  title: string;
  department: string | null;
  description: string | null;
  responsibilities: string | null;
  requirements: string | null;
  country_code: string;
  city: string | null;
  employment_type: string | null;
  work_arrangement: string | null;
  experience_level: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  vacancy_count: number;
  application_deadline: string | null;
  recruitment_path: "A" | "B";
  is_confidential: boolean;
  employer_name: string;
};

export type Database = {
  public: {
    Tables: {
      countries: Tbl<CountryRow>;
      pipeline_stages: Tbl<PipelineStageRow>;
      rejection_reasons: Tbl<RejectionReasonRow>;
      profiles: Tbl<ProfileRow>;
      organizations: Tbl<OrganizationRow>;
      memberships: Tbl<MembershipRow>;
      employer_applications: Tbl<EmployerApplicationRow>;
      employer_application_events: Tbl<EmployerApplicationEventRow>;
      job_roles: Tbl<JobRoleRow>;
      recruiter_role_assignments: Tbl<RecruiterRoleAssignmentRow>;
      recruiter_kpi_targets: Tbl<RecruiterKpiTargetRow>;
      candidate_profiles: Tbl<CandidateProfileRow>;
      candidate_experiences: Tbl<CandidateExperienceRow>;
      candidate_education: Tbl<CandidateEducationRow>;
      candidate_skills: Tbl<CandidateSkillRow>;
      candidate_languages: Tbl<CandidateLanguageRow>;
      candidate_certifications: Tbl<CandidateCertificationRow>;
      candidate_preferences: Tbl<CandidatePreferenceRow>;
      candidate_search_visibility: Tbl<CandidateVisibilityRow>;
      candidate_search_access_events: Tbl<CandidateSearchAccessEventRow>;
      candidate_documents: Tbl<CandidateDocumentRow>;
      candidate_consents: Tbl<CandidateConsentRow>;
      resume_parse_runs: Tbl<ResumeParseRunRow>;
      resume_field_suggestions: Tbl<ResumeFieldSuggestionRow>;
      job_requirements: Tbl<JobRequirementRow>;
      application_ai_reviews: Tbl<ApplicationAiReviewRow>;
      application_ai_review_items: Tbl<ApplicationAiReviewItemRow>;
      ai_usage_events: Tbl<AiUsageEventRow>;
      job_orders: Tbl<JobOrderRow>;
      assessment_assignments: Tbl<AssessmentAssignmentRow>;
      job_order_assessment_files: Tbl<JobOrderAssessmentFileRow>;
      jobs: Tbl<JobRow>;
      job_screening_questions: Tbl<JobScreeningQuestionRow>;
      job_assignments: Tbl<JobAssignmentRow>;
      saved_jobs: Tbl<SavedJobRow>;
      applications: Tbl<ApplicationRow>;
      application_answers: Tbl<ApplicationAnswerRow>;
      application_stage_history: Tbl<ApplicationStageHistoryRow>;
      recruiter_notes: Tbl<RecruiterNoteRow>;
      candidate_tags: Tbl<CandidateTagRow>;
      employer_submissions: Tbl<EmployerSubmissionRow>;
      employer_comments: Tbl<EmployerCommentRow>;
      interviews: Tbl<InterviewRow>;
      offers: Tbl<OfferRow>;
      placements: Tbl<PlacementRow>;
      packages: Tbl<PackageRow>;
      package_entitlements: Tbl<PackageEntitlementRow>;
      employer_subscriptions: Tbl<EmployerSubscriptionRow>;
      invoices: Tbl<InvoiceRow>;
      invoice_items: Tbl<InvoiceItemRow>;
      payment_records: Tbl<PaymentRecordRow>;
      notifications: Tbl<NotificationRow>;
      activity_events: Tbl<ActivityEventRow>;
      audit_logs: Tbl<AuditLogRow>;
      document_access_events: Tbl<DocumentAccessEventRow>;
      integration_connections: Tbl<IntegrationConnectionRow>;
      feature_flags: Tbl<FeatureFlagRow>;
      interview_templates: Tbl<InterviewTemplateRow>;
      interview_template_questions: Tbl<InterviewTemplateQuestionRow>;
      interview_assignments: Tbl<InterviewAssignmentRow>;
      interview_assignment_questions: Tbl<InterviewAssignmentQuestionRow>;
      interview_response_attempts: Tbl<InterviewResponseAttemptRow>;
      interview_reviews: Tbl<InterviewReviewRow>;
      interview_events: Tbl<InterviewEventRow>;
    };
    Views: {
      public_jobs: { Row: PublicJobRow; Relationships: [] };
      interview_question_analytics: { Row: InterviewQuestionAnalyticsRow; Relationships: [] };
      interview_assignment_analytics: {
        Row: InterviewAssignmentAnalyticsRow;
        Relationships: [];
      };
      interview_deadline_reminder_candidates: {
        Row: {
          assignment_id: string;
          organization_id: string;
          expires_at: string;
          candidate_user_id: string;
          job_title: string;
        };
        Relationships: [];
      };
      apply_targets: {
        Row: {
          job_order_id: string;
          responsible_org_id: string;
          recruitment_path: "A" | "B";
          job_status: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      submit_interview: {
        Args: { p_assignment_id: string };
        Returns: InterviewAssignmentRow;
      };
      send_interview_deadline_reminder: {
        Args: { p_assignment_id: string };
        Returns: boolean;
      };
      begin_or_resume_interview_session: {
        Args: {
          p_assignment_id: string;
          p_previous_token?: string | null;
          p_reason?: string | null;
        };
        Returns: {
          session_token: string;
          resumed: boolean;
          interruption_count: number;
          has_unusual_interruptions: boolean;
          allow_pause_between_questions: boolean;
          allow_response_review: boolean;
        }[];
      };
      record_interview_session_event: {
        Args: {
          p_assignment_id: string;
          p_session_token: string;
          p_event_type: string;
          p_assignment_question_id?: string | null;
          p_metadata?: Json;
        };
        Returns: boolean;
      };
      lock_interview_document_snapshot: {
        Args: { p_assignment_id: string };
        Returns: Json;
      };
      candidate_has_active_interview: {
        Args: { p_candidate_id: string };
        Returns: boolean;
      };
      notify_staff_of_application: {
        Args: { p_application_id: string; p_event?: string };
        Returns: number;
      };
      notify_candidate_of_application_status: {
        Args: {
          p_application_id: string;
          p_title: string;
          p_body: string;
          p_category?: string;
        };
        Returns: string;
      };
      advance_application: {
        Args: {
          p_application: string;
          p_to_stage: string;
          p_note?: string | null;
          p_metadata?: Json;
        };
        Returns: Json;
      };
      reject_application: {
        Args: {
          p_application: string;
          p_reason: string;
          p_note?: string | null;
        };
        Returns: Json;
      };
      reopen_application: {
        Args: {
          p_application: string;
          p_note?: string | null;
          p_source?: string | null;
        };
        Returns: Json;
      };
      create_placement_from_offer: {
        Args: { p_offer: string };
        Returns: string;
      };
      notify_candidate_of_assessment_assignment: {
        Args: {
          p_assignment_id: string;
          p_title: string;
          p_body: string;
        };
        Returns: string;
      };
      ai_cv_screens_used: {
        Args: { p_employer_org: string; p_since: string };
        Returns: number;
      };
      approve_and_publish_job_order: {
        Args: { p_job_order_id: string };
        Returns: string;
      };
      withdraw_job_order: {
        Args: { p_job_order_id: string };
        Returns: undefined;
      };
      deny_job_order: {
        Args: { p_job_order_id: string; p_reason: string };
        Returns: undefined;
      };
      apply_assessment_grade: {
        Args: {
          p_assignment_id: string;
          p_responses: Json;
          p_score: number;
          p_mcq_score: number | null;
          p_free_response_score: number | null;
          p_result_band: string;
          p_human_review_required: boolean;
          p_ai_confidence: number | null;
          p_grading_payload: Json;
          p_grading_notes: string | null;
        };
        Returns: undefined;
      };
      assign_job_order_recruiter: {
        Args: { p_job_order_id: string; p_recruiter_user_id: string };
        Returns: undefined;
      };
      search_talent_pool: {
        Args: {
          p_q?: string | null;
          p_skill?: string | null;
          p_country?: string | null;
          p_city?: string | null;
          p_availability?: string | null;
          p_experience_level?: string | null;
          p_limit?: number | null;
        };
        Returns: DiscoverableCandidateRow[];
      };
      open_discovered_candidate: {
        Args: { p_candidate: string };
        Returns: DiscoverableCandidateRow[];
      };
      project_searchable_candidate: {
        Args: { p_candidate: string };
        Returns: DiscoverableCandidateRow[];
      };
      eligible_employer_franchises: {
        Args: { p_country: string; p_region?: string | null };
        Returns: EligibleFranchiseRow[];
      };
      submit_employer_application: {
        Args: { p_application_id: string };
        Returns: EmployerApplicationRow;
      };
      withdraw_employer_application: {
        Args: { p_application_id: string };
        Returns: undefined;
      };
      open_employer_application_review: {
        Args: { p_application_id: string };
        Returns: undefined;
      };
      approve_employer_application: {
        Args: { p_application_id: string };
        Returns: string;
      };
      request_employer_application_changes: {
        Args: { p_application_id: string; p_message: string; p_changes?: Json };
        Returns: undefined;
      };
      reject_employer_application: {
        Args: {
          p_application_id: string;
          p_category: string;
          p_reason: string;
          p_reapply_allowed: boolean;
          p_internal_note?: string | null;
        };
        Returns: undefined;
      };
      reassign_employer_application: {
        Args: { p_application_id: string; p_org_id?: string | null };
        Returns: undefined;
      };
      add_employer_application_note: {
        Args: { p_application_id: string; p_note: string };
        Returns: undefined;
      };
      start_revised_employer_application: {
        Args: { p_previous_id: string };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
