-- =============================================================================
-- Shugulika MVP — application schema (the tables the Next.js app queries).
-- This is a focused, normalized subset aligned with docs/database/ (the full
-- architecture). Apply in order: 0001 schema, 0002 rls, 0003 storage, 0004 seed.
-- Safe to run on a fresh Supabase project. Uuid PKs, FKs, checks, timestamps.
-- =============================================================================
create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---- Reference --------------------------------------------------------------
create table if not exists public.countries (
  code text primary key,
  name text not null,
  currency text,
  is_active boolean not null default false,
  sort_order int not null default 0
);

create table if not exists public.pipeline_stages (
  key text primary key,
  label text not null,
  ordinal int not null,
  stage_class text not null check (stage_class in ('job','candidate','accounts'))
);

create table if not exists public.rejection_reasons (
  key text primary key,
  label text not null,
  applies_to text not null default 'application'
);

-- ---- Identity & organizations ----------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null,
  full_name text,
  phone text,
  avatar_url text,
  headline text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  org_type text not null check (org_type in ('hq','franchise','employer')),
  name text not null,
  country_code text references public.countries(code),
  parent_id uuid references public.organizations(id),
  status text not null default 'active' check (status in ('active','pending','suspended','closed')),
  -- employer-specific (nullable for hq/franchise)
  industry text,
  website text,
  company_size text,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_org_type on public.organizations(org_type);
create index if not exists idx_org_country on public.organizations(country_code);
create index if not exists idx_org_parent on public.organizations(parent_id);

-- Membership model: a user may hold several roles / org memberships (never a
-- single editable role string). role='candidate' uses a null org.
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  role text not null check (role in ('candidate','recruiter','employer_user','franchise_admin','hq_admin','operations','accounts')),
  country_code text references public.countries(code),
  status text not null default 'active' check (status in ('invited','active','suspended','ended')),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_membership on public.memberships (user_id, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), role)
  where status <> 'ended';
create index if not exists idx_membership_user on public.memberships(user_id);
create index if not exists idx_membership_org on public.memberships(organization_id);

-- ---- Candidate domain -------------------------------------------------------
create table if not exists public.candidate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  given_name text,
  family_name text,
  headline text,
  summary text,
  country_code text references public.countries(code),
  city text,
  date_of_birth date,
  availability text,
  open_to_work boolean not null default true,
  profile_status text not null default 'draft' check (profile_status in ('draft','active','archived')),
  completion_pct int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.candidate_experiences (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  title text not null,
  employer_name text,
  location text,
  start_date date,
  end_date date,
  is_current boolean not null default false,
  description text,
  kind text not null default 'formal' check (kind in ('formal','volunteer','informal','internship','freelance')),
  created_at timestamptz not null default now()
);

create table if not exists public.candidate_education (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  institution text not null,
  qualification text,
  field_of_study text,
  start_date date,
  end_date date,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.candidate_skills (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  name text not null,
  level text check (level in ('beginner','intermediate','advanced','expert')),
  is_searchable boolean not null default true
);

create table if not exists public.candidate_languages (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  language text not null,
  proficiency text check (proficiency in ('basic','conversational','professional','fluent','native'))
);

create table if not exists public.candidate_certifications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  name text not null,
  issuer text,
  issued_on date
);

create table if not exists public.candidate_preferences (
  candidate_id uuid primary key references public.candidate_profiles(id) on delete cascade,
  desired_roles text[] not null default '{}',
  preferred_industries text[] not null default '{}',
  preferred_locations text[] not null default '{}',
  min_salary numeric,
  max_salary numeric,
  salary_currency text,
  salary_private boolean not null default true,
  willing_to_relocate boolean not null default false,
  remote_preference text,
  employment_types text[] not null default '{}',
  notice_period text,
  updated_at timestamptz not null default now()
);

