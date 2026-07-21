-- =============================================================================
-- 0030 — Employer client accounts + headhunting CV submissions.
-- Run AFTER 0001–0029. Idempotent (safe to re-run).
--
-- Creates a real employer_user login for every demo employer org that already
-- owns fake portal jobs, and seeds consent-gated employer_submissions so those
-- clients (no in-house HR) receive the end of the Shugulika recruiting pipeline:
-- masked CVs / candidate packs submitted by recruiters.
--
-- Jobs remain linked via job_orders.employer_org_id (already set in 0004/0015);
-- this migration re-asserts those links and adds the missing user accounts.
--
-- ⚠️ '12345678' is the SAME deliberately weak shared testing password used by
--    0005/0015. Change every password, or delete these accounts, BEFORE any
--    production deployment.
--
-- Employer accounts (all password: 12345678 → /employer/dashboard):
--   employer@shugulika.test          Bahari Financial Group (existing)
--   serengeti@shugulika.test         Serengeti Logistics
--   kilimanjaro@shugulika.test       Kilimanjaro Tech Labs
--   uhuru@shugulika.test             Uhuru Health Clinic
--   zanzibar@shugulika.test          Zanzibar Coastal Resorts
--   tembo@shugulika.test             Tembo Manufacturing Ltd
-- =============================================================================

create extension if not exists pgcrypto;

-- ---- 0) Ensure employer orgs exist (idempotent; normally from 0004/0015) ----
insert into public.organizations
  (id, org_type, name, country_code, parent_id, status, industry, website, company_size, verification_status)
values
  ('33333333-3333-3333-3333-333333333333','employer','Bahari Financial Group','TZ','22222222-2222-2222-2222-222222222222','active','Financial Services','https://example.com','201-500','verified'),
  ('44444444-4444-4444-4444-444444444444','employer','Serengeti Logistics','TZ','22222222-2222-2222-2222-222222222222','active','Logistics','https://example.com','51-200','verified'),
  ('55555555-5555-5555-5555-555555555555','employer','Kilimanjaro Tech Labs','TZ','22222222-2222-2222-2222-222222222222','active','Technology','https://example.com','51-200','verified'),
  ('66666666-6666-6666-6666-666666666666','employer','Uhuru Health Clinic','TZ','22222222-2222-2222-2222-222222222222','active','Healthcare','https://example.com','11-50','verified'),
  ('77777777-7777-7777-7777-777777777777','employer','Zanzibar Coastal Resorts','TZ','22222222-2222-2222-2222-222222222222','active','Hospitality','https://example.com','201-500','verified'),
  ('88888888-8888-8888-8888-888888888888','employer','Tembo Manufacturing Ltd','TZ','22222222-2222-2222-2222-222222222222','active','Manufacturing','https://example.com','201-500','verified')
on conflict (id) do update set
  name = excluded.name,
  industry = excluded.industry,
  status = 'active',
  verification_status = excluded.verification_status,
  parent_id = excluded.parent_id;

-- Re-assert job → employer ownership for every demo job on the public board.
update public.job_orders set employer_org_id = '33333333-3333-3333-3333-333333333333'
  where id in ('a0000001-0000-0000-0000-000000000001','a0000002-0000-0000-0000-000000000002','a0000012-0000-0000-0000-000000000012');
update public.job_orders set employer_org_id = '44444444-4444-4444-4444-444444444444'
  where id in ('a0000003-0000-0000-0000-000000000003','a0000013-0000-0000-0000-000000000013');
update public.job_orders set employer_org_id = '55555555-5555-5555-5555-555555555555'
  where id in ('a0000004-0000-0000-0000-000000000004','a0000005-0000-0000-0000-000000000005');
update public.job_orders set employer_org_id = '66666666-6666-6666-6666-666666666666'
  where id in ('a0000006-0000-0000-0000-000000000006','a0000007-0000-0000-0000-000000000007');
update public.job_orders set employer_org_id = '77777777-7777-7777-7777-777777777777'
  where id in ('a0000008-0000-0000-0000-000000000008','a0000009-0000-0000-0000-000000000009');
