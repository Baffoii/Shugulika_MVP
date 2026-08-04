-- Blocker #1: lock down CV-credit minting helpers.
-- public.grant_cv_unlock_tokens / ensure_cv_unlock_balance were SECURITY DEFINER
-- with default PUBLIC execute and no caller authorization, so anon could mint credits.
-- Move helpers to private, revoke client EXECUTE, and retarget authorized wrappers only.
-- Authorization-only; does not change pricing, expiry, unlock scope, or payment policy.

create schema if not exists private;

drop function if exists public.grant_cv_unlock_tokens(uuid, int, text, text, uuid);
drop function if exists public.grant_cv_unlock_tokens(uuid, int, text, text, uuid, uuid, date, date);
drop function if exists public.ensure_cv_unlock_balance(uuid);
drop function if exists private.grant_cv_unlock_tokens(uuid, int, text, text, uuid);
drop function if exists private.grant_cv_unlock_tokens(uuid, int, text, text, uuid, uuid, date, date);
drop function if exists private.ensure_cv_unlock_balance(uuid);

create or replace function private.ensure_cv_unlock_balance(p_employer_org uuid)
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

revoke all on function private.ensure_cv_unlock_balance(uuid) from public;
revoke all on function private.ensure_cv_unlock_balance(uuid) from anon;
revoke all on function private.ensure_cv_unlock_balance(uuid) from authenticated;

create or replace function private.grant_cv_unlock_tokens(
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
  perform private.ensure_cv_unlock_balance(p_employer_org);
  update public.employer_cv_unlock_balances
    set balance = balance + p_amount, updated_at = now()
  where employer_org_id = p_employer_org
  returning balance into v_balance;

  if v_balance is null then
    raise exception 'CV unlock balance row missing';
  end if;

  insert into public.employer_cv_unlock_ledger
    (employer_org_id, entry_type, amount, balance_after, reason, package_key, actor_user_id)
  values
    (p_employer_org, 'grant', p_amount, v_balance, p_reason, p_package_key, p_actor);

  return v_balance;
end;
$$;

revoke all on function private.grant_cv_unlock_tokens(uuid, int, text, text, uuid) from public;
revoke all on function private.grant_cv_unlock_tokens(uuid, int, text, text, uuid) from anon;
revoke all on function private.grant_cv_unlock_tokens(uuid, int, text, text, uuid) from authenticated;

-- Retarget authorized wrappers (bodies match HEAD; only helper schema changes).
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
      v_pkg.key, auth.uid()
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

  perform private.ensure_cv_unlock_balance(v_org);
  select balance into v_balance from public.employer_cv_unlock_balances where employer_org_id = v_org;

  if v_tokens > 0 then
    v_balance := private.grant_cv_unlock_tokens(
      v_org, v_tokens, 'addon_topup', v_pkg.key, auth.uid()
    );
  elsif v_jobs > 0 then
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

  perform private.ensure_cv_unlock_balance(v_org);

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


revoke all on function public.employer_job_slot_limit(uuid) from public;
revoke all on function public.employer_job_slot_limit(uuid) from anon;
grant execute on function public.employer_job_slot_limit(uuid) to authenticated;

revoke all on function public.count_employer_active_job_slots(uuid) from public;
revoke all on function public.count_employer_active_job_slots(uuid) from anon;
grant execute on function public.count_employer_active_job_slots(uuid) to authenticated;

-- Trial expiry is an administrative mutation, not an employer self-service RPC.
revoke all on function public.expire_stale_employer_trials() from public;
revoke all on function public.expire_stale_employer_trials() from anon;
revoke all on function public.expire_stale_employer_trials() from authenticated;
grant execute on function public.expire_stale_employer_trials() to service_role;