create table if not exists public.candidate_search_visibility (
  candidate_id uuid primary key references public.candidate_profiles(id) on delete cascade,
  is_searchable boolean not null default false,
  approved_fields text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.candidate_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  doc_type text not null,
  title text,
  bucket_id text not null default 'candidate-documents',
  object_path text not null,
  mime_type text,
  size_bytes bigint,
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

create table if not exists public.candidate_consents (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  purpose text not null,
  covered_org_id uuid references public.organizations(id),
  scope jsonb not null default '{}',
  method text not null default 'web_form' check (method in ('web_form','otp_confirmed','verbal_recorded','imported')),
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  note text
);
create index if not exists idx_consent_candidate on public.candidate_consents(candidate_id, purpose);

-- ---- Jobs & recruitment -----------------------------------------------------
create table if not exists public.job_orders (
  id uuid primary key default gen_random_uuid(),
  employer_org_id uuid not null references public.organizations(id),
  responsible_org_id uuid not null references public.organizations(id),
  title text not null,
  department text,
  description text,
  responsibilities text,
  requirements text,
  country_code text not null references public.countries(code),
  city text,
  employment_type text,
  work_arrangement text,
  experience_level text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_public boolean not null default false,
  benefits text,
  vacancy_count int not null default 1,
  recruitment_path text not null default 'B' check (recruitment_path in ('A','B')),
  is_confidential boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','active','on_hold','filled','partially_filled','cancelled','closed')),
  application_deadline date,
  target_start_date date,
  closed_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_jo_employer on public.job_orders(employer_org_id);
create index if not exists idx_jo_responsible on public.job_orders(responsible_org_id, status);
create index if not exists idx_jo_country on public.job_orders(country_code, status);

-- Publication record (distinct from the internal order). Public board reads this.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','pending_approval','advertised','paused','expired','unpublished')),
  public_slug citext unique,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_jobs_status on public.jobs(status);

create table if not exists public.job_screening_questions (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  prompt text not null,
  qtype text not null default 'short_text' check (qtype in ('boolean','single_choice','multi_choice','numeric','short_text')),
  options jsonb,
  is_required boolean not null default false,
  ordinal int not null default 0
);

create table if not exists public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  recruiter_user_id uuid not null references public.profiles(id),
  role text not null default 'recruiter' check (role in ('owner','recruiter','coordinator')),
  unique (job_order_id, recruiter_user_id)
);

create table if not exists public.saved_jobs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (candidate_id, job_id)
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id),
  job_order_id uuid not null references public.job_orders(id),
  owning_org_id uuid not null references public.organizations(id),
  recruitment_path text not null check (recruitment_path in ('A','B')),
  entry_source text not null default 'applied_direct',
  current_stage text not null default 'cv_review' references public.pipeline_stages(key),
  assigned_recruiter_id uuid references public.profiles(id),
  consent_status text not null default 'not_required' check (consent_status in ('not_required','required','pending','granted','withdrawn')),
  cv_document_id uuid references public.candidate_documents(id),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  is_on_hold boolean not null default false,
  next_action text,
  next_action_due date,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, job_order_id)
);
create index if not exists idx_app_owning on public.applications(owning_org_id, current_stage);
create index if not exists idx_app_candidate on public.applications(candidate_id);
create index if not exists idx_app_recruiter on public.applications(assigned_recruiter_id, next_action_due);

create table if not exists public.application_answers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  question_id uuid references public.job_screening_questions(id),
  prompt text,
  answer jsonb
);

create table if not exists public.application_stage_history (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.applications(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  actor_id uuid references public.profiles(id),
  actor_role text,
  reason text,
  note text,
  source text not null default 'app',
  created_at timestamptz not null default now()
);
create index if not exists idx_stage_hist_app on public.application_stage_history(application_id, created_at);

create table if not exists public.recruiter_notes (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('candidate','application','employer','job_order','submission')),
  subject_id uuid not null,
  owning_org_id uuid not null references public.organizations(id),
  author_id uuid not null references public.profiles(id),
  body text not null,
  visibility text not null default 'franchise_internal'
    check (visibility in ('recruiter_private','franchise_internal','hq_accessible')),
  created_at timestamptz not null default now()
);
create index if not exists idx_notes_subject on public.recruiter_notes(subject_type, subject_id);

create table if not exists public.candidate_tags (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  owning_org_id uuid not null references public.organizations(id),
  tag text not null
);

create table if not exists public.employer_submissions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id),
  candidate_id uuid not null references public.candidate_profiles(id),
  job_order_id uuid not null references public.job_orders(id),
  employer_org_id uuid not null references public.organizations(id),
  submitting_org_id uuid not null references public.organizations(id),
  submitting_recruiter_id uuid references public.profiles(id),
  consent_id uuid references public.candidate_consents(id),
  status text not null default 'consent_pending'
    check (status in ('consent_pending','submitted','viewed','shortlisted','interview_requested','offered','rejected','withdrawn','access_revoked')),
  is_masked boolean not null default true,
  summary text,
  disclosed_profile jsonb not null default '{}',
  disclosed_fields text[] not null default '{}',
  cv_document_id uuid references public.candidate_documents(id),
  submitted_at timestamptz,
  access_expires_at timestamptz,
  access_revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sub_employer on public.employer_submissions(employer_org_id, status);
