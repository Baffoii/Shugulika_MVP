-- =============================================================================
-- 0015 — Demo data expansion: 2 recruiters, 4 employers, 10 jobs, 10 candidates.
-- Run AFTER 0001–0014 in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Extends the small demo scenario from 0004/0005 so the recruiter, employer and
-- candidate portals have a fuller, more realistic dataset to demonstrate:
--   • 2 more recruiter accounts on the Dar es Salaam franchise
--   • 4 more employer organizations (tech, health, hospitality, manufacturing)
--   • 10 more advertised jobs spread across the 6 employers
--   • 10 more candidate accounts with populated profiles, skills, experience,
--     education, languages, preferences and recruiter-search visibility
--
-- Every new job's responsible_org_id is the Dar es Salaam franchise
-- (22222222…), so the seeded recruiters (and franchise/HQ admins) see them
-- under RLS. Candidate search-visibility is enabled so recruiters can discover
-- them once the candidate-search screen ships.
--
-- ⚠️ '12345678' is the SAME deliberately weak shared testing password used by
--    0005. Change every password, or delete these accounts, BEFORE any
--    production deployment.
--
-- New accounts (all password: 12345678):
--   recruiter2@shugulika.test  Peter Jones   -> /recruiter/dashboard
--   recruiter3@shugulika.test  Susan Clark   -> /recruiter/dashboard
--   john.smith@shugulika.test      … linda.thomas@shugulika.test  (10 candidates)
-- =============================================================================

create extension if not exists pgcrypto;

-- ---- 0) Prerequisite orgs (idempotent; normally from 0004/0005) --------------
insert into public.organizations (id, org_type, name, country_code, status, verification_status) values
  ('11111111-1111-1111-1111-111111111111','hq','Shugulika Africa HQ','TZ','active','verified')
on conflict (id) do nothing;
insert into public.organizations (id, org_type, name, country_code, parent_id, status, verification_status) values
  ('22222222-2222-2222-2222-222222222222','franchise','Shugulika Tanzania (Dar es Salaam)','TZ','11111111-1111-1111-1111-111111111111','active','verified')
on conflict (id) do nothing;

-- ---- 1) Four new employer organizations (children of the DSM franchise) ------
insert into public.organizations
  (id, org_type, name, country_code, parent_id, status, industry, website, company_size, verification_status)
values
  ('55555555-5555-5555-5555-555555555555','employer','Kilimanjaro Tech Labs','TZ','22222222-2222-2222-2222-222222222222','active','Technology','https://example.com','51-200','verified'),
  ('66666666-6666-6666-6666-666666666666','employer','Uhuru Health Clinic','TZ','22222222-2222-2222-2222-222222222222','active','Healthcare','https://example.com','11-50','verified'),
  ('77777777-7777-7777-7777-777777777777','employer','Zanzibar Coastal Resorts','TZ','22222222-2222-2222-2222-222222222222','active','Hospitality','https://example.com','201-500','pending'),
  ('88888888-8888-8888-8888-888888888888','employer','Tembo Manufacturing Ltd','TZ','22222222-2222-2222-2222-222222222222','active','Manufacturing','https://example.com','201-500','verified')
on conflict (id) do nothing;

