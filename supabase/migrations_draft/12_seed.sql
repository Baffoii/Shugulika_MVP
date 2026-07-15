-- =============================================================================
-- File 12: Seed stable reference data + roles/permissions + Tanzania pilot config.
-- Idempotent-friendly (on conflict do nothing). Values only; durations = OD-7.
-- =============================================================================

-- ---- Currencies & countries (Tanzania active; others reserved) -------------
insert into public.currencies (iso_code,name,symbol,minor_unit) values
  ('TZS','Tanzanian Shilling','TSh',2),('USD','US Dollar','$',2),
  ('KES','Kenyan Shilling','KSh',2),('GHS','Ghanaian Cedi','₵',2)
on conflict (iso_code) do nothing;

insert into public.countries (iso2,iso3,name,dial_code,is_active,sort_order) values
  ('TZ','TZA','Tanzania','+255',true,1),
  ('KE','KEN','Kenya','+254',false,2),
  ('GH','GHA','Ghana','+233',false,3)
on conflict (iso2) do nothing;
update public.countries set default_currency_id=(select id from public.currencies where iso_code='TZS') where iso2='TZ';

-- ---- Languages (en active; others reserved) --------------------------------
insert into public.languages (code,name,native_name,is_rtl,is_active) values
  ('en','English','English',false,true),
  ('sw','Swahili','Kiswahili',false,false),
  ('fr','French','Français',false,false),
  ('ar','Arabic','العربية',true,false)
on conflict (code) do nothing;

-- ---- Education levels -------------------------------------------------------
insert into public.education_levels (name,rank) values
  ('No formal qualification',0),('Secondary school',1),('Vocational / professional training',2),
  ('Certificate',3),('Diploma',4),('Bachelor',5),('Postgraduate diploma',6),('Master',7),('Doctorate',8)
on conflict do nothing;

-- ---- Employment types / work arrangements ----------------------------------
insert into public.employment_types (name) values ('full_time'),('part_time'),('contract'),('internship') on conflict do nothing;
insert into public.work_arrangements (name) values ('remote'),('hybrid'),('on_site') on conflict do nothing;

-- ---- Document types ---------------------------------------------------------
insert into public.document_types (key,name,category,default_visibility,default_retention) values
  ('cv','CV','candidate','private','retain'),
  ('cover_letter','Cover Letter','candidate','private','retain'),
  ('id_document','Identity Document','candidate','private','purge'),
  ('certificate','Certificate','candidate','private','retain'),
  ('licence','Licence','candidate','private','retain'),
  ('transcript','Academic Transcript','candidate','private','retain'),
  ('work_sample','Work Sample','candidate','private','retain'),
  ('portfolio','Portfolio','candidate','private','retain'),
  ('interview_recording','Interview Recording','interview','franchise_internal','purge'),
  ('interview_audio','Interview Audio','interview','franchise_internal','purge'),
  ('transcript_file','Transcript File','interview','franchise_internal','purge'),
  ('watermarked_preview','Watermarked Preview','candidate','submission_only','purge'),
  ('payment_proof','Payment Proof','payment','org_internal','retain'),
  ('org_branding','Organization Branding','branding','org_internal','retain')
on conflict (key) do nothing;

-- ---- Interview & verification types ----------------------------------------
insert into public.interview_types (key,name) values
  ('phone_screen','Phone Screening'),('recruiter','Recruiter Interview'),('employer','Employer Interview'),
  ('live_video','Live Video'),('in_person','In Person'),('ai_async','AI Asynchronous Video')
on conflict (key) do nothing;
insert into public.verification_types (key,name) values
  ('email','Email Verification'),('phone','Phone Verification'),('identity_document','Identity Document'),
  ('manual','Manual Verification'),('employer_required','Employer-Required Verification')
on conflict (key) do nothing;