update public.job_orders set employer_org_id = '88888888-8888-8888-8888-888888888888'
  where id in ('a0000010-0000-0000-0000-000000000010','a0000011-0000-0000-0000-000000000011');

-- ---- 1) Auth users for each employer client --------------------------------
do $$
declare a record;
begin
  for a in
    select * from (values
      ('10000000-0000-0000-0000-000000000005'::uuid,'employer@shugulika.test','Amina Juma','employer_user'),
      ('10000000-0000-0000-0000-000000000031'::uuid,'serengeti@shugulika.test','Joseph Mkapa','employer_user'),
      ('10000000-0000-0000-0000-000000000032'::uuid,'kilimanjaro@shugulika.test','Grace Kimaro','employer_user'),
      ('10000000-0000-0000-0000-000000000033'::uuid,'uhuru@shugulika.test','Halima Said','employer_user'),
      ('10000000-0000-0000-0000-000000000034'::uuid,'zanzibar@shugulika.test','Omar Hassan','employer_user'),
      ('10000000-0000-0000-0000-000000000035'::uuid,'tembo@shugulika.test','Peter Mwanga','employer_user')
    ) as t(id, email, full_name, role)
  loop
    if not exists (select 1 from auth.users where id = a.id) then
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) values (
        '00000000-0000-0000-0000-000000000000', a.id, 'authenticated', 'authenticated', a.email,
        crypt('12345678', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', a.full_name, 'role', a.role),
        now(), now(), '', '', '', ''
      );
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), a.id, a.id::text,
        jsonb_build_object('sub', a.id::text, 'email', a.email),
        'email', now(), now(), now()
      );
    else
      update auth.users
        set encrypted_password = crypt('12345678', gen_salt('bf')),
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            email = a.email,
            raw_user_meta_data = jsonb_build_object('full_name', a.full_name, 'role', a.role)
        where id = a.id;
    end if;
  end loop;
end $$;

-- ---- 2) Profiles ------------------------------------------------------------
insert into public.profiles (id, email, full_name)
select v.id, v.email, v.full_name
from (values
  ('10000000-0000-0000-0000-000000000005'::uuid,'employer@shugulika.test','Amina Juma'),
  ('10000000-0000-0000-0000-000000000031'::uuid,'serengeti@shugulika.test','Joseph Mkapa'),
  ('10000000-0000-0000-0000-000000000032'::uuid,'kilimanjaro@shugulika.test','Grace Kimaro'),
  ('10000000-0000-0000-0000-000000000033'::uuid,'uhuru@shugulika.test','Halima Said'),
  ('10000000-0000-0000-0000-000000000034'::uuid,'zanzibar@shugulika.test','Omar Hassan'),
  ('10000000-0000-0000-0000-000000000035'::uuid,'tembo@shugulika.test','Peter Mwanga')
) as v(id, email, full_name)
on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;

-- ---- 3) Employer memberships (clear clamped candidate rows first) -----------
delete from public.memberships where user_id in (
  '10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000031',
  '10000000-0000-0000-0000-000000000032','10000000-0000-0000-0000-000000000033',
  '10000000-0000-0000-0000-000000000034','10000000-0000-0000-0000-000000000035'
);
delete from public.candidate_profiles where user_id in (
  '10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000031',
  '10000000-0000-0000-0000-000000000032','10000000-0000-0000-0000-000000000033',
  '10000000-0000-0000-0000-000000000034','10000000-0000-0000-0000-000000000035'
);

insert into public.memberships (user_id, organization_id, role, status) values
  ('10000000-0000-0000-0000-000000000005','33333333-3333-3333-3333-333333333333','employer_user','active'),
  ('10000000-0000-0000-0000-000000000031','44444444-4444-4444-4444-444444444444','employer_user','active'),
  ('10000000-0000-0000-0000-000000000032','55555555-5555-5555-5555-555555555555','employer_user','active'),
  ('10000000-0000-0000-0000-000000000033','66666666-6666-6666-6666-666666666666','employer_user','active'),
  ('10000000-0000-0000-0000-000000000034','77777777-7777-7777-7777-777777777777','employer_user','active'),
  ('10000000-0000-0000-0000-000000000035','88888888-8888-8888-8888-888888888888','employer_user','active');

