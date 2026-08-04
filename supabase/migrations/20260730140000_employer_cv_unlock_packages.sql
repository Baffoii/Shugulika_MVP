-- Employer packages, free-trial activation, and manhwa-style CV unlock tokens.
-- Payments are intentionally open: activating a plan/addon grants access immediately
-- (Zoho Books / card capture comes later).

-- ---- Packages: kind + description ------------------------------------------
alter table public.packages
  add column if not exists description text,
  add column if not exists package_kind text not null default 'subscription'
    check (package_kind in ('subscription', 'addon'));

alter table public.employer_subscriptions
  add column if not exists trial_started_on date,
  add column if not exists auto_activate_intent boolean not null default false;

create unique index if not exists uq_employer_subscriptions_active
  on public.employer_subscriptions (employer_org_id)
  where status in ('trial', 'active');

alter table public.employer_applications
  add column if not exists preferred_package_key text;

alter table public.employer_submissions
  add column if not exists full_disclosed_profile jsonb;

-- ---- CV unlock wallet ------------------------------------------------------
create table if not exists public.employer_cv_unlock_balances (
  employer_org_id uuid primary key references public.organizations(id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.employer_cv_unlock_ledger (
  id uuid primary key default gen_random_uuid(),
  employer_org_id uuid not null references public.organizations(id) on delete cascade,
  entry_type text not null check (entry_type in ('grant', 'spend', 'adjust', 'expire')),
  amount int not null,
  balance_after int not null check (balance_after >= 0),
  reason text,
  package_key text,
  candidate_id uuid references public.candidate_profiles(id) on delete set null,
  submission_id uuid references public.employer_submissions(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    (entry_type in ('grant', 'adjust') and amount > 0)
    or (entry_type = 'spend' and amount < 0)
    or (entry_type = 'expire' and amount <= 0)
  )
);
create index if not exists idx_cv_unlock_ledger_org
  on public.employer_cv_unlock_ledger (employer_org_id, created_at desc);

create table if not exists public.employer_cv_unlocks (
  id uuid primary key default gen_random_uuid(),
  employer_org_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  submission_id uuid references public.employer_submissions(id) on delete set null,
  ledger_entry_id uuid references public.employer_cv_unlock_ledger(id) on delete set null,
  unlocked_at timestamptz not null default now(),
  unique (employer_org_id, candidate_id)
);
create index if not exists idx_cv_unlocks_org on public.employer_cv_unlocks (employer_org_id);

-- ---- Seed subscription + addon packages ------------------------------------
update public.packages set is_active = false
where key in ('tier_1', 'tier_2', 'tier_3');

insert into public.packages (key, name, tier, description, package_kind, is_active) values
  ('trial', 'Free trial', 0, '1–2 weeks to try job posting and CV unlocks. No card charge in this MVP.', 'subscription', true),
  ('starter', 'Starter', 1, '2 active job slots and 5 CV unlocks to get hiring started.', 'subscription', true),
  ('growth', 'Growth', 2, 'More concurrent roles and CV unlocks for growing teams.', 'subscription', true),
  ('scale', 'Scale', 3, 'Higher capacity for multi-role hiring programmes.', 'subscription', true),
  ('cv_unlocks_5', '+5 CV unlocks', 0, 'Top-up pack of 5 CV unlocks.', 'addon', true),
  ('cv_unlocks_15', '+15 CV unlocks', 0, 'Top-up pack of 15 CV unlocks.', 'addon', true),
  ('job_slot_1', '+1 job slot', 0, 'Adds one active job posting slot for the current package period.', 'addon', true)
on conflict (key) do update set
  name = excluded.name,
  tier = excluded.tier,
  description = excluded.description,
  package_kind = excluded.package_kind,
  is_active = excluded.is_active;

-- Replace entitlements for the new packages (idempotent per package+key).
insert into public.package_entitlements (package_id, key, limit_value, period)
select p.id, e.key, e.lim, e.period
from public.packages p
join (values
  ('trial', 'active_job_postings', 2, 'billing_cycle'),
  ('trial', 'cv_unlock_tokens', 5, 'total'),
  ('trial', 'employer_users', 2, 'billing_cycle'),
  ('trial', 'ai_cv_screens_per_period', 10, 'billing_cycle'),
  ('starter', 'active_job_postings', 2, 'billing_cycle'),
  ('starter', 'cv_unlock_tokens', 5, 'total'),
  ('starter', 'employer_users', 2, 'billing_cycle'),
  ('starter', 'ai_cv_screens_per_period', 20, 'billing_cycle'),
  ('growth', 'active_job_postings', 5, 'billing_cycle'),
  ('growth', 'cv_unlock_tokens', 15, 'total'),
  ('growth', 'employer_users', 3, 'billing_cycle'),
  ('growth', 'ai_cv_screens_per_period', 40, 'billing_cycle'),
  ('scale', 'active_job_postings', 12, 'billing_cycle'),
  ('scale', 'cv_unlock_tokens', 40, 'total'),
  ('scale', 'employer_users', 5, 'billing_cycle'),
  ('scale', 'ai_cv_screens_per_period', 60, 'billing_cycle'),
  ('cv_unlocks_5', 'cv_unlock_tokens', 5, 'total'),
  ('cv_unlocks_15', 'cv_unlock_tokens', 15, 'total'),
  ('job_slot_1', 'active_job_postings', 1, 'billing_cycle')
) as e(pkey, key, lim, period) on e.pkey = p.key
where not exists (
  select 1 from public.package_entitlements pe
  where pe.package_id = p.id and pe.key = e.key
);

-- Keep preferred_package_key aligned with active subscription package keys.
-- Soft interest only — no FK (addons share the packages table).

-- ---- RLS --------------------------------------------------------------------
alter table public.employer_cv_unlock_balances enable row level security;
alter table public.employer_cv_unlock_ledger enable row level security;
alter table public.employer_cv_unlocks enable row level security;

drop policy if exists cv_bal_read on public.employer_cv_unlock_balances;
create policy cv_bal_read on public.employer_cv_unlock_balances for select to authenticated
  using (
    employer_org_id in (select public.auth_scoped_org_ids())
    or public.auth_is_hq()
  );

drop policy if exists cv_ledger_read on public.employer_cv_unlock_ledger;
create policy cv_ledger_read on public.employer_cv_unlock_ledger for select to authenticated
  using (
    employer_org_id in (select public.auth_scoped_org_ids())
    or public.auth_is_hq()
  );

drop policy if exists cv_unlocks_read on public.employer_cv_unlocks;
create policy cv_unlocks_read on public.employer_cv_unlocks for select to authenticated
  using (
    employer_org_id in (select public.auth_scoped_org_ids())
    or public.auth_is_hq()
  );

-- Writes go through security-definer RPCs only (no direct insert policies).

-- Allow employer org admins to insert their own subscription via RPC; keep
-- existing staff write policy. Employers still cannot UPDATE via table policies.
drop policy if exists sub_pkg_insert_employer on public.employer_subscriptions;
-- (RPC is security definer — no extra insert policy required.)

-- ---- Helpers ----------------------------------------------------------------
create or replace function public.employer_org_for_caller()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and m.role = 'employer_user'
    and o.org_type = 'employer'
    and o.status = 'active'
    and o.verification_status = 'verified'
  order by m.created_at
  limit 1;
$$;

create or replace function public.count_employer_active_job_slots(p_employer_org uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.job_orders
  where employer_org_id = p_employer_org
    and status in ('submitted', 'approved', 'active', 'on_hold', 'partially_filled');
$$;

create or replace function public.employer_job_slot_limit(p_employer_org uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base int;
  v_addon int;
begin
  select pe.limit_value into v_base
  from public.employer_subscriptions s
  join public.package_entitlements pe on pe.package_id = s.package_id and pe.key = 'active_job_postings'
  where s.employer_org_id = p_employer_org
    and s.status in ('trial', 'active')
  order by s.starts_on desc
  limit 1;

  if v_base is null then
    return 0;
  end if;

  -- Additive job-slot top-ups recorded as grant ledger rows with package_key job_slot_1.
  select coalesce(sum(pe.limit_value), 0)::int into v_addon
  from public.employer_cv_unlock_ledger l
  join public.packages p on p.key = l.package_key
  join public.package_entitlements pe on pe.package_id = p.id and pe.key = 'active_job_postings'
  where l.employer_org_id = p_employer_org
    and l.entry_type = 'grant'
    and l.package_key = 'job_slot_1';

  return v_base + coalesce(v_addon, 0);
end;
$$;

create or replace function public.ensure_cv_unlock_balance(p_employer_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.employer_cv_unlock_balances (employer_org_id, balance)
  values (p_employer_org, 0)
  on conflict (employer_org_id) do nothing;
end;
$$;

create or replace function public.grant_cv_unlock_tokens(
  p_employer_org uuid,
  p_amount int,
  p_reason text,
  p_package_key text default null,
  p_actor uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Grant amount must be positive';
  end if;
  perform public.ensure_cv_unlock_balance(p_employer_org);
  update public.employer_cv_unlock_balances
    set balance = balance + p_amount, updated_at = now()
  where employer_org_id = p_employer_org
  returning balance into v_balance;

  insert into public.employer_cv_unlock_ledger
    (employer_org_id, entry_type, amount, balance_after, reason, package_key, actor_user_id)
  values
    (p_employer_org, 'grant', p_amount, v_balance, p_reason, p_package_key, p_actor);

  return v_balance;
end;
$$;

-- Activate a subscription package or free trial. Payment is open (always granted).
create or replace function public.activate_employer_package(
  p_package_key text,
  p_as_trial boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_pkg public.packages%rowtype;
  v_sub public.employer_subscriptions%rowtype;
  v_tokens int;
  v_trial_days int := 14;
  v_had_trial boolean;
  v_balance int;
begin
  v_org := public.employer_org_for_caller();
  if v_org is null then
    raise exception 'No approved employer organization for this account';
  end if;

  select * into v_pkg from public.packages
  where key = p_package_key and is_active and package_kind = 'subscription';
  if not found then
    raise exception 'Unknown or inactive subscription package';
  end if;

  if exists (
    select 1 from public.employer_subscriptions s
    where s.employer_org_id = v_org and s.status in ('trial', 'active')
  ) then
    raise exception 'This company already has an active plan or trial';
  end if;

  select exists (
    select 1 from public.employer_subscriptions s
    where s.employer_org_id = v_org and s.is_trial
  ) into v_had_trial;

  if (p_as_trial or v_pkg.key = 'trial') and v_had_trial then
    raise exception 'A free trial was already used for this company';
  end if;

  if p_as_trial or v_pkg.key = 'trial' then
    insert into public.employer_subscriptions
      (employer_org_id, package_id, status, is_trial, trial_started_on, trial_ends_on,
       starts_on, expires_on, auto_activate_intent)
    values
      (v_org, v_pkg.id, 'trial', true, current_date, current_date + v_trial_days,
       current_date, current_date + v_trial_days, false)
    returning * into v_sub;
  else
    insert into public.employer_subscriptions
      (employer_org_id, package_id, status, is_trial, starts_on, expires_on)
    values
      (v_org, v_pkg.id, 'active', false, current_date, current_date + interval '30 days')
    returning * into v_sub;
  end if;

  select pe.limit_value into v_tokens
  from public.package_entitlements pe
  where pe.package_id = v_pkg.id and pe.key = 'cv_unlock_tokens';

  v_balance := 0;
  if coalesce(v_tokens, 0) > 0 then
    v_balance := public.grant_cv_unlock_tokens(
      v_org, v_tokens,
      case when v_sub.is_trial then 'trial_grant' else 'package_grant' end,
      v_pkg.key, auth.uid()
    );
  else
    perform public.ensure_cv_unlock_balance(v_org);
    select balance into v_balance from public.employer_cv_unlock_balances where employer_org_id = v_org;
  end if;

  return jsonb_build_object(
    'subscription_id', v_sub.id,
    'package_key', v_pkg.key,
    'status', v_sub.status,
    'is_trial', v_sub.is_trial,
    'trial_ends_on', v_sub.trial_ends_on,
    'cv_unlock_balance', coalesce(v_balance, 0)
  );
end;
$$;

-- Top-up addon (CV unlocks or job slot). Payment open — grants immediately.
create or replace function public.purchase_employer_addon(p_addon_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_pkg public.packages%rowtype;
  v_tokens int := 0;
  v_jobs int := 0;
  v_balance int := 0;
begin
  v_org := public.employer_org_for_caller();
  if v_org is null then
    raise exception 'No approved employer organization for this account';
  end if;

  if not exists (
    select 1 from public.employer_subscriptions s
    where s.employer_org_id = v_org and s.status in ('trial', 'active')
  ) then
    raise exception 'Choose a plan or start a free trial before buying top-ups';
  end if;

  select * into v_pkg from public.packages
  where key = p_addon_key and is_active and package_kind = 'addon';
  if not found then
    raise exception 'Unknown or inactive add-on';
  end if;

  select coalesce(pe.limit_value, 0) into v_tokens
  from public.package_entitlements pe
  where pe.package_id = v_pkg.id and pe.key = 'cv_unlock_tokens';
  v_tokens := coalesce(v_tokens, 0);

  select coalesce(pe.limit_value, 0) into v_jobs
  from public.package_entitlements pe
  where pe.package_id = v_pkg.id and pe.key = 'active_job_postings';
  v_jobs := coalesce(v_jobs, 0);

  perform public.ensure_cv_unlock_balance(v_org);
  select balance into v_balance from public.employer_cv_unlock_balances where employer_org_id = v_org;

  if v_tokens > 0 then
    v_balance := public.grant_cv_unlock_tokens(
      v_org, v_tokens, 'addon_topup', v_pkg.key, auth.uid()
    );
  elsif v_jobs > 0 then
    -- Sentinel grant row so job_slot_limit can sum addons; balance unchanged.
    insert into public.employer_cv_unlock_ledger
      (employer_org_id, entry_type, amount, balance_after, reason, package_key, actor_user_id)
    values
      (v_org, 'grant', 1, v_balance, 'job_slot_topup', v_pkg.key, auth.uid());
  else
    raise exception 'Add-on has no grantable entitlements';
  end if;

  return jsonb_build_object(
    'addon_key', v_pkg.key,
    'cv_unlock_balance', v_balance,
    'job_slots_added', v_jobs
  );
end;
$$;

-- Spend one CV unlock for a candidate (idempotent if already unlocked).
create or replace function public.spend_cv_unlock(
  p_candidate_id uuid,
  p_submission_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_balance int;
  v_ledger uuid;
  v_existing uuid;
begin
  v_org := public.employer_org_for_caller();
  if v_org is null then
    raise exception 'No approved employer organization for this account';
  end if;

  if not exists (
    select 1 from public.employer_subscriptions s
    where s.employer_org_id = v_org
      and s.status in ('trial', 'active')
      and (s.expires_on is null or s.expires_on >= current_date)
      and (not s.is_trial or s.trial_ends_on is null or s.trial_ends_on >= current_date)
  ) then
    raise exception 'Your plan or trial is not active';
  end if;

  select id into v_existing
  from public.employer_cv_unlocks
  where employer_org_id = v_org and candidate_id = p_candidate_id;
  if found then
    return jsonb_build_object('already_unlocked', true, 'unlock_id', v_existing);
  end if;

  if p_submission_id is not null then
    if not exists (
      select 1 from public.employer_submissions s
      where s.id = p_submission_id
        and s.employer_org_id = v_org
        and s.candidate_id = p_candidate_id
    ) then
      raise exception 'Submission not found for this company';
    end if;
  end if;

  perform public.ensure_cv_unlock_balance(v_org);

  update public.employer_cv_unlock_balances
    set balance = balance - 1, updated_at = now()
  where employer_org_id = v_org and balance >= 1
  returning balance into v_balance;

  if v_balance is null then
    raise exception 'No CV unlocks remaining. Buy more unlocks from Billing.';
  end if;

  insert into public.employer_cv_unlock_ledger
    (employer_org_id, entry_type, amount, balance_after, reason, candidate_id, submission_id, actor_user_id)
  values
    (v_org, 'spend', -1, v_balance, 'cv_unlock', p_candidate_id, p_submission_id, auth.uid())
  returning id into v_ledger;

  insert into public.employer_cv_unlocks
    (employer_org_id, candidate_id, submission_id, ledger_entry_id)
  values
    (v_org, p_candidate_id, p_submission_id, v_ledger)
  returning id into v_existing;

  if p_submission_id is not null then
    update public.employer_submissions
      set is_masked = false
    where id = p_submission_id and employer_org_id = v_org;
  end if;

  return jsonb_build_object(
    'already_unlocked', false,
    'unlock_id', v_existing,
    'cv_unlock_balance', v_balance
  );
end;
$$;

create or replace function public.expire_stale_employer_trials()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.employer_subscriptions
    set status = 'expired'
  where status = 'trial'
    and trial_ends_on is not null
    and trial_ends_on < current_date;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Snapshot + revise copy preferred package interest.
create or replace function public.employer_app_snapshot(a public.employer_applications)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'legal_name', a.legal_name, 'trading_name', a.trading_name,
    'organization_type', a.organization_type, 'industry', a.industry,
    'company_size', a.company_size, 'year_established', a.year_established,
    'website', a.website, 'country_code', a.country_code, 'region', a.region,
    'city', a.city, 'physical_address', a.physical_address,
    'postal_address', a.postal_address, 'contact_name', a.contact_name,
    'contact_job_title', a.contact_job_title, 'contact_email', a.contact_email,
    'contact_phone', a.contact_phone, 'routing_mode', a.routing_mode,
    'requested_franchise_id', a.requested_franchise_id,
    'preferred_package_key', a.preferred_package_key,
    'version', a.version
  );
$$;

create or replace function public.start_revised_employer_application(p_previous_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_prev public.employer_applications%rowtype;
  v_new uuid;
begin
  select * into v_prev from public.employer_applications
  where id = p_previous_id for update;
  if not found or v_prev.applicant_user_id <> auth.uid() then
    raise exception 'Application not found or not authorized';
  end if;
  if v_prev.status not in ('rejected','withdrawn') then
    raise exception 'A revised application can only follow a rejected or withdrawn one';
  end if;
  if v_prev.status = 'rejected' and not coalesce(v_prev.reapply_allowed, false) then
    raise exception 'Reapplication was not allowed for this application';
  end if;
  if exists (
    select 1 from public.employer_applications a
    where a.applicant_user_id = auth.uid()
      and a.status in ('draft','submitted','under_review','changes_requested')
  ) then
    raise exception 'You already have an application in progress';
  end if;

  insert into public.employer_applications
    (applicant_user_id, status, legal_name, trading_name, organization_type, industry,
     company_size, year_established, website, country_code, region, city,
     physical_address, postal_address, contact_name, contact_job_title, contact_email,
     contact_phone, contact_is_authorized, routing_mode, requested_franchise_id,
     preferred_package_key, previous_application_id)
  values
    (auth.uid(), 'draft', v_prev.legal_name, v_prev.trading_name, v_prev.organization_type,
     v_prev.industry, v_prev.company_size, v_prev.year_established, v_prev.website,
     v_prev.country_code, v_prev.region, v_prev.city, v_prev.physical_address,
     v_prev.postal_address, v_prev.contact_name, v_prev.contact_job_title,
     v_prev.contact_email, v_prev.contact_phone, v_prev.contact_is_authorized,
     v_prev.routing_mode, v_prev.requested_franchise_id, v_prev.preferred_package_key,
     v_prev.id)
  returning id into v_new;

  insert into public.employer_application_events
    (application_id, actor_id, action, visible_to_employer, metadata)
  values (v_prev.id, auth.uid(), 'revision_started', true,
          jsonb_build_object('new_application_id', v_new));

  return v_new;
end $$;

grant execute on function public.employer_org_for_caller() to authenticated;
grant execute on function public.count_employer_active_job_slots(uuid) to authenticated;
grant execute on function public.employer_job_slot_limit(uuid) to authenticated;
grant execute on function public.activate_employer_package(text, boolean) to authenticated;
grant execute on function public.purchase_employer_addon(text) to authenticated;
grant execute on function public.spend_cv_unlock(uuid, uuid) to authenticated;

-- Wallet tables: employers read their own rows via RLS; writes via RPCs only.
grant select on public.employer_cv_unlock_balances to authenticated;
grant select on public.employer_cv_unlock_ledger to authenticated;
grant select on public.employer_cv_unlocks to authenticated;
grant execute on function public.expire_stale_employer_trials() to authenticated;