-- ---- The 15-stage Spine (stage_class separates job/candidate/placement/accounts)
insert into public.pipeline_stages (key,label,ordinal,stage_class,is_gated,blocking_rule) values
  ('advertised','Advertised',1,'job',false,null),
  ('applied_sourced','Applied / Sourced',2,'candidate',false,null),
  ('cv_screening','CV Screening',3,'candidate',false,null),
  ('longlisted','Longlisted',4,'candidate',false,null),
  ('ai_interview_screening','AI Interview Screening',5,'candidate',false,null),
  ('shortlisted','Shortlisted',6,'candidate',true,'requires_screening_scorecard'),
  ('screening_interview','Screening Interview',7,'candidate',false,null),
  ('testing','Testing',8,'candidate',false,null),
  ('reference_checks','Reference Checks',9,'candidate',false,null),
  ('client_submission','Client Submission',10,'candidate',true,'requires_employer_consent'),
  ('client_interview','Client Interview',11,'candidate',false,null),
  ('offer','Offer',12,'candidate',false,null),
  ('hired','Hired',13,'candidate',true,'requires_accepted_offer'),
  ('invoiced','Invoiced',14,'accounts',false,null),
  ('closed','Closed',15,'job',false,null)
on conflict (key) do nothing;

-- ---- Candidate sources ------------------------------------------------------
insert into public.candidate_sources (key,name) values
  ('applied_direct','Applied Directly'),('recruiter_sourced','Recruiter Sourced'),
  ('referral','Referral'),('imported','Controlled Import'),('recruiter_created','Recruiter Created')
on conflict (key) do nothing;

-- ---- Rejection reasons (from S5/S6) ----------------------------------------
insert into public.rejection_reasons (key,name,applies_to,requires_note) values
  ('min_experience','Does not meet minimum experience','application',false),
  ('missing_skill','Missing required skill','application',false),
  ('education_mismatch','Education / certification mismatch','application',false),
  ('location_mobility','Location or mobility mismatch','application',false),
  ('work_authorization','Work authorization issue','application',false),
  ('salary_misaligned','Salary expectations misaligned','application',false),
  ('assessment_result','Assessment result','application',false),
  ('interview_outcome','Interview outcome','application',false),
  ('reference_concern','Reference concern','application',false),
  ('client_decision','Client decision','application',false),
  ('candidate_withdrew','Candidate withdrew','application',false),
  ('candidate_unreachable','Candidate unreachable','application',false),
  ('duplicate','Duplicate application','application',false),
  ('role_filled','Role filled or cancelled','application',false),
  ('other','Other','any',true)
on conflict (key) do nothing;

-- ---- Notification categories & channels ------------------------------------
insert into public.notification_categories (key,label,default_channels,is_marketing) values
  ('account','Account & Security','{email,in_app}',false),
  ('application_status','Application Status','{email,in_app}',false),
  ('interview','Interview','{email,in_app}',false),
  ('offer','Offer','{email,in_app}',false),
  ('invoice','Invoice','{email}',false),
  ('marketing','Marketing','{email}',true),
  ('whistleblowing_ack','Whistleblowing Acknowledgement','{email}',false)
on conflict (key) do nothing;
insert into public.channels (key,label,is_active) values
  ('email','Email',true),('sms','SMS',true),('in_app','In-App',true),
  ('whatsapp','WhatsApp',false),('push','Push',false)   -- whatsapp reserved/inactive (R-110)
on conflict (key) do nothing;

-- ---- Consent purposes (R-031) ----------------------------------------------
insert into public.consent_purposes (key,label,requires_recipient,is_special_category) values
  ('profile_creation','Create & maintain profile',false,false),
  ('searchable_fields','Allow searchable profile fields',false,false),
  ('franchise_processing','Allow recruiter/franchise processing',true,false),
  ('employer_submission','Submit to a specific employer',true,false),
  ('share_unmasked','Share unmasked information',true,false),
  ('share_document','Share a CV / document',true,false),
  ('record_ai_interview','Record & process AI video interview',false,true),
  ('transcribe_interview','Transcribe interview',false,false),
  ('ai_analysis','Use AI to analyze interview',false,true),
  ('cross_border','Cross-border processing / disclosure',true,false),
  ('marketing','Marketing & communications',false,false),
  ('whatsapp','WhatsApp communication',false,false),
  ('guardian','Guardian / parental consent',false,true)
