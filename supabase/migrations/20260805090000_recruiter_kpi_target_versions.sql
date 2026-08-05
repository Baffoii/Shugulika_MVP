-- =============================================================================
-- Recruiter KPI target versioning (Workstream A).
--
-- recruiter_kpi_targets holds only the CURRENT target row per
-- (recruiter_level, organization_id). Recomputing a closed past period must use
-- the target that was in force at that period's end, not today's row.
--
-- This migration adds an append-only snapshot table fed by a trigger on every
-- insert/update of recruiter_kpi_targets, plus a backfill so existing rows have
-- an initial version. Additive only; nothing existing is dropped.
-- =============================================================================

create table if not exists public.recruiter_kpi_target_versions (
  id uuid primary key default gen_random_uuid(),
  -- Kept nullable + on delete set null so the history survives target deletion.
  target_id uuid references public.recruiter_kpi_targets(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  recruiter_level text not null
    check (recruiter_level in ('junior', 'recruiter', 'senior', 'head_recruiter')),
  -- Full metric payload snapshot (to_jsonb of the target row at write time).
  metrics jsonb not null,
  effective_from timestamptz not null default now(),
  superseded_at timestamptz,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint recruiter_kpi_target_versions_window_check
    check (superseded_at is null or superseded_at >= effective_from)
);

comment on table public.recruiter_kpi_target_versions is
  'Append-only snapshots of recruiter_kpi_targets. Resolve the row whose '
  '[effective_from, superseded_at) window contains the period end being recomputed.';

create index if not exists idx_kpi_target_versions_lookup
  on public.recruiter_kpi_target_versions (recruiter_level, organization_id, effective_from desc);
create index if not exists idx_kpi_target_versions_target
  on public.recruiter_kpi_target_versions (target_id, effective_from desc);
-- At most one open (current) version per target.
create unique index if not exists uq_kpi_target_versions_open
  on public.recruiter_kpi_target_versions (target_id)
  where superseded_at is null and target_id is not null;

-- ---- Append-only guard ------------------------------------------------------
-- Deletes are always rejected. Updates may only close an open window by setting
-- superseded_at; every other column (and a already-set superseded_at) is frozen.
create or replace function public.tg_kpi_target_versions_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'recruiter_kpi_target_versions is append-only (delete rejected)';
  end if;

  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.recruiter_level is distinct from old.recruiter_level
     or new.metrics is distinct from old.metrics
     or new.effective_from is distinct from old.effective_from
     or new.changed_by is distinct from old.changed_by
     or new.created_at is distinct from old.created_at
  then
    raise exception
      'recruiter_kpi_target_versions is append-only (only superseded_at may be set)';
  end if;

  -- The source foreign key is ON DELETE SET NULL so history survives target
  -- deletion. Permit only that database-driven transition, after the version
  -- has been closed and the referenced target no longer exists.
  if new.target_id is distinct from old.target_id
     and not (
       old.target_id is not null
       and new.target_id is null
       and old.superseded_at is not null
       and not exists (
         select 1 from public.recruiter_kpi_targets t where t.id = old.target_id
       )
     )
  then
    raise exception
      'recruiter_kpi_target_versions is append-only (target_id may only clear after target deletion)';
  end if;

  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
    raise exception 'recruiter_kpi_target_versions.superseded_at is immutable once set';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_kpi_target_versions_append_only
  on public.recruiter_kpi_target_versions;
create trigger trg_kpi_target_versions_append_only
  before update or delete on public.recruiter_kpi_target_versions
  for each row execute function public.tg_kpi_target_versions_append_only();

-- ---- Snapshot trigger on recruiter_kpi_targets ------------------------------
-- SECURITY DEFINER so a franchise admin editing an org target can still write
-- the (RLS-protected) version row. Writes only ever describe the row the caller
-- just changed, so this does not widen what a caller can affect.
create or replace function public.tg_snapshot_kpi_target_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  -- Close the final version while the source target still exists. The foreign
  -- key subsequently preserves that history by setting target_id to NULL.
  if tg_op = 'DELETE' then
    update public.recruiter_kpi_target_versions
    set superseded_at = v_now
    where target_id = old.id
      and superseded_at is null;
    return old;
  end if;

  -- No-op when nothing metric-bearing actually changed.
  if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
    return new;
  end if;

  update public.recruiter_kpi_target_versions
  set superseded_at = v_now
  where target_id = new.id
    and superseded_at is null;

  insert into public.recruiter_kpi_target_versions (
    target_id, organization_id, recruiter_level, metrics,
    effective_from, superseded_at, changed_by
  ) values (
    new.id,
    new.organization_id,
    new.recruiter_level,
    to_jsonb(new),
    v_now,
    null,
    auth.uid()
  );

  return new;
end;
$$;

drop trigger if exists trg_snapshot_kpi_target_version on public.recruiter_kpi_targets;
create trigger trg_snapshot_kpi_target_version
  after insert or update on public.recruiter_kpi_targets
  for each row execute function public.tg_snapshot_kpi_target_version();

drop trigger if exists trg_close_kpi_target_version_before_delete
  on public.recruiter_kpi_targets;
create trigger trg_close_kpi_target_version_before_delete
  before delete on public.recruiter_kpi_targets
  for each row execute function public.tg_snapshot_kpi_target_version();

-- ---- Backfill: one initial version per existing target ----------------------
-- effective_from uses the target's created_at so historical periods resolve to
-- the seeded values rather than "no version yet".
insert into public.recruiter_kpi_target_versions (
  target_id, organization_id, recruiter_level, metrics,
  effective_from, superseded_at, changed_by
)
select t.id, t.organization_id, t.recruiter_level, to_jsonb(t),
       coalesce(t.created_at, now()), null, null
from public.recruiter_kpi_targets t
where not exists (
  select 1 from public.recruiter_kpi_target_versions v where v.target_id = t.id
);

-- ---- RLS --------------------------------------------------------------------
alter table public.recruiter_kpi_target_versions enable row level security;

-- Read mirrors target visibility: platform rows are readable by any staff user,
-- org rows only inside the caller's scoped orgs. Employers/candidates hold no
-- membership row that grants either, so they see nothing.
drop policy if exists "kpi_target_versions_read" on public.recruiter_kpi_target_versions;
create policy "kpi_target_versions_read" on public.recruiter_kpi_target_versions
  for select to authenticated
  using (
    public.auth_is_hq()
    or (
      organization_id is null
      and (
        public.auth_has_role('recruiter')
        or public.auth_has_role('franchise_admin')
      )
    )
    or organization_id in (select public.auth_scoped_org_ids())
  );

-- No direct insert policy: rows are only ever written by the SECURITY DEFINER
-- snapshot trigger. Update is additionally narrowed by the append-only guard.
drop policy if exists "kpi_target_versions_hq_supersede" on public.recruiter_kpi_target_versions;
create policy "kpi_target_versions_hq_supersede" on public.recruiter_kpi_target_versions
  for update to authenticated
  using (public.auth_is_hq())
  with check (public.auth_is_hq());

grant select on public.recruiter_kpi_target_versions to authenticated;
grant all on public.recruiter_kpi_target_versions to service_role;

notify pgrst, 'reload schema';