-- ---- 4) Pipeline applications + consents for Path B (managed) roles ---------
-- Stable IDs so re-runs stay idempotent. Applications sit at client_submission
-- (the stage just before the employer sees the pack).

insert into public.applications
  (id, candidate_id, job_order_id, owning_org_id, recruitment_path, entry_source,
   current_stage, assigned_recruiter_id, consent_status)
values
  -- Bahari
  ('d0000001-0000-0000-0000-000000000001','c0000009-0000-0000-0000-000000000009','a0000012-0000-0000-0000-000000000012',
   '22222222-2222-2222-2222-222222222222','B','sourced','client_submission','10000000-0000-0000-0000-000000000007','granted'),
  ('d0000002-0000-0000-0000-000000000002','c0000009-0000-0000-0000-000000000009','a0000001-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222','B','sourced','client_submission','10000000-0000-0000-0000-000000000004','granted'),
  -- Kilimanjaro
  ('d0000003-0000-0000-0000-000000000003','c0000001-0000-0000-0000-000000000001','a0000004-0000-0000-0000-000000000004',
   '22222222-2222-2222-2222-222222222222','B','sourced','client_submission','10000000-0000-0000-0000-000000000007','granted'),
  -- Uhuru
  ('d0000004-0000-0000-0000-000000000004','c0000003-0000-0000-0000-000000000003','a0000006-0000-0000-0000-000000000006',
   '22222222-2222-2222-2222-222222222222','B','sourced','client_submission','10000000-0000-0000-0000-000000000007','granted'),
  -- Zanzibar
  ('d0000005-0000-0000-0000-000000000005','c0000006-0000-0000-0000-000000000006','a0000009-0000-0000-0000-000000000009',
   '22222222-2222-2222-2222-222222222222','B','sourced','client_submission','10000000-0000-0000-0000-000000000008','granted'),
  -- Tembo
  ('d0000006-0000-0000-0000-000000000006','c0000007-0000-0000-0000-000000000007','a0000010-0000-0000-0000-000000000010',
   '22222222-2222-2222-2222-222222222222','B','sourced','client_submission','10000000-0000-0000-0000-000000000008','granted'),
  -- Serengeti
  ('d0000007-0000-0000-0000-000000000007','c0000010-0000-0000-0000-000000000010','a0000003-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222','B','sourced','client_submission','10000000-0000-0000-0000-000000000008','granted'),
  ('d0000008-0000-0000-0000-000000000008','c0000010-0000-0000-0000-000000000010','a0000013-0000-0000-0000-000000000013',
   '22222222-2222-2222-2222-222222222222','B','sourced','client_submission','10000000-0000-0000-0000-000000000008','granted')
on conflict (id) do update set
  current_stage = excluded.current_stage,
  consent_status = excluded.consent_status,
  assigned_recruiter_id = excluded.assigned_recruiter_id;

insert into public.candidate_consents
  (id, candidate_id, purpose, covered_org_id, scope, method, granted_at, note)