on conflict (key) do nothing;

-- ---- Roles ------------------------------------------------------------------
insert into public.roles (key,display_name,scope_level) values
  ('super_admin','Super Admin','platform'),
  ('hq_recruiter','HQ Recruiter','platform'),
  ('hq_accounts','HQ Accounts','platform'),
  ('hq_content','HQ Content','platform'),
  ('franchise_owner','Franchise Owner / Country Admin','franchise'),
  ('franchise_recruiter','Franchise Recruiter','franchise'),
  ('franchise_accounts','Franchise Accounts','franchise'),
  ('employer_admin','Employer Company Admin','employer'),
  ('employer_hiring','Employer Hiring Team Member','employer'),
  ('candidate','Candidate','self')
on conflict (key) do nothing;

-- ---- Permissions ------------------------------------------------------------
insert into public.permissions (key,description,category) values
  ('platform.super_admin','Full platform administration','platform'),
  ('hq.oversight.read','Controlled HQ oversight read','hq'),
  ('config.manage','Manage reference/config','config'),
  ('team.manage','Manage org team & memberships','org'),
  ('permissions.manage','Manage roles/permissions in own org','org'),
  ('candidate.create','Create candidate records','candidate'),
  ('candidate.search','Search shared candidate pool','candidate'),
  ('candidate.export','Export candidate data (SA only)','candidate'),
  ('engagement.create','Create/manage franchise engagement','pipeline'),
  ('application.review','Review applications','pipeline'),
  ('application.advance','Advance pipeline stages','pipeline'),
  ('application.reject','Reject applications','pipeline'),
  ('reference.read','Read reference checks','pipeline'),
  ('reference.write','Write reference checks','pipeline'),
  ('submission.create','Create client submissions','submission'),
  ('submission.decide','Employer submission decisions','submission'),
  ('consent.request','Request candidate consent','consent'),
  ('interview.manage','Manage interviews','interview'),
  ('offer.manage','Manage offers','offer'),
  ('invoice.issue','Issue invoices','billing'),
  ('invoice.edit','Edit invoices','billing'),
  ('payment.record','Record payments','billing'),
  ('document.download','Download documents','documents'),
  ('safeguarding.read','Access whistleblowing cases','safeguarding'),
  ('audit.read','Read audit log','audit')
on conflict (key) do nothing;

-- ---- Role → permission grants (illustrative; refine per docs/database/07 matrix)
-- super_admin gets everything:
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p where r.key='super_admin'
on conflict do nothing;
-- franchise_recruiter:
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.key in ('candidate.create','candidate.search','engagement.create','application.review',
               'application.advance','application.reject','reference.read','reference.write',
               'submission.create','consent.request','interview.manage','offer.manage','document.download')
where r.key='franchise_recruiter'
on conflict do nothing;
-- franchise_accounts:
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.key in ('invoice.issue','invoice.edit','payment.record')
where r.key='franchise_accounts'
on conflict do nothing;
-- franchise_owner (adds team/permission mgmt on top of recruiter+accounts):
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.key in ('team.manage','permissions.manage','hq.oversight.read')
where r.key='franchise_owner'
on conflict do nothing;
-- employer_admin / employer_hiring:
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.key in ('submission.decide','offer.manage','candidate.search')
where r.key='employer_admin'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.key in ('submission.decide')
where r.key='employer_hiring'
on conflict do nothing;

-- ---- Packages (Tier 1/2/3) + entitlements (literal limits; no credits) -----
insert into public.packages (key,name,package_type) values
  ('tier_1','Tier 1','subscription'),('tier_2','Tier 2','subscription'),('tier_3','Tier 3','subscription'),
  ('addon_test','Assessment Add-on','addon')
