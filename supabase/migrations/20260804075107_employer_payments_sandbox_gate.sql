-- Blocker #3: sandbox-only paid plan/add-on activation.
--
-- SQL hard gate: paid activate/purchase require feature_flags.employer_payments_sandbox_enabled.
-- Free trial remains available. Production must keep the flag false (default).
-- App layer additionally requires non-production + EMPLOYER_PAYMENTS_SANDBOX=true.
--
-- Provisional commercial rules (blocker #4 — pending Sabiha/finance approval):
-- CV credits do not expire; unlocks are org-wide; job-slot add-ons are period-scoped.
-- This migration does not change those mechanics.

insert into public.feature_flags (key, is_enabled, notes) values
  (
    'employer_payments_sandbox_enabled',
    false,
    'When true, paid plan/add-on activation grants immediately without a payment provider (demo/sandbox only). Production must keep this false until real billing exists and commercial rules are approved.'
  )
on conflict (key) do nothing;

create or replace function public.employer_open_payments_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_enabled from public.feature_flags where key = 'employer_payments_sandbox_enabled'),
    false
  );
$$;

revoke all on function public.employer_open_payments_allowed() from public;
revoke all on function public.employer_open_payments_allowed() from anon;
grant execute on function public.employer_open_payments_allowed() to authenticated;

-- ---- Activate package (trial free; paid requires sandbox DB flag) ----------
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
  v_is_trial boolean;
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

  v_is_trial := (p_as_trial or v_pkg.key = 'trial');

  -- Paid activation is blocked unless the sandbox/demo payments flag is on.
  if not v_is_trial and not public.employer_open_payments_allowed() then
    raise exception
      'Payments are not enabled. Real paid plan activation is not available yet. Start a free trial, or enable employer payments sandbox mode for demo environments only.';
  end if;

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

  if v_is_trial and v_had_trial then
    raise exception 'A free trial was already used for this company';
  end if;

  if v_is_upgrade and v_is_trial then
    raise exception 'Free trial cannot be used as an upgrade';
  end if;

  if (not v_is_upgrade) and v_is_trial then
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

-- ---- Purchase addon (requires sandbox DB flag) -----------------------------
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

  if not public.employer_open_payments_allowed() then
    raise exception
      'Payments are not enabled. Add-on purchases require a real payment workflow or employer payments sandbox mode (demo only).';
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