-- ---- 2) Create auth users for the 2 recruiters + 10 candidates --------------
-- Mirrors 0005: writes auth.users + auth.identities directly (SQL editor runs as
-- superuser). The on_auth_user_created trigger will auto-provision a clamped
-- profile/membership/candidate row for each; sections 3–5 reconcile those.
do $$
declare a record;
begin
  for a in
    select * from (values
      ('10000000-0000-0000-0000-000000000007'::uuid,'recruiter2@shugulika.test','Peter Jones','recruiter'),
      ('10000000-0000-0000-0000-000000000008'::uuid,'recruiter3@shugulika.test','Susan Clark','recruiter'),
      ('10000000-0000-0000-0000-000000000011'::uuid,'john.smith@shugulika.test','John Smith','candidate'),
      ('10000000-0000-0000-0000-000000000012'::uuid,'jane.doe@shugulika.test','Jane Doe','candidate'),
      ('10000000-0000-0000-0000-000000000013'::uuid,'michael.johnson@shugulika.test','Michael Johnson','candidate'),
      ('10000000-0000-0000-0000-000000000014'::uuid,'emily.davis@shugulika.test','Emily Davis','candidate'),
      ('10000000-0000-0000-0000-000000000015'::uuid,'david.brown@shugulika.test','David Brown','candidate'),
      ('10000000-0000-0000-0000-000000000016'::uuid,'sarah.wilson@shugulika.test','Sarah Wilson','candidate'),
      ('10000000-0000-0000-0000-000000000017'::uuid,'james.miller@shugulika.test','James Miller','candidate'),
      ('10000000-0000-0000-0000-000000000018'::uuid,'mary.taylor@shugulika.test','Mary Taylor','candidate'),
      ('10000000-0000-0000-0000-000000000019'::uuid,'robert.anderson@shugulika.test','Robert Anderson','candidate'),
      ('10000000-0000-0000-0000-000000000020'::uuid,'linda.thomas@shugulika.test','Linda Thomas','candidate')
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
            raw_user_meta_data = jsonb_build_object('full_name', a.full_name, 'role', a.role)
        where id = a.id;
    end if;
  end loop;
end $$;

-- ---- 3) Ensure a profile row (with full name) for every new user ------------
insert into public.profiles (id, email, full_name)
select v.id, v.email, v.full_name
from (values
  ('10000000-0000-0000-0000-000000000007'::uuid,'recruiter2@shugulika.test','Peter Jones'),
  ('10000000-0000-0000-0000-000000000008'::uuid,'recruiter3@shugulika.test','Susan Clark'),
  ('10000000-0000-0000-0000-000000000011'::uuid,'john.smith@shugulika.test','John Smith'),
  ('10000000-0000-0000-0000-000000000012'::uuid,'jane.doe@shugulika.test','Jane Doe'),
  ('10000000-0000-0000-0000-000000000013'::uuid,'michael.johnson@shugulika.test','Michael Johnson'),
  ('10000000-0000-0000-0000-000000000014'::uuid,'emily.davis@shugulika.test','Emily Davis'),
  ('10000000-0000-0000-0000-000000000015'::uuid,'david.brown@shugulika.test','David Brown'),
  ('10000000-0000-0000-0000-000000000016'::uuid,'sarah.wilson@shugulika.test','Sarah Wilson'),
  ('10000000-0000-0000-0000-000000000017'::uuid,'james.miller@shugulika.test','James Miller'),
  ('10000000-0000-0000-0000-000000000018'::uuid,'mary.taylor@shugulika.test','Mary Taylor'),
  ('10000000-0000-0000-0000-000000000019'::uuid,'robert.anderson@shugulika.test','Robert Anderson'),
  ('10000000-0000-0000-0000-000000000020'::uuid,'linda.thomas@shugulika.test','Linda Thomas')
) as v(id, email, full_name)
on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;

-- ---- 4) Recruiters: clear clamped rows, assign recruiter membership ----------
-- The signup trigger clamps 'recruiter' to a 'candidate' membership and creates
-- a candidate_profiles row; remove both, then grant the real recruiter role on
-- the Dar es Salaam franchise (same org as the 0005 demo recruiter).
delete from public.memberships where user_id in (
  '10000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000008'
);
delete from public.candidate_profiles where user_id in (
  '10000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000008'
);
insert into public.memberships (user_id, organization_id, role, status) values
  ('10000000-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222','recruiter','active'),
  ('10000000-0000-0000-0000-000000000008','22222222-2222-2222-2222-222222222222','recruiter','active');

-- ---- 5) Candidates: rebuild candidate_profiles deterministically ------------
-- Drop the trigger-created candidate_profiles (cascades to prefs/visibility/
-- skills/experience/etc.), then re-create with stable IDs so this whole section
-- is idempotent. The auto-created 'candidate' membership is kept (re-asserted
-- below for safety).
delete from public.candidate_profiles where user_id in (
  '10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000012',
  '10000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000014',
  '10000000-0000-0000-0000-000000000015','10000000-0000-0000-0000-000000000016',
  '10000000-0000-0000-0000-000000000017','10000000-0000-0000-0000-000000000018',
  '10000000-0000-0000-0000-000000000019','10000000-0000-0000-0000-000000000020'
);

