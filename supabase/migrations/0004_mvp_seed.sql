-- =============================================================================
-- Shugulika MVP — seed data.
-- (1) Reference data (always safe).
-- (2) A small demo scenario that does NOT require auth users: orgs + advertised
--     jobs, so the PUBLIC JOB BOARD works immediately after setup.
-- Candidate/recruiter/employer demo records need real auth users; create them
-- with the documented dev procedure in the README, then run 0005_dev_demo.sql
-- (optional) after replacing the placeholder user IDs.
-- Idempotent where practical.
-- =============================================================================

-- ---- Reference: countries ---------------------------------------------------
insert into public.countries (code, name, currency, is_active, sort_order) values
  ('TZ','Tanzania','TZS', true, 1),
  ('KE','Kenya','KES', false, 2),
  ('GH','Ghana','GHS', false, 3)
on conflict (code) do update set name = excluded.name, currency = excluded.currency, is_active = excluded.is_active;

-- ---- Reference: pipeline stages (the 15-stage Spine) ------------------------
insert into public.pipeline_stages (key, label, ordinal, stage_class) values
  ('advertised','Advertised',1,'job'),
  ('applied_sourced','Applied / Sourced',2,'candidate'),
  ('cv_screening','CV Screening',3,'candidate'),
  ('longlisted','Longlisted',4,'candidate'),
  ('ai_interview_screening','AI Interview Screening',5,'candidate'),
  ('shortlisted','Shortlisted',6,'candidate'),
  ('screening_interview','Screening Interview',7,'candidate'),
  ('testing','Testing',8,'candidate'),
  ('reference_checks','Reference Checks',9,'candidate'),
  ('client_submission','Client Submission',10,'candidate'),
  ('client_interview','Client Interview',11,'candidate'),
  ('offer','Offer',12,'candidate'),
  ('hired','Hired',13,'candidate'),
  ('invoiced','Invoiced',14,'accounts'),
  ('closed','Closed',15,'job')
on conflict (key) do update set label = excluded.label, ordinal = excluded.ordinal, stage_class = excluded.stage_class;

-- ---- Reference: rejection reasons ------------------------------------------
insert into public.rejection_reasons (key, label, applies_to) values
  ('min_experience','Does not meet minimum experience','application'),
  ('missing_skill','Missing required skill','application'),
  ('education_mismatch','Education / certification mismatch','application'),
  ('location_mobility','Location or mobility mismatch','application'),
  ('work_authorization','Work authorization issue','application'),
  ('salary_misaligned','Salary expectations misaligned','application'),
  ('assessment_result','Assessment result','application'),
  ('interview_outcome','Interview outcome','application'),
  ('reference_concern','Reference concern','application'),
  ('client_decision','Client decision','application'),
  ('candidate_withdrew','Candidate withdrew','application'),
  ('candidate_unreachable','Candidate unreachable','application'),
  ('duplicate','Duplicate application','application'),
  ('role_filled','Role filled or cancelled','application'),
  ('other','Other','any')
on conflict (key) do nothing;

-- ---- Reference: packages + entitlements ------------------------------------
insert into public.packages (key, name, tier) values
  ('tier_1','Tier 1',1),('tier_2','Tier 2',2),('tier_3','Tier 3',3)
on conflict (key) do nothing;
insert into public.package_entitlements (package_id, key, limit_value)
select p.id, e.key, e.lim from public.packages p
join (values
  ('tier_1','active_job_postings',3),('tier_1','candidate_profile_access_per_period',10),('tier_1','employer_users',2),
  ('tier_2','active_job_postings',7),('tier_2','candidate_profile_access_per_period',20),('tier_2','employer_users',3),
  ('tier_3','active_job_postings',15),('tier_3','candidate_profile_access_per_period',30),('tier_3','employer_users',5)
) as e(pkey,key,lim) on e.pkey = p.key
where not exists (select 1 from public.package_entitlements pe where pe.package_id = p.id and pe.key = e.key);

-- ---- Reference: feature flags + integration placeholders -------------------
insert into public.feature_flags (key, is_enabled, notes) values
  ('whatsapp_enabled', false, 'WhatsApp channel reserved; not implemented in MVP.'),
  ('ai_interview_enabled', false, 'AI interviews are placeholders pending vendor/fairness review.'),
  ('sms_otp_enabled', false, 'Phone OTP pending SMS provider. Email verification used meanwhile.'),
  ('payments_enabled', false, 'No live payment provider connected.')
on conflict (key) do nothing;

