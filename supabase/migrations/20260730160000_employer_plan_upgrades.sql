-- Allow employer plan upgrades to the next (adjacent) tier or any higher tier.
-- Downgrades and re-taking trial while subscribed remain blocked.

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

  select s.* into v_current
  from public.employer_subscriptions s
  where s.employer_org_id = v_org and s.status in ('trial', 'active')
  order by s.starts_on desc
  limit 1;

  if found then
    select * into v_current_pkg from public.packages where id = v_current.package_id;
    -- Upgrades only: target must be a higher ladder tier than the current plan.
    if v_current_pkg.key = v_pkg.key then
      raise exception 'This company is already on the % plan', v_pkg.name;
    end if;
    if v_pkg.key = 'trial' or coalesce(v_pkg.tier, 0) <= coalesce(v_current_pkg.tier, 0) then
      raise exception
        'Choose the next plan up or a higher tier (current: %). Downgrades are not available here.',
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

  -- Never start a trial as an "upgrade" path.
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
    v_balance := public.grant_cv_unlock_tokens(
      v_org, v_tokens,
      case
        when v_is_upgrade then 'upgrade_grant'
        when v_sub.is_trial then 'trial_grant'
        else 'package_grant'
      end,
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
    'cv_unlock_balance', coalesce(v_balance, 0),
    'upgraded', v_is_upgrade
  );
end;
$$;

grant execute on function public.activate_employer_package(text, boolean) to authenticated;
