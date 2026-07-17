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
  created_at: string;
  updated_at: string;
};
export type MembershipRow = {
  id: string;
  user_id: string;
  organization_id: string | null;
  role: string;
  country_code: string | null;
  status: string;
  created_at: string;
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
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
export type ApplicationRow = {
  id: string;
  candidate_id: string;
  job_order_id: string;
  owning_org_id: string;
  recruitment_path: "A" | "B";
  entry_source: string;
  current_stage: string;
  assigned_recruiter_id: string | null;
  consent_status: string;
  cv_document_id: string | null;
  priority: string;
  is_on_hold: boolean;
  next_action: string | null;
  next_action_due: string | null;
  withdrawn_at: string | null;
  created_at: string;
  updated_at: string;
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
export type IntegrationConnectionRow = {
  id: string;
  key: string;
  name: string;
  status: string;
  config: Json;
  updated_at: string;
};
export type FeatureFlagRow = { key: string; is_enabled: boolean; notes: string | null };
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
      candidate_profiles: Tbl<CandidateProfileRow>;
      candidate_experiences: Tbl<CandidateExperienceRow>;
      candidate_education: Tbl<CandidateEducationRow>;
      candidate_skills: Tbl<CandidateSkillRow>;
      candidate_languages: Tbl<CandidateLanguageRow>;
      candidate_certifications: Tbl<CandidateCertificationRow>;
      candidate_preferences: Tbl<CandidatePreferenceRow>;
      candidate_search_visibility: Tbl<CandidateVisibilityRow>;
      candidate_documents: Tbl<CandidateDocumentRow>;
      candidate_consents: Tbl<CandidateConsentRow>;
      resume_parse_runs: Tbl<ResumeParseRunRow>;
      resume_field_suggestions: Tbl<ResumeFieldSuggestionRow>;
      job_orders: Tbl<JobOrderRow>;
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
      integration_connections: Tbl<IntegrationConnectionRow>;
      feature_flags: Tbl<FeatureFlagRow>;
    };
    Views: {
      public_jobs: { Row: PublicJobRow; Relationships: [] };
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
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
