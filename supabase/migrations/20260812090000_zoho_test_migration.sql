-- =============================================================================
-- Zoho rehearsal migration support.
--
-- Applications brought over from Zoho are *historical records*: candidates and
-- recruiters may read them, but nobody may edit or delete them through the app.
-- They describe what already happened in Zoho, so any local edit would be a
-- fiction. Enforced in the database rather than the UI, because the candidate
-- and recruiter clients both hold RLS-bound update policies on `applications`
-- and could otherwise write directly.
--
-- Also registers the Zoho candidate-status vocabulary as pipeline stages so
-- migrated history maps onto the real pipeline instead of being flattened.
-- =============================================================================

-- ---- Historical marker ------------------------------------------------------
alter table public.applications
  add column if not exists is_migrated_readonly boolean not null default false;

comment on column public.applications.is_migrated_readonly is
  'True for applications imported from an external ATS. Read-only: blocked from UPDATE/DELETE by trg_applications_migrated_readonly for every role except service_role.';

create index if not exists idx_applications_migrated
  on public.applications(is_migrated_readonly)
  where is_migrated_readonly;

-- ---- Immutability guard -----------------------------------------------------
create or replace function public.tg_block_migrated_record_writes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Two trusted callers, and only two:
  --   * the importer, which runs as service_role via supabase-js;
  --   * an explicit maintenance escape hatch, following the same
  --     transaction-local GUC convention as app.submitting_interview in
  --     0021_video_interviews_hardening.
  -- The GUC matters because auth.role() is only populated for PostgREST
  -- requests. Without it a direct psql session reads as 'anon' and would be
  -- locked out of its own data — including unsetting is_migrated_readonly.
  if coalesce(auth.role(), 'anon') = 'service_role'
     or coalesce(current_setting('app.migrating_zoho', true), '') = 'true' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'Record % is migrated historical data and cannot be deleted.', old.id
      using errcode = 'check_violation';
  end if;

  raise exception
    'Record % is migrated historical data and cannot be modified.', old.id
    using errcode = 'check_violation';
end;
$$;

-- WHEN clause keeps this off the hot path: it only fires for migrated rows.
drop trigger if exists trg_applications_migrated_readonly on public.applications;
create trigger trg_applications_migrated_readonly
before update or delete on public.applications
for each row
when (old.is_migrated_readonly)
execute function public.tg_block_migrated_record_writes();

-- Stage history for a migrated application is equally historical. `source` is
-- already on the table, so no new column is needed.
create or replace function public.tg_block_migrated_stage_history_writes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Same two trusted callers as tg_block_migrated_record_writes.
  if coalesce(auth.role(), 'anon') = 'service_role'
     or coalesce(current_setting('app.migrating_zoho', true), '') = 'true' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception
    'Stage history row % is migrated historical data and cannot be changed.', old.id
    using errcode = 'check_violation';
end;
$$;

comment on function public.tg_block_migrated_record_writes() is
  'Blocks UPDATE/DELETE on migrated historical rows. Trusted callers: service_role, or a transaction that has set app.migrating_zoho = true.';

drop trigger if exists trg_stage_history_migrated_readonly on public.application_stage_history;
create trigger trg_stage_history_migrated_readonly
before update or delete on public.application_stage_history
for each row
when (old.source = 'zoho_migration')
execute function public.tg_block_migrated_stage_history_writes();

-- ---- Zoho candidate-status vocabulary --------------------------------------
-- Registered at high ordinals like the other legacy keys, so migrated history
-- resolves the `current_stage` / `to_stage` foreign keys without appearing in
-- the live recruiter pipeline UI. Statuses that DO map cleanly onto a real
-- stage are mapped in application code (zoho-recruit/import/stage-map.ts) and
-- deliberately absent here.
insert into public.pipeline_stages (key, label, ordinal, stage_class) values
  ('zoho_new','Zoho: New',120,'candidate'),
  ('zoho_waiting_evaluation','Zoho: Waiting for Evaluation',121,'candidate'),
  ('zoho_contacted','Zoho: Contacted',122,'candidate'),
  ('zoho_unqualified','Zoho: Unqualified',123,'candidate'),
  ('zoho_junk','Zoho: Junk',124,'candidate'),
  ('zoho_on_hold','Zoho: On Hold',125,'candidate'),
  ('zoho_unmapped','Zoho: Unmapped Status',126,'candidate')
on conflict (key) do update set
  label = excluded.label,
  ordinal = excluded.ordinal,
  stage_class = excluded.stage_class;

-- ---- Execute-privilege hardening -------------------------------------------
-- Postgres grants EXECUTE to PUBLIC on new functions. These are trigger-only
-- and must never be callable over PostgREST by any client role.
revoke all on function public.tg_block_migrated_record_writes() from public;
revoke all on function public.tg_block_migrated_record_writes() from anon, authenticated;
revoke all on function public.tg_block_migrated_stage_history_writes() from public;
revoke all on function public.tg_block_migrated_stage_history_writes() from anon, authenticated;

notify pgrst, 'reload schema';
