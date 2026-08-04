-- =============================================================================
-- Demo employer package tiers (job slots from existing roles; CV unlocks = 0).
-- Run AFTER 20260730140000_employer_cv_unlock_packages.sql. Idempotent.
--
-- Packages match README §6e. Job-slot usage follows seeded job_orders:
--
--   Uhuru Health Clinic         → Free trial  · jobs 2/2  · CV unlocks 0
--   Kilimanjaro Tech Labs       → Starter     · jobs 2/2  · CV unlocks 0
--   Serengeti Logistics         → Starter     · jobs 2/2  · CV unlocks 0
--   Zanzibar Coastal Resorts    → Growth      · jobs 2/5  · CV unlocks 0
--   Tembo Manufacturing Ltd     → Growth      · jobs 2/5  · CV unlocks 0
--   Bahari Financial Group      → Scale       · jobs 3/12 · CV unlocks 0
--
-- CV unlock wallets stay at 0 (new feature — no historical unlocks granted).
-- Kilimanjaro login for slot-full + unlock-at-zero testing:
--   kilimanjaro@shugulika.test / 12345678
-- =============================================================================

do $$
declare
  r record;
  v_pkg_id uuid;
  v_is_trial boolean;
  v_status text;
  v_trial_ends date;
  v_expires date;
begin
  for r in
    select * from (values
      ('66666666-6666-6666-6666-666666666666'::uuid, 'trial',   true),   -- Uhuru
      ('55555555-5555-5555-5555-555555555555'::uuid, 'starter', false),  -- Kilimanjaro
      ('44444444-4444-4444-4444-444444444444'::uuid, 'starter', false),  -- Serengeti
      ('77777777-7777-7777-7777-777777777777'::uuid, 'growth',  false),  -- Zanzibar
      ('88888888-8888-8888-8888-888888888888'::uuid, 'growth',  false),  -- Tembo
      ('33333333-3333-3333-3333-333333333333'::uuid, 'scale',   false)   -- Bahari
    ) as t(org_id, package_key, as_trial)
  loop
    select id into v_pkg_id
    from public.packages
    where key = r.package_key and is_active and package_kind = 'subscription';
    if v_pkg_id is null then
      raise exception 'Package % missing — apply 20260730140000 first', r.package_key;
    end if;

    update public.employer_subscriptions
      set status = 'expired'
    where employer_org_id = r.org_id
      and status in ('trial', 'active');

    v_is_trial := r.as_trial or r.package_key = 'trial';
    if v_is_trial then
      v_status := 'trial';
      v_trial_ends := current_date + 14;
      v_expires := v_trial_ends;
    else
      v_status := 'active';
      v_trial_ends := null;
      v_expires := current_date + 30;
    end if;

    insert into public.employer_subscriptions
      (employer_org_id, package_id, status, is_trial, trial_started_on, trial_ends_on,
       starts_on, expires_on, auto_activate_intent)
    values
      (r.org_id, v_pkg_id, v_status, v_is_trial,
       case when v_is_trial then current_date else null end,
       v_trial_ends, current_date, v_expires, false);

    -- Wallet row exists; balance stays 0 (CV unlocks are a new feature).
    perform public.ensure_cv_unlock_balance(r.org_id);
    update public.employer_cv_unlock_balances
      set balance = 0, updated_at = now()
    where employer_org_id = r.org_id;

    -- Drop any prior demo grant/spend noise for a clean zero counter.
    delete from public.employer_cv_unlocks where employer_org_id = r.org_id;
    delete from public.employer_cv_unlock_ledger
    where employer_org_id = r.org_id
      and reason in ('demo_seed_package', 'demo_seed_spend', 'cv_unlock', 'package_grant', 'trial_grant');
  end loop;
end $$;

-- ---- Align existing demo jobs to packages (count toward slot limits) --------
-- Bahari Financial Group — Scale (3 roles: Financial Analyst, Credit Officer, Accountant)
update public.job_orders
  set status = 'active', employer_org_id = '33333333-3333-3333-3333-333333333333'
where id in (
  'a0000001-0000-0000-0000-000000000001',
  'a0000002-0000-0000-0000-000000000002',
  'a0000012-0000-0000-0000-000000000012'
);

-- Serengeti Logistics — Starter (2 roles: Logistics Coordinator, Fleet Dispatch Officer)
update public.job_orders
  set status = 'active', employer_org_id = '44444444-4444-4444-4444-444444444444'
where id in (
  'a0000003-0000-0000-0000-000000000003',
  'a0000013-0000-0000-0000-000000000013'
);

-- Kilimanjaro Tech Labs — Starter (2 roles: Software Developer, IT Support Technician)
update public.job_orders
  set status = 'active', employer_org_id = '55555555-5555-5555-5555-555555555555'
where id in (
  'a0000004-0000-0000-0000-000000000004',
  'a0000005-0000-0000-0000-000000000005'
);

-- Uhuru Health Clinic — Free trial (2 roles: Registered Nurse, Clinic Receptionist)
update public.job_orders
  set status = 'active', employer_org_id = '66666666-6666-6666-6666-666666666666'
where id in (
  'a0000006-0000-0000-0000-000000000006',
  'a0000007-0000-0000-0000-000000000007'
);

-- Zanzibar Coastal Resorts — Growth (2 roles: Hotel Front Desk Agent, Executive Chef)
update public.job_orders
  set status = 'active', employer_org_id = '77777777-7777-7777-7777-777777777777'
where id in (
  'a0000008-0000-0000-0000-000000000008',
  'a0000009-0000-0000-0000-000000000009'
);

