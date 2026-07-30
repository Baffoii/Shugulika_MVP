-- =============================================================================
-- Finalize recruiter / franchise / HQ KPI system.
-- Additive: expand seniority levels, expand KPI targets, stage-age thresholds,
-- indexes, franchise write RLS, target audit, grants.
-- =============================================================================

-- ---- Expand recruiter_level vocabulary --------------------------------------
-- Drop old checks, migrate values, add new checks.

alter table public.memberships drop constraint if exists memberships_recruiter_level_check;
alter table public.recruiter_kpi_targets drop constraint if exists recruiter_kpi_targets_recruiter_level_check;

update public.memberships
set recruiter_level = case recruiter_level
  when 'generic' then 'recruiter'
  when 'head' then 'head_recruiter'
  else recruiter_level
end
where recruiter_level in ('generic', 'head');

update public.recruiter_kpi_targets
set recruiter_level = case recruiter_level
  when 'generic' then 'recruiter'
  when 'head' then 'head_recruiter'
  else recruiter_level
end
where recruiter_level in ('generic', 'head');

alter table public.memberships
  add constraint memberships_recruiter_level_check
  check (
    recruiter_level is null
    or recruiter_level in ('junior', 'recruiter', 'senior', 'head_recruiter')
  );

alter table public.recruiter_kpi_targets
  add constraint recruiter_kpi_targets_recruiter_level_check
  check (recruiter_level in ('junior', 'recruiter', 'senior', 'head_recruiter'));

-- ---- Expand recruiter_kpi_targets columns -----------------------------------
alter table public.recruiter_kpi_targets
  add column if not exists max_time_to_first_review_hours int not null default 48,
  add column if not exists max_time_to_client_submission_days int not null default 14,
  add column if not exists min_interview_conversion_pct int not null default 40,
  add column if not exists min_client_submission_acceptance_pct int not null default 40,
  add column if not exists max_active_workload int not null default 40,
  add column if not exists max_stalled_application_count int not null default 10;

-- Map legacy columns into the new semantics where helpful (TTF / placement /
-- offer-to-hire already exist). Backfill new columns from level defaults.
update public.recruiter_kpi_targets set
  max_time_to_first_review_hours = case recruiter_level
    when 'junior' then 72
    when 'senior' then 36
    when 'head_recruiter' then 24
    else 48
  end,
  max_time_to_client_submission_days = case recruiter_level
    when 'junior' then 21
    when 'senior' then 10
    when 'head_recruiter' then 7
    else 14
  end,
  min_interview_conversion_pct = case recruiter_level
    when 'junior' then 30
    when 'senior' then 50
    when 'head_recruiter' then 55
    else 40
  end,
  min_client_submission_acceptance_pct = case recruiter_level
    when 'junior' then 30
    when 'senior' then 45
    when 'head_recruiter' then 50
    else 40
  end,
  max_active_workload = case recruiter_level
    when 'junior' then 25
    when 'senior' then 50
    when 'head_recruiter' then 60
    else 40
  end,
  max_stalled_application_count = case recruiter_level
    when 'junior' then 8
    when 'senior' then 12
    when 'head_recruiter' then 15
    else 10
  end;

-- Seed platform defaults for senior + ensure all four levels exist globally.
insert into public.recruiter_kpi_targets (
  recruiter_level, organization_id,
  target_time_to_fill_days, target_placement_rate_pct,
  target_apps_reviewed_per_week, target_offer_to_hire_ratio_pct,
  min_aptitude_test_score,
  max_time_to_first_review_hours, max_time_to_client_submission_days,
  min_interview_conversion_pct, min_client_submission_acceptance_pct,
  max_active_workload, max_stalled_application_count
)
select v.lvl, null, v.ttf, v.pr, v.arw, v.ohr, v.min_apt,
       v.first_h, v.cs_d, v.ic, v.csa, v.wl, v.stalled
from (values
  ('junior',         21, 50, 12, 40, 50, 72, 21, 30, 30, 25, 8),
  ('recruiter',      14, 70, 20, 50, 60, 48, 14, 40, 40, 40, 10),
  ('senior',         12, 75, 25, 55, 65, 36, 10, 50, 45, 50, 12),
  ('head_recruiter', 10, 80, 30, 60, 70, 24,  7, 55, 50, 60, 15)
) as v(lvl, ttf, pr, arw, ohr, min_apt, first_h, cs_d, ic, csa, wl, stalled)
where not exists (
  select 1 from public.recruiter_kpi_targets t
  where t.recruiter_level = v.lvl and t.organization_id is null
);

