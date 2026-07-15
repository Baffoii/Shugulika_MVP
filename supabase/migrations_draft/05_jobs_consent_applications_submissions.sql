-- =============================================================================
-- File 05: Jobs (Domain I), Consent (R), Applications & Pipeline (J), Submissions (K).
-- Consent is defined before submissions so the submission FK resolves.
-- =============================================================================

-- ---- Consent (Domain R) ----------------------------------------------------
create table public.legal_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_kind text not null check (document_kind in ('privacy_policy','terms','consent_text','dpa')),
  version_no int not null, locale text not null default 'en',
  title text not null, body text not null,
  effective_from date not null default current_date, is_current boolean not null default true,
  unique (document_kind, version_no, locale)
);
alter table public.user_profiles
  add constraint up_terms_fk foreign key (terms_accepted_version_id) references public.legal_document_versions(id),
  add constraint up_privacy_fk foreign key (privacy_accepted_version_id) references public.legal_document_versions(id);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  subject_candidate_id uuid references public.candidates(id),
  subject_user_id uuid references public.user_profiles(id),
  consent_purpose_id uuid not null references public.consent_purposes(id),
  covered_organization_id uuid references public.organizations(id),
  covered_data_scope jsonb not null default '{}',
  legal_document_version_id uuid references public.legal_document_versions(id),
  granted_by uuid references public.user_profiles(id),
  method text not null check (method in ('web_form','otp_confirmed','verbal_recorded','imported','guardian')),
  evidence jsonb not null default '{}',
  purpose_detail text,
  granted_at timestamptz not null default now(),
  expires_at timestamptz, withdrawn_at timestamptz, withdrawal_effect text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(subject_candidate_id, subject_user_id) = 1)
);
comment on table public.consent_records is 'Versioned auditable consent ledger; employer_submission consent must name covered_organization_id (R-030/R-031).';

-- ---- Jobs (Domain I) -------------------------------------------------------
create table public.job_templates (
  id uuid primary key default gen_random_uuid(),
  owning_organization_id uuid not null references public.organizations(id),
  name text not null, payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.job_orders (
  id uuid primary key default gen_random_uuid(),
  employer_organization_id uuid not null references public.employer_organizations(organization_id),
  responsible_organization_id uuid not null references public.organizations(id),
  created_from_template_id uuid references public.job_templates(id),
  title text not null, department text, description text, responsibilities text, requirements text,
  required_skills jsonb, min_experience_years int,
  education_level_id uuid references public.education_levels(id),
  employment_type_id uuid references public.employment_types(id),
  work_arrangement_id uuid references public.work_arrangements(id),
  country_id uuid not null references public.countries(id), location_city text,
  compensation_min numeric, compensation_max numeric, currency_id uuid references public.currencies(id),
  benefits text, vacancy_count int not null default 1,
  application_deadline date, target_start_date date,
  is_confidential boolean not null default false, is_public boolean not null default true,
  recruitment_path text not null check (recruitment_path in ('A','B')),
  path_locked_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','active','on_hold','filled','partially_filled','cancelled','closed','filled_externally','closed_without_hire')),
  closed_reason text, closed_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.user_profiles(id)
);
alter table public.candidate_access_events
  add constraint cae_job_fk foreign key (job_order_id) references public.job_orders(id);

create table public.job_order_events (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  from_status text, to_status text not null,
  actor_user_id uuid references public.user_profiles(id), reason text,
  occurred_at timestamptz not null default now()
);
create table public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id),
  role text not null default 'recruiter' check (role in ('owner','recruiter','coordinator')),
  assigned_by uuid references public.user_profiles(id)
);
create table public.job_hiring_team (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id),
  can_comment boolean not null default true, can_decide boolean not null default false
);
create table public.job_screening_questions (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  prompt text not null,
  question_type text not null check (question_type in ('boolean','single_choice','multi_choice','numeric','short_text')),
  options jsonb, is_required boolean not null default false, ordinal int not null default 0
);
create table public.job_required_documents (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  document_type_id uuid not null references public.document_types(id), is_required boolean not null default true
);

