-- =============================================================================
-- File 06: Interviews - human (Domain M) and AI video interviews (Domain N).
-- AI model is six separable sub-graphs; NO JSON blob; AI never overwrites human.
-- =============================================================================

-- ---- Human interviews (Domain M) ------------------------------------------
create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id),
  candidate_submission_id uuid references public.candidate_submissions(id),
  owning_organization_id uuid not null references public.organizations(id),
  interview_type_id uuid not null references public.interview_types(id),
  round_no int not null default 1,
  scheduled_start timestamptz, duration_minutes int, location_or_link text,
  status text not null default 'requested' check (status in ('requested','scheduled','confirmed','rescheduled','completed','cancelled','no_show')),
  candidate_confirmed_at timestamptz, reminder_status text,
  recording_document_id uuid references public.documents(id),
  recording_consent_id uuid references public.consent_records(id),
  outcome text check (outcome in ('advance','hold','reject','offer')),
  candidate_feedback text, client_feedback text, decision_deadline date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
comment on table public.interviews is 'client_feedback vs candidate_feedback kept separate; recording gated by recording_consent_id (R-080).';
create table public.interview_panelists (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  user_id uuid references public.user_profiles(id), external_name text,
  role text not null default 'interviewer' check (role in ('interviewer','observer','coordinator'))
);
create table public.interview_events (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  from_status text, to_status text not null, actor_user_id uuid references public.user_profiles(id),
  occurred_at timestamptz not null default now()
);
create table public.interview_scorecards (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  owning_organization_id uuid not null references public.organizations(id),
  overall_recommendation text, narrative text,
  completed_by uuid references public.user_profiles(id),
  audience text not null default 'internal' check (audience in ('internal','employer_visible'))
);
create table public.interview_competency_scores (
  id uuid primary key default gen_random_uuid(),
  interview_scorecard_id uuid not null references public.interview_scorecards(id) on delete cascade,
  competency text not null, score int, note text
);
create table public.interview_question_sets (
  id uuid primary key default gen_random_uuid(),
  owning_organization_id uuid not null references public.organizations(id),
  name text not null, version_no int not null default 1
);
create table public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  question_set_id uuid not null references public.interview_question_sets(id) on delete cascade,
  prompt text not null, ordinal int not null default 0, competency text
);

-- ---- AI video interviews (Domain N) : DEFINITION sub-graph -----------------
create table public.ai_interview_templates (
  id uuid primary key default gen_random_uuid(),
  owning_organization_id uuid not null references public.organizations(id),
  name text not null, description text, is_active boolean not null default true
);
create table public.ai_interview_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ai_interview_templates(id) on delete cascade,
  version_no int not null, is_current boolean not null default true, effective_from date not null default current_date,
  unique (template_id, version_no)
);
create table public.ai_competencies (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.ai_interview_template_versions(id) on delete cascade,
  name text not null, weight numeric, rubric_text text, ordinal int not null default 0
);
create table public.ai_question_banks (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.ai_interview_template_versions(id) on delete cascade,
  name text not null
);
create table public.ai_questions (
  id uuid primary key default gen_random_uuid(),
  question_bank_id uuid not null references public.ai_question_banks(id) on delete cascade,
  ordinal int not null default 0,
  competency_id uuid references public.ai_competencies(id),
  is_follow_up boolean not null default false,
  parent_question_id uuid references public.ai_questions(id)
);
create table public.ai_question_versions (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.ai_questions(id) on delete cascade,
  version_no int not null, prompt_text text not null,
  prep_seconds int, response_limit_seconds int, max_retakes int not null default 0,
  is_current boolean not null default true, unique (question_id, version_no)
);
comment on table public.ai_question_versions is 'Questions are versioned; unversioned AI questions prohibited (R-082).';
create table public.ai_interview_configs (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  template_version_id uuid not null references public.ai_interview_template_versions(id),
  is_required boolean not null default false, not_required_reason text,
  retake_policy jsonb, created_by uuid references public.user_profiles(id)
);

