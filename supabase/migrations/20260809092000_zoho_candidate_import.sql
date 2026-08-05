-- ATS §9: staged Zoho Recruit candidate import.
--
-- Zoho is a satellite, not the employer search database. This schema stages an
-- import through explicit, resumable stages —
--   inventory → map → dry_run → quarantine → match → human_review
--            → canonical_upsert → reconcile → report
-- — so that no Zoho record reaches candidate_profiles without passing
-- validation, duplicate matching, and (when the match is ambiguous) a human.
--
-- Durable local↔Zoho identity lives ONLY in zoho_recruit_external_mappings.
-- The zoho_record_id on a staging row is a batch work item, not an identity
-- store: batches are purgeable (see purge_zoho_candidate_import_batch below)
-- and nothing outside the import reads them.
--
-- Server-only, exactly like the rest of the Zoho satellite: no anon/authenticated
-- policies, service_role grants only. HQ reads a sanitized summary through
-- server code after an application-layer hq_admin check.

create table if not exists public.zoho_candidate_import_batches (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.zoho_recruit_connections(id) on delete cascade,
  stage text not null default 'inventory'
    check (stage in ('inventory','map','dry_run','quarantine','match',
                     'human_review','canonical_upsert','reconcile','report')),
  status text not null default 'open'
    check (status in ('open','running','blocked','completed','cancelled','failed')),
  -- Dry-run batches never write candidate_profiles. Flipping this off is a
  -- deliberate HQ action, so an accidental worker run cannot import for real.
  is_dry_run boolean not null default true,
  source_module text not null default 'Candidates',
  requested_by uuid references public.profiles(id) on delete set null,
  -- {inventoried, mapped, quarantined, matched, needsReview, upserted, failed}
  totals jsonb not null default '{}',
  -- Append-only [{stage, at, note}] so a stalled batch shows where it stopped.
  stage_history jsonb not null default '[]',
  report jsonb not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.zoho_candidate_import_batches is
  'One staged Zoho candidate import run. Batches are dry-run by default and hold no durable external identity.';

create index if not exists idx_zoho_candidate_import_batches_open
  on public.zoho_candidate_import_batches(status, created_at desc);

drop trigger if exists trg_zoho_candidate_import_batches_updated
  on public.zoho_candidate_import_batches;
create trigger trg_zoho_candidate_import_batches_updated
before update on public.zoho_candidate_import_batches
for each row execute function public.tg_set_updated_at();

create table if not exists public.zoho_candidate_import_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.zoho_candidate_import_batches(id) on delete cascade,
  -- Batch-scoped work-item reference. Durable identity is written to
  -- zoho_recruit_external_mappings at canonical_upsert, never here.
  zoho_record_id text not null,
  stage text not null default 'inventory'
    check (stage in ('inventory','map','dry_run','quarantine','match',
                     'human_review','canonical_upsert','reconcile','report')),
  status text not null default 'pending'
    check (status in ('pending','mapped','quarantined','matched',
                      'needs_human_review','upserted','skipped','failed')),
  -- Non-empty exactly when status = 'quarantined'.
  quarantine_reasons text[] not null default '{}',
  -- Canonical-shaped draft produced by the map stage. Never written to
  -- candidate_profiles until canonical_upsert on a non-dry-run batch.
  mapped_payload jsonb not null default '{}',
  source_fingerprint text,
  matched_candidate_id uuid references public.candidate_profiles(id) on delete set null,
  match_score numeric check (match_score is null or (match_score >= 0 and match_score <= 1)),
  match_kind text check (match_kind is null or match_kind in ('exact','probabilistic','none')),
  duplicate_link_id uuid references public.candidate_duplicate_links(id) on delete set null,
  decision text check (decision is null or decision in ('create_new','link_existing','skip')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_zoho_candidate_import_record unique (batch_id, zoho_record_id),
  -- coalesce matters: array_length('{}', 1) is NULL, and a CHECK only fails on
  -- FALSE — without it an empty reason list would pass silently.
  constraint ck_zoho_import_quarantine_has_reason
    check (status <> 'quarantined' or coalesce(array_length(quarantine_reasons, 1), 0) >= 1),
  constraint ck_zoho_import_review_has_actor
    check (decision is null or reviewed_by is not null)
);

comment on table public.zoho_candidate_import_records is
  'Staged Zoho candidate rows. A quarantined row must carry at least one reason; a decided row must name the human who decided it.';

create index if not exists idx_zoho_candidate_import_records_batch
  on public.zoho_candidate_import_records(batch_id, status);
create index if not exists idx_zoho_candidate_import_records_review
  on public.zoho_candidate_import_records(status)
  where status in ('needs_human_review','quarantined');

drop trigger if exists trg_zoho_candidate_import_records_updated
  on public.zoho_candidate_import_records;
create trigger trg_zoho_candidate_import_records_updated
before update on public.zoho_candidate_import_records
for each row execute function public.tg_set_updated_at();

-- A dry-run batch must never leave a staged row claiming it was upserted.
create or replace function public.tg_zoho_import_dry_run_guard()
returns trigger language plpgsql as $$
declare
  v_dry_run boolean;
begin
  if new.status <> 'upserted' then
    return new;
  end if;
  select b.is_dry_run into v_dry_run
    from public.zoho_candidate_import_batches b
   where b.id = new.batch_id;
  if v_dry_run then
    raise exception 'zoho_candidate_import_records: a dry-run batch cannot upsert canonical records'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_zoho_import_dry_run_guard on public.zoho_candidate_import_records;
create trigger trg_zoho_import_dry_run_guard
before insert or update on public.zoho_candidate_import_records
for each row execute function public.tg_zoho_import_dry_run_guard();

-- Staging rows are working data, not a record of external identity. Purging a
-- completed batch must leave the canonical candidate and its mapping intact.
create or replace function public.purge_zoho_candidate_import_batch(p_batch_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_deleted integer;
begin
  delete from public.zoho_candidate_import_records where batch_id = p_batch_id;
  get diagnostics v_deleted = row_count;
  update public.zoho_candidate_import_batches
     set report = coalesce(report, '{}'::jsonb) || jsonb_build_object('purgedRecordCount', v_deleted)
   where id = p_batch_id;
  return v_deleted;
end $$;

revoke all on function public.purge_zoho_candidate_import_batch(uuid) from public, anon, authenticated;
grant execute on function public.purge_zoho_candidate_import_batch(uuid) to service_role;

-- ---- Server-only access boundary -------------------------------------------

alter table public.zoho_candidate_import_batches enable row level security;
alter table public.zoho_candidate_import_records enable row level security;

revoke all on table public.zoho_candidate_import_batches from public, anon, authenticated;
revoke all on table public.zoho_candidate_import_records from public, anon, authenticated;

grant select, insert, update, delete
  on table public.zoho_candidate_import_batches to service_role;
grant select, insert, update, delete
  on table public.zoho_candidate_import_records to service_role;

-- Import is gated separately from outbound sync: connecting Zoho, exporting to
-- Zoho, and importing candidates from Zoho are three independent decisions.
insert into public.feature_flags (key, is_enabled, notes) values
  ('zoho_candidate_import_enabled', false,
   'Master gate for staged Zoho Recruit candidate import. Independent of outbound sync gates.'),
  ('zoho_candidate_import_write_enabled', false,
   'Allows a non-dry-run import batch to upsert canonical candidate records. Requires zoho_candidate_import_enabled.')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