insert into public.memberships (user_id, organization_id, role, status) values
  ('10000000-0000-0000-0000-000000000011', null, 'candidate','active'),
  ('10000000-0000-0000-0000-000000000012', null, 'candidate','active'),
  ('10000000-0000-0000-0000-000000000013', null, 'candidate','active'),
  ('10000000-0000-0000-0000-000000000014', null, 'candidate','active'),
  ('10000000-0000-0000-0000-000000000015', null, 'candidate','active'),
  ('10000000-0000-0000-0000-000000000016', null, 'candidate','active'),
  ('10000000-0000-0000-0000-000000000017', null, 'candidate','active'),
  ('10000000-0000-0000-0000-000000000018', null, 'candidate','active'),
  ('10000000-0000-0000-0000-000000000019', null, 'candidate','active'),
  ('10000000-0000-0000-0000-000000000020', null, 'candidate','active')
on conflict do nothing;

insert into public.candidate_profiles
  (id, user_id, given_name, family_name, headline, summary, country_code, city,
   availability, open_to_work, profile_status, completion_pct)
values
  ('c0000001-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000011','John','Smith',
   'Full-stack developer (React & Node.js)',
   'Software developer with 4 years building web applications for East African fintech and logistics startups.',
   'TZ','Dar es Salaam','1 month notice', true,'active',85),
  ('c0000002-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000012','Jane','Doe',
   'IT support technician',
   'IT support professional experienced in helpdesk, hardware troubleshooting and small-office networking.',
   'TZ','Dar es Salaam','2 weeks notice', true,'active',75),
  ('c0000003-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000013','Michael','Johnson',
   'Registered nurse',
   'Registered nurse with 6 years of outpatient and community clinic experience.',
   'TZ','Arusha','1 month notice', true,'active',88),
  ('c0000004-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000014','Emily','Davis',
   'Front office & administrative assistant',
   'Administrative and front-office professional skilled in scheduling, reception and customer service.',
   'TZ','Arusha','Immediately', true,'active',72),
  ('c0000005-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000015','David','Brown',
   'Hospitality front desk agent',
   'Hotel front desk agent experienced in guest relations, reservations and check-in operations.',
   'TZ','Zanzibar','2 weeks notice', true,'active',78),
  ('c0000006-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000016','Sarah','Wilson',
   'Chef de partie',
   'Professional chef with resort kitchen experience in menu planning and food safety.',
   'TZ','Zanzibar','1 month notice', true,'active',80),
  ('c0000007-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000017','James','Miller',
   'Production supervisor',
   'Manufacturing supervisor experienced in line supervision, quality control and lean practices.',
   'TZ','Mwanza','1 month notice', true,'active',82),
  ('c0000008-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000018','Mary','Taylor',
   'Warehouse & inventory assistant',
   'Warehouse assistant experienced in inventory management, stock control and dispatch support.',
   'TZ','Mwanza','Immediately', true,'active',70),
  ('c0000009-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000019','Robert','Anderson',
   'Accountant (finance & reporting)',
   'Accountant with 5 years in financial reporting and month-end close for trading companies.',
   'TZ','Dar es Salaam','1 month notice', true,'active',86),
  ('c0000010-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000020','Linda','Thomas',
   'Logistics & dispatch coordinator',
   'Logistics coordinator experienced in route planning, dispatch and fleet coordination.',
   'TZ','Dar es Salaam','2 weeks notice', true,'active',79);

-- preferences (one row per candidate)
insert into public.candidate_preferences
  (candidate_id, desired_roles, preferred_locations, employment_types,
   min_salary, max_salary, salary_currency, willing_to_relocate, remote_preference)
