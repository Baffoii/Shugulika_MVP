-- Blocker #2: align employer entitlement spend/expiry contracts.
-- Runs AFTER 20260804065521_lock_down_cv_unlock_grant_helpers.
--
-- Contracts:
-- 1) Path A job_order_id is validated before the already-unlocked early return.
-- 2) Date-lapsed trials/plans are inactive immediately via
--    employer_has_active_subscription (no UPDATE+RAISE for status).
-- 3) Durable status='expired' is applied by expire_employer_entitlements
--    (service_role only).
--
-- Does not introduce payment-sandbox gating (blocker #3) or change commercial
-- pricing policy (blocker #4). Paid activate/purchase remain open as before.

-- ---- Ledger / unlock period association ------------------------------------
alter table public.employer_cv_unlock_ledger
  add column if not exists subscription_id uuid references public.employer_subscriptions(id) on delete set null,
  add column if not exists period_starts_on date,
  add column if not exists period_ends_on date,
  add column if not exists job_order_id uuid references public.job_orders(id) on delete set null,
  add column if not exists expired_at timestamptz;

alter table public.employer_cv_unlocks
  add column if not exists job_order_id uuid references public.job_orders(id) on delete set null;

create index if not exists idx_cv_unlock_ledger_period
  on public.employer_cv_unlock_ledger (employer_org_id, package_key, period_ends_on)
  where entry_type = 'grant' and expired_at is null;

-- ---- Private minting helpers: extend for period-scoped ledger grants -------
-- Lockdown already placed ensure/grant in private with client EXECUTE revoked.
-- Replace the short grant signature with a period-aware overload (defaults keep
-- 5-arg call sites working).
create schema if not exists private;

drop function if exists private.grant_cv_unlock_tokens(uuid, int, text, text, uuid);
drop function if exists private.grant_cv_unlock_tokens(uuid, int, text, text, uuid, uuid, date, date);

create or replace function private.grant_cv_unlock_tokens(
  p_employer_org uuid,
  p_amount int,
  p_reason text,
  p_package_key text default null,
  p_actor uuid default null,
  p_subscription_id uuid default null,
  p_period_starts_on date default null,
  p_period_ends_on date default null
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
  perform private.ensure_cv_unlock_balance(p_employer_org);
  update public.employer_cv_unlock_balances
    set balance = balance + p_amount, updated_at = now()
  where employer_org_id = p_employer_org
  returning balance into v_balance;

  if v_balance is null then
    raise exception 'CV unlock balance row missing';
  end if;

  insert into public.employer_cv_unlock_ledger
    (employer_org_id, entry_type, amount, balance_after, reason, package_key,
     actor_user_id, subscription_id, period_starts_on, period_ends_on)
  values
    (p_employer_org, 'grant', p_amount, v_balance, p_reason, p_package_key,
     p_actor, p_subscription_id, p_period_starts_on, p_period_ends_on);

  return v_balance;
end;
$$;

revoke all on function private.grant_cv_unlock_tokens(uuid, int, text, text, uuid, uuid, date, date) from public;
revoke all on function private.grant_cv_unlock_tokens(uuid, int, text, text, uuid, uuid, date, date) from anon;
revoke all on function private.grant_cv_unlock_tokens(uuid, int, text, text, uuid, uuid, date, date) from authenticated;

-- ---- Job slot limit: only unexpired grants in an active period -------------
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
  v_sub public.employer_subscriptions%rowtype;
begin
  select s.* into v_sub
  from public.employer_subscriptions s
  where s.employer_org_id = p_employer_org
    and s.status in ('trial', 'active')
    and (s.expires_on is null or s.expires_on >= current_date)
    and (not s.is_trial or s.trial_ends_on is null or s.trial_ends_on >= current_date)
  order by s.starts_on desc, s.created_at desc
  limit 1;

  if not found then
    return 0;
  end if;

  select pe.limit_value into v_base
  from public.package_entitlements pe
  where pe.package_id = v_sub.package_id and pe.key = 'active_job_postings';

  if v_base is null then
    return 0;
  end if;

  select coalesce(sum(pe.limit_value), 0)::int into v_addon
  from public.employer_cv_unlock_ledger l
  join public.packages p on p.key = l.package_key
  join public.package_entitlements pe on pe.package_id = p.id and pe.key = 'active_job_postings'
  where l.employer_org_id = p_employer_org
    and l.entry_type = 'grant'
    and l.package_key = 'job_slot_1'
    and l.expired_at is null
    and coalesce(l.period_starts_on, v_sub.starts_on) <= current_date
    and coalesce(l.period_ends_on, v_sub.expires_on, current_date) >= current_date
    and (
      l.subscription_id is null
      or l.subscription_id = v_sub.id
      or exists (
        select 1 from public.employer_subscriptions s2
        where s2.id = l.subscription_id
          and s2.employer_org_id = p_employer_org
          and s2.status in ('trial', 'active')
          and (s2.expires_on is null or s2.expires_on >= current_date)
      )
    );

  return v_base + coalesce(v_addon, 0);
end;
$$;

revoke all on function public.employer_job_slot_limit(uuid) from public;
revoke all on function public.employer_job_slot_limit(uuid) from anon;
grant execute on function public.employer_job_slot_limit(uuid) to authenticated;

-- ---- Activate package: record period on grants (payments remain open) ------
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
  v_current public.employer_subscriptions%rowtype;
  v_current_pkg public.packages%rowtype;
  v_sub public.employer_subscriptions%rowtype;
  v_tokens int;
  v_trial_days int := 14;
  v_had_trial boolean;
  v_balance int;
  v_is_upgrade boolean := false;
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

  update public.employer_subscriptions
    set status = 'expired'
  where employer_org_id = v_org
    and status in ('trial', 'active')
    and (
      (expires_on is not null and expires_on < current_date)
      or (is_trial and trial_ends_on is not null and trial_ends_on < current_date)
    );

  select s.* into v_current
  from public.employer_subscriptions s
  where s.employer_org_id = v_org
    and s.status in ('trial', 'active')
    and (s.expires_on is null or s.expires_on >= current_date)
    and (not s.is_trial or s.trial_ends_on is null or s.trial_ends_on >= current_date)
  order by s.starts_on desc, s.created_at desc
  limit 1;

  if found then
    select * into v_current_pkg from public.packages where id = v_current.package_id;
    if v_current_pkg.key = v_pkg.key then
      raise exception 'This company is already on the % plan', v_pkg.name;
    end if;
    if v_pkg.key = 'trial' or coalesce(v_pkg.tier, 0) <= coalesce(v_current_pkg.tier, 0) then
      raise exception
        'You are on %. Choose Growth or a higher plan — Free trial and lower tiers are not available while subscribed.',
        v_current_pkg.name;
    end if;
    update public.employer_subscriptions
      set status = 'cancelled'
    where id = v_current.id;
    v_is_upgrade := true;
  end if;

  select exists (
    select 1 from public.employer_subscriptions s
    where s.employer_org_id = v_org and s.is_trial
  ) into v_had_trial;

  if (p_as_trial or v_pkg.key = 'trial') and v_had_trial then
    raise exception 'A free trial was already used for this company';
  end if;

  if v_is_upgrade and (p_as_trial or v_pkg.key = 'trial') then
    raise exception 'Free trial cannot be used as an upgrade';
  end if;

  if (not v_is_upgrade) and (p_as_trial or v_pkg.key = 'trial') then
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
    v_balance := private.grant_cv_unlock_tokens(
      v_org, v_tokens,
      case
        when v_is_upgrade then 'upgrade_grant'
        when v_sub.is_trial then 'trial_grant'
        else 'package_grant'
      end,
      v_pkg.key, auth.uid(), v_sub.id, v_sub.starts_on, v_sub.expires_on
    );
  else
    perform private.ensure_cv_unlock_balance(v_org);
    select balance into v_balance from public.employer_cv_unlock_balances where employer_org_id = v_org;
  end if;

  return jsonb_build_object(
    'subscription_id', v_sub.id,
    'package_key', v_pkg.key,
    'status', v_sub.status,
    'is_trial', v_sub.is_trial,
    'trial_ends_on', v_sub.trial_ends_on,
    'cv_unlock_balance', coalesce(v_balance, 0),
    'upgraded', v_is_upgrade
  );
end;
$$;

revoke all on function public.activate_employer_package(text, boolean) from public;
revoke all on function public.activate_employer_package(text, boolean) from anon;
grant execute on function public.activate_employer_package(text, boolean) to authenticated;

-- ---- Purchase addon: period-scoped job slots (payments remain open) --------
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
  v_sub public.employer_subscriptions%rowtype;
begin
  v_org := public.employer_org_for_caller();
  if v_org is null then
    raise exception 'No approved employer organization for this account';
  end if;

  select * into v_pkg from public.packages
  where key = p_addon_key and is_active and package_kind = 'addon';
  if not found then
    raise exception 'Unknown or inactive add-on';
  end if;

  select s.* into v_sub
  from public.employer_subscriptions s
  where s.employer_org_id = v_org
    and s.status in ('trial', 'active')
    and (s.expires_on is null or s.expires_on >= current_date)
    and (not s.is_trial or s.trial_ends_on is null or s.trial_ends_on >= current_date)
  order by s.starts_on desc, s.created_at desc
  limit 1;

  if not found then
    raise exception 'Activate a plan or free trial before buying add-ons';
  end if;

  select pe.limit_value into v_tokens
  from public.package_entitlements pe
  where pe.package_id = v_pkg.id and pe.key = 'cv_unlock_tokens';

  select pe.limit_value into v_jobs
  from public.package_entitlements pe
  where pe.package_id = v_pkg.id and pe.key = 'active_job_postings';

  perform private.ensure_cv_unlock_balance(v_org);
  select balance into v_balance from public.employer_cv_unlock_balances where employer_org_id = v_org;

  if coalesce(v_tokens, 0) > 0 then
    v_balance := private.grant_cv_unlock_tokens(
      v_org, v_tokens, 'addon_topup', v_pkg.key, auth.uid(),
      v_sub.id, v_sub.starts_on, v_sub.expires_on
    );
  elsif coalesce(v_jobs, 0) > 0 then
    insert into public.employer_cv_unlock_ledger
      (employer_org_id, entry_type, amount, balance_after, reason, package_key,
       actor_user_id, subscription_id, period_starts_on, period_ends_on)
    values
      (v_org, 'grant', 1, v_balance, 'job_slot_topup', v_pkg.key,
       auth.uid(), v_sub.id, current_date, v_sub.expires_on);
  else
    raise exception 'Add-on has no grantable entitlements';
  end if;

  return jsonb_build_object(
    'addon_key', v_pkg.key,
    'cv_unlock_balance', v_balance,
    'job_slots_added', coalesce(v_jobs, 0),
    'period_ends_on', v_sub.expires_on
  );
end;
$$;

revoke all on function public.purchase_employer_addon(text) from public;
revoke all on function public.purchase_employer_addon(text) from anon;
grant execute on function public.purchase_employer_addon(text) to authenticated;

-- ---- Entitlement expiry (auditable; never deletes ledger rows) -------------
create or replace function public.expire_employer_entitlements()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trials int := 0;
  v_plans int := 0;
  v_slots int := 0;
  r record;
  v_balance int;
begin
  update public.employer_subscriptions
    set status = 'expired'
  where status = 'trial'
    and trial_ends_on is not null
    and trial_ends_on < current_date;
  get diagnostics v_trials = row_count;

  update public.employer_subscriptions
    set status = 'expired'
  where status = 'active'
    and expires_on is not null
    and expires_on < current_date;
  get diagnostics v_plans = row_count;

  for r in
    select l.*
    from public.employer_cv_unlock_ledger l
    where l.entry_type = 'grant'
      and l.package_key = 'job_slot_1'
      and l.expired_at is null
      and l.period_ends_on is not null
      and l.period_ends_on < current_date
    for update
  loop
    update public.employer_cv_unlock_ledger
      set expired_at = now()
    where id = r.id;

    select balance into v_balance
    from public.employer_cv_unlock_balances
    where employer_org_id = r.employer_org_id;

    insert into public.employer_cv_unlock_ledger
      (employer_org_id, entry_type, amount, balance_after, reason, package_key,
       subscription_id, period_starts_on, period_ends_on, actor_user_id)
    values
      (r.employer_org_id, 'expire', 0, coalesce(v_balance, 0), 'job_slot_period_ended',
       r.package_key, r.subscription_id, r.period_starts_on, r.period_ends_on, null);

    v_slots := v_slots + 1;
  end loop;

  return jsonb_build_object(
    'trials_expired', v_trials,
    'plans_expired', v_plans,
    'job_slot_grants_expired', v_slots
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
  v_result jsonb;
begin
  v_result := public.expire_employer_entitlements();
  return coalesce((v_result ->> 'trials_expired')::int, 0);
end;
$$;

revoke all on function public.expire_employer_entitlements() from public;
revoke all on function public.expire_employer_entitlements() from anon;
revoke all on function public.expire_employer_entitlements() from authenticated;
grant execute on function public.expire_employer_entitlements() to service_role;

revoke all on function public.expire_stale_employer_trials() from public;
revoke all on function public.expire_stale_employer_trials() from anon;
revoke all on function public.expire_stale_employer_trials() from authenticated;
grant execute on function public.expire_stale_employer_trials() to service_role;

-- ---- Hardened spend_cv_unlock (Path A job XOR Path B submission) -----------
drop function if exists public.spend_cv_unlock(uuid, uuid);

create or replace function public.spend_cv_unlock(
  p_candidate_id uuid,
  p_submission_id uuid default null,
  p_job_order_id uuid default null
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
  v_has_submission boolean := false;
  v_has_path_a boolean := false;
begin
  v_org := public.employer_org_for_caller();
  if v_org is null then
    raise exception 'No approved employer organization for this account';
  end if;

  -- Date-gate immediately; do not UPDATE status here (RAISE would roll it back).
  -- Durable status flips belong to expire_employer_entitlements (service_role).
  if not public.employer_has_active_subscription(v_org) then
    raise exception 'Your plan or trial is not active';
  end if;

  -- Validate Path A job scope before the idempotent unlock return so callers
  -- cannot pair an already-unlocked candidate with an inactive/foreign job.
  if p_job_order_id is not null then
    if not public.employer_owns_path_a_job(v_org, p_job_order_id) then
      raise exception 'Select one of your Direct (Path A) job orders';
    end if;
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
    v_has_submission := true;
  end if;

  if p_job_order_id is not null then
    if not exists (
      select 1 from public.candidate_search_visibility v
      where v.candidate_id = p_candidate_id and v.is_searchable
    ) then
      raise exception 'Candidate is not available in the searchable pool';
    end if;
    v_has_path_a := true;
  end if;

  if not v_has_submission and not v_has_path_a then
    raise exception
      'Unlock requires a Path B submission or a Direct (Path A) job order';
  end if;

  perform private.ensure_cv_unlock_balance(v_org);

  update public.employer_cv_unlock_balances
    set balance = balance - 1, updated_at = now()
  where employer_org_id = v_org and balance >= 1
  returning balance into v_balance;

  if v_balance is null then
    raise exception 'No CV unlocks remaining. Buy more unlocks from Billing.';
  end if;

  if v_balance < 0 then
    raise exception 'CV unlock balance cannot go below zero';
  end if;

  insert into public.employer_cv_unlock_ledger
    (employer_org_id, entry_type, amount, balance_after, reason, candidate_id,
     submission_id, job_order_id, actor_user_id)
  values
    (v_org, 'spend', -1, v_balance, 'cv_unlock', p_candidate_id,
     p_submission_id, p_job_order_id, auth.uid())
  returning id into v_ledger;

  insert into public.employer_cv_unlocks
    (employer_org_id, candidate_id, submission_id, job_order_id, ledger_entry_id)
  values
    (v_org, p_candidate_id, p_submission_id, p_job_order_id, v_ledger)
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

revoke all on function public.spend_cv_unlock(uuid, uuid, uuid) from public;
revoke all on function public.spend_cv_unlock(uuid, uuid, uuid) from anon;
grant execute on function public.spend_cv_unlock(uuid, uuid, uuid) to authenticated;

revoke all on function public.count_employer_active_job_slots(uuid) from public;
revoke all on function public.count_employer_active_job_slots(uuid) from anon;
grant execute on function public.count_employer_active_job_slots(uuid) to authenticated;

-- ---- Zoho Path A unlock: require Path A job + date-gate --------------------
