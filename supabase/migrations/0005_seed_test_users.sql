-- =============================================================================
-- 0005 — Seed the 6 MVP test users + roles, all in one shot.
-- Run AFTER 0001–0004 in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Creates real Supabase Auth users (email pre-confirmed) with the shared test
-- password and assigns each account's role membership. No service key needed —
-- the SQL editor runs as a superuser that can write auth.users directly.
--
-- ⚠️ '12345678' is a DELIBERATELY WEAK shared testing password for this
--    controlled MVP only. Change every password, or delete these accounts,
--    BEFORE any production deployment.
--
-- Accounts (all password: 12345678):
--   hq.admin@shugulika.test          -> /hq/dashboard
--   franchise.admin@shugulika.test   -> /franchise/dashboard
--   operations.admin@shugulika.test  -> /franchise/dashboard
--   recruiter@shugulika.test         -> /recruiter/dashboard
--   employer@shugulika.test          -> /employer/dashboard
--   candidate@shugulika.test         -> /candidate/dashboard
-- =============================================================================

create extension if not exists pgcrypto;

-- ---- Make sure the demo orgs exist (idempotent; normally from 0004) ---------
insert into public.organizations (id, org_type, name, country_code, status, verification_status) values
  ('11111111-1111-1111-1111-111111111111','hq','Shugulika Africa HQ','TZ','active','verified')
on conflict (id) do nothing;
insert into public.organizations (id, org_type, name, country_code, parent_id, status, verification_status) values
  ('22222222-2222-2222-2222-222222222222','franchise','Shugulika Tanzania (Dar es Salaam)','TZ','11111111-1111-1111-1111-111111111111','active','verified')
on conflict (id) do nothing;
insert into public.organizations (id, org_type, name, country_code, parent_id, status, industry, verification_status) values
  ('33333333-3333-3333-3333-333333333333','employer','Bahari Financial Group','TZ','22222222-2222-2222-2222-222222222222','active','Financial Services','verified')
on conflict (id) do nothing;

-- ---- 1) Create the auth users (bcrypt password, confirmed email) ------------
do $$
declare a record;
begin
  for a in
    select * from (values
      ('10000000-0000-0000-0000-000000000001'::uuid,'hq.admin@shugulika.test','HQ Administrator','hq_admin'),
      ('10000000-0000-0000-0000-000000000002'::uuid,'franchise.admin@shugulika.test','Franchise Administrator','franchise_admin'),
      ('10000000-0000-0000-0000-000000000003'::uuid,'operations.admin@shugulika.test','Operations Administrator','operations'),
      ('10000000-0000-0000-0000-000000000004'::uuid,'recruiter@shugulika.test','Demo Recruiter','recruiter'),
      ('10000000-0000-0000-0000-000000000005'::uuid,'employer@shugulika.test','Demo Employer','employer_user'),
      ('10000000-0000-0000-0000-000000000006'::uuid,'candidate@shugulika.test','Demo Candidate','candidate')
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
      -- keep password + confirmation up to date on re-run
      update auth.users
        set encrypted_password = crypt('12345678', gen_salt('bf')),
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            raw_user_meta_data = jsonb_build_object('full_name', a.full_name, 'role', a.role)
        where id = a.id;
    end if;
  end loop;
end $$;

-- ---- 2) Ensure a profile row for each user ---------------------------------
insert into public.profiles (id, email, full_name)
select v.id, v.email, v.full_name
from (values
  ('10000000-0000-0000-0000-000000000001'::uuid,'hq.admin@shugulika.test','HQ Administrator'),
  ('10000000-0000-0000-0000-000000000002'::uuid,'franchise.admin@shugulika.test','Franchise Administrator'),
  ('10000000-0000-0000-0000-000000000003'::uuid,'operations.admin@shugulika.test','Operations Administrator'),
  ('10000000-0000-0000-0000-000000000004'::uuid,'recruiter@shugulika.test','Demo Recruiter'),
  ('10000000-0000-0000-0000-000000000005'::uuid,'employer@shugulika.test','Demo Employer'),
  ('10000000-0000-0000-0000-000000000006'::uuid,'candidate@shugulika.test','Demo Candidate')
) as v(id, email, full_name)
on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;

-- ---- 3) Reset & assign the correct role memberships ------------------------
-- (The signup trigger may have auto-created a clamped 'candidate' membership;
--  we remove those for these 6 users and set the intended roles.)
delete from public.memberships where user_id in (
  '10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000006'
);
-- non-candidate accounts should not carry a candidate profile
delete from public.candidate_profiles where user_id in (
  '10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000005'
);

insert into public.memberships (user_id, organization_id, role, status) values
  ('10000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','hq_admin','active'),
  ('10000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','franchise_admin','active'),
  ('10000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','operations','active'),
  ('10000000-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222','recruiter','active'),
  ('10000000-0000-0000-0000-000000000005','33333333-3333-3333-3333-333333333333','employer_user','active'),
  ('10000000-0000-0000-0000-000000000006', null, 'candidate','active');

-- ---- 4) Candidate needs a candidate profile (+ prefs/visibility) -----------
insert into public.candidate_profiles (user_id, given_name, family_name, headline, profile_status)
values ('10000000-0000-0000-0000-000000000006','Demo','Candidate','Aspiring finance professional','active')
on conflict (user_id) do nothing;
insert into public.candidate_preferences (candidate_id)
select id from public.candidate_profiles where user_id = '10000000-0000-0000-0000-000000000006'
on conflict (candidate_id) do nothing;
insert into public.candidate_search_visibility (candidate_id)
select id from public.candidate_profiles where user_id = '10000000-0000-0000-0000-000000000006'
on conflict (candidate_id) do nothing;

-- Refresh the API schema cache.
notify pgrst, 'reload schema';

-- Sanity check (optional): see the accounts and roles you just created.
-- select p.email, m.role, o.name as org
-- from public.profiles p
-- left join public.memberships m on m.user_id = p.id
-- left join public.organizations o on o.id = m.organization_id
-- where p.email like '%@shugulika.test' order by p.email;