values
  ('c0000001-0000-0000-0000-000000000001', array['Software Developer','Frontend Developer'], array['Dar es Salaam'], array['full_time'], 2500000, 3500000,'TZS', false,'hybrid'),
  ('c0000002-0000-0000-0000-000000000002', array['IT Support Technician','Helpdesk Analyst'], array['Dar es Salaam'], array['full_time'], 900000, 1400000,'TZS', false,'on_site'),
  ('c0000003-0000-0000-0000-000000000003', array['Registered Nurse','Clinical Nurse'], array['Arusha'], array['full_time'], 1200000, 1800000,'TZS', true,'on_site'),
  ('c0000004-0000-0000-0000-000000000004', array['Receptionist','Administrative Assistant'], array['Arusha'], array['full_time'], 700000, 1000000,'TZS', false,'on_site'),
  ('c0000005-0000-0000-0000-000000000005', array['Front Desk Agent','Guest Relations'], array['Zanzibar'], array['full_time'], 800000, 1200000,'TZS', true,'on_site'),
  ('c0000006-0000-0000-0000-000000000006', array['Chef','Cook'], array['Zanzibar'], array['full_time'], 1500000, 2500000,'TZS', true,'on_site'),
  ('c0000007-0000-0000-0000-000000000007', array['Production Supervisor','Line Supervisor'], array['Mwanza'], array['full_time'], 1600000, 2300000,'TZS', true,'on_site'),
  ('c0000008-0000-0000-0000-000000000008', array['Warehouse Assistant','Inventory Clerk'], array['Mwanza'], array['full_time'], 600000, 1000000,'TZS', false,'on_site'),
  ('c0000009-0000-0000-0000-000000000009', array['Accountant','Finance Officer'], array['Dar es Salaam'], array['full_time'], 1900000, 2700000,'TZS', false,'hybrid'),
  ('c0000010-0000-0000-0000-000000000010', array['Logistics Coordinator','Dispatch Officer'], array['Dar es Salaam'], array['full_time'], 1300000, 1900000,'TZS', false,'on_site');

-- search visibility (opt in to recruiter discovery)
insert into public.candidate_search_visibility (candidate_id, is_searchable, approved_fields)
select id, true, array['given_name','family_name','headline','city','country_code','skills']
from public.candidate_profiles
where id in (
  'c0000001-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000002',
  'c0000003-0000-0000-0000-000000000003','c0000004-0000-0000-0000-000000000004',
  'c0000005-0000-0000-0000-000000000005','c0000006-0000-0000-0000-000000000006',
  'c0000007-0000-0000-0000-000000000007','c0000008-0000-0000-0000-000000000008',
  'c0000009-0000-0000-0000-000000000009','c0000010-0000-0000-0000-000000000010'
)
on conflict (candidate_id) do update set is_searchable = excluded.is_searchable, approved_fields = excluded.approved_fields;

-- skills
insert into public.candidate_skills (candidate_id, name, level) values
  ('c0000001-0000-0000-0000-000000000001','JavaScript','advanced'),
  ('c0000001-0000-0000-0000-000000000001','React','advanced'),
  ('c0000001-0000-0000-0000-000000000001','Node.js','intermediate'),
  ('c0000002-0000-0000-0000-000000000002','Troubleshooting','advanced'),
  ('c0000002-0000-0000-0000-000000000002','Windows Administration','intermediate'),
  ('c0000002-0000-0000-0000-000000000002','Networking','beginner'),
  ('c0000003-0000-0000-0000-000000000003','Patient Care','expert'),
  ('c0000003-0000-0000-0000-000000000003','Triage','advanced'),
  ('c0000003-0000-0000-0000-000000000003','Medical Record Keeping','advanced'),
  ('c0000004-0000-0000-0000-000000000004','Customer Service','advanced'),
  ('c0000004-0000-0000-0000-000000000004','Scheduling','advanced'),
  ('c0000004-0000-0000-0000-000000000004','MS Office','intermediate'),
  ('c0000005-0000-0000-0000-000000000005','Guest Relations','advanced'),
  ('c0000005-0000-0000-0000-000000000005','Reservations','intermediate'),
  ('c0000005-0000-0000-0000-000000000005','POS Systems','intermediate'),
  ('c0000006-0000-0000-0000-000000000006','Menu Planning','advanced'),
  ('c0000006-0000-0000-0000-000000000006','Food Safety','advanced'),
  ('c0000006-0000-0000-0000-000000000006','Team Leadership','intermediate'),
  ('c0000007-0000-0000-0000-000000000007','Line Supervision','advanced'),
  ('c0000007-0000-0000-0000-000000000007','Quality Control','advanced'),
  ('c0000007-0000-0000-0000-000000000007','Lean Manufacturing','intermediate'),
  ('c0000008-0000-0000-0000-000000000008','Inventory Management','advanced'),
  ('c0000008-0000-0000-0000-000000000008','Stock Control','advanced'),
  ('c0000008-0000-0000-0000-000000000008','Forklift Operation','intermediate'),
  ('c0000009-0000-0000-0000-000000000009','Financial Reporting','advanced'),
  ('c0000009-0000-0000-0000-000000000009','Microsoft Excel','expert'),
  ('c0000009-0000-0000-0000-000000000009','QuickBooks','advanced'),
  ('c0000010-0000-0000-0000-000000000010','Route Planning','advanced'),
  ('c0000010-0000-0000-0000-000000000010','Dispatch','advanced'),
  ('c0000010-0000-0000-0000-000000000010','Fleet Coordination','intermediate');