-- Align existing global rows with the seeded defaults for migrated levels.
update public.recruiter_kpi_targets t
set
  target_time_to_fill_days = s.ttf,
  target_placement_rate_pct = s.pr,
  target_apps_reviewed_per_week = s.arw,
  target_offer_to_hire_ratio_pct = s.ohr,
  min_aptitude_test_score = s.min_apt,
  max_time_to_first_review_hours = s.first_h,
  max_time_to_client_submission_days = s.cs_d,
  min_interview_conversion_pct = s.ic,
  min_client_submission_acceptance_pct = s.csa,
  max_active_workload = s.wl,
  max_stalled_application_count = s.stalled,
  updated_at = now()
from (values
  ('junior',         21, 50, 12, 40, 50, 72, 21, 30, 30, 25, 8),
  ('recruiter',      14, 70, 20, 50, 60, 48, 14, 40, 40, 40, 10),
  ('senior',         12, 75, 25, 55, 65, 36, 10, 50, 45, 50, 12),
  ('head_recruiter', 10, 80, 30, 60, 70, 24,  7, 55, 50, 60, 15)
) as s(lvl, ttf, pr, arw, ohr, min_apt, first_h, cs_d, ic, csa, wl, stalled)
where t.recruiter_level = s.lvl
  and t.organization_id is null;

-- ---- Stage-age thresholds ---------------------------------------------------
create table if not exists public.kpi_stage_age_thresholds (
  id uuid primary key default gen_random_uuid(),
  stage_key text not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  max_hours int not null check (max_hours > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_kpi_stage_age_global
  on public.kpi_stage_age_thresholds (stage_key)
  where organization_id is null;
create unique index if not exists uq_kpi_stage_age_org
  on public.kpi_stage_age_thresholds (stage_key, organization_id)
  where organization_id is not null;

drop trigger if exists trg_updated on public.kpi_stage_age_thresholds;
create trigger trg_updated before update on public.kpi_stage_age_thresholds
  for each row execute function public.tg_set_updated_at();

insert into public.kpi_stage_age_thresholds (stage_key, organization_id, max_hours)
select v.stage_key, null, v.max_hours
from (values
  ('cv_review', 72),
  ('testing', 168),
  ('test_review', 72),
  ('interview_screening', 168),
  ('interview_review', 72),
  ('reference_checks', 120),
  ('client_submission', 120),
  ('offer', 168)
) as v(stage_key, max_hours)
where not exists (
  select 1 from public.kpi_stage_age_thresholds t
  where t.stage_key = v.stage_key and t.organization_id is null
);

-- ---- Indexes for KPI queries ------------------------------------------------
create index if not exists idx_stage_hist_actor_created
  on public.application_stage_history (actor_id, created_at);
create index if not exists idx_stage_hist_to_stage_created
  on public.application_stage_history (to_stage, created_at);
create index if not exists idx_app_recruiter_created
  on public.applications (assigned_recruiter_id, created_at);
create index if not exists idx_app_recruiter_stage
  on public.applications (assigned_recruiter_id, current_stage);
create index if not exists idx_placements_recruiter_created
  on public.placements (recruiter_id, created_at);
create index if not exists idx_offers_owning_status_updated
  on public.offers (owning_org_id, status, updated_at);
create index if not exists idx_sub_submitting_status_submitted
  on public.employer_submissions (submitting_org_id, status, submitted_at);

-- ---- Target / threshold audit -----------------------------------------------
create or replace function public.tg_audit_kpi_targets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, org_context_id,
      before_value, after_value, metadata
    ) values (
      auth.uid(),
      'kpi_target.deleted',
      'recruiter_kpi_targets',
      old.id,
      old.organization_id,
      to_jsonb(old),
      null,
      jsonb_build_object('recruiter_level', old.recruiter_level)
    );
    return old;
  elsif tg_op = 'INSERT' then
    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, org_context_id,
      before_value, after_value, metadata
    ) values (
      auth.uid(),
      'kpi_target.created',
      'recruiter_kpi_targets',
      new.id,
      new.organization_id,
      null,
      to_jsonb(new),
      jsonb_build_object('recruiter_level', new.recruiter_level)
    );
    return new;
  else
    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, org_context_id,
      before_value, after_value, metadata
    ) values (
      auth.uid(),
      'kpi_target.updated',
      'recruiter_kpi_targets',
      new.id,
      new.organization_id,
      to_jsonb(old),
      to_jsonb(new),
      jsonb_build_object('recruiter_level', new.recruiter_level)
    );
    return new;
  end if;
end;
$$;