-- ---- EXECUTION sub-graph ---------------------------------------------------
create table public.ai_interview_invitations (
  id uuid primary key default gen_random_uuid(),
  ai_interview_config_id uuid not null references public.ai_interview_configs(id),
  application_id uuid not null references public.applications(id),
  candidate_id uuid not null references public.candidates(id),
  secure_token_hash text not null unique,
  status text not null default 'sent' check (status in ('sent','opened','started','completed','expired','revoked')),
  expires_at timestamptz, sent_at timestamptz not null default now()
);
create table public.ai_interview_sessions (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.ai_interview_invitations(id),
  application_id uuid not null references public.applications(id),
  consent_record_id uuid not null references public.consent_records(id),  -- purpose=record_ai_interview
  status text not null default 'in_progress' check (status in ('in_progress','completed','abandoned','error')),
  device_metadata jsonb, browser_metadata jsonb,
  started_at timestamptz, completed_at timestamptz, error_reason text
);
create table public.ai_interview_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_interview_sessions(id) on delete cascade,
  ai_question_version_id uuid not null references public.ai_question_versions(id),
  ordinal int not null default 0, retake_no int not null default 0,
  response_status text, duration_seconds int
);
create table public.ai_media_assets (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.ai_interview_responses(id) on delete cascade,
  media_kind text not null check (media_kind in ('video','audio')),
  bucket_id text not null, object_path text not null,
  upload_status text not null default 'pending' check (upload_status in ('pending','uploaded','failed')),
  processing_status text not null default 'pending' check (processing_status in ('pending','processing','done','error')),
  size_bytes bigint, duration_seconds int, checksum text,
  retention_status text not null default 'active' check (retention_status in ('active','pending_purge','purged','on_hold')),
  delete_after timestamptz
);
comment on table public.ai_media_assets is 'Raw media in Storage; retention independent of transcript/model output (R-021/R-082).';
create table public.ai_transcripts (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.ai_media_assets(id) on delete cascade,
  language text, full_text text, redaction_status text,
  translation_of_transcript_id uuid references public.ai_transcripts(id),
  retention_status text not null default 'active', delete_after timestamptz
);
create table public.ai_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.ai_transcripts(id) on delete cascade,
  ordinal int not null default 0, speaker text, start_ms int, end_ms int, text text
);

-- ---- MODEL-EXECUTION sub-graph ---------------------------------------------
create table public.ai_model_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_interview_sessions(id) on delete cascade,
  provider text not null, model_id text not null, model_version text,
  prompt_version text, rubric_version text,
  run_status text not null default 'queued' check (run_status in ('queued','running','succeeded','failed')),
  reprocessing_of_run_id uuid references public.ai_model_runs(id),
  token_cost int, cost_amount numeric, error_reason text,
  started_at timestamptz, completed_at timestamptz
);
comment on table public.ai_model_runs is 'Full lineage: provider/model/prompt/rubric versions; reprocessing = new run (R-082).';
create table public.ai_processing_errors (
  id uuid primary key default gen_random_uuid(),
  model_run_id uuid not null references public.ai_model_runs(id) on delete cascade,
  stage text, error_code text, detail text
);

-- ---- OUTPUT sub-graph (MACHINE) --------------------------------------------
create table public.ai_evaluations (
  id uuid primary key default gen_random_uuid(),
  model_run_id uuid not null references public.ai_model_runs(id) on delete cascade,
  overall_score numeric, confidence numeric, summary_text text,
  audience text not null default 'recruiter' check (audience in ('recruiter','candidate')),
  is_superseded boolean not null default false,
  retention_status text not null default 'active', delete_after timestamptz
);
comment on table public.ai_evaluations is 'MACHINE output only; separate from human decision; never writes an application stage (R-081/R-083).';
create table public.ai_evaluation_scores (
  id uuid primary key default gen_random_uuid(),
  ai_evaluation_id uuid not null references public.ai_evaluations(id) on delete cascade,
  competency_id uuid references public.ai_competencies(id),
  score numeric, confidence numeric, evidence_text text,
  evidence_segment_id uuid references public.ai_transcript_segments(id)
);
create table public.ai_integrity_flags (
  id uuid primary key default gen_random_uuid(),
  ai_evaluation_id uuid not null references public.ai_evaluations(id) on delete cascade,
  flag_type text check (flag_type in ('possible_multiple_speakers','off_topic','low_audio_quality','possible_assistance','anomaly')),
  severity text, detail text
);

-- ---- HUMAN-DECISION & GOVERNANCE sub-graph ---------------------------------
create table public.ai_human_reviews (
  id uuid primary key default gen_random_uuid(),
  ai_evaluation_id uuid not null references public.ai_evaluations(id) on delete cascade,
  reviewer_id uuid not null references public.user_profiles(id),
  agrees_with_ai boolean, overrides_ai boolean not null default false, override_reason text,
  final_recommendation text check (final_recommendation in ('advance','hold','reject','not_required')),
  is_final boolean not null default false, reviewed_at timestamptz not null default now()
);
comment on table public.ai_human_reviews is 'Human decision authoritative; AI recommendation preserved unchanged (R-081).';
create table public.ai_fairness_reviews (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid references public.ai_interview_template_versions(id),
  ai_evaluation_id uuid references public.ai_evaluations(id),
  review_type text check (review_type in ('bias','adverse_impact','quality')),
  outcome text, reviewer_id uuid references public.user_profiles(id), notes text,
  reviewed_at timestamptz not null default now()
);

create trigger trg_interviews_updated before update on public.interviews for each row execute function private.set_updated_at();