-- languages (English + Swahili for each)
insert into public.candidate_languages (candidate_id, language, proficiency) values
  ('c0000001-0000-0000-0000-000000000001','English','professional'),
  ('c0000001-0000-0000-0000-000000000001','Swahili','native'),
  ('c0000002-0000-0000-0000-000000000002','English','professional'),
  ('c0000002-0000-0000-0000-000000000002','Swahili','native'),
  ('c0000003-0000-0000-0000-000000000003','English','professional'),
  ('c0000003-0000-0000-0000-000000000003','Swahili','native'),
  ('c0000004-0000-0000-0000-000000000004','English','conversational'),
  ('c0000004-0000-0000-0000-000000000004','Swahili','native'),
  ('c0000005-0000-0000-0000-000000000005','English','fluent'),
  ('c0000005-0000-0000-0000-000000000005','Swahili','native'),
  ('c0000006-0000-0000-0000-000000000006','English','professional'),
  ('c0000006-0000-0000-0000-000000000006','Swahili','native'),
  ('c0000007-0000-0000-0000-000000000007','English','conversational'),
  ('c0000007-0000-0000-0000-000000000007','Swahili','native'),
  ('c0000008-0000-0000-0000-000000000008','English','conversational'),
  ('c0000008-0000-0000-0000-000000000008','Swahili','native'),
  ('c0000009-0000-0000-0000-000000000009','English','professional'),
  ('c0000009-0000-0000-0000-000000000009','Swahili','native'),
  ('c0000010-0000-0000-0000-000000000010','English','professional'),
  ('c0000010-0000-0000-0000-000000000010','Swahili','native');

-- experience (one current role each)
insert into public.candidate_experiences
  (candidate_id, title, employer_name, location, start_date, is_current, description, kind)
values
  ('c0000001-0000-0000-0000-000000000001','Software Developer','Nia Tech Solutions','Dar es Salaam','2021-03-01', true,'Build and maintain React/Node.js web applications and REST APIs.','formal'),
  ('c0000002-0000-0000-0000-000000000002','IT Support Technician','Baraka Systems','Dar es Salaam','2020-06-01', true,'Provide first-line helpdesk support and manage hardware and user accounts.','formal'),
  ('c0000003-0000-0000-0000-000000000003','Registered Nurse','Mount Meru Regional Hospital','Arusha','2017-09-01', true,'Deliver outpatient nursing care, triage and patient education.','formal'),
  ('c0000004-0000-0000-0000-000000000004','Receptionist','Uhuru Dental Clinic','Arusha','2019-01-01', true,'Manage front desk, appointment scheduling and patient records.','formal'),
  ('c0000005-0000-0000-0000-000000000005','Front Desk Agent','Stone Town Hotel','Zanzibar','2018-05-01', true,'Handle guest check-in/out, reservations and guest requests.','formal'),
  ('c0000006-0000-0000-0000-000000000006','Chef de Partie','Coastal Breeze Resort','Zanzibar','2019-02-01', true,'Run a kitchen section, plan menus and enforce food-safety standards.','formal'),
  ('c0000007-0000-0000-0000-000000000007','Production Supervisor','Lake Zone Foods','Mwanza','2018-08-01', true,'Supervise a production line, track output and quality metrics.','formal'),
  ('c0000008-0000-0000-0000-000000000008','Warehouse Assistant','Tembo Distributors','Mwanza','2020-04-01', true,'Receive, store and dispatch stock and maintain inventory records.','formal'),
  ('c0000009-0000-0000-0000-000000000009','Accountant','Bahari Trading Co','Dar es Salaam','2019-07-01', true,'Prepare monthly financial reports and manage the month-end close.','formal'),
  ('c0000010-0000-0000-0000-000000000010','Dispatch Officer','Serengeti Movers','Dar es Salaam','2019-10-01', true,'Plan delivery routes and coordinate drivers and dispatch schedules.','formal');

