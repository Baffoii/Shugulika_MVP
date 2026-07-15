-- =============================================================================
-- File 03: Candidate global identity (Domain D), Documents (E), Verification (F).
-- =============================================================================

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.user_profiles(id) on delete set null,
  given_name text, family_name text,
  date_of_birth date,
  email citext, phone text,
  country_id uuid references public.countries(id),
  current_city text,
  nationality_country_id uuid references public.countries(id),
  professional_summary text,
  profile_photo_document_id uuid,       -- FK -> documents (below) added after
  profile_status text not null default 'draft'
    check (profile_status in ('draft','active','archived','pending_deletion')),
  source_channel text,
  profile_completion_pct int not null default 0,
  created_by_organization_id uuid references public.organizations(id),
  merged_into_candidate_id uuid references public.candidates(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.candidates is 'Ring-1 global candidate identity; candidate-owned; not franchise-owned (R-010).';

-- ---- Modular profile (Ring 1) ---------------------------------------------
create table public.candidate_work_experiences (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  job_title text, employer_name text, location text,
  start_date date, end_date date, is_current boolean not null default false,
  responsibilities text,
  employment_type_id uuid references public.employment_types(id),
  experience_kind text not null default 'formal'
    check (experience_kind in ('formal','volunteer','informal','family_business','internship','freelance','community')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.candidate_educations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  institution_name text, institution_not_listed boolean not null default false,
  qualification text, field_of_study text,
  education_level_id uuid references public.education_levels(id),
  start_date date, end_date date,
  is_current boolean not null default false, is_completed boolean not null default true,
  grade text, description text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.candidate_skills (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  skill_id uuid references public.skills(id),
  custom_label text,                    -- candidate-added skill not in catalog
  proficiency text, years int,
  is_searchable boolean not null default true,
  check (skill_id is not null or custom_label is not null)
);

create table public.candidate_languages (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  language_id uuid not null references public.languages(id),
  proficiency text check (proficiency in ('basic','conversational','professional','fluent','native'))
);

create table public.candidate_certifications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  name text not null, issuer text, issued_on date, expires_on date, credential_id text,
  document_id uuid                       -- FK -> documents added after
);

create table public.candidate_licences (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  name text not null, issuer text, licence_number text, issued_on date, expires_on date,
  document_id uuid
);

create table public.candidate_projects (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  title text not null, description text, url text, start_date date, end_date date
);

create table public.candidate_memberships (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  organization_name text not null, role text, start_date date, end_date date
);

create table public.candidate_references (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  referee_name text not null, relationship text, organization text,
  contact_method text, contact_value text, is_reachable boolean
);
comment on table public.candidate_references is 'Sensitive; NEVER enters shared search (R-063).';

create table public.candidate_preferences (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  desired_salary_min numeric, desired_salary_max numeric,
  salary_currency_id uuid references public.currencies(id),
  salary_is_private boolean not null default true,
  availability text, notice_period text,
  willing_to_relocate boolean not null default false,
  cross_border_mobility boolean not null default false,
  remote_preference text, employment_type_pref text,
  open_to_opportunities boolean not null default true,
  accessibility_accommodations text,
  updated_at timestamptz not null default now()
);

create table public.candidate_preferred_roles (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  role_title text not null
);
create table public.candidate_preferred_industries (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  industry_id uuid not null references public.industries(id)
);
create table public.candidate_preferred_locations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  country_id uuid references public.countries(id), city text, is_primary boolean not null default false
);

create table public.candidate_tags (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  tag text not null,
  tag_scope text not null default 'global' check (tag_scope in ('global','franchise')),
  owning_organization_id uuid references public.organizations(id)  -- required for franchise tags
);

create table public.candidate_visibility (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  searchable boolean not null default false,
  approved_search_fields jsonb not null default '{}',
  talent_pool_opt_in boolean not null default false,
  updated_by uuid references public.user_profiles(id),
  updated_at timestamptz not null default now()
);

-- Ring 2: derived search projection (only candidate-approved fields; maintained by trigger)
create table public.candidate_search_documents (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  is_searchable boolean not null default false,
  search_tsv tsvector,
  approved_skills text[] not null default '{}',
  preferred_roles text[] not null default '{}',
  country_id uuid references public.countries(id),
  city text,
  education_level_rank int,
  languages text[] not null default '{}',
  availability text,
  embedding_reserved jsonb   -- placeholder; replace with vector column if AI matching enabled
);
comment on table public.candidate_search_documents is 'Ring-2 shared search: ONLY candidate-approved fields; never restricted fields (R-012).';

create table public.candidate_duplicate_links (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  duplicate_candidate_id uuid not null references public.candidates(id),
  match_score numeric,
  status text not null default 'suspected' check (status in ('suspected','dismissed','merged')),
  reviewed_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);

-- ---- Documents (Domain E) --------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  document_type_id uuid not null references public.document_types(id),
  owner_candidate_id uuid references public.candidates(id),
  owning_organization_id uuid references public.organizations(id),
  uploaded_by uuid references public.user_profiles(id),
  title text,
  bucket_id text not null,
  object_path text not null,
  current_version_id uuid,              -- FK added after document_versions
  visibility text not null default 'private'
    check (visibility in ('private','franchise_internal','recruiter_discoverable','submission_only','org_internal')),
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','infected','failed')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified','verified','rejected')),
  expires_at timestamptz,
  retention_status text not null default 'active' check (retention_status in ('active','pending_purge','purged','on_hold')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path),
  check (num_nonnulls(owner_candidate_id, owning_organization_id) = 1)
);
comment on table public.documents is 'Metadata only; bytes live in Supabase Storage (R-021).';

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version_no int not null,
  object_path text not null unique,
  size_bytes bigint, mime_type text, checksum_sha256 text, page_count int,
  uploaded_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(),
  unique (document_id, version_no)
);
alter table public.documents
  add constraint documents_current_version_fk foreign key (current_version_id) references public.document_versions(id);