drop trigger if exists trg_audit_kpi_targets on public.recruiter_kpi_targets;
create trigger trg_audit_kpi_targets
  after insert or update or delete on public.recruiter_kpi_targets
  for each row execute function public.tg_audit_kpi_targets();

create or replace function public.tg_audit_kpi_stage_thresholds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, org_context_id,
      before_value, after_value, metadata
    ) values (
      auth.uid(),
      'kpi_stage_threshold.deleted',
      'kpi_stage_age_thresholds',
      old.id,
      old.organization_id,
      to_jsonb(old),
      null,
      jsonb_build_object('stage_key', old.stage_key)
    );
    return old;
  elsif tg_op = 'INSERT' then
    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, org_context_id,
      before_value, after_value, metadata
    ) values (
      auth.uid(),
      'kpi_stage_threshold.created',
      'kpi_stage_age_thresholds',
      new.id,
      new.organization_id,
      null,
      to_jsonb(new),
      jsonb_build_object('stage_key', new.stage_key)
    );
    return new;
  else
    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, org_context_id,
      before_value, after_value, metadata
    ) values (
      auth.uid(),
      'kpi_stage_threshold.updated',
      'kpi_stage_age_thresholds',
      new.id,
      new.organization_id,
      to_jsonb(old),
      to_jsonb(new),
      jsonb_build_object('stage_key', new.stage_key)
    );
    return new;
  end if;
end;
$$;

drop trigger if exists trg_audit_kpi_stage_thresholds on public.kpi_stage_age_thresholds;
create trigger trg_audit_kpi_stage_thresholds
  after insert or update or delete on public.kpi_stage_age_thresholds
  for each row execute function public.tg_audit_kpi_stage_thresholds();

-- ---- RLS: franchise may manage org-scoped targets ---------------------------
drop policy if exists "kpi_targets_hq_write" on public.recruiter_kpi_targets;
drop policy if exists "kpi_targets_write" on public.recruiter_kpi_targets;

-- HQ: full write including platform (organization_id is null) rows.
create policy "kpi_targets_hq_write" on public.recruiter_kpi_targets
  for all to authenticated
  using (public.auth_is_hq())
  with check (public.auth_is_hq());

-- Franchise admins: org-scoped rows only (never platform defaults).
create policy "kpi_targets_franchise_write" on public.recruiter_kpi_targets
  for all to authenticated
  using (
    not public.auth_is_hq()
    and public.auth_has_role('franchise_admin')
    and organization_id is not null
    and organization_id in (select public.auth_scoped_org_ids())
  )
  with check (
    not public.auth_is_hq()
    and public.auth_has_role('franchise_admin')
    and organization_id is not null
    and organization_id in (select public.auth_scoped_org_ids())
  );

alter table public.kpi_stage_age_thresholds enable row level security;

drop policy if exists "kpi_stage_age_read" on public.kpi_stage_age_thresholds;
create policy "kpi_stage_age_read" on public.kpi_stage_age_thresholds
  for select to authenticated
  using (
    organization_id is null
    or organization_id in (select public.auth_scoped_org_ids())
    or public.auth_is_hq()
  );

drop policy if exists "kpi_stage_age_hq_write" on public.kpi_stage_age_thresholds;
create policy "kpi_stage_age_hq_write" on public.kpi_stage_age_thresholds
  for all to authenticated
  using (public.auth_is_hq())
  with check (public.auth_is_hq());

drop policy if exists "kpi_stage_age_franchise_write" on public.kpi_stage_age_thresholds;
create policy "kpi_stage_age_franchise_write" on public.kpi_stage_age_thresholds
  for all to authenticated
  using (
    not public.auth_is_hq()
    and public.auth_has_role('franchise_admin')
    and organization_id is not null
    and organization_id in (select public.auth_scoped_org_ids())
  )
  with check (
    not public.auth_is_hq()
    and public.auth_has_role('franchise_admin')
    and organization_id is not null
    and organization_id in (select public.auth_scoped_org_ids())
  );

-- ---- Grants (fix 0029 gap on fresh applies) ---------------------------------
grant select on public.job_roles to authenticated;
grant select, insert, update, delete on public.recruiter_role_assignments to authenticated;
grant select, insert, update, delete on public.recruiter_kpi_targets to authenticated;
grant select, insert, update, delete on public.kpi_stage_age_thresholds to authenticated;
grant all on public.job_roles to service_role;
grant all on public.recruiter_role_assignments to service_role;
grant all on public.recruiter_kpi_targets to service_role;
grant all on public.kpi_stage_age_thresholds to service_role;

notify pgrst, 'reload schema';