-- education (one qualification each)
insert into public.candidate_education
  (candidate_id, institution, qualification, field_of_study, start_date, end_date)
values
  ('c0000001-0000-0000-0000-000000000001','University of Dar es Salaam','BSc','Computer Science','2016-09-01','2020-07-01'),
  ('c0000002-0000-0000-0000-000000000002','Dar es Salaam Institute of Technology','Diploma','Information Technology','2018-09-01','2020-07-01'),
  ('c0000003-0000-0000-0000-000000000003','Kilimanjaro Christian Medical University College','Bachelor of Nursing','Nursing','2013-09-01','2017-07-01'),
  ('c0000004-0000-0000-0000-000000000004','Arusha Technical College','Certificate','Business Administration','2017-09-01','2018-07-01'),
  ('c0000005-0000-0000-0000-000000000005','Zanzibar Institute of Tourism','Diploma','Hotel Management','2016-09-01','2018-07-01'),
  ('c0000006-0000-0000-0000-000000000006','Zanzibar Institute of Tourism','Certificate','Culinary Arts','2015-09-01','2017-07-01'),
  ('c0000007-0000-0000-0000-000000000007','Mwanza Technical College','Diploma','Mechanical Engineering','2014-09-01','2017-07-01'),
  ('c0000008-0000-0000-0000-000000000008','Mwanza Technical College','Certificate','Logistics & Supply Chain','2018-09-01','2019-07-01'),
  ('c0000009-0000-0000-0000-000000000009','Mzumbe University','BCom','Accounting','2014-09-01','2018-07-01'),
  ('c0000010-0000-0000-0000-000000000010','National Institute of Transport','Diploma','Logistics & Transport','2015-09-01','2017-07-01');

-- a couple of certifications (exercise the table)
insert into public.candidate_certifications (candidate_id, name, issuer, issued_on) values
  ('c0000003-0000-0000-0000-000000000003','Basic Life Support (BLS)','Tanzania Nurses & Midwives Council','2022-04-01'),
  ('c0000009-0000-0000-0000-000000000009','CPA(T) — in progress','National Board of Accountants and Auditors','2023-06-01');

-- ---- 6) Ten new job orders + advertised jobs --------------------------------
insert into public.job_orders
  (id, employer_org_id, responsible_org_id, title, department, description, responsibilities, requirements,
   country_code, city, employment_type, work_arrangement, experience_level, salary_min, salary_max, salary_currency,
   salary_public, vacancy_count, recruitment_path, status, application_deadline, created_by)