create table public.job_postings (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  country_id uuid not null references public.countries(id),
  status text not null default 'draft' check (status in ('draft','pending_approval','advertised','paused','expired','unpublished')),
  approval_status text not null default 'not_submitted' check (approval_status in ('not_submitted','submitted','changes_requested','approved')),
  approved_by uuid references public.user_profiles(id),
  published_at timestamptz, unpublished_at timestamptz,
  current_version_id uuid, public_slug citext unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.job_posting_versions (
  id uuid primary key default gen_random_uuid(),
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  version_no int not null, title text, body text, snapshot jsonb, created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(), unique (job_posting_id, version_no)
);
alter table public.job_postings
  add constraint jp_current_version_fk foreign key (current_version_id) references public.job_posting_versions(id);
create table public.job_posting_channels (
  id uuid primary key default gen_random_uuid(),
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  channel text not null check (channel in ('public_board','linkedin','facebook','instagram','x','paid_tender')),
  external_reference text, status text, shared_at timestamptz
);
create table public.job_posting_events (
  id uuid primary key default gen_random_uuid(),
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  from_status text, to_status text not null, actor_user_id uuid references public.user_profiles(id),
  occurred_at timestamptz not null default now()
);
create table public.job_search_documents (
  job_posting_id uuid primary key references public.job_postings(id) on delete cascade,
  search_tsv tsvector, country_id uuid, city text, industry_id uuid,
  employment_type_id uuid, level_rank int, is_advertised boolean not null default false, deadline date
);

-- ---- Applications & Pipeline (Domain J, Ring 3a) ---------------------------
create table public.candidate_engagements (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id),
  owning_organization_id uuid not null references public.organizations(id),
  source_id uuid references public.candidate_sources(id),
  engagement_status text not null default 'active' check (engagement_status in ('active','dormant','archived')),
  internal_summary text,
  has_processing_consent boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.user_profiles(id),
  unique (candidate_id, owning_organization_id)
);
comment on table public.candidate_engagements is 'Ring-3a franchise-private engagement; one per (candidate, owning org); other franchises cannot see (R-003/R-013).';

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id),
  job_order_id uuid not null references public.job_orders(id),
  owning_organization_id uuid not null references public.organizations(id),
  recruitment_path text not null check (recruitment_path in ('A','B')),
  entry_type uuid not null references public.candidate_sources(id),
  is_direct_application boolean not null default true,
  sourced_contacted_at timestamptz,
  network_search_permission boolean,
  candidate_existed_globally boolean not null default true,
  current_stage_id uuid not null references public.pipeline_stages(id),
  assigned_recruiter_id uuid references public.user_profiles(id),
  assigned_team_id uuid references public.teams(id),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  cv_document_version_id uuid references public.document_versions(id),
  consent_status text not null default 'not_required' check (consent_status in ('not_required','required','pending','granted','withdrawn')),
  is_on_hold boolean not null default false,
  withdrawn_at timestamptz, reopened_from_rejection_at timestamptz,
  next_action text, next_action_due date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (candidate_id, job_order_id)
);
comment on table public.applications is 'Pipeline record; UK(candidate,job) prevents duplicate applications; reapplication reopens (R-064).';

create table public.application_stage_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.applications(id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages(id),
  to_stage_id uuid not null references public.pipeline_stages(id),
  actor_user_id uuid references public.user_profiles(id),
  actor_service_id uuid references public.service_actors(id),
  occurred_at timestamptz not null default now(),
  time_in_previous_stage interval, reason text, metadata jsonb
);

create table public.application_snapshots (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  profile_snapshot jsonb not null, screening_answers jsonb,
  cv_document_version_id uuid references public.document_versions(id),
  consent_record_id uuid references public.consent_records(id),
  snapshot_hash text, taken_at timestamptz not null default now()
);

create table public.application_answers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  job_screening_question_id uuid not null references public.job_screening_questions(id),
  answer jsonb
);

create table public.screening_records (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  owning_organization_id uuid not null references public.organizations(id),
  outcome text check (outcome in ('advance','keep','request_info','reject')),
  initial_rating int, notes text,
  screened_by uuid references public.user_profiles(id), screened_at timestamptz
);
create table public.screening_criteria_results (
  id uuid primary key default gen_random_uuid(),
  screening_record_id uuid not null references public.screening_records(id) on delete cascade,
  criterion text not null, result text check (result in ('meets','partial','fails','unknown')), note text
);
create table public.screening_scorecards (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  owning_organization_id uuid not null references public.organizations(id),
  overall_recommendation text check (overall_recommendation in ('strongly_recommend','recommend','hold','do_not_recommend')),
  narrative text, completed_by uuid references public.user_profiles(id), completed_at timestamptz
);
create table public.scorecard_competency_scores (
  id uuid primary key default gen_random_uuid(),
  screening_scorecard_id uuid not null references public.screening_scorecards(id) on delete cascade,
  competency text not null, score int, note text
);
create table public.assessment_records (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  owning_organization_id uuid not null references public.organizations(id),
  test_type text, provider text, provider_reference text,
  invited_at timestamptz, due_at timestamptz,
  completion_status text check (completion_status in ('not_required','invited','in_progress','completed','expired')),
  score numeric, pass_threshold numeric, recruiter_interpretation text,
  result_document_id uuid references public.documents(id), not_required_reason text
);
comment on table public.assessment_records is 'Vendor-neutral (TestGorilla/Central Test/future builder); NO Pmaps-specific fields (C-6).';