create index if not exists idx_sub_submitting on public.employer_submissions(submitting_org_id, status);

create table if not exists public.employer_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.employer_submissions(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  submission_id uuid references public.employer_submissions(id) on delete cascade,
  owning_org_id uuid not null references public.organizations(id),
  interview_type text not null default 'recruiter',
  round_no int not null default 1,
  status text not null default 'requested'
    check (status in ('requested','scheduled','confirmed','completed','cancelled','no_show')),
  scheduled_at timestamptz,
  duration_minutes int,
  location_or_link text,
  instructions text,
  expires_at timestamptz,
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_interview_app on public.interviews(application_id);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  owning_org_id uuid not null references public.organizations(id),
  employer_org_id uuid not null references public.organizations(id),
  status text not null default 'preparing'
    check (status in ('preparing','sent','negotiating','accepted','declined','expired','withdrawn')),
  position_title text,
  compensation numeric,
  currency text,
  start_date date,
  conditions text,
  expires_at timestamptz,
  declined_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.placements (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.offers(id),
  application_id uuid not null references public.applications(id),
  employer_org_id uuid not null references public.organizations(id),
  owning_org_id uuid not null references public.organizations(id),
  recruiter_id uuid references public.profiles(id),
  start_date date,
  fee numeric,
  currency text,
  guarantee_days int,
  status text not null default 'active' check (status in ('active','guarantee_period','completed','failed','replaced')),
  created_at timestamptz not null default now()
);

-- ---- Packages & billing -----------------------------------------------------
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  tier int not null default 1,
  is_active boolean not null default true
);

create table if not exists public.package_entitlements (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  key text not null,
  limit_value int,
  period text not null default 'billing_cycle'
);

create table if not exists public.employer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employer_org_id uuid not null references public.organizations(id),
  package_id uuid not null references public.packages(id),
  status text not null default 'active' check (status in ('trial','active','expired','cancelled','suspended')),
  is_trial boolean not null default false,
  trial_ends_on date,
  starts_on date not null default current_date,
  expires_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  owning_org_id uuid not null references public.organizations(id),
  employer_org_id uuid references public.organizations(id),
  subscription_id uuid references public.employer_subscriptions(id),
  placement_id uuid references public.placements(id),
  currency text not null default 'TZS',
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','overdue','voided')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid','refunded')),
  issue_date date,
  due_date date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_inv_owning on public.invoices(owning_org_id, status);
create index if not exists idx_inv_employer on public.invoices(employer_org_id);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1,
  unit_amount numeric not null default 0,
  line_total numeric not null default 0
);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric not null,
  currency text not null default 'TZS',
  method text not null default 'manual' check (method in ('manual','card','mobile_money','bank_transfer')),
  reference text,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunded')),
  recorded_by uuid references public.profiles(id),
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

-- ---- Platform operations ----------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null default 'general',
  title text not null,
  body text,
  subject_type text,
  subject_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user on public.notifications(user_id, read_at);

create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  owning_org_id uuid references public.organizations(id),
  subject_type text not null,
  subject_id uuid not null,
  event_type text not null,
  actor_id uuid references public.profiles(id),
  summary text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_activity_subject on public.activity_events(subject_type, subject_id);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  org_context_id uuid,
  before_value jsonb,
  after_value jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_entity on public.audit_logs(entity_type, entity_id);

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  status text not null default 'not_enabled' check (status in ('not_enabled','integration_pending','coming_soon','connected')),
  config jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_flags (
  key text primary key,
  is_enabled boolean not null default false,
  notes text
);

-- ---- updated_at trigger -----------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','organizations','candidate_profiles','job_orders','jobs',
    'applications','employer_submissions','interviews','offers','invoices'] loop
    execute format('drop trigger if exists trg_updated on public.%I;', t);
    execute format('create trigger trg_updated before update on public.%I for each row execute function public.tg_set_updated_at();', t);
  end loop;
end $$;
