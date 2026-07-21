-- =============================================================================
-- Simplify the recruiter pipeline to the MVP candidate flow:
--   CV Review → Testing → Test Review → Interview Screening → Interview Review
--   → (optional) Reference Checks → Client Submission → Offer → Hired
-- Rejection is permanent and records the stage where it happened.
-- Backward stage moves are blocked in application code.
-- =============================================================================

-- New / updated candidate stages (upsert by key).
insert into public.pipeline_stages (key, label, ordinal, stage_class) values
  ('cv_review','CV Review',2,'candidate'),
  ('testing','Testing',3,'candidate'),
  ('test_review','Test Review / Grading',4,'candidate'),
  ('interview_screening','Interview Screening',5,'candidate'),
  ('interview_review','Interview Review',6,'candidate'),
  ('reference_checks','Reference Checks',7,'candidate'),
  ('client_submission','Client Submission',8,'candidate'),
  ('offer','Offer',9,'candidate'),
  ('hired','Hired',10,'candidate'),
  ('rejected','Rejected',11,'candidate'),
  ('advertised','Advertised',1,'job'),
  ('invoiced','Invoiced',12,'accounts'),
  ('closed','Closed',13,'job')
on conflict (key) do update set
  label = excluded.label,
  ordinal = excluded.ordinal,
  stage_class = excluded.stage_class;

-- Keep legacy keys for historical stage_history rows (high ordinals, unused by UI).
insert into public.pipeline_stages (key, label, ordinal, stage_class) values
  ('applied_sourced','Applied / Sourced',102,'candidate'),
  ('cv_screening','CV Screening',103,'candidate'),
  ('longlisted','Longlisted',104,'candidate'),
  ('ai_interview_screening','AI Interview Screening',105,'candidate'),
  ('shortlisted','Shortlisted',106,'candidate'),
  ('screening_interview','Screening Interview',107,'candidate'),
  ('client_interview','Client Interview',108,'candidate')
on conflict (key) do update set
  label = excluded.label,
  ordinal = excluded.ordinal,
  stage_class = excluded.stage_class;

-- Permanent rejection metadata on applications.
alter table public.applications
  add column if not exists rejected_from_stage text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;

-- Remap live applications onto the simplified spine.
update public.applications set current_stage = 'cv_review'
  where current_stage in ('applied_sourced','cv_screening','longlisted');

update public.applications set current_stage = 'interview_screening'
  where current_stage in ('ai_interview_screening','shortlisted','screening_interview');

update public.applications set current_stage = 'client_submission'
  where current_stage = 'client_interview';

-- Default for new applications.
alter table public.applications
  alter column current_stage set default 'cv_review';

notify pgrst, 'reload schema';
