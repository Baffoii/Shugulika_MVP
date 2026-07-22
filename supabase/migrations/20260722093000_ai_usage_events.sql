-- =============================================================================
-- AI usage events — persist OpenAI token usage for HQ credit tracking.
-- Append-only; estimates use list rates (not OpenAI invoice truth).
-- =============================================================================

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  feature text not null check (feature in ('resume', 'screening')),
  purpose text not null,
  model text not null,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  estimated_usd numeric(12, 8),
  duration_ms int,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_created_at_idx
  on public.ai_usage_events (created_at desc);
create index if not exists ai_usage_events_purpose_idx
  on public.ai_usage_events (purpose);
create index if not exists ai_usage_events_feature_idx
  on public.ai_usage_events (feature);

comment on table public.ai_usage_events is
  'Append-only OpenAI call ledger for HQ spend tracking. estimated_usd uses published list rates and may differ from the OpenAI invoice.';

alter table public.ai_usage_events enable row level security;

-- Authenticated callers may append their own events (actor_id = self or null).
drop policy if exists ai_usage_insert on public.ai_usage_events;
create policy ai_usage_insert on public.ai_usage_events
  for insert to authenticated
  with check (actor_id is null or actor_id = auth.uid());

-- HQ admins may read the full ledger. No UPDATE/DELETE policies (append-only).
drop policy if exists ai_usage_hq_read on public.ai_usage_events;
create policy ai_usage_hq_read on public.ai_usage_events
  for select to authenticated
  using (public.auth_is_hq());

grant select, insert on public.ai_usage_events to authenticated;

-- HQ needs aggregate visibility into OpenAI-backed CV parses (candidate RLS
-- otherwise hides these rows from the AI usage dashboard).
drop policy if exists resume_parse_runs_hq_read on public.resume_parse_runs;
create policy resume_parse_runs_hq_read on public.resume_parse_runs
  for select to authenticated
  using (public.auth_is_hq());
