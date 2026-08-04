-- Commercial rule (approved): CV unlock credits expire per subscription month.
-- Unspent tokens on period-lapsed grants are removed from the wallet with an
-- auditable expire ledger row. Already-unlocked candidates stay org-wide.
-- Job-slot add-ons continue to expire with their period (unchanged).
--
-- Model: grant rows carry remaining; spends FIFO-consume remaining from
-- non-expired, still-current period grants; expire_employer_entitlements
-- burns leftover remaining when period_ends_on < current_date.

alter table public.employer_cv_unlock_ledger
  add column if not exists remaining int;

comment on column public.employer_cv_unlock_ledger.remaining is
  'Unspent tokens left on a CV credit grant. Null for non-token rows (e.g. job_slot_1).';

-- Backfill remaining for CV token grants (exclude job-slot sentinel grants).
update public.employer_cv_unlock_ledger
   set remaining = amount
 where entry_type = 'grant'
   and package_key is distinct from 'job_slot_1'
   and amount > 0
   and remaining is null
   and expired_at is null;

-- Attach period ends from subscription when missing.
update public.employer_cv_unlock_ledger l
   set period_starts_on = coalesce(l.period_starts_on, s.starts_on),
       period_ends_on = coalesce(l.period_ends_on, s.expires_on, s.trial_ends_on)
  from public.employer_subscriptions s
 where l.subscription_id = s.id
   and l.entry_type = 'grant'
   and l.package_key is distinct from 'job_slot_1'
   and l.period_ends_on is null;

-- Replay historical spends as FIFO against remaining (best-effort for existing rows).
do $$
declare
  org uuid;
  need int;
  r record;
  take int;
begin
  for org in
    select distinct employer_org_id from public.employer_cv_unlock_ledger
    where entry_type = 'spend'
  loop
    select coalesce(sum(-amount), 0)::int into need
    from public.employer_cv_unlock_ledger
    where employer_org_id = org and entry_type = 'spend';

    for r in
      select id, coalesce(remaining, 0) as rem
      from public.employer_cv_unlock_ledger
      where employer_org_id = org
        and entry_type = 'grant'
        and package_key is distinct from 'job_slot_1'
        and expired_at is null
        and coalesce(remaining, 0) > 0
      order by coalesce(period_ends_on, '9999-12-31'::date), created_at
      for update
    loop
      exit when need <= 0;
      take := least(r.rem, need);
      update public.employer_cv_unlock_ledger
         set remaining = r.rem - take
       where id = r.id;
      need := need - take;
    end loop;
  end loop;
end $$;

-- ---- Grant helper: set remaining = amount ----------------------------------
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
     actor_user_id, subscription_id, period_starts_on, period_ends_on, remaining)
  values
    (p_employer_org, 'grant', p_amount, v_balance, p_reason, p_package_key,
     p_actor, p_subscription_id, p_period_starts_on, p_period_ends_on, p_amount);

  return v_balance;
end;
$$;

revoke all on function private.grant_cv_unlock_tokens(uuid, int, text, text, uuid, uuid, date, date) from public;
revoke all on function private.grant_cv_unlock_tokens(uuid, int, text, text, uuid, uuid, date, date) from anon;
revoke all on function private.grant_cv_unlock_tokens(uuid, int, text, text, uuid, uuid, date, date) from authenticated;