values
  ('e0000001-0000-0000-0000-000000000001','c0000009-0000-0000-0000-000000000009','employer_submission',
   '33333333-3333-3333-3333-333333333333','{"fields":["headline","location","summary","availability"]}'::jsonb,
   'web_form', now() - interval '3 days','Consent to share CV pack with Bahari Financial Group'),
  ('e0000002-0000-0000-0000-000000000002','c0000001-0000-0000-0000-000000000001','employer_submission',
   '55555555-5555-5555-5555-555555555555','{"fields":["headline","location","summary","availability"]}'::jsonb,
   'web_form', now() - interval '2 days','Consent to share CV pack with Kilimanjaro Tech Labs'),
  ('e0000003-0000-0000-0000-000000000003','c0000003-0000-0000-0000-000000000003','employer_submission',
   '66666666-6666-6666-6666-666666666666','{"fields":["headline","location","summary","availability"]}'::jsonb,
   'web_form', now() - interval '4 days','Consent to share CV pack with Uhuru Health Clinic'),
  ('e0000004-0000-0000-0000-000000000004','c0000006-0000-0000-0000-000000000006','employer_submission',
   '77777777-7777-7777-7777-777777777777','{"fields":["headline","location","summary","availability"]}'::jsonb,
   'web_form', now() - interval '1 day','Consent to share CV pack with Zanzibar Coastal Resorts'),
  ('e0000005-0000-0000-0000-000000000005','c0000007-0000-0000-0000-000000000007','employer_submission',
   '88888888-8888-8888-8888-888888888888','{"fields":["headline","location","summary","availability"]}'::jsonb,
   'web_form', now() - interval '5 days','Consent to share CV pack with Tembo Manufacturing Ltd'),
  ('e0000006-0000-0000-0000-000000000006','c0000010-0000-0000-0000-000000000010','employer_submission',
   '44444444-4444-4444-4444-444444444444','{"fields":["headline","location","summary","availability"]}'::jsonb,
   'web_form', now() - interval '2 days','Consent to share CV pack with Serengeti Logistics')
on conflict (id) do nothing;

-- ---- 5) Employer submissions = CVs sent by Shugulika to the client ----------
insert into public.employer_submissions
  (id, application_id, candidate_id, job_order_id, employer_org_id, submitting_org_id,
   submitting_recruiter_id, consent_id, status, is_masked, summary, disclosed_profile,
   disclosed_fields, submitted_at)
