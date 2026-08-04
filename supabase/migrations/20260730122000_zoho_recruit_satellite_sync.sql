-- Zoho Recruit satellite sync layer (additive).
-- Extends the foundation ledger with field maps, offline cases, worker claims,
-- production-approval evidence, and sandbox mode. All sync gates stay false.

-- ---- Token refresh concurrency lock ---------------------------------------

alter table public.zoho_recruit_connections
  add column if not exists token_refresh_lock_until timestamptz;

alter table public.zoho_recruit_connections
  add column if not exists last_rate_limit jsonb not null default '{}'::jsonb;

alter table public.zoho_recruit_connections
  add column if not exists sync_paused_at timestamptz;

alter table public.zoho_recruit_connections
  add column if not exists sync_paused_reason text;

-- ---- Outbox claim / worker columns ----------------------------------------

alter table public.zoho_recruit_outbox
  add column if not exists claim_token uuid;

alter table public.zoho_recruit_outbox
  add column if not exists claim_expires_at timestamptz;

alter table public.zoho_recruit_outbox
  add column if not exists max_attempts integer not null default 8
    check (max_attempts > 0);

alter table public.zoho_recruit_outbox
  add column if not exists superseded_by uuid references public.zoho_recruit_outbox(event_id);

create index if not exists idx_zoho_outbox_claim
  on public.zoho_recruit_outbox(claim_expires_at)
  where status = 'processing';

-- ---- Inbox replay / hash columns ------------------------------------------

alter table public.zoho_recruit_inbox
  add column if not exists payload_hash text;

alter table public.zoho_recruit_inbox
  add column if not exists claim_token uuid;

alter table public.zoho_recruit_inbox
  add column if not exists claim_expires_at timestamptz;

create index if not exists idx_zoho_inbox_hash
  on public.zoho_recruit_inbox(connection_id, payload_hash)
  where payload_hash is not null;

-- ---- Field-mapping registry (service-role only) ---------------------------

create table if not exists public.zoho_recruit_field_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.zoho_recruit_connections(id) on delete cascade,
  local_entity_type text not null,
  local_field text not null,
  zoho_module text not null,
  zoho_field_api_name text not null,
  sync_direction text not null
    check (sync_direction in ('outbound', 'inbound', 'none')),
  authoritative_system text not null
    check (authoritative_system in ('shugulika', 'zoho_recruit')),
  purpose text not null,
  transformation_version integer not null default 1 check (transformation_version > 0),
  enabled boolean not null default false,
  sensitivity text not null default 'internal'
    check (sensitivity in ('public', 'internal', 'confidential', 'restricted')),
  retention_behavior text not null default 'mirror_local',
  deletion_behavior text not null default 'restrict_then_delete',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_zoho_field_map unique (local_entity_type, local_field, zoho_module, zoho_field_api_name)
);

drop trigger if exists trg_zoho_recruit_field_mappings_updated
  on public.zoho_recruit_field_mappings;
create trigger trg_zoho_recruit_field_mappings_updated
before update on public.zoho_recruit_field_mappings
for each row execute function public.tg_set_updated_at();

-- ---- Explicit offline-case eligibility ------------------------------------

create table if not exists public.zoho_recruit_offline_cases (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.zoho_recruit_connections(id) on delete cascade,
  local_entity_type text not null check (local_entity_type in ('candidate', 'job')),
  local_entity_id uuid not null,
  franchise_org_id uuid references public.organizations(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'restricted', 'withdrawn', 'closed')),
  is_synthetic boolean not null default true,
  processing_purpose text not null default 'offline_recruitment_satellite',
  restriction_reason text,
  legal_hold boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_zoho_offline_case unique (connection_id, local_entity_type, local_entity_id)
);

create index if not exists idx_zoho_offline_cases_status
  on public.zoho_recruit_offline_cases(status, is_synthetic);

drop trigger if exists trg_zoho_recruit_offline_cases_updated
  on public.zoho_recruit_offline_cases;
create trigger trg_zoho_recruit_offline_cases_updated
before update on public.zoho_recruit_offline_cases
for each row execute function public.tg_set_updated_at();

-- ---- Production-data approval evidence (HQ audited) -----------------------