-- Tembo Manufacturing Ltd — Growth (2 roles: Production Supervisor, Warehouse Assistant)
update public.job_orders
  set status = 'active', employer_org_id = '88888888-8888-8888-8888-888888888888'
where id in (
  'a0000010-0000-0000-0000-000000000010',
  'a0000011-0000-0000-0000-000000000011'
);

-- ---- Kilimanjaro: extra locked teasers (balance 0 → buy unlocks to open) ----
-- Bypass insert/stage RPC guards for demo fixtures (same flag the pipeline RPCs use).
-- false = session-scoped so it survives statement boundaries in the SQL editor.
select set_config('shugulika.stage_rpc', '1', false);

insert into public.applications
  (id, candidate_id, job_order_id, owning_org_id, recruitment_path, entry_source,
   current_stage, assigned_recruiter_id, consent_status)
values
  ('d0000011-0000-0000-0000-000000000011','c0000002-0000-0000-0000-000000000002','a0000005-0000-0000-0000-000000000005',
   '22222222-2222-2222-2222-222222222222','B','sourced','client_submission','10000000-0000-0000-0000-000000000007','granted'),
  ('d0000012-0000-0000-0000-000000000012','c0000008-0000-0000-0000-000000000008','a0000004-0000-0000-0000-000000000004',
   '22222222-2222-2222-2222-222222222222','B','sourced','client_submission','10000000-0000-0000-0000-000000000007','granted')
on conflict (id) do update set
  current_stage = excluded.current_stage,
  consent_status = excluded.consent_status;

insert into public.candidate_consents
  (id, candidate_id, purpose, covered_org_id, scope, method, granted_at, note)
values
  ('e0000011-0000-0000-0000-000000000011','c0000002-0000-0000-0000-000000000002','employer_submission',
   '55555555-5555-5555-5555-555555555555','{"fields":["headline","location","summary","availability"]}'::jsonb,
   'web_form', now() - interval '1 day','Consent to share CV pack with Kilimanjaro Tech Labs'),
  ('e0000012-0000-0000-0000-000000000012','c0000008-0000-0000-0000-000000000008','employer_submission',
   '55555555-5555-5555-5555-555555555555','{"fields":["headline","location","summary","availability"]}'::jsonb,
   'web_form', now() - interval '1 day','Consent to share CV pack with Kilimanjaro Tech Labs')
on conflict (id) do nothing;

insert into public.employer_submissions
  (id, application_id, candidate_id, job_order_id, employer_org_id, submitting_org_id,
   submitting_recruiter_id, consent_id, status, is_masked, summary, disclosed_profile,
   full_disclosed_profile, disclosed_fields, submitted_at)
values
  ('f0000011-0000-0000-0000-000000000011','d0000011-0000-0000-0000-000000000011',
   'c0000002-0000-0000-0000-000000000002','a0000005-0000-0000-0000-000000000005',
   '55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222',
   '10000000-0000-0000-0000-000000000007','e0000011-0000-0000-0000-000000000011',
   'submitted', true,
   'Solid helpdesk background; good fit for the IT Support Technician role.',
   '{"headline":"IT support technician","location":"Dar es Salaam, TZ","summary":"IT support professional experienced in helpdesk, hardware troubleshooting and small-office networking.","availability":"2 weeks notice"}'::jsonb,
   '{"headline":"IT support technician","location":"Dar es Salaam, TZ","summary":"IT support professional experienced in helpdesk, hardware troubleshooting and small-office networking.","availability":"2 weeks notice","full_name":"Jane Doe","given_name":"Jane","family_name":"Doe"}'::jsonb,
   array['headline','location','summary','availability'], now() - interval '12 hours'),
  ('f0000012-0000-0000-0000-000000000012','d0000012-0000-0000-0000-000000000012',
   'c0000008-0000-0000-0000-000000000008','a0000004-0000-0000-0000-000000000004',
   '55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222',
   '10000000-0000-0000-0000-000000000007','e0000012-0000-0000-0000-000000000012',
   'submitted', true,
   'Inventory-systems experience; stretch for Software Developer — masked until unlock.',
   '{"headline":"Warehouse & inventory assistant","location":"Mwanza, TZ","summary":"Warehouse assistant experienced in inventory management, stock control and dispatch support.","availability":"Immediately"}'::jsonb,
   '{"headline":"Warehouse & inventory assistant","location":"Mwanza, TZ","summary":"Warehouse assistant experienced in inventory management, stock control and dispatch support.","availability":"Immediately","full_name":"Mary Taylor","given_name":"Mary","family_name":"Taylor"}'::jsonb,
   array['headline','location','summary','availability'], now() - interval '6 hours')
on conflict (id) do update set
  is_masked = true,
  disclosed_profile = excluded.disclosed_profile,
  full_disclosed_profile = excluded.full_disclosed_profile,
  status = excluded.status;

-- Keep original Kilimanjaro pack masked with a full snapshot ready after unlock.
update public.employer_submissions
set
  is_masked = true,
  full_disclosed_profile = coalesce(
    full_disclosed_profile,
    '{"headline":"Full-stack developer (React & Node.js)","location":"Dar es Salaam, TZ","summary":"Software developer with 4 years building web applications for East African fintech and logistics startups.","availability":"1 month notice","full_name":"John Smith","given_name":"John","family_name":"Smith"}'::jsonb
  )
where id = 'f0000003-0000-0000-0000-000000000003';

select set_config('shugulika.stage_rpc', '', false);
