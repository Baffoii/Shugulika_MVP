-- Zoho Recruit satellite foundation (D-1).
--
-- This migration is deliberately additive. It creates a server-only integration
-- ledger and disabled-by-default gates, but it does not attach triggers to any
-- existing recruitment table and cannot enqueue or export existing platform data.

-- ---- Connection credentials and provider metadata --------------------------

create table if not exists public.zoho_recruit_connections (
  id uuid primary key default gen_random_uuid(),
  connection_key text not null default 'primary',
  status text not null default 'disconnected'
    check (status in ('disconnected', 'pending', 'connected', 'error', 'disabled')),
  zoho_org_id text,
  zoho_org_name text,
  zoho_org_country text,
  zoho_plan text,
  accounts_domain text,
  api_domain text,
  data_center_location text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_zoho_recruit_connection_key unique (connection_key)
);

comment on table public.zoho_recruit_connections is
  'Server-only Zoho Recruit OAuth credentials and non-secret organization metadata. Never browser-readable.';

drop trigger if exists trg_zoho_recruit_connections_updated
  on public.zoho_recruit_connections;
create trigger trg_zoho_recruit_connections_updated
before update on public.zoho_recruit_connections
for each row execute function public.tg_set_updated_at();

-- ---- Stable local ↔ Zoho identity mapping ----------------------------------

create table if not exists public.zoho_recruit_external_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.zoho_recruit_connections(id) on delete cascade,
  local_entity_type text not null,
  local_entity_id uuid not null,
  zoho_module text not null,
  zoho_record_id text not null,
  sync_direction text not null default 'outbound'
    check (sync_direction in ('outbound', 'inbound', 'bidirectional_summary')),
  last_local_fingerprint text,
  last_external_fingerprint text,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_zoho_mapping_local
    unique (connection_id, local_entity_type, local_entity_id),
  constraint uq_zoho_mapping_external
    unique (connection_id, zoho_module, zoho_record_id)
);

create index if not exists idx_zoho_mapping_local
  on public.zoho_recruit_external_mappings(local_entity_type, local_entity_id);

drop trigger if exists trg_zoho_recruit_external_mappings_updated
  on public.zoho_recruit_external_mappings;
create trigger trg_zoho_recruit_external_mappings_updated
before update on public.zoho_recruit_external_mappings
for each row execute function public.tg_set_updated_at();

-- ---- Durable outbound and inbound ledgers ----------------------------------

create table if not exists public.zoho_recruit_outbox (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.zoho_recruit_connections(id) on delete cascade,
  event_id uuid not null default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  processing_purpose text not null,
  payload_version integer not null default 1 check (payload_version > 0),
  payload jsonb not null,
  consent_snapshot jsonb not null default '{}',
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'retry', 'succeeded', 'dead_letter', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint uq_zoho_outbox_event unique (event_id)
);

create index if not exists idx_zoho_outbox_ready
  on public.zoho_recruit_outbox(status, available_at)
  where status in ('queued', 'retry');
create index if not exists idx_zoho_outbox_aggregate
  on public.zoho_recruit_outbox(aggregate_type, aggregate_id);

create table if not exists public.zoho_recruit_inbox (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.zoho_recruit_connections(id) on delete cascade,
  dedupe_key text not null,
  event_type text,
  payload jsonb not null,
  signature_verified boolean not null default false,
  status text not null default 'received'
    check (status in ('received', 'processing', 'succeeded', 'ignored', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  constraint uq_zoho_inbox_dedupe unique (connection_id, dedupe_key)
);

create index if not exists idx_zoho_inbox_status
  on public.zoho_recruit_inbox(status, received_at);

-- ---- Conflict and reconciliation evidence ----------------------------------

create table if not exists public.zoho_recruit_conflicts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.zoho_recruit_connections(id) on delete cascade,
  mapping_id uuid references public.zoho_recruit_external_mappings(id) on delete set null,
  field_name text not null,
  authoritative_system text not null
    check (authoritative_system in ('shugulika', 'zoho_recruit')),
  local_value_hash text,
  external_value_hash text,
  status text not null default 'open'
    check (status in ('open', 'resolved_local', 'resolved_external', 'ignored')),
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_zoho_conflicts_open
  on public.zoho_recruit_conflicts(connection_id, created_at)
  where status = 'open';

create table if not exists public.zoho_recruit_reconciliations (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.zoho_recruit_connections(id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  cursor_value text,
  records_checked integer not null default 0 check (records_checked >= 0),
  differences_found integer not null default 0 check (differences_found >= 0),
  summary jsonb not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text
);

create index if not exists idx_zoho_reconciliations_started
  on public.zoho_recruit_reconciliations(connection_id, started_at desc);

-- ---- Server-only access boundary -------------------------------------------

alter table public.zoho_recruit_connections enable row level security;
alter table public.zoho_recruit_external_mappings enable row level security;
alter table public.zoho_recruit_outbox enable row level security;
alter table public.zoho_recruit_inbox enable row level security;
alter table public.zoho_recruit_conflicts enable row level security;
alter table public.zoho_recruit_reconciliations enable row level security;

-- No anon/authenticated policies are created. HQ reads a sanitized status
-- through server code after an application-layer hq_admin check.
revoke all on table public.zoho_recruit_connections from public, anon, authenticated;
revoke all on table public.zoho_recruit_external_mappings from public, anon, authenticated;
revoke all on table public.zoho_recruit_outbox from public, anon, authenticated;
revoke all on table public.zoho_recruit_inbox from public, anon, authenticated;
revoke all on table public.zoho_recruit_conflicts from public, anon, authenticated;
revoke all on table public.zoho_recruit_reconciliations from public, anon, authenticated;

grant select, insert, update, delete on table public.zoho_recruit_connections to service_role;
grant select, insert, update, delete on table public.zoho_recruit_external_mappings to service_role;
grant select, insert, update, delete on table public.zoho_recruit_outbox to service_role;
grant select, insert, update, delete on table public.zoho_recruit_inbox to service_role;
grant select, insert, update, delete on table public.zoho_recruit_conflicts to service_role;
grant select, insert, update, delete on table public.zoho_recruit_reconciliations to service_role;

-- Separate gates prevent connection setup from ever enabling data export.
insert into public.feature_flags (key, is_enabled, notes) values
  ('zoho_recruit_enabled', false,
   'Master runtime gate reserved for future Zoho Recruit synchronization; OAuth setup is separate.'),
  ('zoho_recruit_data_sync_enabled', false,
   'Master kill switch for any future Zoho Recruit record synchronization.'),
  ('zoho_recruit_production_data_enabled', false,
   'Requires DPO/legal approval before any production candidate data may be exported.')
on conflict (key) do nothing;

insert into public.integration_connections (key, name, status, config) values
  (
    'zoho_recruit',
    'Zoho Recruit (offline satellite)',
    'not_enabled',
    '{"mode":"satellite","data_sync_enabled":false}'::jsonb
  )
on conflict (key) do nothing;