create table public.reference_checks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  owning_organization_id uuid not null references public.organizations(id),
  referee_name text, relationship text, organization text, contact_method text,
  contacted_at timestamptz, completed_by uuid references public.user_profiles(id),
  outcome text check (outcome in ('positive','mixed','negative','unreachable')),
  concerns text, follow_up_required boolean not null default false,
  candidate_authorization_status text check (candidate_authorization_status in ('authorized','pending','declined'))
);
comment on table public.reference_checks is 'Extra-restricted (reference.read); never in shared search (R-063).';

create table public.application_rejections (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  owning_organization_id uuid not null references public.organizations(id),
  rejection_reason_id uuid references public.rejection_reasons(id),
  other_note text,
  communication_outcome text check (communication_outcome in ('notify_now','schedule','already_informed','do_not_notify')),
  rejected_by uuid references public.user_profiles(id), rejected_at timestamptz not null default now(),
  is_active boolean not null default true,
  check (rejection_reason_id is not null or other_note is not null)  -- every rejection needs a reason (R-062)
);

-- ---- Employer Submissions (Domain K, Ring 3b) ------------------------------
create table public.candidate_submissions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id),
  candidate_id uuid not null references public.candidates(id),
  job_order_id uuid not null references public.job_orders(id),
  employer_organization_id uuid not null references public.employer_organizations(organization_id),
  submitting_organization_id uuid not null references public.organizations(id),
  submitting_recruiter_id uuid references public.user_profiles(id),
  consent_record_id uuid not null references public.consent_records(id),
  status text not null default 'consent_pending'
    check (status in ('consent_pending','submitted','viewed','shortlisted','interview_requested','offered','rejected','withdrawn','access_revoked','access_expired')),
  is_masked boolean not null default true,
  client_facing_summary text,
  submitted_at timestamptz, access_expires_at timestamptz, access_revoked_at timestamptz,
  version_no int not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (access_revoked_at is null or submitted_at is null or access_revoked_at >= submitted_at)
);
comment on table public.candidate_submissions is 'Deliberate consent-gated employer disclosure; NEVER the live profile (R-070); consent must name employer.';
alter table public.candidate_access_events
  add constraint cae_submission_fk foreign key (submission_id) references public.candidate_submissions(id);
alter table public.document_access_grants
  add constraint dag_submission_fk foreign key (submission_id) references public.candidate_submissions(id);

create table public.submission_snapshots (
  id uuid primary key default gen_random_uuid(),
  candidate_submission_id uuid not null unique references public.candidate_submissions(id) on delete cascade,
  disclosed_profile jsonb not null, disclosed_fields text[] not null default '{}',
  cv_document_version_id uuid references public.document_versions(id),
  test_results_included boolean not null default false, reference_summary_included boolean not null default false,
  proposed_salary jsonb, snapshot_hash text, taken_at timestamptz not null default now()
);
create table public.submission_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_submission_id uuid not null references public.candidate_submissions(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id),
  disclosure_scope text not null check (disclosure_scope in ('watermarked_preview','download'))
);
create table public.submission_events (
  id uuid primary key default gen_random_uuid(),
  candidate_submission_id uuid not null references public.candidate_submissions(id) on delete cascade,
  from_status text, to_status text not null, actor_user_id uuid references public.user_profiles(id),
  note text, occurred_at timestamptz not null default now()
);
create table public.submission_views (
  id uuid primary key default gen_random_uuid(),
  candidate_submission_id uuid not null references public.candidate_submissions(id) on delete cascade,
  viewed_by uuid references public.user_profiles(id), viewed_at timestamptz not null default now(),
  document_version_id uuid references public.document_versions(id), ip inet, user_agent text
);
create table public.submission_comments (
  id uuid primary key default gen_random_uuid(),
  candidate_submission_id uuid not null references public.candidate_submissions(id) on delete cascade,
  author_id uuid not null references public.user_profiles(id), body text not null,
  visibility text not null default 'employer_and_recruiter' check (visibility in ('employer_and_recruiter')),
  created_at timestamptz not null default now()
);
create table public.submission_ratings (
  id uuid primary key default gen_random_uuid(),
  candidate_submission_id uuid not null references public.candidate_submissions(id) on delete cascade,
  rated_by uuid references public.user_profiles(id), rating int, dimension text
);

create trigger trg_job_orders_updated before update on public.job_orders for each row execute function private.set_updated_at();
create trigger trg_job_postings_updated before update on public.job_postings for each row execute function private.set_updated_at();
create trigger trg_applications_updated before update on public.applications for each row execute function private.set_updated_at();
create trigger trg_submissions_updated before update on public.candidate_submissions for each row execute function private.set_updated_at();