values
  ('f0000001-0000-0000-0000-000000000001','d0000001-0000-0000-0000-000000000001',
   'c0000009-0000-0000-0000-000000000009','a0000012-0000-0000-0000-000000000012',
   '33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
   '10000000-0000-0000-0000-000000000007','e0000001-0000-0000-0000-000000000001',
   'submitted', true,
   'Strong month-end close discipline and CPA(T) in progress. Recommended shortlist.',
   '{"headline":"Accountant (finance & reporting)","location":"Dar es Salaam, TZ","summary":"Accountant with 5 years in financial reporting and month-end close for trading companies.","availability":"1 month notice"}'::jsonb,
   array['headline','location','summary','availability'], now() - interval '2 days'),

  ('f0000002-0000-0000-0000-000000000002','d0000002-0000-0000-0000-000000000002',
   'c0000009-0000-0000-0000-000000000009','a0000001-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
   '10000000-0000-0000-0000-000000000004','e0000001-0000-0000-0000-000000000001',
   'viewed', true,
   'Solid Excel modelling background; good fit for Financial Analyst if you want a reporting-first profile.',
   '{"headline":"Accountant (finance & reporting)","location":"Dar es Salaam, TZ","summary":"Accountant with 5 years in financial reporting and month-end close for trading companies.","availability":"1 month notice"}'::jsonb,
   array['headline','location','summary','availability'], now() - interval '3 days'),

  ('f0000003-0000-0000-0000-000000000003','d0000003-0000-0000-0000-000000000003',
   'c0000001-0000-0000-0000-000000000001','a0000004-0000-0000-0000-000000000004',
   '55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222',
   '10000000-0000-0000-0000-000000000007','e0000002-0000-0000-0000-000000000002',
   'submitted', true,
   'React/Node full-stack with East African fintech delivery experience. Ready for client interview.',
   '{"headline":"Full-stack developer (React & Node.js)","location":"Dar es Salaam, TZ","summary":"Software developer with 4 years building web applications for East African fintech and logistics startups.","availability":"1 month notice"}'::jsonb,
   array['headline','location','summary','availability'], now() - interval '1 day'),

  ('f0000004-0000-0000-0000-000000000004','d0000004-0000-0000-0000-000000000004',
   'c0000003-0000-0000-0000-000000000003','a0000006-0000-0000-0000-000000000006',
   '66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222',
   '10000000-0000-0000-0000-000000000007','e0000003-0000-0000-0000-000000000003',
   'shortlisted', true,
   'Licensed RN with outpatient triage experience. Strong patient-education notes from screening.',
   '{"headline":"Registered nurse","location":"Arusha, TZ","summary":"Registered nurse with 6 years of outpatient and community clinic experience.","availability":"1 month notice"}'::jsonb,
   array['headline','location','summary','availability'], now() - interval '4 days'),

  ('f0000005-0000-0000-0000-000000000005','d0000005-0000-0000-0000-000000000005',
   'c0000006-0000-0000-0000-000000000006','a0000009-0000-0000-0000-000000000009',
   '77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222',
   '10000000-0000-0000-0000-000000000008','e0000004-0000-0000-0000-000000000004',
   'submitted', true,
   'Resort kitchen leadership and food-safety certification. Recommend for Executive Chef shortlist.',
   '{"headline":"Chef de partie","location":"Zanzibar, TZ","summary":"Professional chef with resort kitchen experience in menu planning and food safety.","availability":"1 month notice"}'::jsonb,
   array['headline','location','summary','availability'], now() - interval '18 hours'),

  ('f0000006-0000-0000-0000-000000000006','d0000006-0000-0000-0000-000000000006',
   'c0000007-0000-0000-0000-000000000007','a0000010-0000-0000-0000-000000000010',
   '88888888-8888-8888-8888-888888888888','22222222-2222-2222-2222-222222222222',
   '10000000-0000-0000-0000-000000000008','e0000005-0000-0000-0000-000000000005',
   'submitted', true,
   'Line supervision + lean practices. Good cultural fit for Mwanza plant shifts.',
   '{"headline":"Production supervisor","location":"Mwanza, TZ","summary":"Manufacturing supervisor experienced in line supervision, quality control and lean practices.","availability":"1 month notice"}'::jsonb,
   array['headline','location','summary','availability'], now() - interval '5 days'),

  ('f0000007-0000-0000-0000-000000000007','d0000007-0000-0000-0000-000000000007',
   'c0000010-0000-0000-0000-000000000010','a0000003-0000-0000-0000-000000000003',
   '44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222',
   '10000000-0000-0000-0000-000000000008','e0000006-0000-0000-0000-000000000006',
   'interview_requested', true,
   'Hands-on dispatch and corridor coordination. Ready for your client interview slot.',
   '{"headline":"Logistics & dispatch coordinator","location":"Dar es Salaam, TZ","summary":"Logistics coordinator experienced in route planning, dispatch and fleet coordination.","availability":"2 weeks notice"}'::jsonb,
   array['headline','location','summary','availability'], now() - interval '2 days'),

  ('f0000008-0000-0000-0000-000000000008','d0000008-0000-0000-0000-000000000008',
   'c0000010-0000-0000-0000-000000000010','a0000013-0000-0000-0000-000000000013',
   '44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222',
   '10000000-0000-0000-0000-000000000008','e0000006-0000-0000-0000-000000000006',
   'submitted', true,
   'Same strong dispatch profile; also a fit for Fleet Dispatch Officer if you prefer that title.',
   '{"headline":"Logistics & dispatch coordinator","location":"Dar es Salaam, TZ","summary":"Logistics coordinator experienced in route planning, dispatch and fleet coordination.","availability":"2 weeks notice"}'::jsonb,
   array['headline','location','summary','availability'], now() - interval '1 day')
on conflict (id) do update set
  status = excluded.status,
  summary = excluded.summary,
  disclosed_profile = excluded.disclosed_profile,
  disclosed_fields = excluded.disclosed_fields,
  submitted_at = excluded.submitted_at,
  consent_id = excluded.consent_id;

notify pgrst, 'reload schema';

-- Sanity checks (optional):
-- select p.email, o.name from profiles p
--   join memberships m on m.user_id = p.id
--   join organizations o on o.id = m.organization_id
--  where m.role = 'employer_user' order by o.name;
-- select o.name, jo.title, s.status from employer_submissions s
--   join organizations o on o.id = s.employer_org_id
--   join job_orders jo on jo.id = s.job_order_id
--  order by o.name;