-- ---- FIFO consume one token from current-period grants ---------------------
create or replace function private.consume_cv_unlock_token(p_employer_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select l.id into v_id
  from public.employer_cv_unlock_ledger l
  where l.employer_org_id = p_employer_org
    and l.entry_type = 'grant'
    and l.package_key is distinct from 'job_slot_1'
    and l.expired_at is null
    and coalesce(l.remaining, 0) > 0
    and (l.period_ends_on is null or l.period_ends_on >= current_date)
    and (l.period_starts_on is null or l.period_starts_on <= current_date)
  order by coalesce(l.period_ends_on, '9999-12-31'::date), l.created_at
  for update skip locked
  limit 1;

  if v_id is null then
    raise exception 'No CV unlocks remaining. Buy more unlocks from Billing.';
  end if;

  update public.employer_cv_unlock_ledger
     set remaining = remaining - 1
   where id = v_id
     and coalesce(remaining, 0) >= 1;

  if not found then
    raise exception 'No CV unlocks remaining. Buy more unlocks from Billing.';
  end if;
end;
$$;

revoke all on function private.consume_cv_unlock_token(uuid) from public;
revoke all on function private.consume_cv_unlock_token(uuid) from anon;
revoke all on function private.consume_cv_unlock_token(uuid) from authenticated;

-- ---- Expire: job slots + CV credits per period -----------------------------
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
  v_credits int := 0;
  v_tokens_burned int := 0;
  r record;
  v_balance int;
  v_burn int;
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

  -- Job-slot add-ons (period-scoped; do not touch wallet balance).
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

  -- CV unlock credits: burn remaining on period-lapsed grants.
  for r in
    select l.*
    from public.employer_cv_unlock_ledger l
    where l.entry_type = 'grant'
      and l.package_key is distinct from 'job_slot_1'
      and l.expired_at is null
      and l.period_ends_on is not null
      and l.period_ends_on < current_date
      and coalesce(l.remaining, 0) >= 0
    for update
  loop
    v_burn := coalesce(r.remaining, 0);

    update public.employer_cv_unlock_ledger
       set expired_at = now(),
           remaining = 0
     where id = r.id;

    if v_burn > 0 then
      perform private.ensure_cv_unlock_balance(r.employer_org_id);
      update public.employer_cv_unlock_balances
         set balance = greatest(balance - v_burn, 0),
             updated_at = now()
       where employer_org_id = r.employer_org_id
       returning balance into v_balance;

      insert into public.employer_cv_unlock_ledger
        (employer_org_id, entry_type, amount, balance_after, reason, package_key,
         subscription_id, period_starts_on, period_ends_on, actor_user_id)
      values
        (r.employer_org_id, 'expire', -v_burn, coalesce(v_balance, 0),
         'cv_unlock_period_ended', r.package_key, r.subscription_id,
         r.period_starts_on, r.period_ends_on, null);

      v_tokens_burned := v_tokens_burned + v_burn;
    else
      select balance into v_balance
      from public.employer_cv_unlock_balances
      where employer_org_id = r.employer_org_id;

      insert into public.employer_cv_unlock_ledger
        (employer_org_id, entry_type, amount, balance_after, reason, package_key,
         subscription_id, period_starts_on, period_ends_on, actor_user_id)
      values
        (r.employer_org_id, 'expire', 0, coalesce(v_balance, 0),
         'cv_unlock_period_ended', r.package_key, r.subscription_id,
         r.period_starts_on, r.period_ends_on, null);
    end if;

    v_credits := v_credits + 1;
  end loop;

  return jsonb_build_object(
    'trials_expired', v_trials,
    'plans_expired', v_plans,
    'job_slot_grants_expired', v_slots,
    'cv_credit_grants_expired', v_credits,
    'cv_tokens_burned', v_tokens_burned
  );
end;
$$;

revoke all on function public.expire_employer_entitlements() from public;
revoke all on function public.expire_employer_entitlements() from anon;
revoke all on function public.expire_employer_entitlements() from authenticated;
grant execute on function public.expire_employer_entitlements() to service_role;

-- ---- Spend paths: FIFO consume then decrement wallet -----------------------
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

  if not public.employer_has_active_subscription(v_org) then
    raise exception 'Your plan or trial is not active';
  end if;

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
  perform private.consume_cv_unlock_token(v_org);

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

create or replace function public.spend_zoho_cv_unlock(
  p_zoho_candidate_id text,
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
  v_search_id uuid;
  v_zoho_id text;
begin
  v_zoho_id := nullif(btrim(p_zoho_candidate_id), '');
  if v_zoho_id is null or char_length(v_zoho_id) > 100 then
    raise exception 'Invalid candidate reference';
  end if;

  v_org := public.employer_org_for_caller();
  if v_org is null then
    raise exception 'No approved employer organization for this account';
  end if;

  if not public.employer_has_active_subscription(v_org) then
    raise exception 'Your plan or trial is not active';
  end if;

  if p_job_order_id is null or not public.employer_owns_path_a_job(v_org, p_job_order_id) then
    raise exception 'Select one of your Direct (Path A) job orders';
  end if;

  select id into v_search_id
  from public.zoho_recruit_candidate_search
  where zoho_candidate_id = v_zoho_id
    and is_active
    and search_eligible;
  if v_search_id is null then
    raise exception 'Candidate is not available in the searchable pool';
  end if;

  select id into v_existing
  from public.employer_zoho_candidate_unlocks
  where employer_org_id = v_org and zoho_candidate_id = v_zoho_id;
  if found then
    return jsonb_build_object('already_unlocked', true, 'unlock_id', v_existing);
  end if;

  perform private.ensure_cv_unlock_balance(v_org);
  perform private.consume_cv_unlock_token(v_org);

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
    (employer_org_id, entry_type, amount, balance_after, reason, zoho_candidate_id,
     job_order_id, actor_user_id)
  values
    (v_org, 'spend', -1, v_balance, 'zoho_cv_unlock', v_zoho_id,
     p_job_order_id, auth.uid())
  returning id into v_ledger;

  insert into public.employer_zoho_candidate_unlocks
    (employer_org_id, zoho_candidate_id, search_row_id, job_order_id, ledger_entry_id)
  values
    (v_org, v_zoho_id, v_search_id, p_job_order_id, v_ledger)
  returning id into v_existing;

  return jsonb_build_object(
    'already_unlocked', false,
    'unlock_id', v_existing,
    'cv_unlock_balance', v_balance
  );
end;
$$;

revoke all on function public.spend_zoho_cv_unlock(text, uuid) from public;
revoke all on function public.spend_zoho_cv_unlock(text, uuid) from anon;
grant execute on function public.spend_zoho_cv_unlock(text, uuid) to authenticated;