alter table public.candidates
  add constraint candidates_photo_fk foreign key (profile_photo_document_id) references public.documents(id);
alter table public.candidate_certifications
  add constraint cand_cert_doc_fk foreign key (document_id) references public.documents(id);
alter table public.candidate_licences
  add constraint cand_lic_doc_fk foreign key (document_id) references public.documents(id);
alter table public.organizations
  add constraint org_branding_doc_fk foreign key (branding_document_id) references public.documents(id);

create table public.document_previews (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid references public.document_versions(id),
  preview_type text not null check (preview_type in ('watermarked','thumbnail','redacted')),
  bucket_id text not null, object_path text not null,
  generated_by_service uuid references public.service_actors(id),
  created_at timestamptz not null default now()
);

create table public.document_access_grants (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  granted_to_organization_id uuid references public.organizations(id),
  granted_to_user_id uuid references public.user_profiles(id),
  submission_id uuid,                   -- FK -> candidate_submissions (file 06)
  scope text not null check (scope in ('preview','download')),
  granted_by uuid references public.user_profiles(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

-- ---- Verification (Domain F) ----------------------------------------------
create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  verification_type_id uuid not null references public.verification_types(id),
  subject_candidate_id uuid references public.candidates(id),
  subject_organization_id uuid references public.organizations(id),
  status text not null default 'pending' check (status in ('pending','in_review','verified','failed','expired')),
  method text check (method in ('otp','email_link','manual_review','document_review','biometric_ocr','biometric_liveness','face_match')),
  requested_by uuid references public.user_profiles(id),
  verified_by uuid references public.user_profiles(id),
  outcome_reason text,
  verified_at timestamptz, expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (num_nonnulls(subject_candidate_id, subject_organization_id) = 1)
);

create table public.verification_evidence (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references public.verifications(id) on delete cascade,
  evidence_document_id uuid references public.documents(id),
  evidence_metadata jsonb not null default '{}',
  captured_at timestamptz not null default now()
);

create table public.verification_events (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references public.verifications(id) on delete cascade,
  from_status text, to_status text not null,
  actor_user_id uuid references public.user_profiles(id),
  actor_service_id uuid references public.service_actors(id),
  note text, occurred_at timestamptz not null default now()
);

create trigger trg_candidates_updated before update on public.candidates
  for each row execute function private.set_updated_at();
create trigger trg_documents_updated before update on public.documents
  for each row execute function private.set_updated_at();