values
  ('a0000004-0000-0000-0000-000000000004','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222',
   'Software Developer','Engineering','Build and ship web features for a growing Tanzanian technology company.',
   'Develop features; write tests; review code; collaborate with product.','3+ years with JavaScript/TypeScript; React and Node.js; Git.',
   'TZ','Dar es Salaam','full_time','hybrid','mid', 2500000, 3800000,'TZS', true, 2,'B','active', current_date + 28,'10000000-0000-0000-0000-000000000007'),
  ('a0000005-0000-0000-0000-000000000005','55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222',
   'IT Support Technician','IT','Provide first-line technical support to internal teams and clients.',
   'Resolve helpdesk tickets; set up hardware; manage accounts.','1+ year in IT support; Windows; basic networking.',
   'TZ','Dar es Salaam','full_time','on_site','entry', 900000, 1300000,'TZS', false, 1,'A','active', current_date + 21,'10000000-0000-0000-0000-000000000007'),
  ('a0000006-0000-0000-0000-000000000006','66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222',
   'Registered Nurse','Clinical','Provide outpatient nursing care at a busy community clinic.',
   'Assess and triage patients; administer treatments; keep records.','Registered nurse licence; 2+ years clinical experience.',
   'TZ','Arusha','full_time','on_site','mid', 1200000, 1800000,'TZS', true, 2,'B','active', current_date + 30,'10000000-0000-0000-0000-000000000007'),
  ('a0000007-0000-0000-0000-000000000007','66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222',
   'Clinic Receptionist','Front Office','Be the first point of contact for patients at the clinic front desk.',
   'Greet patients; book appointments; manage records and calls.','Excellent communication in English & Swahili; MS Office.',
   'TZ','Arusha','full_time','on_site','entry', 700000, 1000000,'TZS', false, 1,'A','active', current_date + 21,'10000000-0000-0000-0000-000000000007'),
  ('a0000008-0000-0000-0000-000000000008','77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222',
   'Hotel Front Desk Agent','Front Office','Deliver a warm arrival experience for resort guests.',
   'Check guests in/out; handle reservations; resolve requests.','Customer-service experience; fluent English; shift work.',
   'TZ','Zanzibar','full_time','on_site','entry', 800000, 1100000,'TZS', false, 3,'A','active', current_date + 24,'10000000-0000-0000-0000-000000000008'),
  ('a0000009-0000-0000-0000-000000000009','77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222',
   'Executive Chef','Kitchen','Lead the culinary operation for a beachfront resort.',
   'Design menus; manage kitchen staff; control food cost and safety.','5+ years senior kitchen experience; food-safety certification.',
   'TZ','Zanzibar','full_time','on_site','senior', 2200000, 3000000,'TZS', true, 1,'B','active', current_date + 35,'10000000-0000-0000-0000-000000000008'),
  ('a0000010-0000-0000-0000-000000000010','88888888-8888-8888-8888-888888888888','22222222-2222-2222-2222-222222222222',
   'Production Supervisor','Production','Supervise a manufacturing line and its shift team.',
   'Plan shifts; monitor output and quality; enforce safety.','2+ years supervising production; quality-control experience.',
   'TZ','Mwanza','full_time','on_site','mid', 1600000, 2300000,'TZS', true, 1,'B','active', current_date + 28,'10000000-0000-0000-0000-000000000008'),
  ('a0000011-0000-0000-0000-000000000011','88888888-8888-8888-8888-888888888888','22222222-2222-2222-2222-222222222222',
   'Warehouse Assistant','Warehouse','Support receiving, storage and dispatch in the plant warehouse.',
   'Receive and store stock; pick and pack; update inventory.','Attention to detail; forklift licence a plus.',
   'TZ','Mwanza','full_time','on_site','entry', 600000, 1000000,'TZS', false, 2,'A','active', current_date + 18,'10000000-0000-0000-0000-000000000008'),
  ('a0000012-0000-0000-0000-000000000012','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
   'Accountant','Finance','Own monthly reporting and the close for a financial group.',
   'Prepare financial statements; manage close; support audits.','Degree in accounting; 3+ years; strong Excel.',
   'TZ','Dar es Salaam','full_time','hybrid','mid', 1900000, 2700000,'TZS', true, 1,'B','active', current_date + 30,'10000000-0000-0000-0000-000000000007'),
  ('a0000013-0000-0000-0000-000000000013','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222',
   'Fleet Dispatch Officer','Operations','Coordinate drivers and dispatch across the Dar es Salaam corridor.',
   'Plan routes; assign drivers; track deliveries and report KPIs.','2+ years in logistics/dispatch; strong coordination skills.',
   'TZ','Dar es Salaam','full_time','on_site','mid', 1300000, 1900000,'TZS', false, 1,'B','active', current_date + 20,'10000000-0000-0000-0000-000000000008')