create table if not exists public.zoho_recruit_production_approvals (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.zoho_recruit_connections(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  dpo_name text not null,
  legal_reference text not null,
  approval_note text not null,
  evidence_uri text,
  status text not null default 'recorded'
    check (status in ('recorded', 'revoked')),
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

-- ---- Sync observations (sanitized HQ metrics) -----------------------------

create table if not exists public.zoho_recruit_sync_observations (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.zoho_recruit_connections(id) on delete cascade,
  observed_at timestamptz not null default now(),
  kind text not null,
  metrics jsonb not null default '{}'::jsonb
);

create index if not exists idx_zoho_sync_observations_recent
  on public.zoho_recruit_sync_observations(connection_id, observed_at desc);

-- ---- Server-only access boundary ------------------------------------------

alter table public.zoho_recruit_field_mappings enable row level security;
alter table public.zoho_recruit_offline_cases enable row level security;
alter table public.zoho_recruit_production_approvals enable row level security;
alter table public.zoho_recruit_sync_observations enable row level security;

revoke all on table public.zoho_recruit_field_mappings from public, anon, authenticated;
revoke all on table public.zoho_recruit_offline_cases from public, anon, authenticated;
revoke all on table public.zoho_recruit_production_approvals from public, anon, authenticated;
revoke all on table public.zoho_recruit_sync_observations from public, anon, authenticated;

grant select, insert, update, delete on table public.zoho_recruit_field_mappings to service_role;
grant select, insert, update, delete on table public.zoho_recruit_offline_cases to service_role;
grant select, insert, update, delete on table public.zoho_recruit_production_approvals to service_role;
grant select, insert, update, delete on table public.zoho_recruit_sync_observations to service_role;

-- Sandbox/synthetic gate stays false. Never enable sync in a migration.
insert into public.feature_flags (key, is_enabled, notes) values
  ('zoho_recruit_sandbox_sync_enabled', false,
   'Allows synthetic/sandbox offline-case projection only when data sync is also enabled. Production candidate data still requires the production-data gate plus recorded DPO/legal approval.')
on conflict (key) do nothing;

-- Conservative default field map rows (disabled). Enable only after HQ readiness.
insert into public.zoho_recruit_field_mappings (
  local_entity_type, local_field, zoho_module, zoho_field_api_name,
  sync_direction, authoritative_system, purpose, enabled, sensitivity, notes
) values
  ('candidate', 'id', 'Candidates', 'Shugulika_ID',
   'outbound', 'shugulika', 'Immutable external correlation id', false, 'internal',
   'Create this custom unique field in Zoho Recruit before enabling.'),
  ('candidate', 'full_name', 'Candidates', 'Full_Name',
   'outbound', 'shugulika', 'Offline recruiter identification', false, 'confidential', null),
  ('candidate', 'email', 'Candidates', 'Email',
   'outbound', 'shugulika', 'Offline recruiter contact for approved cases only', false, 'confidential',
   'Never used as a match key; Shugulika_ID is authoritative.'),
  ('candidate', 'phone', 'Candidates', 'Mobile',
   'outbound', 'shugulika', 'Offline recruiter contact for approved cases only', false, 'confidential', null),
  ('candidate', 'city', 'Candidates', 'City',
   'outbound', 'shugulika', 'Location context for offline sourcing', false, 'internal', null),
  ('candidate', 'country', 'Candidates', 'Country',
   'outbound', 'shugulika', 'Location context for offline sourcing', false, 'internal', null),
  ('job', 'id', 'Job_Openings', 'Shugulika_ID',
   'outbound', 'shugulika', 'Immutable external correlation id', false, 'internal',
   'Create this custom unique field in Zoho Recruit before enabling.'),
  ('job', 'title', 'Job_Openings', 'Job_Opening_Name',
   'outbound', 'shugulika', 'Offline requisition title', false, 'internal', null),
  ('candidate', 'zoho_offline_status', 'Candidates', 'Candidate_Status',
   'inbound', 'zoho_recruit', 'Zoho-owned offline status/outcome summary only', false, 'internal',
   'Inbound only; never overwrites portal application stage.')
on conflict do nothing;
