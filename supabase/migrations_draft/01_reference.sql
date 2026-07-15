-- =============================================================================
-- File 01: Reference / lookup / configuration tables (Domain C).
-- Admin-configurable sets are TABLES (not enums). Read-all; write = config.manage.
-- =============================================================================

create table public.countries (
  id uuid primary key default gen_random_uuid(),
  iso2 char(2) not null unique,
  iso3 char(3),
  name text not null,
  dial_code text,
  default_currency_id uuid,           -- FK added after currencies
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table public.currencies (
  id uuid primary key default gen_random_uuid(),
  iso_code char(3) not null unique,
  name text not null,
  symbol text,
  minor_unit int not null default 2,
  is_active boolean not null default true
);
alter table public.countries
  add constraint countries_currency_fk
  foreign key (default_currency_id) references public.currencies(id);

create table public.languages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  native_name text,
  is_rtl boolean not null default false,
  is_active boolean not null default true
);

create table public.industries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.industries(id),
  is_active boolean not null default true
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext unique,
  is_verified boolean not null default false,
  is_active boolean not null default true
);

create table public.education_levels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rank int not null,
  is_active boolean not null default true
);

create table public.employment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, is_active boolean not null default true
);

create table public.work_arrangements (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, is_active boolean not null default true
);

create table public.document_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  category text not null,               -- candidate, employer, interview, payment, branding
  default_visibility text not null default 'private',
  default_retention text not null default 'retain',
  is_active boolean not null default true
);

create table public.interview_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, name text not null, is_active boolean not null default true
);

create table public.verification_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, name text not null, is_active boolean not null default true
);

-- The 15-stage Spine + stage classification (job/candidate/placement/accounts).
create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  ordinal int not null,
  stage_class text not null check (stage_class in ('job','candidate','placement','accounts')),
  is_gated boolean not null default false,
  blocking_rule text,                   -- e.g. 'requires_screening_scorecard'
  is_active boolean not null default true
);

create table public.candidate_sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, name text not null, is_active boolean not null default true
);

create table public.rejection_reasons (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  applies_to text not null check (applies_to in ('application','submission','offer','any')),
  requires_note boolean not null default false,
  is_active boolean not null default true
);

create table public.notification_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  default_channels text[] not null default '{email,in_app}',
  is_marketing boolean not null default false,
  is_active boolean not null default true
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,             -- email, sms, in_app, whatsapp(inactive), push(reserved)
  label text not null,
  is_active boolean not null default true
);

create table public.consent_purposes (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  requires_recipient boolean not null default false,
  is_special_category boolean not null default false,
  is_active boolean not null default true
);

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  is_enabled boolean not null default false,
  scope text not null default 'global',  -- global | organization
  organization_id uuid,                  -- FK added in 02
  notes text
);

create table public.country_configurations (
  country_id uuid primary key,           -- FK added in 02 order note (countries exists here)
  id_document_types jsonb not null default '{}',
  tax_rules jsonb not null default '{}',
  default_currency_id uuid references public.currencies(id),
  work_auth_rules jsonb not null default '{}'
);
alter table public.country_configurations
  add constraint country_config_country_fk foreign key (country_id) references public.countries(id);

create table public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'
);

-- status_definitions: optional catalog for UI labels of workflow statuses
create table public.status_definitions (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  key text not null,
  label text not null,
  ordinal int not null default 0,
  unique (domain, key)
);

comment on table public.pipeline_stages is 'The 15-stage Spine; stage_class separates job/candidate/placement/accounts milestones (R-040/R-060).';
comment on table public.consent_purposes is 'Distinct consent purposes incl. employer_submission, ai_interview, whatsapp, guardian (R-031).';