on conflict (id) do nothing;

insert into public.jobs (id, job_order_id, status, public_slug, published_at) values
  ('b0000004-0000-0000-0000-000000000004','a0000004-0000-0000-0000-000000000004','advertised','software-developer-kilimanjaro-tech', now()),
  ('b0000005-0000-0000-0000-000000000005','a0000005-0000-0000-0000-000000000005','advertised','it-support-technician-kilimanjaro-tech', now()),
  ('b0000006-0000-0000-0000-000000000006','a0000006-0000-0000-0000-000000000006','advertised','registered-nurse-uhuru-health', now()),
  ('b0000007-0000-0000-0000-000000000007','a0000007-0000-0000-0000-000000000007','advertised','clinic-receptionist-uhuru-health', now()),
  ('b0000008-0000-0000-0000-000000000008','a0000008-0000-0000-0000-000000000008','advertised','hotel-front-desk-agent-zanzibar-coastal', now()),
  ('b0000009-0000-0000-0000-000000000009','a0000009-0000-0000-0000-000000000009','advertised','executive-chef-zanzibar-coastal', now()),
  ('b0000010-0000-0000-0000-000000000010','a0000010-0000-0000-0000-000000000010','advertised','production-supervisor-tembo', now()),
  ('b0000011-0000-0000-0000-000000000011','a0000011-0000-0000-0000-000000000011','advertised','warehouse-assistant-tembo', now()),
  ('b0000012-0000-0000-0000-000000000012','a0000012-0000-0000-0000-000000000012','advertised','accountant-bahari', now()),
  ('b0000013-0000-0000-0000-000000000013','a0000013-0000-0000-0000-000000000013','advertised','fleet-dispatch-officer-serengeti', now())
on conflict (id) do nothing;

-- ---- 7) Assign the new jobs to the two new recruiters -----------------------
insert into public.job_assignments (job_order_id, recruiter_user_id, role) values
  ('a0000004-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000007','owner'),
  ('a0000005-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000007','owner'),
  ('a0000006-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000007','owner'),
  ('a0000007-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000007','owner'),
  ('a0000012-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000007','owner'),
  ('a0000008-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000008','owner'),
  ('a0000009-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000008','owner'),
  ('a0000010-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000008','owner'),
  ('a0000011-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000008','owner'),
  ('a0000013-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000008','owner')
on conflict (job_order_id, recruiter_user_id) do nothing;

-- ---- 8) A few screening questions on selected jobs --------------------------
-- (job_screening_questions has no natural unique key; clear-then-insert keeps
--  this idempotent on re-run for these newly-created job orders.)
delete from public.job_screening_questions where job_order_id in (
  'a0000004-0000-0000-0000-000000000004','a0000006-0000-0000-0000-000000000006',
  'a0000009-0000-0000-0000-000000000009','a0000012-0000-0000-0000-000000000012'
);
insert into public.job_screening_questions (job_order_id, prompt, qtype, is_required, ordinal) values
  ('a0000004-0000-0000-0000-000000000004','Are you legally permitted to work in Tanzania?','boolean', true, 1),
  ('a0000004-0000-0000-0000-000000000004','How many years of professional software development do you have?','numeric', true, 2),
  ('a0000006-0000-0000-0000-000000000006','Do you hold a current nursing registration/licence?','boolean', true, 1),
  ('a0000009-0000-0000-0000-000000000009','Do you hold a valid food-safety certification?','boolean', true, 1),
  ('a0000012-0000-0000-0000-000000000012','What is your notice period?','short_text', false, 1)
on conflict do nothing;

-- Refresh the API schema cache.
notify pgrst, 'reload schema';

-- Sanity checks (optional):
-- select email, raw_user_meta_data->>'role' as role from auth.users where email like '%@shugulika.test' order by email;
-- select title, city, status from public.job_orders order by created_at;
-- select given_name, family_name, headline, city from public.candidate_profiles order by created_at;
