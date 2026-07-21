-- =============================================================================
-- 0029 — Recruiter role assignments + KPI targets.
-- Adds job_role taxonomy on job_orders, region-scoped role assignment for
-- recruiters, default KPI targets by recruiter level, and TZ region defaults
-- for demo recruiter memberships. RLS follows SECURITY DEFINER helpers to
-- avoid membership recursion.
-- =============================================================================

-- ---- Job role taxonomy (controlled vocabulary for assignments + KPIs) -------
create table if not exists public.job_roles (
  id text primary key,
  label text not null,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

insert into public.job_roles (id, label, description, sort_order) values
  ('software_engineer', 'Software Engineer', 'Engineering and development roles', 10),
  ('product_manager', 'Product Manager', 'Product ownership and roadmap roles', 20),
  ('sales_executive', 'Sales Executive', 'Business development and sales', 30),
  ('finance_analyst', 'Finance Analyst', 'Finance, accounting, and analysis', 40),
  ('operations_manager', 'Operations Manager', 'Ops, logistics, and coordination', 50),
  ('customer_success', 'Customer Success', 'Account management and support', 60),
  ('hr_generalist', 'HR Generalist', 'People operations and HR', 70),
  ('marketing_specialist', 'Marketing Specialist', 'Marketing and communications', 80),
  ('data_analyst', 'Data Analyst', 'Analytics and BI', 90),
  ('general', 'General / Uncategorized', 'Fallback when a job has no specific role', 999)
on conflict (id) do nothing;

-- ---- job_orders.job_role ----------------------------------------------------
alter table public.job_orders
  add column if not exists job_role text references public.job_roles(id);

create index if not exists idx_jo_job_role on public.job_orders(job_role);

-- Backfill demo / existing orders to a sensible default so KPI filters work.
update public.job_orders
set job_role = 'general'
where job_role is null;

-- ---- Recruiter level on memberships (recruiters only; null for others) ------
alter table public.memberships
  add column if not exists recruiter_level text
  check (recruiter_level is null or recruiter_level in ('generic', 'head', 'junior'));

update public.memberships
set recruiter_level = 'generic'
where role = 'recruiter' and recruiter_level is null;

-- ---- recruiter_role_assignments ---------------------------------------------
create table if not exists public.recruiter_role_assignments (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references public.profiles(id) on delete cascade,
  recruiter_organization_id uuid references public.organizations(id),
  job_role_id text not null references public.job_roles(id),
  assigned_by uuid references public.profiles(id),
  assigned_region_code text references public.countries(code),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_recruiter_role unique (recruiter_id, job_role_id)
);

create index if not exists idx_rra_recruiter on public.recruiter_role_assignments(recruiter_id);
create index if not exists idx_rra_role on public.recruiter_role_assignments(job_role_id);
create index if not exists idx_rra_region on public.recruiter_role_assignments(assigned_region_code);
create index if not exists idx_rra_status on public.recruiter_role_assignments(status);

drop trigger if exists trg_updated on public.recruiter_role_assignments;
create trigger trg_updated before update on public.recruiter_role_assignments
  for each row execute function public.tg_set_updated_at();

-- ---- recruiter_kpi_targets --------------------------------------------------
create table if not exists public.recruiter_kpi_targets (
  id uuid primary key default gen_random_uuid(),
  recruiter_level text not null
    check (recruiter_level in ('generic', 'head', 'junior')),
  organization_id uuid references public.organizations(id),
  target_time_to_fill_days int not null default 14,
  target_placement_rate_pct int not null default 70,
  target_apps_reviewed_per_week int not null default 20,
  target_offer_to_hire_ratio_pct int not null default 50,
  min_aptitude_test_score int default 60,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_kpi_targets_level on public.recruiter_kpi_targets(recruiter_level);
-- Postgres treats NULLs as distinct in UNIQUE, so use partial indexes.
create unique index if not exists uq_kpi_targets_global
  on public.recruiter_kpi_targets (recruiter_level)
  where organization_id is null;
create unique index if not exists uq_kpi_targets_org
  on public.recruiter_kpi_targets (recruiter_level, organization_id)
  where organization_id is not null;

drop trigger if exists trg_updated on public.recruiter_kpi_targets;
create trigger trg_updated before update on public.recruiter_kpi_targets
  for each row execute function public.tg_set_updated_at();

-- Global defaults (organization_id null = platform-wide)
insert into public.recruiter_kpi_targets (
  recruiter_level, organization_id,
  target_time_to_fill_days, target_placement_rate_pct,
  target_apps_reviewed_per_week, target_offer_to_hire_ratio_pct,
  min_aptitude_test_score
)
select v.recruiter_level, null, v.ttf, v.pr, v.arw, v.ohr, v.min_apt
from (values
  ('generic', 14, 70, 20, 50, 60),
  ('head',    10, 80, 30, 60, 70),
  ('junior',  21, 50, 12, 40, 50)
) as v(recruiter_level, ttf, pr, arw, ohr, min_apt)
where not exists (
  select 1 from public.recruiter_kpi_targets t
  where t.recruiter_level = v.recruiter_level and t.organization_id is null
);

-- ---- Region helpers for assignment RLS --------------------------------------
-- Country codes the current user may administer for recruiter role assignment.
create or replace function public.auth_admin_region_codes()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  -- HQ: every active country
  select c.code from public.countries c
  where c.is_active and public.auth_is_hq()
  union
  -- Franchise / operations: membership country, else org country
  select coalesce(m.country_code, o.country_code)
  from public.memberships m
  left join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and m.role in ('franchise_admin', 'operations')
    and coalesce(m.country_code, o.country_code) is not null;
$$;

create or replace function public.auth_can_manage_role_assignment(p_region text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.auth_is_hq()
    or (
      p_region is not null
      and p_region in (select public.auth_admin_region_codes())
    );
$$;

-- ---- RLS: job_roles (read for authenticated staff; HQ manages) --------------
alter table public.job_roles enable row level security;

drop policy if exists "job_roles_read" on public.job_roles;
create policy "job_roles_read" on public.job_roles
  for select to authenticated
  using (true);

drop policy if exists "job_roles_hq_write" on public.job_roles;
create policy "job_roles_hq_write" on public.job_roles
  for all to authenticated
  using (public.auth_is_hq())
  with check (public.auth_is_hq());

-- ---- RLS: recruiter_role_assignments ----------------------------------------
alter table public.recruiter_role_assignments enable row level security;

drop policy if exists "rra_hq_all" on public.recruiter_role_assignments;
create policy "rra_hq_all" on public.recruiter_role_assignments
  for all to authenticated
  using (public.auth_is_hq())
  with check (public.auth_is_hq());

drop policy if exists "rra_region_admin_all" on public.recruiter_role_assignments;
create policy "rra_region_admin_all" on public.recruiter_role_assignments
  for all to authenticated
  using (
    not public.auth_is_hq()
    and public.auth_can_manage_role_assignment(assigned_region_code)
  )
  with check (
    not public.auth_is_hq()
    and public.auth_can_manage_role_assignment(assigned_region_code)
  );

drop policy if exists "rra_recruiter_select_own" on public.recruiter_role_assignments;
create policy "rra_recruiter_select_own" on public.recruiter_role_assignments
  for select to authenticated
  using (recruiter_id = auth.uid());

-- Staff who share an org with the recruiter can read assignments (admin list).
drop policy if exists "rra_org_peer_select" on public.recruiter_role_assignments;
create policy "rra_org_peer_select" on public.recruiter_role_assignments
  for select to authenticated
  using (
    recruiter_organization_id is not null
    and recruiter_organization_id in (select public.auth_scoped_org_ids())
  );

-- ---- RLS: recruiter_kpi_targets ---------------------------------------------
alter table public.recruiter_kpi_targets enable row level security;

drop policy if exists "kpi_targets_read" on public.recruiter_kpi_targets;
create policy "kpi_targets_read" on public.recruiter_kpi_targets
  for select to authenticated
  using (
    organization_id is null
    or organization_id in (select public.auth_scoped_org_ids())
    or public.auth_is_hq()
  );

drop policy if exists "kpi_targets_hq_write" on public.recruiter_kpi_targets;
create policy "kpi_targets_hq_write" on public.recruiter_kpi_targets
  for all to authenticated
  using (public.auth_is_hq())
  with check (public.auth_is_hq());

-- ---- Default TZ region on recruiter / staff memberships ---------------------
update public.memberships m
set country_code = 'TZ'
where m.role in ('recruiter', 'franchise_admin', 'operations')
  and m.country_code is null
  and m.status = 'active';

-- Ensure demo recruiter membership is TZ + generic level
update public.memberships
set country_code = 'TZ', recruiter_level = coalesce(recruiter_level, 'generic')
where user_id = '10000000-0000-0000-0000-000000000004'
  and role = 'recruiter';

-- Assign ALL job roles to recruiter@shugulika.test (demo full pipeline access)
insert into public.recruiter_role_assignments (
  recruiter_id, recruiter_organization_id, job_role_id,
  assigned_by, assigned_region_code, status
)
select
  '10000000-0000-0000-0000-000000000004'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  jr.id,
  '10000000-0000-0000-0000-000000000001'::uuid,
  'TZ',
  'active'
from public.job_roles jr
where jr.is_active
on conflict (recruiter_id, job_role_id) do update
  set status = 'active',
      assigned_region_code = excluded.assigned_region_code,
      updated_at = now();

-- Seed a couple of roles for other demo recruiters if present (0015 expansion)
insert into public.recruiter_role_assignments (
  recruiter_id, recruiter_organization_id, job_role_id,
  assigned_by, assigned_region_code, status
)
select r.uid, '22222222-2222-2222-2222-222222222222'::uuid, r.role_id,
       '10000000-0000-0000-0000-000000000002'::uuid, 'TZ', 'active'
from (values
  ('10000000-0000-0000-0000-000000000007'::uuid, 'finance_analyst'),
  ('10000000-0000-0000-0000-000000000007'::uuid, 'sales_executive'),
  ('10000000-0000-0000-0000-000000000008'::uuid, 'operations_manager'),
  ('10000000-0000-0000-0000-000000000008'::uuid, 'customer_success')
) as r(uid, role_id)
where exists (select 1 from public.profiles p where p.id = r.uid)
on conflict (recruiter_id, job_role_id) do nothing;

-- Franchise / operations need to list recruiter memberships in their org scope
-- (HQ already covered by mem_self_read via auth_is_hq).
drop policy if exists mem_staff_read_recruiters on public.memberships;
create policy mem_staff_read_recruiters on public.memberships
  for select to authenticated
  using (
    role = 'recruiter'
    and status = 'active'
    and organization_id in (select public.auth_scoped_org_ids())
    and (
      public.auth_has_role('franchise_admin')
      or public.auth_has_role('operations')
    )
  );

notify pgrst, 'reload schema';