insert into public.integration_connections (key, name, status) values
  ('ai_video_interview','AI Video Interviews','integration_pending'),
  ('assessments','Assessments (TestGorilla / Central Test)','integration_pending'),
  ('whatsapp','WhatsApp','integration_pending'),
  ('payments','Payments (Flutterwave / Selcom)','not_enabled'),
  ('social_publishing','Social & Job-board Publishing','coming_soon'),
  ('watermarking','Document Watermarking','integration_pending')
on conflict (key) do nothing;

-- ---- Demo orgs (no auth users required) ------------------------------------
-- Stable UUIDs so re-running / dev demo scripts can reference them.
insert into public.organizations (id, org_type, name, country_code, status, verification_status) values
  ('11111111-1111-1111-1111-111111111111','hq','Shugulika Africa HQ','TZ','active','verified')
on conflict (id) do nothing;
insert into public.organizations (id, org_type, name, country_code, parent_id, status, verification_status) values
  ('22222222-2222-2222-2222-222222222222','franchise','Shugulika Tanzania (Dar es Salaam)','TZ','11111111-1111-1111-1111-111111111111','active','verified')
on conflict (id) do nothing;
insert into public.organizations (id, org_type, name, country_code, parent_id, status, industry, website, company_size, verification_status) values
  ('33333333-3333-3333-3333-333333333333','employer','Bahari Financial Group','TZ','22222222-2222-2222-2222-222222222222','active','Financial Services','https://example.com','201-500','verified'),
  ('44444444-4444-4444-4444-444444444444','employer','Serengeti Logistics','TZ','22222222-2222-2222-2222-222222222222','active','Logistics','https://example.com','51-200','pending')
on conflict (id) do nothing;

-- ---- Demo job orders + advertised jobs (public board works immediately) ----
insert into public.job_orders
  (id, employer_org_id, responsible_org_id, title, department, description, responsibilities, requirements,
   country_code, city, employment_type, work_arrangement, experience_level, salary_min, salary_max, salary_currency,
   salary_public, vacancy_count, recruitment_path, status, application_deadline)
values
  ('a0000001-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
   'Financial Analyst','Finance','Analyse financial performance and support planning for a growing pan-African financial group.',
   'Build models; prepare monthly reporting; support budgeting.','2+ years in financial analysis; strong Excel; CPA in progress a plus.',
   'TZ','Dar es Salaam','full_time','hybrid','mid', 1800000, 2600000, 'TZS', true, 1, 'B','active', current_date + 21),
  ('a0000002-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
   'Customer Success Associate','Operations','Own client relationships and drive product adoption for SME banking customers.',
   'Onboard clients; resolve queries; track satisfaction.','1+ year in customer-facing roles; excellent communication in English & Swahili.',
   'TZ','Dar es Salaam','full_time','on_site','entry', null, null, 'TZS', false, 2, 'A','active', current_date + 30),
  ('a0000003-0000-0000-0000-000000000003','44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222',
   'Logistics Coordinator','Operations','Coordinate fleet and warehouse operations across the Dar es Salaam corridor.',
   'Plan routes; manage dispatch; report KPIs.','2+ years in logistics or supply chain; valid driver''s licence.',
   'TZ','Dar es Salaam','full_time','on_site','mid', 1400000, 2000000, 'TZS', true, 1, 'B','active', current_date + 14)
on conflict (id) do nothing;

insert into public.jobs (id, job_order_id, status, public_slug, published_at) values
  ('b0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000001','advertised','financial-analyst-bahari', now()),
  ('b0000002-0000-0000-0000-000000000002','a0000002-0000-0000-0000-000000000002','advertised','customer-success-associate-bahari', now()),
  ('b0000003-0000-0000-0000-000000000003','a0000003-0000-0000-0000-000000000003','advertised','logistics-coordinator-serengeti', now())
on conflict (id) do nothing;

insert into public.job_screening_questions (job_order_id, prompt, qtype, is_required, ordinal) values
  ('a0000001-0000-0000-0000-000000000001','Are you legally permitted to work in Tanzania?','boolean', true, 1),
  ('a0000001-0000-0000-0000-000000000001','How many years of financial analysis experience do you have?','numeric', true, 2),
  ('a0000001-0000-0000-0000-000000000001','What is your notice period?','short_text', false, 3)
on conflict do nothing;

-- Refresh PostgREST's schema cache so the API immediately sees the new tables
-- and views (fixes "Could not find the table 'public.public_jobs' in the schema
-- cache"). Supabase usually reloads automatically; this makes it deterministic.
notify pgrst, 'reload schema';