on conflict (key) do nothing;

do $$
declare v_pkg uuid; v_ver uuid;
begin
  -- Tier 1: 3 postings, 10 candidate-profile accesses/period
  select id into v_pkg from public.packages where key='tier_1';
  insert into public.package_versions(package_id,version_no,is_current) values (v_pkg,1,true) returning id into v_ver;
  insert into public.package_entitlements(package_version_id,entitlement_key,limit_value,period) values
    (v_ver,'active_job_postings',3,'billing_cycle'),
    (v_ver,'candidate_profile_access_per_period',10,'billing_cycle'),
    (v_ver,'employer_users',2,'none');
  -- Tier 2: 7 postings, 20 accesses
  select id into v_pkg from public.packages where key='tier_2';
  insert into public.package_versions(package_id,version_no,is_current) values (v_pkg,1,true) returning id into v_ver;
  insert into public.package_entitlements(package_version_id,entitlement_key,limit_value,period) values
    (v_ver,'active_job_postings',7,'billing_cycle'),
    (v_ver,'candidate_profile_access_per_period',20,'billing_cycle'),
    (v_ver,'employer_users',3,'none');
  -- Tier 3: 15 postings, 30 accesses
  select id into v_pkg from public.packages where key='tier_3';
  insert into public.package_versions(package_id,version_no,is_current) values (v_pkg,1,true) returning id into v_ver;
  insert into public.package_entitlements(package_version_id,entitlement_key,limit_value,period) values
    (v_ver,'active_job_postings',15,'billing_cycle'),
    (v_ver,'candidate_profile_access_per_period',30,'billing_cycle'),
    (v_ver,'employer_users',5,'none');
end $$;

-- ---- Feature flags (WhatsApp & AI off; prod-data gated by OD-6) ------------
insert into public.feature_flags (key,is_enabled,scope,notes) values
  ('whatsapp_enabled',false,'global','Channel reserved; not implemented (R-110)'),
  ('ai_interview_enabled',false,'global','AI interviews deferred pending fairness/vendor (OD-8)'),
  ('production_data_mode',false,'global','Gate: enable only after PDPC/DPO/DPIA/cross-border (R-132/OD-6)')
on conflict (key) do nothing;

-- ---- Retention policies (provisional durations — confirm with counsel, OD-7)
insert into public.retention_policies (entity_type,retention_action,retention_period,basis) values
  ('application_rejections','retain','24 months','operational + fairness review'),
  ('interview_recordings','purge','12 months','minimization'),
  ('ai_transcripts','purge','12 months','minimization'),
  ('ai_evaluations','purge','24 months','decision traceability'),
  ('candidate_id_evidence','purge','90 days','post-verification minimization'),
  ('audit_log','retain','7 years','statutory'),
  ('consent_records','retain','7 years','legal evidence'),
  ('invoices','retain','7 years','statutory')
on conflict (entity_type) do nothing;

-- ---- HQ organization (Tanzania) --------------------------------------------
insert into public.organizations (organization_type,legal_name,slug,country_id,status)
select 'hq','Shugulika Africa HQ','hq',(select id from public.countries where iso2='TZ'),'active'
where not exists (select 1 from public.organizations where organization_type='hq');

-- ---- Legal document versions (placeholders; replace with approved text) -----
insert into public.legal_document_versions (document_kind,version_no,locale,title,body,is_current) values
  ('privacy_policy',1,'en','Privacy Policy (Draft)','TBD — pending DPO/PDPC (OD-6).',true),
  ('terms',1,'en','Terms of Service (Draft)','TBD.',true),
  ('consent_text',1,'en','Application Consent (Draft)','I agree that Shugulika may process this application and share the information shown with the employer or recruitment team handling this position.',true)
on conflict (document_kind,version_no,locale) do nothing;
